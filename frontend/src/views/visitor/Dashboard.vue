<template>
  <div class="mx-auto min-h-screen w-full max-w-[1320px] px-3 pb-6 pt-3 md:px-6 md:pt-5">
    <header class="glass-card mb-3 p-4 md:p-5 fade-rise">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p class="text-[11px] uppercase tracking-[0.25em] text-slate-500">Zero Ben · Public Board</p>
          <h1 class="mt-1 text-2xl font-extrabold text-slate-900">公开资产总览</h1>
          <p class="mt-1 text-xs text-slate-600">{{ nowText }} · 数据每 15 秒自动刷新</p>
        </div>
        <div class="flex gap-2">
          <button class="btn-solid btn-ghost" @click="loadOverview">刷新</button>
          <button class="btn-solid btn-primary" @click="$router.push('/login')">管理员登录</button>
        </div>
      </div>
    </header>

    <section class="grid gap-3 lg:grid-cols-[1.35fr,1fr]">
      <article class="glass-card p-4 md:p-5 fade-rise">
        <div class="grid gap-3 md:grid-cols-3">
          <div class="md:col-span-2">
            <div class="kv-label">总资产 (CNY)</div>
            <div class="mt-2 text-3xl font-extrabold font-mono text-slate-900">¥{{ formatMoney(data.assets.total) }}</div>
            <div class="mt-2 flex flex-wrap gap-2 text-xs">
              <span class="tag" :class="Number(data.assets.return_total_pct) >= 0 ? 'tag-pos' : 'tag-neg'">累计收益 {{ formatPct(data.assets.return_total_pct) }}</span>
              <span class="tag" :class="Number(data.assets.day_pct) >= 0 ? 'tag-pos' : 'tag-neg'">当日 {{ formatPct(data.assets.day_pct) }}</span>
              <span class="tag tag-neutral">冻结 ¥{{ formatMoney(data.assets.frozen) }}</span>
            </div>
          </div>
          <div class="rounded-xl border border-[var(--line)] bg-white/85 p-3">
            <div class="kv-label">持仓市值</div>
            <div class="mt-1 font-mono text-lg font-bold text-slate-800">¥{{ formatMoney(data.assets.market_cap) }}</div>
            <div class="mt-2 text-xs text-slate-600">可用资金 ¥{{ formatMoney(data.assets.balance) }}</div>
          </div>
        </div>

        <div class="mt-4">
          <div class="mb-2 flex items-center justify-between">
            <h2 class="panel-title">资产趋势</h2>
            <span class="text-xs text-slate-500">{{ chartPoints.length }} 点</span>
          </div>
          <div ref="chartRef" class="h-[300px] w-full"></div>
        </div>
      </article>

      <div class="space-y-3 fade-rise">
        <article class="glass-card overflow-hidden">
          <div class="flex items-center justify-between border-b border-[var(--line)] px-4 py-3">
            <h2 class="panel-title">交易播报</h2>
            <span class="text-xs text-slate-500">{{ data.logs.length }} 条</span>
          </div>

          <div class="max-h-[280px] overflow-y-auto scrollbar-thin px-4 py-3">
            <div v-if="data.logs.length === 0" class="py-6 text-center text-sm text-slate-500">暂无交易播报</div>
            <div v-for="(log, idx) in data.logs" :key="idx" class="mb-2 rounded-xl border border-[var(--line)] bg-white/90 p-3">
              <div class="flex items-center justify-between gap-2">
                <div class="text-sm font-semibold text-slate-800">{{ log.text }}</div>
                <span class="text-[11px] text-slate-500">{{ log.time }}</span>
              </div>
              <div class="mt-1 text-xs text-slate-600">{{ log.detail }}</div>
            </div>
          </div>
        </article>

        <InsightPanel title="公开看板说明" :items="publicHints" />
      </div>
    </section>

    <section class="glass-card mt-3 overflow-hidden fade-rise">
      <div class="flex items-center justify-between border-b border-[var(--line)] px-4 py-3">
        <h2 class="panel-title">持仓明细</h2>
        <span class="text-xs text-slate-500">{{ data.holdings.length }} 只</span>
      </div>

      <div v-if="data.holdings.length === 0" class="px-4 py-10 text-center text-sm text-slate-500">暂无持仓</div>

      <div v-else class="overflow-x-auto scrollbar-thin">
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
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, reactive, ref } from 'vue';
import * as echarts from 'echarts';
import api from '../../api';
import InsightPanel from '../../components/InsightPanel.vue';
import { formatMoney, formatPct, formatQty, getColor, shanghaiNowText } from '../../utils/format';

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

const nowText = ref(shanghaiNowText());

const chartPoints = computed(() => {
  const points = Array.isArray(data.charts?.asset) ? [...data.charts.asset] : [];
  if (data.charts?.latest?.date) points.push(data.charts.latest);
  return points;
});

const publicHints = computed(() => {
  return [
    {
      title: '数据口径',
      text: '总资产 = 现金余额 + 持仓按当前价格估值。',
      level: 'info'
    },
    {
      title: '交易时效',
      text: '交易日志存在刷新延迟，最终以管理端订单状态为准。',
      level: 'risk'
    },
    {
      title: '适用范围',
      text: '本系统用于模拟交易与流程演示，不构成投资建议。',
      level: 'ok'
    }
  ] as Array<{ title: string; text: string; level: 'info' | 'risk' | 'ok' }>;
});

const renderChart = () => {
  if (!chartRef.value) return;
  if (!chart) chart = echarts.init(chartRef.value);

  const points = chartPoints.value;

  chart.setOption({
    grid: { top: 14, left: 48, right: 18, bottom: 30 },
    xAxis: {
      type: 'category',
      data: points.map((x: any) => x.date),
      boundaryGap: false,
      axisLabel: { color: '#5a6f82', fontSize: 11 },
      axisLine: { lineStyle: { color: '#b5c7d5' } }
    },
    yAxis: {
      type: 'value',
      axisLabel: {
        color: '#5a6f82',
        formatter: (v: number) => `¥${Math.round(v)}`
      },
      splitLine: { lineStyle: { color: '#dbe7f0' } }
    },
    tooltip: {
      trigger: 'axis',
      backgroundColor: 'rgba(16,29,41,0.95)',
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
        symbolSize: 6,
        lineStyle: { width: 2.3, color: '#2098d2' },
        itemStyle: { color: '#10a37b' },
        areaStyle: {
          color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
            { offset: 0, color: 'rgba(32,152,210,0.29)' },
            { offset: 1, color: 'rgba(16,163,123,0.03)' }
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

let refreshTimer: ReturnType<typeof setInterval> | null = null;
let clockTimer: ReturnType<typeof setInterval> | null = null;

onMounted(async () => {
  await loadOverview();

  refreshTimer = setInterval(loadOverview, 15000);
  clockTimer = setInterval(() => {
    nowText.value = shanghaiNowText();
  }, 1000);

  window.addEventListener('resize', resizeChart);
});

const resizeChart = () => {
  chart?.resize();
};

onUnmounted(() => {
  if (refreshTimer) clearInterval(refreshTimer);
  if (clockTimer) clearInterval(clockTimer);
  window.removeEventListener('resize', resizeChart);
  chart?.dispose();
  chart = null;
});
</script>
