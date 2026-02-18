<template>
  <div class="trade-page">
    <section class="panel panel-form">
      <header class="panel-head">
        <div>
          <h2 class="panel-title">{{ isBuy ? '买入委托' : '卖出委托' }}</h2>
          <p class="panel-sub">{{ sessionText }}</p>
        </div>
        <span class="status-badge" :class="isTradingSession() ? 'status-live' : 'status-queue'">
          {{ isTradingSession() ? '撮合中' : '可挂单' }}
        </span>
      </header>

      <div class="metric-row">
        <div class="metric-box">
          <span class="metric-label">可用资金</span>
          <strong class="metric-value">¥{{ formatMoney(store.dashboard.available) }}</strong>
        </div>
        <div class="metric-box">
          <span class="metric-label">{{ isBuy ? '预估手续费' : '可卖数量' }}</span>
          <strong class="metric-value">{{ isBuy ? `¥${formatMoney(estimatedFee)}` : `${formatQty(maxSellQty)} 股` }}</strong>
        </div>
      </div>

      <div class="form-grid">
        <label class="field-block field-symbol">
          <span class="field-label">证券代码</span>
          <div class="field-inline">
            <input
              v-model="form.symbol"
              maxlength="6"
              inputmode="numeric"
              class="field-input"
              placeholder="例如 600519"
            />
            <button class="field-btn" :disabled="quote.loading" @click="refreshQuote(true)">
              {{ quote.loading ? '更新中' : '刷新行情' }}
            </button>
          </div>
          <p v-if="quote.name" class="quote-name">{{ quote.name }} · {{ normalizedSymbol }}</p>
        </label>

        <label class="field-block">
          <span class="field-label">委托价格(元)</span>
          <input
            v-model.number="form.price"
            type="number"
            step="0.01"
            class="field-input"
            placeholder="0.00"
          />
        </label>

        <label class="field-block">
          <span class="field-label">委托数量(股)</span>
          <input
            v-model.number="form.qty"
            type="number"
            step="100"
            class="field-input"
            placeholder="100"
          />
        </label>
      </div>

      <div class="quote-card" :class="quote.change_pct > 0 ? 'rise' : quote.change_pct < 0 ? 'fall' : ''">
        <div class="quote-main">
          <span>最新价</span>
          <strong>¥{{ formatMoney(quote.price || form.price || 0) }}</strong>
          <span class="quote-change" :class="getColor(quote.change_pct)">{{ formatPct(quote.change_pct) }}</span>
        </div>
        <div class="quote-meta">
          <label class="auto-follow">
            <input v-model="autoPrice" type="checkbox" />
            自动跟价填入委托价
          </label>
          <span>源: {{ quote.source || '--' }}</span>
          <span v-if="quote.updatedAt">{{ quote.updatedAt }}</span>
        </div>
        <p v-if="quote.error" class="quote-error">{{ quote.error }}</p>
      </div>

      <div class="ratio-row">
        <button class="ratio-btn" @click="setQtyByRatio(0.25)">25%</button>
        <button class="ratio-btn" @click="setQtyByRatio(0.5)">50%</button>
        <button class="ratio-btn" @click="setQtyByRatio(0.75)">75%</button>
        <button class="ratio-btn" @click="setQtyByRatio(1)">100%</button>
      </div>

      <button
        class="submit-btn"
        :class="isBuy ? 'submit-buy' : 'submit-sell'"
        :disabled="submitting"
        @click="submit"
      >
        <span v-if="submitting" class="loading-dot"></span>
        {{ submitting ? '提交中...' : (isBuy ? '提交买入挂单' : '提交卖出挂单') }}
      </button>
    </section>

    <section class="panel panel-order">
      <InsightPanel title="交易执行说明" :items="insightItems" />
      <OrderList class="order-list" :orders="store.orders" :can-cancel="true" @cancel="onCancel" />
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
import { formatMoney, formatPct, formatQty, getColor, isTradingSession, shanghaiNowText } from '../../utils/format';
import { notifyError, notifyInfo, notifySuccess } from '../../utils/notify';

const route = useRoute();
const store = useMarketStore();

const form = reactive({
  symbol: '',
  price: 0,
  qty: 0
});

const quote = reactive({
  name: '',
  price: 0,
  change_pct: 0,
  source: '',
  loading: false,
  error: '',
  updatedAt: ''
});

const autoPrice = ref(true);
const submitting = ref(false);
const quoteTimer = ref<number | null>(null);

const isBuy = computed(() => route.path.includes('/buy'));
const sessionText = computed(() => (isTradingSession() ? '交易时段，提交后将立即进入撮合。' : '非交易时段，允许挂单并在开市后自动撮合。'));

const normalizeSymbol = (raw: string) => {
  const code = String(raw || '').trim();
  if (!/^\d{6}$/.test(code)) return code;
  return code.startsWith('6') || code.startsWith('5') ? `sh${code}` : `sz${code}`;
};

const normalizedSymbol = computed(() => normalizeSymbol(form.symbol));

const matchedHolding = computed(() => {
  const key = normalizedSymbol.value;
  return store.holdings.find((h: any) => h.symbol === key || h.symbol === form.symbol);
});

const maxSellQty = computed(() => Number(matchedHolding.value?.available_qty || 0));
const estimatedFee = computed(() => Math.max(5, Number(form.price || 0) * Number(form.qty || 0) * 0.00025));

const alignedQty = (val: number) => {
  const n = Math.floor(Number(val || 0));
  return Math.max(0, Math.floor(n / 100) * 100);
};

const refreshQuote = async (manual = false) => {
  if (!/^\d{6}$/.test(form.symbol)) return;

  quote.loading = true;
  quote.error = '';
  try {
    const data: any = await api.getQuote(form.symbol);
    quote.name = data.name || '';
    quote.price = Number(data.price || 0);
    quote.change_pct = Number(data.change_pct || 0);
    quote.source = data.source || '';
    quote.updatedAt = shanghaiNowText().split(' ')[1] || shanghaiNowText();

    if (autoPrice.value && quote.price > 0) {
      form.price = quote.price;
    }

    if (manual) {
      notifyInfo('行情已刷新', `${quote.name || form.symbol} 最新价 ¥${formatMoney(quote.price)}`, '可继续调整价格后提交委托。', 2200);
    }
  } catch {
    quote.error = '行情获取失败，请确认代码或稍后重试。';
    if (manual) {
      notifyError('行情刷新失败', '未获取到可用行情数据。', '请检查证券代码是否正确。');
    }
  } finally {
    quote.loading = false;
  }
};

const insightItems = computed(() => {
  return [
    {
      title: '下单规则',
      text: '数量必须为 100 股整数倍；价格最多两位小数。',
      level: form.qty > 0 && form.qty % 100 === 0 ? 'ok' : 'risk'
    },
    {
      title: '风控校验',
      text: isBuy.value ? '买入需覆盖委托金额+手续费。' : '卖出不能超过可卖持仓。',
      level: 'info'
    },
    {
      title: '时段策略',
      text: isTradingSession() ? '当前提交后可实时撮合。' : '当前可挂单，待开市后撮合。',
      level: isTradingSession() ? 'ok' : 'info'
    }
  ] as Array<{ title: string; text: string; level: 'info' | 'risk' | 'ok' }>;
});

const setQtyByRatio = (ratio: number) => {
  if (isBuy.value) {
    if (!form.price || form.price <= 0) {
      notifyError('价格未填写', '无法按比例估算可买数量。', '请先输入或刷新行情价格。');
      return;
    }
    const budget = Number(store.dashboard.available || 0) * ratio;
    form.qty = alignedQty(budget / (form.price * 1.00025));
    return;
  }
  form.qty = alignedQty(maxSellQty.value * ratio);
};

const validateForm = () => {
  if (!/^\d{6}$/.test(form.symbol)) {
    notifyError('代码格式不正确', '证券代码必须是 6 位数字。', '例如 000001 或 600519。');
    return false;
  }
  if (!form.price || Number(form.price) <= 0) {
    notifyError('委托价格无效', '委托价格必须大于 0。', '建议使用“刷新行情”后自动带入价格。');
    return false;
  }
  if (!Number.isInteger(form.qty) || form.qty <= 0 || form.qty % 100 !== 0) {
    notifyError('委托数量不合规', '数量需为 100 股整数倍且大于 0。', '可点击 25/50/75/100% 快捷填充。');
    return false;
  }
  if (!isBuy.value && form.qty > maxSellQty.value) {
    notifyError('超出可卖数量', '卖出数量超过当前可卖持仓。', '请减少数量或等待 T+1 可卖释放。');
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
      isBuy.value ? '买入挂单提交成功' : '卖出挂单提交成功',
      isTradingSession() ? '订单已进入撮合流程。' : '当前为非交易时段，已进入挂单队列。',
      '可前往撤单页查看状态。'
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
  notifySuccess('撤单成功', `订单 #${id} 已提交撤销。`, '资金或持仓将按规则回补。');
  await store.fetchAdminData();
};

watch(
  () => form.symbol,
  (val) => {
    if (quoteTimer.value) {
      window.clearTimeout(quoteTimer.value);
      quoteTimer.value = null;
    }

    const code = String(val || '').trim().replace(/\D/g, '').slice(0, 6);
    if (code !== val) form.symbol = code;

    if (/^\d{6}$/.test(code)) {
      quoteTimer.value = window.setTimeout(() => {
        refreshQuote(false);
      }, 260);
    } else {
      quote.name = '';
      quote.price = 0;
      quote.change_pct = 0;
      quote.error = '';
      quote.updatedAt = '';
    }
  }
);

watch(
  () => store.currentTradeSymbol,
  (symbol) => {
    if (!symbol) return;
    form.symbol = String(symbol).replace(/^(sh|sz)/, '');
    store.currentTradeSymbol = '';
  },
  { immediate: true }
);

watch(
  () => autoPrice.value,
  (enabled) => {
    if (enabled && quote.price > 0) {
      form.price = quote.price;
    }
  }
);
</script>

<style scoped>
.trade-page {
  display: grid;
  gap: 12px;
}

.panel {
  border: 1px solid var(--line);
  border-radius: 14px;
  background: var(--surface);
  padding: 14px;
}

.panel-form {
  display: grid;
  gap: 12px;
}

.panel-order {
  display: grid;
  gap: 12px;
}

.panel-head {
  display: flex;
  justify-content: space-between;
  gap: 10px;
}

.panel-sub {
  margin-top: 4px;
  font-size: 12px;
  color: var(--text-soft);
}

.status-badge {
  border-radius: 999px;
  padding: 4px 10px;
  font-size: 11px;
  font-weight: 700;
  border: 1px solid transparent;
  height: fit-content;
}

.status-live {
  color: #b42318;
  background: #fee4e2;
  border-color: #fecdca;
}

.status-queue {
  color: #175cd3;
  background: #eff8ff;
  border-color: #b2ddff;
}

.metric-row {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}

.metric-box {
  border: 1px solid var(--line);
  border-radius: 10px;
  padding: 8px 10px;
  background: var(--surface-soft);
}

.metric-label {
  display: block;
  font-size: 11px;
  color: var(--text-muted);
}

.metric-value {
  display: block;
  margin-top: 3px;
  font-size: 14px;
}

.form-grid {
  display: grid;
  gap: 10px;
}

.field-block {
  display: grid;
  gap: 6px;
}

.field-label {
  font-size: 12px;
  color: var(--text-soft);
}

.field-inline {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 8px;
}

.field-input {
  width: 100%;
  border: 1px solid var(--line-strong);
  border-radius: 10px;
  padding: 10px 11px;
  font-size: 14px;
  background: #fff;
  outline: none;
}

.field-input:focus {
  border-color: var(--brand);
  box-shadow: 0 0 0 2px rgba(20, 136, 252, 0.12);
}

.field-btn {
  border: 1px solid var(--line-strong);
  border-radius: 10px;
  padding: 0 12px;
  font-size: 12px;
  font-weight: 600;
  background: #fff;
  color: var(--text-soft);
}

.field-btn:disabled {
  opacity: 0.7;
}

.quote-name {
  margin: 0;
  font-size: 12px;
  color: var(--text-muted);
}

.quote-card {
  border: 1px solid var(--line);
  border-radius: 12px;
  background: var(--surface-soft);
  padding: 10px 12px;
  display: grid;
  gap: 6px;
}

.quote-card.rise {
  border-color: #fecdca;
  background: #fff5f3;
}

.quote-card.fall {
  border-color: #abefc6;
  background: #f6fef9;
}

.quote-main {
  display: flex;
  align-items: baseline;
  gap: 8px;
  font-size: 12px;
  color: var(--text-soft);
}

.quote-main strong {
  font-size: 20px;
  color: var(--text);
}

.quote-change {
  font-size: 12px;
  font-weight: 700;
}

.quote-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  font-size: 11px;
  color: var(--text-muted);
}

.auto-follow {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.quote-error {
  margin: 0;
  font-size: 12px;
  color: #b42318;
}

.ratio-row {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 8px;
}

.ratio-btn {
  border: 1px solid var(--line-strong);
  border-radius: 10px;
  background: #fff;
  color: var(--text-soft);
  padding: 8px 0;
  font-size: 12px;
  font-weight: 700;
}

.submit-btn {
  width: 100%;
  border: 0;
  border-radius: 11px;
  color: #fff;
  padding: 11px;
  font-size: 14px;
  font-weight: 700;
  display: inline-flex;
  justify-content: center;
  align-items: center;
  gap: 8px;
}

.submit-buy {
  background: #d92d20;
}

.submit-sell {
  background: #067647;
}

.submit-btn:disabled {
  opacity: 0.6;
}

.loading-dot {
  width: 14px;
  height: 14px;
  border-radius: 999px;
  border: 2px solid rgba(255, 255, 255, 0.45);
  border-top-color: #fff;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

@media (min-width: 1080px) {
  .trade-page {
    grid-template-columns: minmax(380px, 420px) minmax(0, 1fr);
    align-items: start;
  }

  .panel {
    padding: 16px;
  }
}
</style>
