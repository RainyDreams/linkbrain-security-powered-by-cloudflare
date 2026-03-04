<template>
  <div class="trade-page">
    <section class="panel panel-form">
      <header class="panel-head">
        <div>
          <h2 class="panel-title">{{ isBuy ? '买入委托' : '卖出委托' }}</h2>
          <p class="panel-sub hide-mobile">{{ sessionText }}</p>
          <div class="side-switch">
            <button class="side-btn" :class="isBuy ? 'active buy' : ''" @click="switchSide('BUY')">买入</button>
            <button class="side-btn" :class="!isBuy ? 'active sell' : ''" @click="switchSide('SELL')">卖出</button>
          </div>
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

        <label class="field-block">
          <span class="field-label">策略标签</span>
          <select v-model="form.strategy_tag" class="field-input">
            <option value="LONG_STABLE">长期稳健</option>
            <option value="SHORT_AGGRESSIVE">短期激进</option>
            <option value="MID_BALANCED">中线均衡</option>
          </select>
        </label>

        <label class="field-block">
          <span class="field-label">订单备注（心得/吃亏点/目的/底线）</span>
          <textarea
            v-model="form.remark"
            rows="3"
            maxlength="1200"
            class="field-input field-textarea"
            placeholder="例如：目的、底线、仓位节奏、失败复盘要点..."
          ></textarea>
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

      <div class="etf-card">
        <div class="etf-head">
          <span class="guard-title">大盘ETF情绪</span>
          <button class="field-btn" :disabled="etfLoading" @click="fetchMarketEtfs(true)">
            {{ etfLoading ? '更新中' : '刷新ETF' }}
          </button>
        </div>
        <div v-if="marketEtfs.length === 0" class="quote-error">暂无ETF行情</div>
        <div v-else class="etf-grid">
          <article
            v-for="item in marketEtfs"
            :key="item.symbol"
            class="etf-item"
          >
            <div class="etf-top">
              <strong>{{ item.name }}</strong>
              <span class="font-mono">{{ item.symbol }}</span>
            </div>
            <div class="etf-bottom">
              <span class="font-mono">¥{{ formatMoney(item.price || 0) }}</span>
              <span :class="getColor(item.change_pct)">{{ formatPct(item.change_pct) }}</span>
            </div>
          </article>
        </div>
      </div>

      <div v-if="priceGuard.ready" class="guard-card">
        <div class="guard-head">
          <div>
            <span class="guard-title">价格笼子智能辅助</span>
            <p class="guard-sub">
              {{ priceGuard.boardText }} · 参考价 ¥{{ formatMoney(priceGuard.referencePrice) }} ·
              涨跌停 ¥{{ formatMoney(priceGuard.limitDown) }} ~ ¥{{ formatMoney(priceGuard.limitUp) }}
            </p>
          </div>
          <span class="guard-status" :class="guardStatusClass">
            {{ guardStatusText }}
          </span>
        </div>

        <div class="guard-range">
          <span>
            买入上限 ¥{{ formatMoney(priceGuard.buyUp) }} · 卖出下限 ¥{{ formatMoney(priceGuard.sellDown) }}
          </span>
          <span>当前委托: ¥{{ formatMoney(form.price || 0) }}</span>
        </div>
        <p v-if="priceGuard.reason" class="guard-note">{{ priceGuard.reason }}</p>

        <div class="guard-actions">
          <button class="ratio-btn" @click="applySmartPrice('buy')">推荐买价 ¥{{ formatMoney(priceGuard.suggestBuy) }}</button>
          <button class="ratio-btn" @click="applySmartPrice('mid')">中位价 ¥{{ formatMoney(priceGuard.suggestMid) }}</button>
          <button class="ratio-btn" @click="applySmartPrice('sell')">推荐卖价 ¥{{ formatMoney(priceGuard.suggestSell) }}</button>
        </div>
      </div>

      <div class="ratio-row">
        <button class="ratio-btn" @click="setQtyByRatio(0.25)">25%</button>
        <button class="ratio-btn" @click="setQtyByRatio(0.5)">50%</button>
        <button class="ratio-btn" @click="setQtyByRatio(0.75)">75%</button>
        <button class="ratio-btn" @click="setQtyByRatio(1)">100%</button>
      </div>

      <div class="ratio-row">
        <button class="ratio-btn" @click="setQtyLots(2)">2手</button>
        <button class="ratio-btn" @click="setQtyLots(5)">5手</button>
        <button class="ratio-btn" @click="setQtyLots(10)">10手</button>
        <button class="ratio-btn" @click="setQtyLots(20)">20手</button>
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
      <div class="order-toolbar">
        <div>
          <span class="order-title">撮合控制</span>
          <span class="order-tip">强制撮合</span>
        </div>
        <button class="btn-solid btn-ghost" :disabled="manualMatching" @click="manualMatch">
          {{ manualMatching ? '撮合中...' : '手动撮合' }}
        </button>
      </div>
      <OrderList class="order-list" :orders="store.orders" :can-cancel="true" @cancel="onCancel" />
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import api from '../../api';
import OrderList from '../../components/OrderList.vue';
import { useMarketStore } from '../../stores/market';
import { formatMoney, formatPct, formatQty, getColor, isTradingSession, shanghaiNowText } from '../../utils/format';
import { notifyError, notifyInfo, notifySuccess, notifyWarning } from '../../utils/notify';

const route = useRoute();
const router = useRouter();
const store = useMarketStore();

const form = reactive({
  symbol: '',
  price: 0,
  qty: 300,
  strategy_tag: 'LONG_STABLE',
  remark: ''
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

const priceGuard = reactive({
  ready: false,
  enabled: false,
  applicable: false,
  mode: 'NONE',
  reason: '',
  board: 'OTHER',
  boardText: '未知板块',
  referencePrice: 0,
  limitUp: 0,
  limitDown: 0,
  buyUp: 0,
  sellDown: 0,
  cageUp: 0,
  cageDown: 0,
  suggestBuy: 0,
  suggestSell: 0,
  suggestMid: 0,
  tick: 0.01
});

const autoPrice = ref(true);
const submitting = ref(false);
const manualMatching = ref(false);
const quoteTimer = ref<number | null>(null);
const etfLoading = ref(false);
const marketEtfs = ref<Array<{
  symbol: string;
  name: string;
  price: number;
  change_pct: number;
}>>([]);

const side = ref<'BUY' | 'SELL'>('BUY');
const isBuy = computed(() => side.value === 'BUY');
const sessionText = computed(() => (isTradingSession() ? '交易时段，提交后将立即进入撮合。' : '非交易时段，允许挂单并在开市后自动撮合。'));

const switchSide = (next: 'BUY' | 'SELL') => {
  if (side.value === next) return;
  side.value = next;
  router.replace({ path: '/admin/trade', query: { ...route.query, side: next } });
};

const normalizeSymbol = (raw: string) => {
  const code = String(raw || '').trim();
  if (!/^\d{6}$/.test(code)) return code;
  if (code.startsWith('8') || code.startsWith('4')) return `bj${code}`;
  return code.startsWith('6') || code.startsWith('5') ? `sh${code}` : `sz${code}`;
};

const boardTextMap: Record<string, string> = {
  MAIN: '沪深主板',
  CHINEXT: '创业板',
  STAR: '科创板',
  BSE: '北交所',
  OTHER: '其他板块'
};

const normalizedSymbol = computed(() => normalizeSymbol(form.symbol));

const matchedHolding = computed(() => {
  const key = normalizedSymbol.value.toLowerCase();
  return store.holdings.find((h: any) => String(h.symbol || '').toLowerCase() === key || h.symbol === form.symbol);
});

const maxSellQty = computed(() => Number(matchedHolding.value?.available_qty || 0));
const estimatedFee = computed(() => Math.max(5, Number(form.price || 0) * Number(form.qty || 0) * 0.00025));
const priceInCage = computed(() => {
  if (!priceGuard.ready || !priceGuard.enabled || !priceGuard.applicable) return true;
  const p = Number(form.price || 0);
  if (isBuy.value) return p <= Number(priceGuard.buyUp || 0);
  return p >= Number(priceGuard.sellDown || 0);
});

const guardStatusText = computed(() => {
  if (!priceGuard.ready || !priceGuard.enabled) return '未启用';
  if (!priceGuard.applicable) return '当前不适用';
  if (priceInCage.value) return '笼子内';
  return priceGuard.mode === 'QUEUE' ? '超笼暂存' : '超笼拒单';
});

const guardStatusClass = computed(() => {
  if (!priceGuard.ready || !priceGuard.enabled || !priceGuard.applicable) return 'idle';
  return priceInCage.value ? 'ok' : 'warn';
});

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

    const guard = data?.price_guard || null;
    if (guard) {
      const board = String(guard.board || 'OTHER').toUpperCase();
      priceGuard.ready = true;
      priceGuard.enabled = !!guard.cage_enabled;
      priceGuard.applicable = !!guard.cage_applicable;
      priceGuard.mode = String(guard.cage_mode || 'NONE').toUpperCase();
      priceGuard.reason = String(guard.cage_reason || '');
      priceGuard.board = board;
      priceGuard.boardText = boardTextMap[board] || boardTextMap.OTHER;
      priceGuard.referencePrice = Number(guard.reference_price || 0);
      priceGuard.limitUp = Number(guard.limit_up || 0);
      priceGuard.limitDown = Number(guard.limit_down || 0);
      priceGuard.buyUp = Number(guard.buy_up || guard.cage_up || 0);
      priceGuard.sellDown = Number(guard.sell_down || guard.cage_down || 0);
      priceGuard.cageUp = Number(guard.cage_up || 0);
      priceGuard.cageDown = Number(guard.cage_down || 0);
      priceGuard.suggestBuy = Number(guard.suggest_buy || 0);
      priceGuard.suggestSell = Number(guard.suggest_sell || 0);
      priceGuard.suggestMid = Number(guard.suggest_mid || 0);
      priceGuard.tick = Number(guard.tick || 0.01);
    } else {
      priceGuard.ready = false;
      priceGuard.enabled = false;
      priceGuard.applicable = false;
      priceGuard.mode = 'NONE';
      priceGuard.reason = '';
    }

    if (autoPrice.value) {
      applySmartPrice(isBuy.value ? 'buy' : 'sell', true);
    }

    if (manual) {
      notifyInfo('行情已刷新', `${quote.name || form.symbol} ¥${formatMoney(quote.price)}`, undefined, 2200);
    }
  } catch {
    quote.error = '行情获取失败，请确认代码或稍后重试。';
    if (manual) {
      notifyError('行情刷新失败', '未获取到可用行情数据。');
    }
  } finally {
    quote.loading = false;
  }
};

const applySmartPrice = (mode: 'buy' | 'sell' | 'mid', silent = false) => {
  let price = 0;
  if (mode === 'buy') price = Number(priceGuard.suggestBuy || 0);
  else if (mode === 'sell') price = Number(priceGuard.suggestSell || 0);
  else price = Number(priceGuard.suggestMid || 0);

  if (!price || price <= 0) {
    price = Number(quote.price || form.price || 0);
  }
  if (!price || price <= 0) return;

  form.price = Number(price.toFixed(2));
  if (!silent) {
    notifyInfo('已填入智能参考价', `委托价已更新为 ¥${formatMoney(form.price)}`, undefined, 1800);
  }
};

const setQtyByRatio = (ratio: number) => {
  if (isBuy.value) {
    if (!form.price || form.price <= 0) {
      notifyError('价格未填写', '无法按比例估算可买数量。');
      return;
    }
    const budget = Number(store.dashboard.available || 0) * ratio;
    form.qty = alignedQty(budget / (form.price * 1.00025));
    return;
  }
  form.qty = alignedQty(maxSellQty.value * ratio);
};

const setQtyLots = (lots: number) => {
  const safeLots = Math.max(1, Math.floor(Number(lots || 1)));
  form.qty = safeLots * 100;
};

const fetchMarketEtfs = async (manual = false) => {
  etfLoading.value = true;
  try {
    const res: any = await api.getMarketEtfs(true);
    const list = Array.isArray(res?.items) ? res.items : [];
    marketEtfs.value = list.map((x: any) => ({
      symbol: String(x?.symbol || ''),
      name: String(x?.name || ''),
      price: Number(x?.price || 0),
      change_pct: Number(x?.change_pct || 0)
    }));
    if (manual) notifyInfo('ETF行情已刷新', `已加载 ${marketEtfs.value.length} 个ETF`, undefined, 1800);
  } catch {
    if (manual) notifyError('ETF行情刷新失败', '请稍后重试。');
  } finally {
    etfLoading.value = false;
  }
};

const validateForm = () => {
  if (!/^\d{6}$/.test(form.symbol)) {
    notifyError('代码格式不正确', '证券代码必须是 6 位数字。');
    return false;
  }
  if (!form.price || Number(form.price) <= 0) {
    notifyError('委托价格无效', '委托价格必须大于 0。');
    return false;
  }
  if (!Number.isInteger(form.qty) || form.qty <= 0 || form.qty % 100 !== 0) {
    notifyError('委托数量不合规', '数量需为 100 股整数倍且大于 0。');
    return false;
  }
  if (priceGuard.ready && priceGuard.enabled && priceGuard.applicable && !priceInCage.value) {
    if (priceGuard.mode === 'QUEUE') {
      notifyWarning(
        '超出价格笼子，订单将暂存',
        `当前${isBuy.value ? '买入上限' : '卖出下限'}为 ¥${formatMoney(isBuy.value ? priceGuard.buyUp : priceGuard.sellDown)}。`
      );
    } else {
      notifyError(
        '超出价格笼子区间',
        `当前${isBuy.value ? '买入上限' : '卖出下限'}为 ¥${formatMoney(isBuy.value ? priceGuard.buyUp : priceGuard.sellDown)}。`
      );
      return false;
    }
  }
  if (!isBuy.value && form.qty > maxSellQty.value) {
    notifyError('超出可卖数量', '卖出数量超过当前可卖持仓。');
    return false;
  }
  return true;
};

const submit = async () => {
  if (!validateForm()) return;

  submitting.value = true;
  try {
    const result: any = await api.trade({
      symbol: form.symbol,
      side: side.value,
      price: Number(form.price),
      qty: Number(form.qty),
      strategy_tag: String(form.strategy_tag || '').toUpperCase(),
      remark: String(form.remark || '').trim()
    });

    notifySuccess(
      isBuy.value ? '买入挂单提交成功' : '卖出挂单提交成功',
      String(result?.message || (isTradingSession() ? '订单已进入撮合流程。' : '已进入挂单队列。'))
    );

    form.qty = 300;
    await store.fetchAdminData();
  } finally {
    submitting.value = false;
  }
};

const onCancel = async (id: number) => {
  if (!window.confirm('确认撤销该委托？')) return;
  await api.cancel(id);
  notifySuccess('撤单成功', `订单 #${id} 已提交撤销。`);
  await store.fetchAdminData();
};

const manualMatch = async () => {
  if (manualMatching.value) return;
  if (!window.confirm('确认立即执行一次撮合？将忽略交易时段限制。')) return;

  const reason = window.prompt('可填写触发原因（可选）')?.trim() || '';

  manualMatching.value = true;
  try {
    const result: any = await api.match({ reason });
    if (result?.skipped) {
      const skipReason = String(result?.reason || '').trim();
      notifyInfo('撮合已跳过', skipReason || '本次撮合被规则跳过。');
    } else {
      const checked = Number(result?.checked ?? 0);
      const triggered = Number(result?.triggered ?? 0);
      notifySuccess('已触发撮合', `已检查 ${checked} 笔挂单，触发 ${triggered} 笔成交。`);
    }
    await store.fetchAdminData();
  } finally {
    manualMatching.value = false;
  }
};

watch(
  () => String(route.query.side || '').toUpperCase(),
  (v) => {
    side.value = v === 'SELL' ? 'SELL' : 'BUY';
  },
  { immediate: true }
);

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
      priceGuard.ready = false;
    }
  }
);

watch(
  () => store.currentTradeSymbol,
  (symbol) => {
    if (!symbol) return;
    form.symbol = String(symbol).replace(/^(sh|sz|bj)/i, '');
    store.currentTradeSymbol = '';
  },
  { immediate: true }
);

watch(
  () => autoPrice.value,
  (enabled) => {
    if (enabled) {
      applySmartPrice(isBuy.value ? 'buy' : 'sell', true);
    }
  }
);

watch(
  () => side.value,
  () => {
    if (autoPrice.value) {
      applySmartPrice(isBuy.value ? 'buy' : 'sell', true);
    }
  }
);

onMounted(() => {
  fetchMarketEtfs(false);
});
</script>

<style scoped>
.trade-page {
  display: grid;
  gap: 12px;
}

.panel {
  border: 1px solid var(--line);
  border-radius: var(--radius-lg);
  background: var(--surface);
  padding: 14px;
  box-shadow: var(--shadow-soft);
}

.panel-form {
  display: grid;
  gap: 12px;
}

.panel-order {
  display: grid;
  gap: 12px;
}

.order-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  border: 1px solid var(--line);
  border-radius: var(--radius-sm);
  background: var(--surface-soft);
  padding: 10px 12px;
}

.order-title {
  display: block;
  font-size: 12px;
  font-weight: 700;
  color: var(--text);
}

.order-tip {
  display: block;
  margin-top: 2px;
  font-size: 11px;
  color: var(--text-muted);
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

.side-switch {
  margin-top: 8px;
  display: inline-flex;
  border: 1px solid var(--line);
  border-radius: var(--radius-sm);
  overflow: hidden;
}

.side-btn {
  border: 0;
  background: #fff;
  color: var(--text-soft);
  padding: 4px 10px;
  font-size: 12px;
  font-weight: 700;
}

.side-btn.active.buy {
  background: #fee4e2;
  color: #b42318;
}

.side-btn.active.sell {
  background: #dafbe9;
  color: #067647;
}

.status-badge {
  border-radius: var(--radius-sm);
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
  color: #475467;
  background: #f8fafc;
  border-color: #d0d5dd;
}

.metric-row {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}

.metric-box {
  border: 1px solid var(--line);
  border-radius: var(--radius-sm);
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
  border-radius: var(--radius-sm);
  padding: 10px 11px;
  font-size: 14px;
  background: #fff;
  outline: none;
}

.field-input:focus {
  border-color: var(--brand);
  box-shadow: 0 0 0 2px rgba(16, 163, 127, 0.12);
}

.field-textarea {
  resize: vertical;
  min-height: 80px;
}

.field-btn {
  border: 1px solid var(--line-strong);
  border-radius: var(--radius-sm);
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
  border-radius: var(--radius-md);
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

.etf-card {
  border: 1px solid var(--line);
  border-radius: var(--radius-md);
  background: #f8fafc;
  padding: 10px 12px;
  display: grid;
  gap: 8px;
}

.etf-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.etf-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
  gap: 8px;
}

.etf-item {
  border: 1px solid var(--line);
  border-radius: var(--radius-sm);
  background: #fff;
  padding: 8px;
  display: grid;
  gap: 6px;
}

.etf-top {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.etf-top strong {
  font-size: 12px;
  color: var(--text);
}

.etf-top span {
  font-size: 11px;
  color: var(--text-muted);
}

.etf-bottom {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  font-size: 12px;
}

.guard-card {
  border: 1px solid #bbf7d0;
  border-radius: var(--radius-md);
  background: #f0fdf4;
  padding: 10px 12px;
  display: grid;
  gap: 8px;
}

.guard-head {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  align-items: flex-start;
}

.guard-title {
  display: block;
  font-size: 12px;
  font-weight: 800;
  color: #166534;
}

.guard-sub {
  margin: 4px 0 0;
  font-size: 11px;
  color: #166534;
}

.guard-status {
  border-radius: var(--radius-sm);
  border: 1px solid transparent;
  padding: 3px 8px;
  font-size: 11px;
  font-weight: 700;
  white-space: nowrap;
}

.guard-status.ok {
  color: #166534;
  border-color: #86efac;
  background: #dcfce7;
}

.guard-status.idle {
  color: #475467;
  border-color: #d0d5dd;
  background: #f8fafc;
}

.guard-status.warn {
  color: #9a3412;
  border-color: #fdba74;
  background: #ffedd5;
}

.guard-range {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 12px;
  font-size: 11px;
  color: #166534;
}

.guard-actions {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
}

.ratio-row {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 8px;
}

.ratio-btn {
  border: 1px solid var(--line-strong);
  border-radius: var(--radius-sm);
  background: #fff;
  color: var(--text-soft);
  padding: 8px 0;
  font-size: 12px;
  font-weight: 700;
}

.ratio-btn:hover {
  border-color: #b8c7da;
  background: #f8fafc;
}

.submit-btn {
  width: 100%;
  border: 0;
  border-radius: var(--radius-sm);
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

@media (max-width: 700px) {
  .guard-actions {
    grid-template-columns: 1fr;
  }
}
</style>
