<template>
  <div class="space-y-3">
    <section class="glass-card p-4 md:p-5">
      <div class="grid gap-3 md:grid-cols-4">
        <div>
          <div class="kv-label">总资产</div>
          <div class="kv-value">¥{{ formatMoney(store.dashboard.total) }}</div>
        </div>
        <div>
          <div class="kv-label">证券市值</div>
          <div class="kv-value">¥{{ formatMoney(store.dashboard.market_cap) }}</div>
        </div>
        <div>
          <div class="kv-label">可用资金</div>
          <div class="kv-value">¥{{ formatMoney(store.dashboard.available) }}</div>
        </div>
        <div>
          <div class="kv-label">冻结资金</div>
          <div class="kv-value">¥{{ formatMoney(store.dashboard.frozen) }}</div>
        </div>
      </div>

      <div class="mt-4 flex flex-wrap gap-2">
        <button class="btn-solid btn-primary" @click="openTransfer('IN')">银证转入</button>
        <button class="btn-solid btn-ghost" @click="openTransfer('OUT')">银证转出</button>
        <button class="btn-solid btn-ghost" @click="refresh">刷新持仓</button>
      </div>
    </section>

    <InsightPanel title="资金与持仓提示" :items="insightItems" />

    <section class="glass-card overflow-hidden">
      <div class="flex items-center justify-between border-b border-[var(--line)] px-4 py-3">
        <h2 class="panel-title">持仓明细</h2>
        <span class="text-xs text-slate-500">{{ rows.length }} 只</span>
      </div>

      <div v-if="rows.length === 0" class="px-4 py-10 text-center text-sm text-slate-500">暂无持仓</div>

      <div v-else class="overflow-x-auto scrollbar-thin">
        <table class="min-w-full text-sm">
          <thead class="data-table-head">
            <tr>
              <th class="px-4 py-3 text-left">证券</th>
              <th class="px-4 py-3 text-right">数量(总/可卖)</th>
              <th class="px-4 py-3 text-right">现价</th>
              <th class="px-4 py-3 text-right">浮盈亏</th>
              <th class="px-4 py-3 text-right">仓位</th>
              <th class="px-4 py-3 text-right">操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="h in rows" :key="h.symbol" class="border-t border-[var(--line)]/70">
              <td class="px-4 py-3">
                <div class="font-semibold text-slate-800">{{ h.name || '--' }}</div>
                <div class="font-mono text-xs text-slate-500">{{ h.symbol }}</div>
              </td>
              <td class="px-4 py-3 text-right font-mono text-slate-700">{{ formatQty(h.quantity) }} / {{ formatQty(h.available_qty) }}</td>
              <td class="px-4 py-3 text-right font-mono text-slate-700">¥{{ formatMoney(h.current_price) }}</td>
              <td class="px-4 py-3 text-right font-mono" :class="getColor(h.pnl)">¥{{ formatMoney(h.pnl) }}</td>
              <td class="px-4 py-3 text-right font-mono text-slate-700">{{ h.position }}%</td>
              <td class="px-4 py-3 text-right">
                <button class="rounded-lg border border-[var(--line)] px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50" @click="goTrade(h.symbol, 'buy')">买入</button>
                <button class="ml-1 rounded-lg border border-[var(--line)] px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50" @click="goTrade(h.symbol, 'sell')">卖出</button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <div v-if="showTransfer" class="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4" @click="showTransfer = false">
      <div class="w-full max-w-md rounded-2xl border border-[var(--line)] bg-white p-5 shadow-2xl" @click.stop>
        <h3 class="text-lg font-bold text-slate-900">{{ transferType === 'IN' ? '银证转入' : '银证转出' }}</h3>
        <p class="mt-1 text-xs text-slate-600">办理时段：工作日 09:00-16:00。系统会记录 request_id 以防重复入账。</p>

        <div class="mt-4">
          <label class="kv-label">金额(元)</label>
          <input
            v-model="transferAmount"
            type="number"
            step="0.01"
            min="0"
            class="mt-1 w-full rounded-xl border border-[var(--line)] bg-white px-3 py-2 text-lg font-mono outline-none focus:border-cyan-500"
            placeholder="0.00"
          />
        </div>

        <div class="mt-3 rounded-xl border border-[var(--line)] bg-slate-50 px-3 py-2 text-xs text-slate-600">
          <div>本次 request_id: <span class="font-mono text-slate-800">{{ previewRequestId }}</span></div>
          <div class="mt-1">说明：提交成功后请以“状态为 SUCCESS”的流水为准。</div>
        </div>

        <div class="mt-4 flex gap-2">
          <button class="btn-solid btn-ghost flex-1" @click="showTransfer = false">取消</button>
          <button class="btn-solid btn-primary flex-1" :disabled="transfering" @click="submitTransfer">
            {{ transfering ? '提交中...' : '确认提交' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRouter } from 'vue-router';
import api from '../../api';
import InsightPanel from '../../components/InsightPanel.vue';
import { useMarketStore } from '../../stores/market';
import { formatMoney, formatQty, getColor, isTradingSession } from '../../utils/format';
import { notifyError, notifySuccess } from '../../utils/notify';

const store = useMarketStore();
const router = useRouter();

const rows = computed(() => {
  const total = Number(store.dashboard.total || 0);
  return store.holdings.map((h: any) => {
    const qty = Number(h.quantity || 0);
    const marketValue = Number(h.current_price || 0) * qty;
    const pnl = marketValue - Number(h.total_cost || 0);
    return {
      ...h,
      marketValue,
      pnl,
      position: total > 0 ? ((marketValue / total) * 100).toFixed(2) : '0.00'
    };
  });
});

const insightItems = computed(() => {
  return [
    {
      title: '转账时段控制',
      text: isTradingSession() ? '当前处于交易时段，可正常办理银证转账。' : '当前可能不在转账时段，提交时如失败请关注系统提示。',
      level: isTradingSession() ? 'ok' : 'risk'
    },
    {
      title: '可卖数量说明',
      text: '卖出操作以 available_qty 为准，受 T+1 规则影响。',
      level: 'info'
    },
    {
      title: '风险建议',
      text: '转出前建议保留足够可用资金，避免影响后续买入委托。',
      level: 'info'
    }
  ] as Array<{ title: string; text: string; level: 'info' | 'risk' | 'ok' }>;
});

const showTransfer = ref(false);
const transferType = ref<'IN' | 'OUT'>('IN');
const transferAmount = ref('');
const transfering = ref(false);
const previewRequestId = ref(crypto.randomUUID());

const openTransfer = (type: 'IN' | 'OUT') => {
  transferType.value = type;
  transferAmount.value = '';
  previewRequestId.value = crypto.randomUUID();
  showTransfer.value = true;
};

const submitTransfer = async () => {
  const amount = Number(transferAmount.value);
  if (!Number.isFinite(amount) || amount <= 0) {
    notifyError('金额输入无效', '转账金额必须大于 0。', '请按元输入，最多两位小数。');
    return;
  }

  transfering.value = true;
  try {
    await api.transfer({
      amount,
      type: transferType.value,
      request_id: previewRequestId.value
    });
    notifySuccess(
      transferType.value === 'IN' ? '银证转入提交成功' : '银证转出提交成功',
      `请求流水号：${previewRequestId.value}`,
      '请在后续查询中确认状态为 SUCCESS。'
    );
    showTransfer.value = false;
    await store.fetchAdminData();
  } finally {
    transfering.value = false;
  }
};

const goTrade = (symbol: string, side: 'buy' | 'sell') => {
  store.currentTradeSymbol = symbol;
  router.push(`/admin/${side}`);
};

const refresh = async () => {
  await store.fetchAdminData(true);
};
</script>
