<template>
  <div class="oa-shell">
    <header class="oa-topbar fade-rise">
      <div class="brand-block">
        <p class="brand-kicker">ZERO BEN SECURITIES</p>
        <h1>公开市场看板</h1>
        <p class="brand-sub">资产、成交、持仓与评论的实时总览</p>
      </div>

      <div class="meta-block">
        <span class="state-chip" :class="marketOpen ? 'live' : 'closed'">
          {{ marketOpen ? '交易时段' : '非交易时段' }}
        </span>
        <span class="mono">{{ nowText }}（上海）</span>
        <span class="sync-text">最近刷新 {{ lastSyncText }}</span>
      </div>

      <div class="action-block">
        <button class="btn btn-ghost" :disabled="syncing" @click="refreshOverview">
          {{ syncing ? '刷新中...' : '刷新数据' }}
        </button>
        <button class="btn btn-primary" @click="$router.push('/login')">管理登录</button>
      </div>
    </header>

    <section class="stats-grid fade-rise">
      <article class="stat-card">
        <span class="stat-label">总资产</span>
        <strong class="stat-value">¥{{ formatMoney(data.assets.total) }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">持仓市值</span>
        <strong class="stat-value">¥{{ formatMoney(data.assets.market_cap) }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">可用资金</span>
        <strong class="stat-value">¥{{ formatMoney(data.assets.balance) }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">冻结资金</span>
        <strong class="stat-value">¥{{ formatMoney(data.assets.frozen) }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">当日收益</span>
        <strong class="stat-value" :class="Number(data.assets.day_pnl) >= 0 ? 'up' : 'down'">
          ¥{{ formatMoney(data.assets.day_pnl) }}
        </strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">累计收益率</span>
        <strong class="stat-value" :class="Number(data.assets.return_total_pct) >= 0 ? 'up' : 'down'">
          {{ formatPct(data.assets.return_total_pct) }}
        </strong>
      </article>
    </section>

    <section class="main-grid">
      <article class="panel chart-panel fade-rise">
        <div class="panel-head">
          <div>
            <h2>资产曲线</h2>
            <p>{{ chartEmpty ? '暂无图表数据' : `样本 ${chartPoints.length} 条` }}</p>
          </div>
          <span class="head-chip">最新资产 ¥{{ formatMoney(latestAssetValue) }}</span>
        </div>
        <div ref="chartRef" class="chart-box"></div>
      </article>

      <aside class="side-grid fade-rise">
        <article class="panel feed-panel">
          <div class="panel-head">
            <div>
              <h2>成交播报</h2>
              <p>最近交易动态</p>
            </div>
            <span class="head-chip">{{ data.logs.length }} 条</span>
            <button class="fold-btn" @click="toggleSection('feed')">
              {{ isSectionOpen('feed') ? '收起' : '展开' }}
            </button>
          </div>

          <transition name="panel-fold">
            <div v-show="isSectionOpen('feed')" class="feed-list scrollbar-thin">
              <div v-if="data.logs.length === 0" class="empty">暂无成交</div>
              <article v-for="(log, idx) in data.logs" :key="idx" class="feed-item">
                <div class="feed-top">
                  <span class="side-pill" :class="log.side === 'BUY' ? 'pill-buy' : 'pill-sell'">
                    {{ log.side === 'BUY' ? '买入' : '卖出' }}
                  </span>
                  <span class="mono">{{ log.time || '--:--:--' }}</span>
                </div>
                <div class="feed-main">{{ log.text || '--' }}</div>
                <div class="feed-sub">{{ log.detail || '' }}</div>
              </article>
            </div>
          </transition>
        </article>

        <article class="panel ai-panel">
          <div class="panel-head">
            <div>
              <h2>AI 自动交易引擎</h2>
              <p>公开展示最近一次 AI 投研讨论与执行结论</p>
            </div>
            <span class="head-chip" :class="data.ai?.enabled ? 'chip-ai-on' : 'chip-ai-off'">
              {{ data.ai?.enabled ? 'AUTO ON' : 'AUTO OFF' }}
            </span>
            <button class="fold-btn" @click="toggleSection('ai')">
              {{ isSectionOpen('ai') ? '收起' : '展开' }}
            </button>
          </div>

          <transition name="panel-fold">
            <div v-show="isSectionOpen('ai')">
              <div v-if="!aiLatest" class="empty">暂无 AI 运行记录</div>
              <div v-else class="ai-content">
                <div class="ai-topline">
                  <span class="state-chip" :class="aiLatest.status === 'SUCCESS' ? 'live' : 'closed'">{{ aiLatest.status || '--' }}</span>
                  <span class="mono">run {{ aiLatest.run_id || '--' }}</span>
                  <span class="mono">{{ aiLatest.created_at_cst || '--' }}</span>
                </div>

                <div class="ai-metrics">
                  <span>触发 {{ aiLatest.trigger || '--' }}</span>
                  <span>阶段 {{ aiLatest.phase || '--' }}</span>
                  <span>胜出 {{ aiLatest.manager_winner || '--' }}</span>
                  <span>执行 {{ aiLatest.executed_total || 0 }}/{{ aiLatest.actions_total || 0 }}</span>
                </div>

                <div v-if="aiLatest.skipped" class="ai-skip-box">
                  <p><strong>本次跳过：</strong>{{ aiLatest.reason || '未返回具体原因' }}</p>
                  <p v-if="Number(aiLatest.blocked_count || 0) > 0">
                    <strong>阻断项：</strong>{{ aiLatest.blocked_count }}
                  </p>
                  <ul v-if="aiSkipReasons.length > 0" class="ai-skip-list">
                    <li v-for="(item, idx) in aiSkipReasons" :key="`${idx}-${item}`">{{ item }}</li>
                  </ul>
                </div>

                <div class="ai-brief">
                  <p><strong>经理结论：</strong>{{ aiDiscussion?.manager?.decision_reason || '--' }}</p>
                  <p><strong>长期：</strong>{{ aiHorizons.long_term || '--' }}</p>
                  <p><strong>中期：</strong>{{ aiHorizons.mid_term || '--' }}</p>
                  <p><strong>短期：</strong>{{ aiHorizons.short_term || '--' }}</p>
                  <p><strong>做T：</strong>{{ aiHorizons.intraday_t || '--' }}</p>
                  <p><strong>T+1：</strong>{{ aiDiscussion?.president?.t_plus_one_note || '--' }}</p>
                </div>

                <ul v-if="aiNewsReferences.length > 0" class="ai-news">
                  <li v-for="item in aiNewsReferences" :key="`${item.index}-${item.title}`">
                    <a :href="item.link" target="_blank" rel="noopener noreferrer">{{ item.title }}</a>
                  </li>
                </ul>
              </div>
            </div>
          </transition>
        </article>

        <article class="panel note-panel">
          <div class="panel-head">
            <div>
              <h2>看板说明</h2>
              <p>数据口径与使用提示</p>
            </div>
            <button class="fold-btn" @click="toggleSection('notes')">
              {{ isSectionOpen('notes') ? '收起' : '展开' }}
            </button>
          </div>

          <transition name="panel-fold">
            <div v-show="isSectionOpen('notes')" class="note-list">
              <article v-for="(item, idx) in publicHints" :key="idx" class="note-item">
                <div class="note-top">
                  <span class="note-dot" :class="`dot-${item.level}`"></span>
                  <strong>{{ item.title }}</strong>
                </div>
                <p>{{ item.text }}</p>
              </article>
            </div>
          </transition>
        </article>
      </aside>
    </section>

    <section class="bottom-grid">
      <article class="panel hold-panel fade-rise">
        <div class="panel-head">
          <div>
            <h2>持仓结构</h2>
            <p>按现价与浮动盈亏展示</p>
          </div>
          <span class="head-chip">{{ data.holdings.length }} 支</span>
          <button class="fold-btn" @click="toggleSection('holdings')">
            {{ isSectionOpen('holdings') ? '收起' : '展开' }}
          </button>
        </div>

        <transition name="panel-fold">
          <div v-show="isSectionOpen('holdings')">
            <div v-if="data.holdings.length === 0" class="empty">暂无持仓</div>
            <div v-else class="table-wrap scrollbar-thin">
              <table class="hold-table">
                <thead>
                  <tr>
                    <th>证券</th>
                    <th>数量</th>
                    <th>现价</th>
                    <th>盈亏</th>
                    <th>仓位</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="h in data.holdings" :key="h.code">
                    <td>
                      <div class="cell-main">{{ h.name || '--' }}</div>
                      <div class="cell-sub mono">{{ h.code || '--' }}</div>
                    </td>
                    <td class="mono">{{ formatQty(h.quantity) }}</td>
                    <td class="mono">¥{{ formatMoney(h.price) }}</td>
                    <td class="mono" :class="getColor(h.pnl_val)">¥{{ formatMoney(h.pnl_val) }}</td>
                    <td class="mono">{{ formatWeight(h.position_rate) }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </transition>
      </article>

      <article class="panel comment-panel fade-rise">
        <div class="panel-head">
          <div>
            <h2>公开评论</h2>
            <p>欢迎交流观点，理性发言</p>
          </div>
          <span class="head-chip">{{ comments.length }} 条</span>
          <button class="fold-btn" @click="toggleSection('comments')">
            {{ isSectionOpen('comments') ? '收起' : '展开' }}
          </button>
        </div>

        <transition name="panel-fold">
          <div v-show="isSectionOpen('comments')">
            <form class="comment-form" @submit.prevent="submitComment">
              <input v-model="commentForm.nickname" maxlength="20" class="comment-input" placeholder="昵称（可选）" />
              <input v-model="commentForm.content" maxlength="500" class="comment-input" placeholder="输入评论内容" />
              <button class="btn btn-primary comment-submit" :disabled="commentSubmitting">
                {{ commentSubmitting ? '发布中...' : '发布' }}
              </button>
            </form>

            <div class="comment-list scrollbar-thin">
              <div v-if="comments.length === 0" class="empty">暂无评论</div>
              <article v-for="item in comments" :key="item.id" class="comment-item">
                <div class="comment-head">
                  <strong>{{ item.nickname || '访客' }}</strong>
                  <span class="mono">{{ item.created_at }}</span>
                </div>
                <p>{{ item.content }}</p>
              </article>
            </div>
          </div>
        </transition>
      </article>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, reactive, ref } from 'vue';
import type { EChartsType } from '../../utils/echartsLite';
import api from '../../api';
import { formatMoney, formatPct, formatQty, getColor, isTradingSession, shanghaiNowText } from '../../utils/format';
import { notifyError, notifySuccess } from '../../utils/notify';

const chartRef = ref<HTMLElement | null>(null);
let chartLib: typeof import('../../utils/echartsLite') | null = null;
let chart: EChartsType | null = null;

const data = reactive<any>({
  assets: {
    total: 0,
    market_cap: 0,
    balance: 0,
    frozen: 0,
    pnl_holding: 0,
    day_pnl: 0,
    day_pct: 0,
    return_total_pct: 0
  },
  holdings: [],
  logs: [],
  charts: { asset: [], latest: null },
  ai: {
    enabled: false,
    latest: null,
    discussion_digest: null,
    news_references: []
  }
});

const comments = ref<any[]>([]);
const commentSubmitting = ref(false);
const commentForm = reactive({
  nickname: '',
  content: ''
});

const nowText = ref(shanghaiNowText());
const syncing = ref(false);
const lastSyncAt = ref<Date | null>(null);
const isCompactMobile = ref(typeof window !== 'undefined' ? window.innerWidth <= 720 : false);
type SectionKey = 'feed' | 'ai' | 'notes' | 'holdings' | 'comments';
const collapsed = reactive<Record<SectionKey, boolean>>({
  feed: false,
  ai: false,
  notes: true,
  holdings: false,
  comments: true
});

const marketOpen = computed(() => {
  nowText.value;
  return isTradingSession();
});

const chartPoints = computed(() => {
  const points = Array.isArray(data.charts?.asset) ? [...data.charts.asset] : [];
  if (data.charts?.latest?.date) points.push(data.charts.latest);
  return points;
});

const publicHints = computed(() => {
  return [
    { title: '数据口径', text: '总资产 = 现金余额 + 持仓按当前价格估值。', level: 'info' },
    { title: '更新频率', text: '公开页按固定周期刷新，实时性略低于管理端。', level: 'risk' },
    { title: '免责声明', text: '本系统用于策略演示与流程验证，不构成投资建议。', level: 'ok' }
  ] as Array<{ title: string; text: string; level: 'info' | 'risk' | 'ok' }>;
});

const chartEmpty = computed(() => chartPoints.value.length === 0);
const aiLatest = computed(() => data.ai?.latest || null);
const aiDiscussion = computed(() => {
  const digest = data.ai?.discussion_digest;
  return digest && typeof digest === 'object' ? digest : {};
});
const aiHorizons = computed(() => {
  const h = aiDiscussion.value?.president?.strategy_horizons;
  return h && typeof h === 'object' ? h : {};
});
const aiNewsReferences = computed(() => {
  const refs = data.ai?.news_references;
  return Array.isArray(refs) ? refs.slice(0, 3) : [];
});
const aiSkipReasons = computed(() => {
  const blocked = Array.isArray(aiLatest.value?.blocked_reasons)
    ? aiLatest.value.blocked_reasons.map((x: any) => String(x || '').trim()).filter(Boolean)
    : [];
  const nonBlocking = Array.isArray(aiLatest.value?.non_blocking_reasons)
    ? aiLatest.value.non_blocking_reasons.map((x: any) => String(x || '').trim()).filter(Boolean)
    : [];
  return [...blocked, ...nonBlocking].slice(0, 3);
});
const latestAssetValue = computed(() => {
  const points = chartPoints.value;
  const latest = points.length > 0 ? points[points.length - 1] : null;
  return Number(latest?.value ?? data.assets.total ?? 0);
});

const lastSyncText = computed(() => {
  if (!lastSyncAt.value) return '--:--:--';
  return lastSyncAt.value.toLocaleTimeString('zh-CN', { hour12: false });
});

const formatWeight = (val: number | string | undefined | null) => {
  const num = Number(val ?? 0);
  if (!Number.isFinite(num)) return '0.00%';
  return `${num.toFixed(2)}%`;
};

const isSectionOpen = (key: SectionKey) => !isCompactMobile.value || !collapsed[key];

const toggleSection = (key: SectionKey) => {
  if (!isCompactMobile.value) return;
  collapsed[key] = !collapsed[key];
};

const syncCompactMode = () => {
  if (typeof window === 'undefined') return;
  isCompactMobile.value = window.innerWidth <= 720;
};

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

  chart.setOption({
    animationDuration: 260,
    grid: { top: 16, left: 48, right: 16, bottom: 24 },
    xAxis: {
      type: 'category',
      data: points.map((x: any) => x.date),
      boundaryGap: false,
      axisLabel: { color: '#6b7280', fontSize: 11 },
      axisLine: { lineStyle: { color: '#e5e7eb' } }
    },
    yAxis: {
      type: 'value',
      axisLabel: {
        color: '#6b7280',
        formatter: (v: number) => `¥${Math.round(v).toLocaleString('zh-CN')}`
      },
      splitLine: { lineStyle: { color: '#f1f5f9' } }
    },
    tooltip: {
      trigger: 'axis',
      backgroundColor: '#ffffff',
      borderColor: '#dbe1ea',
      borderWidth: 1,
      textStyle: { color: '#111827' }
    },
    series: [
      {
        type: 'line',
        smooth: 0.3,
        data: points.map((x: any) => x.value),
        symbol: 'none',
        lineStyle: { width: 2.2, color: '#10a37f' },
        areaStyle: {
          color: new echartsLite.graphic.LinearGradient(0, 0, 0, 1, [
            { offset: 0, color: 'rgba(16, 163, 127, 0.22)' },
            { offset: 1, color: 'rgba(16, 163, 127, 0.02)' }
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
  } catch (error) {
    if (!silent) notifyError('公开看板加载失败', '请稍后重试。');
    throw error;
  } finally {
    if (!silent) syncing.value = false;
  }
};

const refreshOverview = async () => {
  try {
    await loadOverview(false);
  } catch {
    // notice is already handled in loadOverview
  }
};

const loadComments = async () => {
  comments.value = await api.getComments();
};

const submitComment = async () => {
  const nickname = commentForm.nickname.trim();
  const content = commentForm.content.trim();

  if (!content) {
    notifyError('评论内容为空', '请输入评论内容后再提交。');
    return;
  }

  commentSubmitting.value = true;
  try {
    await api.comment({ nickname, content });
    commentForm.content = '';
    await loadComments();
    notifySuccess('评论发布成功', '你的留言已进入公开评论区。');
  } finally {
    commentSubmitting.value = false;
  }
};

let refreshTimer: ReturnType<typeof setInterval> | null = null;
let clockTimer: ReturnType<typeof setInterval> | null = null;
const onResize = () => {
  syncCompactMode();
  chart?.resize();
};

onMounted(async () => {
  syncCompactMode();
  try {
    await Promise.all([loadOverview(false), loadComments()]);
  } catch {
    // load failure notice already shown by interceptors/loadOverview
  }

  refreshTimer = setInterval(async () => {
    try {
      await loadOverview(true);
    } catch {
      // ignored in polling
    }
  }, 15000);

  clockTimer = setInterval(() => {
    nowText.value = shanghaiNowText();
  }, 1000);

  window.addEventListener('resize', onResize);
});

onUnmounted(() => {
  if (refreshTimer) clearInterval(refreshTimer);
  if (clockTimer) clearInterval(clockTimer);
  window.removeEventListener('resize', onResize);
  chart?.dispose();
  chart = null;
});
</script>

<style scoped>
.oa-shell {
  min-height: 100vh;
  width: min(1560px, 100%);
  margin: 0 auto;
  padding: 12px;
  display: grid;
  gap: 12px;
  color: #111827;
  background:
    radial-gradient(980px 340px at 10% -20%, rgba(16, 163, 127, 0.09), transparent 66%),
    radial-gradient(800px 280px at 110% 120%, rgba(15, 23, 42, 0.04), transparent 70%),
    #f8fafc;
}

.oa-topbar,
.panel,
.stat-card {
  border: 1px solid #e5eaf0;
  border-radius: 14px;
  background: #ffffff;
  box-shadow: 0 1px 2px rgba(15, 23, 42, 0.04), 0 10px 30px rgba(15, 23, 42, 0.05);
}

.oa-topbar {
  padding: 14px;
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto auto;
  gap: 10px;
  align-items: center;
}

.brand-kicker {
  margin: 0;
  font-size: 10px;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: #6b7280;
}

.brand-block h1 {
  margin: 6px 0 0;
  font-size: clamp(20px, 2.6vw, 28px);
  line-height: 1.15;
  font-weight: 800;
  color: #0f172a;
}

.brand-sub {
  margin: 8px 0 0;
  font-size: 12px;
  color: #64748b;
}

.meta-block {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 6px;
  font-size: 12px;
  color: #6b7280;
}

.state-chip,
.head-chip {
  display: inline-flex;
  align-items: center;
  border-radius: 999px;
  padding: 4px 10px;
  font-size: 11px;
  font-weight: 700;
}

.state-chip.live {
  color: #0f766e;
  border: 1px solid #99f6e4;
  background: #ecfeff;
}

.state-chip.closed {
  color: #475569;
  border: 1px solid #dbe2ea;
  background: #f8fafc;
}

.sync-text {
  color: #94a3b8;
}

.action-block {
  display: flex;
  gap: 8px;
}

.btn {
  border-radius: 10px;
  border: 1px solid #d7e0ea;
  background: #ffffff;
  color: #1e293b;
  font-size: 12px;
  font-weight: 700;
  padding: 8px 12px;
  transition: all 0.2s ease;
}

.btn:hover {
  background: #f8fafc;
  border-color: #c9d5e4;
}

.btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.btn-primary {
  color: #ffffff;
  border-color: #0f8f6f;
  background: linear-gradient(180deg, #16b58d 0%, #10a37f 100%);
}

.btn-primary:hover {
  filter: brightness(1.03);
}

.stats-grid {
  display: grid;
  gap: 10px;
  grid-template-columns: repeat(6, minmax(0, 1fr));
}

.stat-card {
  padding: 11px 12px;
  display: grid;
  gap: 6px;
}

.stat-label {
  font-size: 11px;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: #64748b;
}

.stat-value {
  font-size: 16px;
  font-weight: 800;
  color: #0f172a;
}

.up {
  color: #d92d20;
}

.down {
  color: #067647;
}

.main-grid {
  display: grid;
  gap: 12px;
  grid-template-columns: minmax(0, 1.35fr) minmax(320px, 0.9fr);
  align-items: start;
}

.side-grid {
  display: grid;
  gap: 12px;
}

.panel {
  padding: 12px;
}

.panel-head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 8px;
  margin-bottom: 10px;
}

.fold-btn {
  margin-left: auto;
  border: 1px solid #d7e0ea;
  background: #fff;
  color: #475569;
  border-radius: 999px;
  padding: 2px 8px;
  font-size: 10px;
  font-weight: 700;
  display: none;
}

.panel-head h2 {
  margin: 0;
  font-size: 13px;
  font-weight: 800;
  color: #0f172a;
}

.panel-head p {
  margin: 4px 0 0;
  font-size: 12px;
  color: #64748b;
}

.head-chip {
  color: #0f766e;
  border: 1px solid #a7f3d0;
  background: #f0fdf4;
}

.chart-box {
  height: clamp(260px, 36vh, 380px);
}

.feed-list {
  max-height: 340px;
  overflow-y: auto;
  display: grid;
  gap: 8px;
}

.feed-item {
  border: 1px solid #e6ecf3;
  border-radius: 10px;
  background: #fbfdff;
  padding: 9px;
}

.feed-top {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 6px;
  font-size: 12px;
}

.side-pill {
  border-radius: 999px;
  padding: 2px 8px;
  font-size: 10px;
  font-weight: 800;
}

.pill-buy {
  color: #b42318;
  background: #fee4e2;
}

.pill-sell {
  color: #067647;
  background: #dafbe9;
}

.feed-main {
  font-size: 12px;
  font-weight: 600;
  color: #0f172a;
  overflow-wrap: anywhere;
}

.feed-sub {
  margin-top: 4px;
  font-size: 11px;
  color: #64748b;
  overflow-wrap: anywhere;
}

.note-list {
  display: grid;
  gap: 8px;
}

.note-item {
  border: 1px solid #e6ecf3;
  border-radius: 10px;
  background: #fcfdff;
  padding: 9px 10px;
}

.note-top {
  display: flex;
  align-items: center;
  gap: 8px;
}

.note-dot {
  width: 7px;
  height: 7px;
  border-radius: 999px;
}

.dot-info {
  background: #0ea5e9;
}

.dot-risk {
  background: #f59e0b;
}

.dot-ok {
  background: #10a37f;
}

.note-item strong {
  font-size: 12px;
  color: #0f172a;
}

.note-item p {
  margin: 6px 0 0;
  font-size: 11px;
  line-height: 1.55;
  color: #64748b;
  overflow-wrap: anywhere;
}

.ai-panel {
  background:
    radial-gradient(760px 180px at 0% 0%, rgba(16, 163, 127, 0.1), transparent 62%),
    #fff;
}

.chip-ai-on {
  color: #065f46;
  border-color: #86efac;
  background: #f0fdf4;
}

.chip-ai-off {
  color: #475569;
  border-color: #dbe2ea;
  background: #f8fafc;
}

.ai-content {
  display: grid;
  gap: 8px;
}

.ai-topline {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  font-size: 11px;
}

.ai-metrics {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.ai-metrics span {
  border: 1px solid #e6ecf3;
  border-radius: 999px;
  padding: 2px 8px;
  font-size: 10px;
  color: #475569;
  background: #f8fafc;
}

.ai-skip-box {
  border: 1px solid #f9d58b;
  border-radius: 10px;
  background:
    radial-gradient(680px 140px at 0% 0%, rgba(245, 158, 11, 0.16), transparent 62%),
    #fffaf0;
  padding: 8px 9px;
  display: grid;
  gap: 4px;
}

.ai-skip-box p {
  margin: 0;
  font-size: 11px;
  color: #78350f;
  line-height: 1.45;
}

.ai-skip-list {
  margin: 2px 0 0;
  padding-left: 16px;
  display: grid;
  gap: 4px;
  font-size: 11px;
  color: #92400e;
}

.ai-brief {
  border: 1px solid #e6ecf3;
  border-radius: 10px;
  background: #fbfdff;
  padding: 8px 9px;
  display: grid;
  gap: 3px;
}

.ai-brief p {
  margin: 0;
  font-size: 11px;
  color: #334155;
  line-height: 1.45;
  overflow-wrap: anywhere;
}

.ai-news {
  margin: 0;
  padding: 0;
  list-style: none;
  display: grid;
  gap: 5px;
}

.ai-news li {
  border: 1px solid #e6ecf3;
  border-radius: 8px;
  background: #fff;
  padding: 6px 8px;
}

.ai-news a {
  color: #1453c2;
  text-decoration: none;
  font-size: 11px;
  overflow-wrap: anywhere;
}

.ai-news a:hover {
  text-decoration: underline;
}

.panel-fold-enter-active,
.panel-fold-leave-active {
  transition: all 0.2s ease;
  overflow: hidden;
}

.panel-fold-enter-from,
.panel-fold-leave-to {
  opacity: 0;
  transform: translateY(-4px);
  max-height: 0;
}

.panel-fold-enter-to,
.panel-fold-leave-from {
  opacity: 1;
  transform: translateY(0);
  max-height: 1200px;
}

.bottom-grid {
  display: grid;
  gap: 12px;
  grid-template-columns: minmax(0, 1.3fr) minmax(0, 0.9fr);
  align-items: start;
}

.table-wrap {
  overflow-x: auto;
}

.hold-table {
  width: 100%;
  border-collapse: collapse;
}

.hold-table th,
.hold-table td {
  padding: 10px 8px;
  border-top: 1px solid #e6ecf3;
  font-size: 12px;
  text-align: left;
}

.hold-table th {
  color: #64748b;
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.cell-main {
  color: #0f172a;
  font-weight: 700;
}

.cell-sub {
  margin-top: 2px;
  color: #64748b;
  font-size: 11px;
}

.comment-form {
  display: grid;
  gap: 8px;
  grid-template-columns: minmax(120px, 180px) minmax(0, 1fr) auto;
}

.comment-input {
  width: 100%;
  border: 1px solid #d7e0ea;
  border-radius: 10px;
  padding: 10px 11px;
  font-size: 12px;
  background: #ffffff;
  color: #0f172a;
  outline: none;
}

.comment-input::placeholder {
  color: #94a3b8;
}

.comment-input:focus {
  border-color: #10a37f;
  box-shadow: 0 0 0 2px rgba(16, 163, 127, 0.12);
}

.comment-submit {
  min-width: 84px;
}

.comment-list {
  margin-top: 10px;
  max-height: 320px;
  overflow-y: auto;
  display: grid;
  gap: 8px;
}

.comment-item {
  border: 1px solid #e6ecf3;
  border-radius: 10px;
  background: #fbfdff;
  padding: 9px 10px;
}

.comment-head {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  font-size: 12px;
}

.comment-head strong {
  color: #0f172a;
}

.comment-head span {
  color: #64748b;
}

.comment-item p {
  margin: 6px 0 0;
  font-size: 12px;
  line-height: 1.55;
  color: #475569;
  word-break: break-word;
}

.mono {
  font-family: 'JetBrains Mono', monospace;
}

.empty {
  padding: 18px 8px;
  text-align: center;
  font-size: 12px;
  color: #94a3b8;
}

@media (max-width: 1180px) {
  .oa-topbar {
    grid-template-columns: 1fr;
  }

  .meta-block {
    justify-content: flex-start;
  }

  .stats-grid {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }

  .main-grid,
  .bottom-grid {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 720px) {
  .oa-shell {
    padding: 8px;
    gap: 10px;
  }

  .brand-block h1 {
    font-size: 20px;
  }

  .action-block {
    flex-wrap: wrap;
  }

  .stats-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .comment-form {
    grid-template-columns: 1fr;
  }

  .comment-submit {
    width: 100%;
  }

  .ai-brief p,
  .ai-news a {
    font-size: 10px;
  }

  .fold-btn {
    display: inline-flex;
    align-items: center;
  }
}
</style>
