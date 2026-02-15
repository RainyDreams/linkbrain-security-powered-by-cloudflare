<template>
  <div class="grid gap-3 xl:grid-cols-[420px,1fr]">
    <section class="space-y-3">
      <article class="glass-card p-4 md:p-5">
        <div class="mb-3 flex items-center justify-between">
          <h2 class="panel-title">{{ isBuy ? '买入挂单' : '卖出挂单' }}</h2>
          <span class="status-chip">{{ sessionText }}</span>
        </div>

        <div class="grid grid-cols-2 gap-2 text-xs text-slate-600">
          <div class="rounded-xl border border-[var(--line)] bg-white/80 px-3 py-2">
            <div>可用资金</div>
            <div class="mt-1 font-mono text-sm font-semibold text-slate-800">¥{{ formatMoney(store.dashboard.available) }}</div>
          </div>
          <div class="rounded-xl border border-[var(--line)] bg-white/80 px-3 py-2">
            <div>{{ isBuy ? '预计手续费' : '当前可卖' }}</div>
            <div class="mt-1 font-mono text-sm font-semibold text-slate-800">
              {{ isBuy ? `¥${formatMoney(estimatedFee)}` : `${formatQty(maxSellQty)} 股` }}
            </div>
          </div>
        </div>

        <div class="mt-4 space-y-3">
          <label class="block">
            <span class="kv-label">证券代码</span>
            <input
              v-model="form.symbol"
              maxlength="6"
              inputmode="numeric"
              class="mt-1 w-full rounded-xl border border-[var(--line)] bg-white px-3 py-2 text-sm font-mono outline-none focus:border-cyan-500"
              placeholder="例如 600519"
            />
          </label>

          <div class="grid grid-cols-2 gap-2">
            <label class="block">
              <span class="kv-label">委托价格(元)</span>
              <input
                v-model.number="form.price"
                type="number"
                step="0.01"
                class="mt-1 w-full rounded-xl border border-[var(--line)] bg-white px-3 py-2 text-sm font-mono outline-none focus:border-cyan-500"
                placeholder="0.00"
              />
            </label>
            <label class="block">
              <span class="kv-label">委托数量(股)</span>
              <input
                v-model.number="form.qty"
                type="number"
                step="100"
                class="mt-1 w-full rounded-xl border border-[var(--line)] bg-white px-3 py-2 text-sm font-mono outline-none focus:border-cyan-500"
                placeholder="100"
              />
            </label>
          </div>

          <div class="grid grid-cols-4 gap-2 text-xs">
            <button class="btn-solid btn-ghost" @click="setQtyByRatio(0.25)">25%</button>
            <button class="btn-solid btn-ghost" @click="setQtyByRatio(0.5)">50%</button>
            <button class="btn-solid btn-ghost" @click="setQtyByRatio(0.75)">75%</button>
            <button class="btn-solid btn-ghost" @click="setQtyByRatio(1)">100%</button>
          </div>

          <div class="rounded-xl border border-[var(--line)] bg-slate-50 px-3 py-2 text-xs text-slate-600">
            <div>标的名称: <span class="font-semibold text-slate-800">{{ matchedHolding?.name || '--' }}</span></div>
            <div class="mt-1">预计委托金额: <span class="font-mono text-slate-800">¥{{ formatMoney(estimatedAmount) }}</span></div>
          </div>

          <button
            class="btn-solid w-full"
            :class="isBuy ? 'bg-[var(--pos)] text-white hover:brightness-110' : 'bg-[var(--neg)] text-white hover:brightness-110'"
            :disabled="submitting"
            @click="submit"
          >
            <span v-if="submitting" class="mr-2 inline-block h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white"></span>
            {{ submitting ? '提交中...' : (isBuy ? '提交买入挂单' : '提交卖出挂单') }}
          </button>
        </div>
      </article>

      <InsightPanel title="交易风控提示" :items="insightItems" />
    </section>

    <section>
      <OrderList :orders="store.orders" :can-cancel="true" @cancel="onCancel" />
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import api from '../../api';
import InsightPanel from '../../components/InsightPanel.vue';
import OrderList from '../../components/OrderList.vue';
import { useMarketStore } from '../../stores/market';
import { formatMoney, formatQty, isTradingSession } from '../../utils/format';
import { notifyError, notifyInfo, notifySuccess } from '../../utils/notify';

const route = useRoute();
const store = useMarketStore();

const form = reactive({
  symbol: '',
  price: 0,
  qty: 0
});

const submitting = ref(false);

const isBuy = computed(() => route.path.includes('/buy'));
const sessionText = computed(() => (isTradingSession() ? '交易时段（可撮合）' : '非交易时段（可挂单）'));

const normalizeSymbol = (raw: string) => {
  const code = raw.trim();
  if (!/^\d{6}$/.test(code)) return code;
  return code.startsWith('6') || code.startsWith('5') ? `sh${code}` : `sz${code}`;
};

const matchedHolding = computed(() => {
  const key = normalizeSymbol(form.symbol);
  return store.holdings.find((h: any) => h.symbol === key || h.symbol === form.symbol);
});

const maxSellQty = computed(() => Number(matchedHolding.value?.available_qty || 0));
const estimatedAmount = computed(() => Number(form.price || 0) * Number(form.qty || 0));
const estimatedFee = computed(() => Math.max(5, estimatedAmount.value * 0.00025));

const alignedQty = (val: number) => {
  const n = Math.floor(Number(val || 0));
  return Math.max(0, Math.floor(n / 100) * 100);
};

const insightItems = computed(() => {
  const items: Array<{ title: string; text: string; level: 'info' | 'risk' | 'ok' }> = [
    {
      title: '规则 1：整手委托',
      text: '数量必须为 100 股整数倍，系统将拒绝零股提交。',
      level: form.qty > 0 && form.qty % 100 === 0 ? 'ok' : 'risk'
    },
    {
      title: '规则 2：资金与持仓检查',
      text: isBuy.value
        ? '买入时校验可用资金 + 手续费，避免透支下单。'
        : '卖出时校验可卖持仓，遵守 T+1 可卖规则。',
      level: 'info'
    },
    {
      title: '规则 3：撮合时段',
      text: isTradingSession() ? '当前时段提交后可立即参与撮合。' : '当前时段仅挂单，待开市后自动撮合。',
      level: isTradingSession() ? 'ok' : 'info'
    }
  ];

  if (form.symbol && !/^\d{6}$/.test(form.symbol)) {
    items.unshift({
      title: '代码格式提示',
      text: '证券代码应为 6 位数字，例如 000001、600519。',
      level: 'risk'
    });
  }

  return items;
});

const setQtyByRatio = (ratio: number) => {
  if (isBuy.value) {
    if (!form.price || form.price <= 0) {
      notifyError('价格未填写', '无法计算可买数量。', '请先输入有效委托价格。');
      return;
    }
    const budget = Number(store.dashboard.available || 0) * ratio;
    const qty = alignedQty(budget / form.price);
    form.qty = qty;
    return;
  }
  form.qty = alignedQty(maxSellQty.value * ratio);
};

const validateForm = () => {
  if (!/^\d{6}$/.test(form.symbol)) {
    notifyError('代码格式不正确', '证券代码必须为 6 位数字。', '例如：600519。');
    return false;
  }
  if (!form.price || form.price <= 0) {
    notifyError('委托价格无效', '委托价格需大于 0。', '建议参考行情最新价输入。');
    return false;
  }
  if (!Number.isInteger(form.qty) || form.qty <= 0 || form.qty % 100 !== 0) {
    notifyError('委托数量不合规', '数量必须是 100 股整数倍。', '可使用 25%/50% 快捷按钮自动计算。');
    return false;
  }
  if (!isBuy.value && form.qty > maxSellQty.value) {
    notifyError('超出可卖数量', '卖出数量大于当前可卖持仓。', '请先减少数量或等待 T+1 解锁。');
    return false;
  }
  return true;
};

const submit = async () => {
  if (!validateForm()) return;

  submitting.value = true;
  try {
    await api.trade({
      symbol: form.symbol,
      side: isBuy.value ? 'BUY' : 'SELL',
      price: Number(form.price),
      qty: Number(form.qty)
    });

    notifySuccess(
      isBuy.value ? '买入挂单已提交' : '卖出挂单已提交',
      isTradingSession() ? '订单正在参与撮合流程。' : '当前为非交易时段，订单已进入挂单队列。',
      '可在“撤单中心”查看状态并执行撤单。'
    );

    form.qty = 0;
    await store.fetchAdminData();
  } finally {
    submitting.value = false;
  }
};

const onCancel = async (id: number) => {
  if (!window.confirm('确认撤销该委托？')) return;
  await api.cancel(id);
  notifySuccess('撤单成功', '订单状态已更新。', '请关注资金与可卖持仓的回补结果。');
  await store.fetchAdminData();
};

watch(
  () => store.currentTradeSymbol,
  (symbol) => {
    if (!symbol) return;
    const code = symbol.replace(/^(sh|sz)/, '');
    form.symbol = code;
    const h = store.holdings.find((x: any) => x.symbol === symbol);
    if (h) form.price = Number(h.current_price || h.avg_cost || 0);
    store.currentTradeSymbol = '';
    notifyInfo('已载入标的', `当前标的 ${code} 已填入委托表单。`);
  },
  { immediate: true }
);
</script>
