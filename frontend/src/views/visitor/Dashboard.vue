<template>
  <div class="pub-shell">
    <header class="pub-topbar">
      <div class="pub-brand">
        <svg viewBox="0 0 24 24" width="22" height="22" fill="none">
          <rect x="2" y="2" width="20" height="20" rx="5" fill="currentColor"/>
          <path d="M7 14l3-3 3 3 4-6" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
        <div class="pub-brand-text">
          <span class="pub-brand-name">Zero Ben Securities</span>
          <span class="pub-brand-sub">AI-Native 交易演示平台</span>
        </div>
      </div>
      <div class="pub-meta">
        <span :class="['status-pill', marketOpen ? 'open' : 'closed']">
          <span class="status-dot"></span>
          {{ marketOpen ? '交易时段' : '非交易时段' }}
        </span>
        <span class="mono pub-clock">{{ nowText }}</span>
        <span class="text-faint pub-sync hide-mobile">最近刷新 {{ lastSyncText }}</span>
        <button class="btn btn-secondary btn-sm" :disabled="syncing" @click="refreshOverview">{{ syncing ? '刷新中…' : '刷新' }}</button>
        <router-link to="/login" class="btn btn-primary btn-sm">管理登录</router-link>
      </div>
    </header>

    <div class="pub-page">
      <!-- Hero — ChatGPT style -->
      <section class="pub-hero">
        <div class="hero-amount-block" :class="trendClass">
          <p class="kicker">组合总览 · {{ trendLabel }}</p>
          <h1 class="hero-amount">
            <span class="amount-symbol">¥</span>{{ formatMoney(data.assets.total) }}
          </h1>
          <div class="hero-trendline">
            <span class="trend-tag" :class="trendClass">
              {{ trendArrow }} {{ formatMoney(Math.abs(Number(data.assets.day_pnl))) }}
            </span>
            <span class="trend-pct mono">{{ formatPct(data.assets.day_pct) }}</span>
            <span class="trend-meta">当日盈亏</span>
          </div>
        </div>

        <div class="hero-stat-grid">
          <div class="hero-stat" :class="getTrendClass(data.assets.return_total_pct)">
            <span class="hs-label">累计收益</span>
            <span class="hs-value mono">{{ formatPct(data.assets.return_total_pct) }}</span>
          </div>
          <div class="hero-stat">
            <span class="hs-label">证券市值</span>
            <span class="hs-value mono">¥{{ formatMoney(data.assets.market_cap) }}</span>
          </div>
          <div class="hero-stat">
            <span class="hs-label">可用资金</span>
            <span class="hs-value mono">¥{{ formatMoney(data.assets.balance) }}</span>
          </div>
          <div class="hero-stat">
            <span class="hs-label">冻结资金</span>
            <span class="hs-value mono text-muted">¥{{ formatMoney(data.assets.frozen) }}</span>
          </div>
          <div class="hero-stat" :class="getTrendClass(data.assets.pnl_holding)">
            <span class="hs-label">持仓浮盈</span>
            <span class="hs-value mono">{{ Number(data.assets.pnl_holding) >= 0 ? '+' : '−' }}¥{{ formatMoney(Math.abs(Number(data.assets.pnl_holding))) }}</span>
          </div>
          <div class="hero-stat">
            <span class="hs-label">今日成交</span>
            <span class="hs-value mono">{{ data.logs.length }} <em>笔</em></span>
          </div>
        </div>

        <div class="hero-chart surface">
          <div class="chart-head">
            <div>
              <p class="kicker">资产曲线</p>
              <p class="chart-meta">{{ chartEmpty ? '暂无图表数据' : `样本 ${chartPoints.length} 条 · 最新 ¥${formatMoney(latestAssetValue)}` }}</p>
            </div>
            <div class="chart-legend">
              <span :class="['legend-dot', trendClass]"></span>
              <span>{{ trendLabel }}</span>
            </div>
          </div>
          <div ref="chartRef" class="chart-box"></div>
        </div>
      </section>

      <!-- Trades + AI -->
      <section class="pub-main">
        <article class="surface panel">
          <header class="panel-head">
            <div>
              <h2 class="t-title">成交播报</h2>
              <p class="t-sub">最近交易动态</p>
            </div>
            <span class="tag tag-neutral">{{ data.logs.length }} 条</span>
          </header>
          <div v-if="data.logs.length === 0" class="empty"><span class="empty-title">暂无成交</span></div>
          <div v-else class="feed-list scroll-thin">
            <article v-for="(log, idx) in data.logs" :key="idx" class="feed-item">
              <div class="feed-top">
                <span :class="['side-pill', log.side === 'BUY' ? 'side-buy' : 'side-sell']">{{ log.side === 'BUY' ? 'B' : 'S' }}</span>
                <span class="mono feed-time">{{ log.time || '--' }}</span>
              </div>
              <div class="feed-main">{{ log.text || '--' }}</div>
              <div class="feed-sub mono">{{ log.detail || '' }}</div>
            </article>
          </div>
        </article>

        <article class="surface panel">
          <header class="panel-head">
            <div>
              <h2 class="t-title">AI 自动交易</h2>
              <p class="t-sub">最近一次 AI 委员会决策</p>
            </div>
            <span :class="['tag', data.ai?.enabled ? 'tag-up' : 'tag-neutral']">{{ data.ai?.enabled ? 'AUTO ON' : 'AUTO OFF' }}</span>
          </header>
          <div v-if="!aiLatest" class="empty"><span class="empty-title">暂无 AI 运行记录</span></div>
          <div v-else class="ai-content">
            <div class="ai-meta">
              <span :class="['tag', aiLatest.status === 'SUCCESS' ? 'tag-up' : aiLatest.status === 'SKIPPED' ? 'tag-warn' : 'tag-neutral']">{{ aiLatest.status || '--' }}</span>
              <span class="mono text-faint">{{ aiLatest.created_at_cst || '--' }}</span>
            </div>
            <div class="ai-stats">
              <div><span>触发</span><strong>{{ aiLatest.trigger || '--' }}</strong></div>
              <div><span>胜出</span><strong>{{ aiLatest.manager_winner || '--' }}</strong></div>
              <div><span>执行</span><strong class="mono">{{ aiLatest.executed_total || 0 }} / {{ aiLatest.actions_total || 0 }}</strong></div>
            </div>
            <div v-if="aiLatest.skipped" class="ai-skip">
              <strong>本次跳过：</strong>{{ aiLatest.reason || '未返回原因' }}
            </div>
            <div class="ai-brief">
              <p><strong>长期：</strong>{{ aiHorizons.long_term || '--' }}</p>
              <p><strong>中期：</strong>{{ aiHorizons.mid_term || '--' }}</p>
              <p><strong>短期：</strong>{{ aiHorizons.short_term || '--' }}</p>
              <p><strong>做T：</strong>{{ aiHorizons.intraday_t || '--' }}</p>
            </div>
            <ul v-if="aiNewsReferences.length > 0" class="ai-news">
              <li v-for="(it, i) in aiNewsReferences" :key="`n${i}-${it.title}`">
                <a :href="it.link" target="_blank" rel="noopener noreferrer" class="mono">{{ it.title }}</a>
              </li>
            </ul>
          </div>
        </article>
      </section>

      <!-- Holdings + Comments -->
      <section class="pub-bottom">
        <article class="surface panel">
          <header class="panel-head">
            <div>
              <h2 class="t-title">持仓结构</h2>
              <p class="t-sub">按现价估值与浮动盈亏</p>
            </div>
            <span class="tag tag-neutral">{{ data.holdings.length }} 支</span>
          </header>
          <div v-if="data.holdings.length === 0" class="empty"><span class="empty-title">暂无持仓</span></div>
          <div v-else class="tbl-wrap scroll-thin">
            <table class="tbl tbl-condensed">
              <thead>
                <tr>
                  <th>证券</th>
                  <th class="is-num">数量</th>
                  <th class="is-num">现价</th>
                  <th class="is-num">浮盈亏</th>
                  <th class="is-num">仓位</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="h in data.holdings" :key="h.code">
                  <td>
                    <div class="cell-name">{{ h.name || '--' }}</div>
                    <div class="cell-code mono">{{ h.code }}</div>
                  </td>
                  <td class="is-num mono">{{ formatQty(h.quantity) }}</td>
                  <td class="is-num mono">¥{{ formatMoney(h.price) }}</td>
                  <td class="is-num mono num-strong" :class="Number(h.pnl_val) >= 0 ? 'num-up' : 'num-down'">
                    {{ Number(h.pnl_val) >= 0 ? '+' : '−' }}¥{{ formatMoney(Math.abs(Number(h.pnl_val))) }}
                  </td>
                  <td class="is-num mono">{{ h.position_rate?.toFixed ? h.position_rate.toFixed(2) : h.position_rate }}%</td>
                </tr>
              </tbody>
            </table>
          </div>
        </article>

        <article class="surface panel">
          <header class="panel-head">
            <div>
              <h2 class="t-title">公开评论</h2>
              <p class="t-sub">理性发言，共同交流</p>
            </div>
            <span class="tag tag-neutral">{{ comments.length }} 条</span>
          </header>
          <form class="comment-form" @submit.prevent="submitComment">
            <input v-model="commentForm.nickname" maxlength="20" class="input" placeholder="昵称（可选）" />
            <textarea v-model="commentForm.content" maxlength="500" class="textarea comment-input" rows="3" placeholder="说点什么…" required></textarea>
            <div class="comment-actions">
              <span class="comment-counter mono">{{ commentForm.content.length }} / 500</span>
              <button class="btn btn-primary btn-sm" :disabled="commentSubmitting">{{ commentSubmitting ? '发布中…' : '发布' }}</button>
            </div>
          </form>
          <div v-if="comments.length === 0" class="empty"><span class="empty-title">暂无评论</span></div>
          <div v-else class="comment-list scroll-thin">
            <article v-for="c in comments" :key="c.id" class="comment-item">
              <div class="comment-avatar">{{ (c.nickname || '访客').slice(0, 1).toUpperCase() }}</div>
              <div class="comment-body">
                <div class="comment-head">
                  <strong>{{ c.nickname || '访客' }}</strong>
                  <span class="mono text-faint">{{ c.created_at }}</span>
                </div>
                <p>{{ c.content }}</p>
              </div>
            </article>
          </div>
        </article>
      </section>

      <footer class="pub-footer">
        <span>Zero Ben Securities · Trading Terminal · A 股交易演示</span>
        <span class="mono">{{ nowText }}</span>
      </footer>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, reactive, ref } from 'vue';
import api from '../../api';
import { formatMoney, formatPct, formatQty, isTradingSession, shanghaiNowText } from '../../utils/format';
import { notifyError, notifySuccess } from '../../utils/notify';

declare global { interface Window { __visitorMath?: { abs?: (n: number) => number } } }
const Math = window.Math;

const chartRef = ref<HTMLElement | null>(null);
let chartLib: any = null;
let chart: any = null;

const data = reactive<any>({
  assets: { total: 0, market_cap: 0, balance: 0, frozen: 0, pnl_holding: 0, day_pnl: 0, day_pct: 0, return_total_pct: 0 },
  holdings: [],
  logs: [],
  charts: { asset: [], latest: null },
  ai: { enabled: false, latest: null, discussion_digest: null, news_references: [] }
});

const comments = ref<any[]>([]);
const commentForm = reactive({ nickname: '', content: '' });
const commentSubmitting = ref(false);

const nowText = ref(shanghaiNowText());
const syncing = ref(false);
const lastSyncAt = ref<Date | null>(null);

const marketOpen = computed(() => isTradingSession());

const chartPoints = computed(() => {
  const points = Array.isArray(data.charts?.asset) ? [...data.charts.asset] : [];
  if (data.charts?.latest?.date) points.push(data.charts.latest);
  return points;
});
const chartEmpty = computed(() => chartPoints.value.length === 0);
const latestAssetValue = computed(() => {
  const points = chartPoints.value;
  const latest = points.length > 0 ? points[points.length - 1] : null;
  return Number(latest?.value ?? data.assets.total ?? 0);
});

const aiLatest = computed(() => data.ai?.latest || null);
const aiDiscussion = computed(() => {
  const d = data.ai?.discussion_digest;
  return d && typeof d === 'object' ? d : {};
});
const aiHorizons = computed(() => {
  const h = aiDiscussion.value?.president?.strategy_horizons;
  return h && typeof h === 'object' ? h : {};
});
const aiNewsReferences = computed(() => {
  const refs = data.ai?.news_references;
  return Array.isArray(refs) ? refs.slice(0, 4) : [];
});

const lastSyncText = computed(() => {
  if (!lastSyncAt.value) return '--:--';
  return lastSyncAt.value.toLocaleTimeString('zh-CN', { hour12: false });
});

// === Trend helpers (A 股配色：涨红跌青绿) ===
const trendClass = computed(() => {
  const v = Number(data.assets.day_pnl);
  if (v > 0) return 'is-up';
  if (v < 0) return 'is-down';
  return 'is-flat';
});
const trendLabel = computed(() => {
  if (trendClass.value === 'is-up') return '今日上涨';
  if (trendClass.value === 'is-down') return '今日下跌';
  return '今日持平';
});
const trendArrow = computed(() => {
  if (trendClass.value === 'is-up') return '▲';
  if (trendClass.value === 'is-down') return '▼';
  return '—';
});
const getTrendClass = (v: any) => {
  const n = Number(v);
  if (n > 0) return 'is-up';
  if (n < 0) return 'is-down';
  return '';
};

const chartLineColor = computed(() => {
  if (trendClass.value === 'is-up') return '#dc2626';
  if (trendClass.value === 'is-down') return '#0891b2';
  return '#7a8089';
});
const chartFillTop = computed(() => {
  if (trendClass.value === 'is-up') return 'rgba(220, 38, 38, 0.18)';
  if (trendClass.value === 'is-down') return 'rgba(8, 145, 178, 0.18)';
  return 'rgba(122, 128, 137, 0.10)';
});

const ensureChartLib = async () => {
  if (chartLib) return chartLib;
  chartLib = await import('../../utils/echartsLite');
  return chartLib;
};

const renderChart = async () => {
  if (!chartRef.value) return;
  const { echartsLite } = await ensureChartLib();
  if (!chart) chart = echartsLite.init(chartRef.value);
  const points = chartPoints.value;
  const lineColor = chartLineColor.value;

  const isNarrow = typeof window !== 'undefined' && window.innerWidth < 600;
  chart.setOption({
    animationDuration: 320,
    grid: { top: 8, left: isNarrow ? 44 : 56, right: isNarrow ? 8 : 12, bottom: isNarrow ? 18 : 24, containLabel: false },
    xAxis: {
      type: 'category',
      data: points.map((x: any) => x.date),
      boundaryGap: false,
      axisLabel: {
        color: '#7a8089',
        fontSize: isNarrow ? 9 : 10,
        interval: isNarrow ? 'auto' : 'auto',
        formatter: (v: string) => {
          if (!v) return '';
          if (isNarrow) return v.slice(5); // MM-DD only
          return v;
        },
        hideOverlap: true
      },
      axisLine: { lineStyle: { color: '#e6e8ec' } },
      axisTick: { show: false }
    },
    yAxis: {
      type: 'value',
      axisLabel: {
        color: '#7a8089',
        fontSize: isNarrow ? 9 : 10,
        formatter: (v: number) => `${(v / 10000).toFixed(0)}万`,
        margin: 4
      },
      splitLine: { lineStyle: { color: '#eef0f3' } }
    },
    tooltip: {
      trigger: 'axis',
      backgroundColor: '#ffffff',
      borderColor: '#e6e8ec',
      borderWidth: 1,
      padding: [8, 10],
      textStyle: { color: '#0f1115', fontSize: 12 },
      valueFormatter: (v: any) => `¥${Number(v).toLocaleString('zh-CN')}`
    },
    series: [
      {
        type: 'line',
        smooth: 0.3,
        data: points.map((x: any) => x.value),
        symbol: 'none',
        lineStyle: { width: 2, color: lineColor },
        areaStyle: {
          color: new echartsLite.graphic.LinearGradient(0, 0, 0, 1, [
            { offset: 0, color: chartFillTop.value },
            { offset: 1, color: 'rgba(0,0,0,0)' }
          ])
        }
      }
    ]
  });
};

const loadOverview = async (silent = false) => {
  if (!silent) syncing.value = true;
  try {
    const res: any = await api.getPublicOverview();
    Object.assign(data, res);
    await nextTick();
    await renderChart();
    lastSyncAt.value = new Date();
  } catch {
    if (!silent) notifyError('公开看板加载失败');
    throw null;
  } finally {
    if (!silent) syncing.value = false;
  }
};
const refreshOverview = async () => { try { await loadOverview(false); } catch { /* ignore */ } };
const loadComments = async () => { comments.value = await api.getComments(); };

const submitComment = async () => {
  const content = commentForm.content.trim();
  if (!content) { notifyError('评论为空', '请输入评论内容'); return; }
  commentSubmitting.value = true;
  try {
    await api.comment({ nickname: commentForm.nickname.trim(), content });
    commentForm.content = '';
    await loadComments();
    notifySuccess('评论发布成功');
  } finally { commentSubmitting.value = false; }
};

let refreshTimer: any = null;
let clockTimer: any = null;

const onResize = () => { try { chart?.resize(); } catch { /* ignore */ } };

onMounted(async () => {
  try { await Promise.all([loadOverview(false), loadComments()]); } catch { /* ignore */ }
  refreshTimer = setInterval(async () => { try { await loadOverview(true); } catch { /* ignore */ } }, 15000);
  clockTimer = setInterval(() => { nowText.value = shanghaiNowText(); }, 1000);
  window.addEventListener('resize', onResize);
});
onUnmounted(() => {
  if (refreshTimer) clearInterval(refreshTimer);
  if (clockTimer) clearInterval(clockTimer);
  window.removeEventListener('resize', onResize);
  try { chart?.dispose(); } catch { /* ignore */ }
  chart = null;
});
</script>

<style scoped>
.pub-shell { min-height: 100vh; background: var(--bg); }
.pub-topbar {
  height: var(--topbar-h);
  background: var(--bg-elev);
  border-bottom: 1px solid var(--line);
  display: flex; align-items: center; justify-content: space-between;
  padding: 0 18px;
  gap: 12px;
  position: sticky; top: 0; z-index: 30;
}
.pub-brand { display: flex; align-items: center; gap: 10px; min-width: 0; flex-shrink: 1; }
.pub-brand svg { flex-shrink: 0; }
.pub-brand-text { display: flex; flex-direction: column; min-width: 0; }
.pub-brand-name { font-size: 14px; font-weight: 800; color: var(--text-strong); letter-spacing: -0.01em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.pub-brand-sub { font-size: 10.5px; color: var(--text-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.pub-meta { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; flex-shrink: 0; }
.pub-clock { font-size: 12px; color: var(--text-soft); white-space: nowrap; }
.pub-sync { font-size: 11px; }
.status-pill {
  display: inline-flex; align-items: center; gap: 5px;
  height: 24px; padding: 0 9px; border-radius: 999px;
  font-size: 11px; font-weight: 700;
  background: var(--bg-inset); color: var(--text-soft);
  border: 1px solid var(--line-soft);
  position: relative;
  white-space: nowrap;
}
.status-pill .status-dot { width: 6px; height: 6px; border-radius: 999px; background: currentColor; }
.status-pill.open { background: var(--up-soft); color: var(--up); border-color: var(--up-line); }
.status-pill.closed { background: var(--bg-inset); color: var(--text-muted); }

.pub-page { max-width: 1280px; margin: 0 auto; padding: 24px; display: flex; flex-direction: column; gap: 16px; }

/* === Hero — ChatGPT style === */
.pub-hero {
  display: flex; flex-direction: column; gap: 18px;
  padding: 28px 32px 22px;
  background: var(--bg-elev);
  border: 1px solid var(--line);
  border-radius: var(--r-2xl);
  position: relative;
  overflow: hidden;
}
.hero-amount-block {
  display: flex; flex-direction: column; gap: 10px;
  padding-left: 4px;
}
.kicker { font-size: 10.5px; font-weight: 700; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.12em; }
.hero-amount {
  display: inline-flex; align-items: baseline; gap: 6px;
  font-family: 'Inter', sans-serif;
  font-size: clamp(36px, 8vw, 64px);
  font-weight: 800;
  letter-spacing: -0.03em;
  line-height: 1.05;
  color: var(--text-strong);
  font-variant-numeric: tabular-nums;
  margin: 0;
  max-width: 100%;
  min-width: 0;
  flex-wrap: wrap;
  word-break: break-word;
  overflow-wrap: anywhere;
}
.hero-amount-block { min-width: 0; max-width: 100%; }
.amount-symbol { font-size: 0.5em; color: var(--text-muted); font-weight: 600; }
.hero-trendline {
  display: inline-flex; align-items: baseline; gap: 10px;
  font-size: 13px; color: var(--text-muted);
}
.trend-tag {
  display: inline-flex; align-items: center; gap: 4px;
  padding: 4px 10px;
  border-radius: 999px;
  font-weight: 700;
  font-size: 13px;
  font-variant-numeric: tabular-nums;
}
.trend-tag.is-up { background: var(--up-soft); color: var(--up); }
.trend-tag.is-down { background: var(--down-soft); color: var(--down); }
.trend-tag.is-flat { background: var(--bg-inset); color: var(--text-muted); }
.trend-pct { font-size: 13px; font-weight: 600; color: inherit; }
.trend-meta { font-size: 12px; color: var(--text-muted); }

/* Hero stat grid — colored by trend */
.hero-stat-grid {
  display: grid;
  grid-template-columns: repeat(6, minmax(0, 1fr));
  gap: 12px;
  border-top: 1px solid var(--line-soft);
  padding-top: 16px;
}
.hero-stat {
  display: flex; flex-direction: column; gap: 4px;
  padding: 10px 12px;
  border-radius: var(--r-md);
  background: var(--bg-subtle);
  border: 1px solid var(--line-soft);
  min-width: 0;
}
.hero-stat .hs-label { font-size: 10.5px; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.04em; font-weight: 600; }
.hero-stat .hs-value { font-size: 16px; font-weight: 700; color: var(--text-strong); display: inline-flex; gap: 4px; align-items: baseline; min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.hero-stat .hs-value em { font-style: normal; font-size: 11px; color: var(--text-muted); font-weight: 500; }
.hero-stat.is-up .hs-value { color: var(--up); }
.hero-stat.is-down .hs-value { color: var(--down); }

.hero-chart { padding: 12px 16px; }
.chart-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 10px; margin-bottom: 4px; }
.chart-meta { font-size: 12px; color: var(--text-muted); margin-top: 2px; }
.chart-legend { display: inline-flex; align-items: center; gap: 6px; font-size: 11.5px; font-weight: 600; color: var(--text-soft); }
.legend-dot { width: 8px; height: 8px; border-radius: 999px; }
.legend-dot.is-up { background: var(--up); }
.legend-dot.is-down { background: var(--down); }
.legend-dot.is-flat { background: var(--text-muted); }
.chart-box { height: clamp(180px, 28vh, 280px); }

/* Main 2-col */
.pub-main, .pub-bottom { display: grid; grid-template-columns: 1.3fr 1fr; gap: 14px; }

.panel { padding: 0; }
.panel-head { padding: 12px 16px; border-bottom: 1px solid var(--line); display: flex; justify-content: space-between; align-items: center; }
.t-title { font-size: 13.5px; font-weight: 700; color: var(--text-strong); }
.t-sub { font-size: 11.5px; color: var(--text-muted); margin-top: 2px; }

.feed-list { display: flex; flex-direction: column; gap: 6px; padding: 10px 14px; max-height: 60vh; overflow: auto; }
.feed-item { padding: 8px 10px; border: 1px solid var(--line-soft); border-radius: var(--r-sm); background: var(--bg-subtle); display: flex; flex-direction: column; gap: 4px; }
.feed-top { display: flex; justify-content: space-between; align-items: center; font-size: 11px; }
.feed-time { color: var(--text-muted); }
.feed-main { font-size: 12.5px; font-weight: 600; color: var(--text-strong); }
.feed-sub { font-size: 11px; color: var(--text-muted); word-break: break-word; }

.side-pill { display: inline-flex; align-items: center; justify-content: center; width: 22px; height: 22px; border-radius: 4px; font-size: 11px; font-weight: 800; }
.side-pill.side-buy { background: var(--up-soft); color: var(--up); }
.side-pill.side-sell { background: var(--down-soft); color: var(--down); }

/* AI panel */
.ai-content { padding: 12px 14px; display: flex; flex-direction: column; gap: 10px; }
.ai-meta { display: flex; justify-content: space-between; align-items: center; font-size: 11px; }
.ai-stats { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 6px; }
.ai-stats > div { padding: 6px 8px; background: var(--bg-subtle); border: 1px solid var(--line-soft); border-radius: var(--r-sm); display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.ai-stats span { font-size: 10.5px; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.04em; }
.ai-stats strong { font-size: 12px; color: var(--text-strong); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ai-skip { padding: 8px 10px; background: var(--warn-soft); border: 1px solid var(--warn-line); border-radius: var(--r-sm); font-size: 12px; color: var(--text-strong); }
.ai-brief { display: flex; flex-direction: column; gap: 4px; padding: 8px 10px; background: var(--bg-subtle); border: 1px solid var(--line-soft); border-radius: var(--r-sm); }
.ai-brief p { font-size: 11.5px; color: var(--text-soft); line-height: 1.5; }
.ai-brief strong { color: var(--text); font-weight: 700; }
.ai-news { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; }
.ai-news li { padding: 5px 8px; border: 1px solid var(--line-soft); border-radius: var(--r-xs); background: var(--bg-elev); }
.ai-news a { font-size: 11.5px; color: var(--info); word-break: break-word; }
.ai-news a:hover { text-decoration: underline; }

/* Holdings */
.tbl-wrap { overflow: auto; max-height: 50vh; }
.cell-name { font-size: 13px; font-weight: 600; color: var(--text-strong); }
.cell-code { font-size: 11px; color: var(--text-muted); }

/* ChatGPT-style comments */
.comment-form { padding: 14px; border-bottom: 1px solid var(--line); display: flex; flex-direction: column; gap: 8px; }
.comment-input { min-height: 64px; resize: vertical; }
.comment-actions { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
.comment-counter { font-size: 11px; color: var(--text-muted); }
.comment-list { display: flex; flex-direction: column; gap: 10px; padding: 12px 14px; max-height: 60vh; overflow: auto; }
.comment-item { display: flex; gap: 10px; padding: 10px; border: 1px solid var(--line-soft); border-radius: var(--r-md); background: var(--bg-subtle); }
.comment-avatar {
  flex-shrink: 0;
  width: 30px; height: 30px;
  border-radius: 999px;
  background: var(--text);
  color: #fff;
  display: flex; align-items: center; justify-content: center;
  font-size: 12px;
  font-weight: 700;
}
.comment-body { flex: 1; min-width: 0; }
.comment-head { display: flex; justify-content: space-between; align-items: center; font-size: 12px; gap: 6px; }
.comment-head strong { color: var(--text-strong); }
.comment-item p { margin-top: 4px; font-size: 12.5px; color: var(--text-soft); line-height: 1.5; word-break: break-word; }

.empty { padding: 40px 20px; text-align: center; color: var(--text-muted); display: flex; flex-direction: column; gap: 4px; align-items: center; }
.empty-title { font-size: 12.5px; font-weight: 600; color: var(--text-soft); }

.pub-footer { display: flex; justify-content: space-between; align-items: center; padding: 16px 0; font-size: 11.5px; color: var(--text-muted); border-top: 1px solid var(--line); margin-top: 8px; }

/* === Tablet === */
@media (max-width: 920px) {
  .pub-page { padding: 16px; }
  .pub-hero { padding: 20px 22px 18px; }
  .hero-stat-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); }
  .pub-main, .pub-bottom { grid-template-columns: 1fr; }
  .hide-mobile { display: none !important; }
}

/* === Mobile === */
@media (max-width: 640px) {
  .pub-page { padding: 12px; gap: 12px; }
  .pub-hero { padding: 18px 16px 14px; gap: 14px; border-radius: var(--r-xl); }
  .hero-amount { font-size: clamp(36px, 12vw, 48px); }
  .amount-symbol { font-size: 0.45em; }
  .hero-stat-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; padding-top: 12px; }
  .hero-stat .hs-value { font-size: 14px; }
  .pub-topbar { padding: 0 12px; gap: 6px; }
  .pub-brand-sub { display: none; }
  .pub-sync { display: none; }
  .pub-clock { display: none; }
  .status-pill { padding: 0 8px; }
  .chart-box { height: 180px; }
  .pub-footer { flex-direction: column; gap: 4px; }
}
</style>