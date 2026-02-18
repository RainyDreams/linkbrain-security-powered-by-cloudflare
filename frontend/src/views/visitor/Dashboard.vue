<template>
  <div class="public-shell">
    <header class="glass-card head fade-rise">
      <div class="head-main">
        <div>
          <p class="kicker">Zero Ben · Public Board</p>
          <h1>公开资产总览</h1>
          <p>{{ nowText }} · 每 15 秒自动刷新</p>
        </div>
        <div class="head-actions">
          <button class="btn-solid btn-ghost" @click="loadOverview">刷新</button>
          <button class="btn-solid btn-primary" @click="$router.push('/login')">管理端</button>
        </div>
      </div>
    </header>

    <section class="grid-main">
      <article class="glass-card block fade-rise">
        <div class="asset-top">
          <div>
            <div class="kv-label">总资产 (CNY)</div>
            <div class="asset-total font-mono">¥{{ formatMoney(data.assets.total) }}</div>
          </div>
          <div class="asset-tags">
            <span class="tag" :class="Number(data.assets.return_total_pct) >= 0 ? 'tag-pos' : 'tag-neg'">累计 {{ formatPct(data.assets.return_total_pct) }}</span>
            <span class="tag" :class="Number(data.assets.day_pct) >= 0 ? 'tag-pos' : 'tag-neg'">当日 {{ formatPct(data.assets.day_pct) }}</span>
          </div>
        </div>

        <div class="asset-grid">
          <div class="surface-soft asset-cell">
            <span>持仓市值</span>
            <strong class="font-mono">¥{{ formatMoney(data.assets.market_cap) }}</strong>
          </div>
          <div class="surface-soft asset-cell">
            <span>可用资金</span>
            <strong class="font-mono">¥{{ formatMoney(data.assets.balance) }}</strong>
          </div>
          <div class="surface-soft asset-cell">
            <span>冻结资金</span>
            <strong class="font-mono">¥{{ formatMoney(data.assets.frozen) }}</strong>
          </div>
        </div>

        <div class="chart-head">
          <h2 class="panel-title">资产趋势</h2>
          <span class="text-xs text-slate-500">{{ chartPoints.length }} 点</span>
        </div>
        <div ref="chartRef" class="chart-box"></div>
      </article>

      <aside class="side-stack fade-rise">
        <article class="glass-card block">
          <div class="section-head">
            <h2 class="panel-title">交易播报</h2>
            <span class="text-xs text-slate-500">{{ data.logs.length }} 条</span>
          </div>
          <div class="log-list scrollbar-thin">
            <div v-if="data.logs.length === 0" class="empty-line">暂无交易播报</div>
            <article v-for="(log, idx) in data.logs" :key="idx" class="surface-soft log-item">
              <div class="log-top">
                <div class="font-semibold text-slate-800">{{ log.text }}</div>
                <span class="text-[11px] text-slate-500">{{ log.time }}</span>
              </div>
              <div class="text-xs text-slate-600 mt-1">{{ log.detail }}</div>
            </article>
          </div>
        </article>

        <InsightPanel title="公开看板说明" :items="publicHints" />
      </aside>
    </section>

    <section class="glass-card block fade-rise">
      <div class="section-head">
        <h2 class="panel-title">持仓明细</h2>
        <span class="text-xs text-slate-500">{{ data.holdings.length }} 只</span>
      </div>

      <div v-if="data.holdings.length === 0" class="empty-line">暂无持仓</div>

      <div v-else>
        <div class="mobile-cards md:hidden">
          <article v-for="h in data.holdings" :key="h.code" class="surface-soft card-item">
            <div class="row-main">
              <div>
                <div class="name">{{ h.name }}</div>
                <div class="code font-mono">{{ h.code }}</div>
              </div>
              <div class="text-right">
                <div class="font-mono text-sm">¥{{ formatMoney(h.price) }}</div>
                <div class="text-xs font-mono" :class="getColor(h.pnl_val)">¥{{ formatMoney(h.pnl_val) }}</div>
              </div>
            </div>
            <div class="row-meta">
              <span>数量 <strong class="font-mono">{{ formatQty(h.quantity) }}</strong></span>
              <span>仓位 <strong class="font-mono">{{ h.position_rate }}%</strong></span>
            </div>
          </article>
        </div>

        <div class="hidden md:block overflow-x-auto scrollbar-thin">
          <table class="min-w-full text-sm">
            <thead class="data-table-head">
              <tr>
                <th class="px-4 py-3 text-left">证券</th>
                <th class="px-4 py-3 text-right">数量</th>
                <th class="px-4 py-3 text-right">现价</th>
                <th class="px-4 py-3 text-right">浮盈亏</th>
                <th class="px-4 py-3 text-right">仓位</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="h in data.holdings" :key="h.code" class="border-t border-[var(--line)]/70">
                <td class="px-4 py-3">
                  <div class="font-semibold text-slate-800">{{ h.name }}</div>
                  <div class="font-mono text-xs text-slate-500">{{ h.code }}</div>
                </td>
                <td class="px-4 py-3 text-right font-mono text-slate-700">{{ formatQty(h.quantity) }}</td>
                <td class="px-4 py-3 text-right font-mono text-slate-700">¥{{ formatMoney(h.price) }}</td>
                <td class="px-4 py-3 text-right font-mono" :class="getColor(h.pnl_val)">¥{{ formatMoney(h.pnl_val) }}</td>
                <td class="px-4 py-3 text-right font-mono text-slate-700">{{ h.position_rate }}%</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </section>

    <section class="glass-card block fade-rise">
      <div class="section-head">
        <h2 class="panel-title">评论区</h2>
        <span class="text-xs text-slate-500">{{ comments.length }} 条</span>
      </div>

      <form class="comment-form" @submit.prevent="submitComment">
        <input v-model="commentForm.nickname" maxlength="20" class="comment-input" placeholder="昵称（可选）" />
        <input v-model="commentForm.content" maxlength="500" class="comment-input" placeholder="请输入评论内容" />
        <button class="btn-solid btn-primary" :disabled="commentSubmitting">{{ commentSubmitting ? '提交中...' : '发布' }}</button>
      </form>

      <div class="comment-list scrollbar-thin">
        <div v-if="comments.length === 0" class="empty-line">暂无评论</div>
        <article v-for="item in comments" :key="item.id" class="surface-soft comment-item">
          <div class="comment-head">
            <strong>{{ item.nickname || 'Guest' }}</strong>
            <span>{{ item.created_at }}</span>
          </div>
          <p>{{ item.content }}</p>
        </article>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, reactive, ref } from 'vue';
import * as echarts from 'echarts';
import api from '../../api';
import InsightPanel from '../../components/InsightPanel.vue';
import { formatMoney, formatPct, formatQty, getColor, shanghaiNowText } from '../../utils/format';
import { notifyError, notifySuccess } from '../../utils/notify';

const chartRef = ref<HTMLElement | null>(null);
let chart: echarts.ECharts | null = null;

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
  charts: { asset: [], latest: null }
});

const comments = ref<any[]>([]);
const commentSubmitting = ref(false);
const commentForm = reactive({
  nickname: '',
  content: ''
});

const nowText = ref(shanghaiNowText());

const chartPoints = computed(() => {
  const points = Array.isArray(data.charts?.asset) ? [...data.charts.asset] : [];
  if (data.charts?.latest?.date) points.push(data.charts.latest);
  return points;
});

const publicHints = computed(() => {
  return [
    { title: '数据口径', text: '总资产 = 现金余额 + 持仓按当前价格估值。', level: 'info' },
    { title: '更新频率', text: '公开看板按固定频率刷新，实时性略低于管理端。', level: 'risk' },
    { title: '使用说明', text: '本系统用于策略演示与流程验证，不构成投资建议。', level: 'ok' }
  ] as Array<{ title: string; text: string; level: 'info' | 'risk' | 'ok' }>;
});

const renderChart = () => {
  if (!chartRef.value) return;
  if (!chart) chart = echarts.init(chartRef.value);

  const points = chartPoints.value;

  chart.setOption({
    grid: { top: 14, left: 44, right: 16, bottom: 24 },
    xAxis: {
      type: 'category',
      data: points.map((x: any) => x.date),
      boundaryGap: false,
      axisLabel: { color: '#64748b', fontSize: 11 },
      axisLine: { lineStyle: { color: '#d8e0ea' } }
    },
    yAxis: {
      type: 'value',
      axisLabel: {
        color: '#64748b',
        formatter: (v: number) => `¥${Math.round(v)}`
      },
      splitLine: { lineStyle: { color: '#edf2f7' } }
    },
    tooltip: {
      trigger: 'axis',
      backgroundColor: 'rgba(10, 21, 38, 0.92)',
      borderWidth: 0,
      textStyle: { color: '#fff' },
      formatter: (params: any) => {
        const p = params[0];
        return `${p.axisValue}<br/>资产: ¥${formatMoney(p.data)}`;
      }
    },
    series: [
      {
        type: 'line',
        smooth: 0.24,
        data: points.map((x: any) => x.value),
        symbol: 'circle',
        symbolSize: 5,
        lineStyle: { width: 2, color: '#1488fc' },
        itemStyle: { color: '#1488fc' },
        areaStyle: {
          color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
            { offset: 0, color: 'rgba(20, 136, 252, 0.18)' },
            { offset: 1, color: 'rgba(20, 136, 252, 0.02)' }
          ])
        }
      }
    ]
  });
};

const loadOverview = async () => {
  const res: any = await api.getPublicOverview();
  Object.assign(data, res);
  await nextTick();
  renderChart();
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

const resizeChart = () => {
  chart?.resize();
};

onMounted(async () => {
  try {
    await Promise.all([loadOverview(), loadComments()]);
  } catch {
    notifyError('公开看板加载失败', '请稍后刷新重试。');
  }

  refreshTimer = setInterval(async () => {
    try {
      await loadOverview();
    } catch {
      // ignore periodic refresh errors
    }
  }, 15000);

  clockTimer = setInterval(() => {
    nowText.value = shanghaiNowText();
  }, 1000);

  window.addEventListener('resize', resizeChart);
});

onUnmounted(() => {
  if (refreshTimer) clearInterval(refreshTimer);
  if (clockTimer) clearInterval(clockTimer);
  window.removeEventListener('resize', resizeChart);
  chart?.dispose();
  chart = null;
});
</script>

<style scoped>
.public-shell {
  max-width: 1280px;
  margin: 0 auto;
  padding: 12px;
  display: grid;
  gap: 12px;
}

.head {
  padding: 12px;
}

.head-main {
  display: flex;
  justify-content: space-between;
  gap: 10px;
}

.kicker {
  margin: 0;
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.22em;
  color: var(--text-muted);
}

.head h1 {
  margin: 6px 0 0;
  font-size: 22px;
  font-weight: 900;
}

.head p {
  margin: 4px 0 0;
  color: var(--text-soft);
  font-size: 12px;
}

.head-actions {
  display: flex;
  gap: 8px;
  align-items: flex-start;
}

.grid-main {
  display: grid;
  gap: 12px;
}

.block {
  padding: 12px;
}

.asset-top {
  display: flex;
  justify-content: space-between;
  gap: 10px;
  flex-wrap: wrap;
}

.asset-total {
  margin-top: 4px;
  font-size: 30px;
  font-weight: 900;
}

.asset-tags {
  display: flex;
  gap: 6px;
  align-items: flex-start;
}

.asset-grid {
  margin-top: 10px;
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
}

.asset-cell {
  padding: 8px 10px;
  display: grid;
  gap: 2px;
  font-size: 12px;
  color: var(--text-soft);
}

.asset-cell strong {
  font-size: 14px;
  color: var(--text);
}

.chart-head,
.section-head {
  margin-top: 12px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
}

.chart-box {
  margin-top: 8px;
  height: 260px;
  width: 100%;
}

.side-stack {
  display: grid;
  gap: 12px;
}

.log-list {
  margin-top: 8px;
  max-height: 260px;
  overflow-y: auto;
  display: grid;
  gap: 8px;
}

.log-item {
  padding: 9px 10px;
}

.log-top {
  display: flex;
  justify-content: space-between;
  gap: 8px;
}

.empty-line {
  padding: 28px 12px;
  text-align: center;
  color: var(--text-muted);
  font-size: 13px;
}

.mobile-cards {
  display: grid;
  gap: 8px;
  margin-top: 10px;
}

.card-item {
  padding: 10px;
}

.row-main {
  display: flex;
  justify-content: space-between;
  gap: 10px;
}

.name {
  font-size: 14px;
  font-weight: 700;
}

.code {
  font-size: 11px;
  color: var(--text-muted);
  margin-top: 2px;
}

.row-meta {
  margin-top: 8px;
  display: grid;
  gap: 4px;
  font-size: 12px;
  color: var(--text-soft);
}

.comment-form {
  margin-top: 10px;
  display: grid;
  grid-template-columns: minmax(120px, 180px) 1fr auto;
  gap: 8px;
}

.comment-input {
  border: 1px solid var(--line-strong);
  border-radius: 10px;
  padding: 9px 10px;
  font-size: 13px;
  outline: none;
  background: #fff;
}

.comment-input:focus {
  border-color: var(--brand);
  box-shadow: 0 0 0 2px rgba(20, 136, 252, 0.12);
}

.comment-list {
  margin-top: 10px;
  max-height: 260px;
  overflow-y: auto;
  display: grid;
  gap: 8px;
}

.comment-item {
  padding: 9px 10px;
}

.comment-head {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  font-size: 12px;
}

.comment-head span {
  color: var(--text-muted);
}

.comment-item p {
  margin: 6px 0 0;
  font-size: 13px;
  color: var(--text-soft);
  line-height: 1.55;
  word-break: break-word;
}

@media (max-width: 900px) {
  .asset-grid {
    grid-template-columns: 1fr;
  }

  .comment-form {
    grid-template-columns: 1fr;
  }

  .head-main {
    flex-direction: column;
  }
}

@media (min-width: 1080px) {
  .public-shell {
    padding: 16px 20px;
  }

  .grid-main {
    grid-template-columns: minmax(0, 1.3fr) minmax(360px, 1fr);
  }

  .block,
  .head {
    padding: 14px;
  }

  .chart-box {
    height: 300px;
  }
}
</style>
