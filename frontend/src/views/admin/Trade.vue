<template>
  <div class="trade-page">
    <!-- Top: live quote + price cage -->
    <section class="surface quote-card">
      <header class="quote-head">
        <div class="quote-title">
          <div>
            <p class="quote-kicker">实时行情</p>
            <h2 class="quote-name">
              <span v-if="quote.name">{{ quote.name }}</span>
              <span v-else class="text-faint">输入证券代码获取行情</span>
              <span v-if="quote.name" class="mono text-muted quote-code">{{ normalizedSymbol }}</span>
            </h2>
          </div>
          <div class="quote-actions">
            <button class="btn btn-secondary btn-sm" :disabled="quote.loading" @click="refreshQuote(true)">
              <svg viewBox="0 0 16 16" width="12" height="12" fill="none">
                <path d="M2 8a6 6 0 0 1 10.5-4M14 8A6 6 0 0 1 3.5 12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
                <path d="M12 1v3h-3M4 15v-3h3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
              <span>刷新</span>
            </button>
            <button class="btn btn-secondary btn-sm" :disabled="etfLoading" @click="fetchMarketEtfs(true)">
              <span>刷新 ETF</span>
            </button>
            <label class="auto-follow">
              <input type="checkbox" v-model="autoPrice" />
              <span>跟价</span>
            </label>
          </div>
        </div>

        <div class="quote-main" v-if="quote.price > 0">
          <div class="price-block">
            <span class="price-label">最新价</span>
            <span class="price-value mono num-strong" :class="Number(quote.change_pct) >= 0 ? 'num-up' : 'num-down'">¥{{ formatMoney(quote.price) }}</span>
            <span class="price-change mono" :class="getColor(quote.change_pct)">{{ formatPct(quote.change_pct) }}</span>
            <span class="text-faint mono" v-if="quote.source">· {{ quote.source }}</span>
          </div>
          <div class="cage-block">
            <div class="cage-row">
              <span class="cage-label">板块</span>
              <span class="cage-value">{{ boardText }}</span>
            </div>
            <div class="cage-row">
              <span class="cage-label">参考价</span>
              <span class="cage-value mono">¥{{ formatMoney(priceGuard.referencePrice) }}</span>
            </div>
            <div class="cage-row">
              <span class="cage-label">涨跌停</span>
              <span class="cage-value mono">
                {{ formatMoney(priceGuard.limitDown) }} ~ {{ formatMoney(priceGuard.limitUp) }}
              </span>
            </div>
            <div class="cage-row cage-row-strong" :class="priceInCage ? 'ok' : 'warn'">
              <span class="cage-label">笼子</span>
              <span class="cage-value">
                <span class="tag" :class="priceGuard.mode === 'QUEUE' ? 'tag-warn' : 'tag-down'" v-if="priceGuard.ready && priceGuard.enabled">
                  {{ priceGuard.mode === 'QUEUE' ? '暂存模式' : '拒收模式' }}
                </span>
                <span class="tag tag-neutral" v-else-if="priceGuard.ready">未启用</span>
                <span class="tag tag-neutral" v-else>—</span>
                <span class="cage-edge mono" v-if="priceGuard.ready && priceGuard.enabled">
                  买 ≤ {{ formatMoney(priceGuard.buyUp) }} · 卖 ≥ {{ formatMoney(priceGuard.sellDown) }}
                </span>
              </span>
            </div>
          </div>
        </div>
        <div v-else class="quote-empty">
          <span>请输入 6 位证券代码（例：600519）</span>
        </div>

        <div v-if="priceGuard.ready && priceGuard.enabled && priceGuard.applicable" class="quick-price">
          <button class="btn btn-secondary btn-sm" @click="applySmartPrice('buy')">
            推荐买价 <span class="mono">¥{{ formatMoney(priceGuard.suggestBuy) }}</span>
          </button>
          <button class="btn btn-secondary btn-sm" @click="applySmartPrice('mid')">
            中位价 <span class="mono">¥{{ formatMoney(priceGuard.suggestMid) }}</span>
          </button>
          <button class="btn btn-secondary btn-sm" @click="applySmartPrice('sell')">
            推荐卖价 <span class="mono">¥{{ formatMoney(priceGuard.suggestSell) }}</span>
          </button>
        </div>
      </header>

      <!-- ETF sentiment -->
      <div v-if="marketEtfs.length > 0" class="etf-strip scroll-thin">
        <div v-for="item in marketEtfs" :key="item.symbol" class="etf-pill">
          <span class="etf-name">{{ item.name || item.symbol }}</span>
          <span class="etf-price mono" :class="Number(item.change_pct) >= 0 ? 'num-up' : 'num-down'">
            ¥{{ formatMoney(item.price) }}
            <em>{{ formatPct(item.change_pct) }}</em>
          </span>
        </div>
      </div>
    </section>

    <!-- Main 3-column -->
    <div class="trade-grid">
      <!-- Order ticket -->
      <section class="surface ticket-card">
        <header class="ticket-head">
          <div>
            <p class="ticket-kicker">{{ isBuy ? '买入委托' : '卖出委托' }}</p>
            <h3 class="ticket-title">
              <span class="side-badge" :class="isBuy ? 'side-buy' : 'side-sell'">{{ isBuy ? 'B' : 'S' }}</span>
              <span>{{ isBuy ? '限价买入' : '限价卖出' }}</span>
            </h3>
          </div>
          <div class="side-switch">
            <button :class="['side-btn', isBuy ? 'is-active' : '']" @click="switchSide('BUY')">买入</button>
            <button :class="['side-btn', !isBuy ? 'is-active' : '']" @click="switchSide('SELL')">卖出</button>
          </div>
        </header>

        <div class="ticket-body">
          <div class="field-grid">
            <div class="field">
              <label class="field-label">证券代码</label>
              <input
                v-model="form.symbol"
                class="input input-mono"
                maxlength="6"
                inputmode="numeric"
                placeholder="6 位数字"
              />
            </div>
            <div class="field">
              <label class="field-label">委托价格 (元)</label>
              <input
                v-model.number="form.price"
                class="input input-mono"
                type="number"
                step="0.01"
                placeholder="0.00"
              />
            </div>
            <div class="field">
              <label class="field-label">委托数量 (股)</label>
              <input
                v-model.number="form.qty"
                class="input input-mono"
                type="number"
                step="100"
                placeholder="100"
              />
            </div>
            <div class="field">
              <label class="field-label">策略标签</label>
              <select v-model="form.strategy_tag" class="select">
                <option value="LONG_STABLE">长期稳健</option>
                <option value="MID_BALANCED">中线均衡</option>
                <option value="SHORT_AGGRESSIVE">短期激进</option>
              </select>
            </div>
          </div>

          <div class="field">
            <label class="field-label">订单备注</label>
            <textarea
              v-model="form.remark"
              class="textarea"
              rows="3"
              maxlength="1200"
              placeholder="目的、底线、仓位节奏、复盘要点..."
            ></textarea>
          </div>

          <!-- Quick helpers -->
          <div class="quick-row">
            <div class="quick-group">
              <span class="quick-label">仓位</span>
              <button class="btn btn-secondary btn-sm" @click="setQtyByRatio(0.25)">25%</button>
              <button class="btn btn-secondary btn-sm" @click="setQtyByRatio(0.5)">50%</button>
              <button class="btn btn-secondary btn-sm" @click="setQtyByRatio(0.75)">75%</button>
              <button class="btn btn-secondary btn-sm" @click="setQtyByRatio(1)">100%</button>
            </div>
            <div class="quick-group">
              <span class="quick-label">手数</span>
              <button class="btn btn-secondary btn-sm" @click="setQtyLots(2)">2</button>
              <button class="btn btn-secondary btn-sm" @click="setQtyLots(5)">5</button>
              <button class="btn btn-secondary btn-sm" @click="setQtyLots(10)">10</button>
              <button class="btn btn-secondary btn-sm" @click="setQtyLots(20)">20</button>
            </div>
          </div>

          <div class="ticket-summary">
            <div class="sum-row">
              <span>预估手续费</span>
              <span class="mono">¥{{ formatMoney(estimatedFee) }}</span>
            </div>
            <div class="sum-row">
              <span>可{{ isBuy ? '用资金' : '卖数量' }}</span>
              <span class="mono">¥{{ isBuy ? formatMoney(store.dashboard.available) : formatQty(maxSellQty) + ' 股' }}</span>
            </div>
            <div v-if="!isBuy && matchedHolding" class="sum-row">
              <span>当前持仓</span>
              <span class="mono">{{ formatQty(matchedHolding.quantity) }} 股</span>
            </div>
          </div>

          <button
            class="btn btn-lg btn-block"
            :class="isBuy ? 'btn-primary' : 'btn-danger'"
            :disabled="submitting"
            @click="submit"
          >
            <span v-if="submitting" class="spinner"></span>
            <span>{{ submitting ? '提交中...' : (isBuy ? '提交买入挂单' : '提交卖出挂单') }}</span>
          </button>
        </div>
      </section>

      <!-- Order book / Pending -->
      <section class="surface orderbook-card">
        <header class="ticket-head">
          <div>
            <p class="ticket-kicker">挂单队列</p>
            <h3 class="ticket-title">待成交委托</h3>
          </div>
          <button class="btn btn-ghost btn-sm" :disabled="!store.pendingOrders.length" @click="cancelAll">
            一键撤单
          </button>
        </header>
        <div v-if="store.pendingOrders.length === 0" class="empty">
          <span class="empty-title">暂无挂单</span>
          <span class="text-faint">提交委托后会出现在这里</span>
        </div>
        <div v-else class="orderbook-list scroll-thin">
          <article v-for="o in store.pendingOrders.slice(0, 12)" :key="o.id" class="ob-row">
            <div class="ob-side" :class="o.side === 'BUY' ? 'side-buy' : 'side-sell'">
              {{ o.side === 'BUY' ? 'B' : 'S' }}
            </div>
            <div class="ob-main">
              <div class="ob-top">
                <span class="ob-symbol">{{ o.name || o.symbol }}</span>
                <span class="ob-meta mono">{{ formatQty(o.qty) }} × ¥{{ formatMoney(o.price) }}</span>
              </div>
              <div class="ob-bot">
                <span class="mono text-faint">#{{ o.id }} · {{ o.time || '--' }}</span>
                <button class="btn btn-ghost btn-sm" @click="onCancel(o.id)">撤</button>
              </div>
            </div>
          </article>
        </div>
      </section>

      <!-- Manual match + Recent fills -->
      <section class="surface fills-card">
        <header class="ticket-head">
          <div>
            <p class="ticket-kicker">撮合控制</p>
            <h3 class="ticket-title">撮合与成交</h3>
          </div>
          <button class="btn btn-secondary btn-sm" :disabled="manualMatching" @click="manualMatch">
            <span v-if="manualMatching" class="spinner"></span>
            <span>{{ manualMatching ? '撮合中...' : '手动撮合' }}</span>
          </button>
        </header>
        <div class="recent-fills scroll-thin">
          <div v-if="recentTrades.length === 0" class="empty">
            <span class="empty-title">暂无成交</span>
            <span class="text-faint">撮合后成交将显示在此</span>
          </div>
          <article v-for="t in recentTrades" :key="t.id" class="fill-row">
            <div class="ob-side" :class="t.side === 'BUY' ? 'side-buy' : 'side-sell'">
              {{ t.side === 'BUY' ? 'B' : 'S' }}
            </div>
            <div class="ob-main">
              <div class="ob-top">
                <span class="ob-symbol">{{ t.name || t.symbol }}</span>
                <span class="ob-meta mono">¥{{ formatMoney(t.price) }} × {{ formatQty(t.qty) }}</span>
              </div>
              <div class="ob-bot">
                <span class="mono text-faint">{{ t.time || '--' }}</span>
                <span class="mono num-strong" :class="t.side === 'BUY' ? 'num-down' : 'num-up'">
                  {{ t.side === 'BUY' ? '-' : '+' }}{{ formatMoney((t.price || 0) * (t.qty || 0)) }}
                </span>
              </div>
            </div>
          </article>
        </div>
      </section>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import api from '../../api';
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
  board: 'OTHER',
  referencePrice: 0,
  limitUp: 0,
  limitDown: 0,
  buyUp: 0,
  sellDown: 0,
  suggestBuy: 0,
  suggestSell: 0,
  suggestMid: 0
});

const autoPrice = ref(true);
const submitting = ref(false);
const manualMatching = ref(false);
const quoteTimer = ref<number | null>(null);
const etfLoading = ref(false);
const marketEtfs = ref<Array<{ symbol: string; name: string; price: number; change_pct: number }>>([]);

const side = ref<'BUY' | 'SELL'>('BUY');
const isBuy = computed(() => side.value === 'BUY');

const recentTrades = computed(() => store.orders.filter((o: any) => o.status === 'FILLED' || o.status === 'PARTIAL').slice(0, 8));

const boardTextMap: Record<string, string> = {
  MAIN: '沪深主板',
  CHINEXT: '创业板',
  STAR: '科创板',
  BSE: '北交所',
  OTHER: '其他'
};
const boardText = computed(() => boardTextMap[priceGuard.board] || boardTextMap.OTHER);

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

const alignedQty = (val: number) => Math.max(0, Math.floor(Number(val || 0) / 100) * 100);

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
      priceGuard.board = board;
      priceGuard.referencePrice = Number(guard.reference_price || 0);
      priceGuard.limitUp = Number(guard.limit_up || 0);
      priceGuard.limitDown = Number(guard.limit_down || 0);
      priceGuard.buyUp = Number(guard.buy_up || guard.cage_up || 0);
      priceGuard.sellDown = Number(guard.sell_down || guard.cage_down || 0);
      priceGuard.suggestBuy = Number(guard.suggest_buy || 0);
      priceGuard.suggestSell = Number(guard.suggest_sell || 0);
      priceGuard.suggestMid = Number(guard.suggest_mid || 0);
    } else {
      priceGuard.ready = false;
      priceGuard.enabled = false;
    }

    if (autoPrice.value) applySmartPrice(isBuy.value ? 'buy' : 'sell', true);
  } catch {
    quote.error = '行情获取失败，请确认代码或稍后重试。';
  } finally {
    quote.loading = false;
  }
};

const applySmartPrice = (mode: 'buy' | 'sell' | 'mid', silent = false) => {
  let price = 0;
  if (mode === 'buy') price = priceGuard.suggestBuy;
  else if (mode === 'sell') price = priceGuard.suggestSell;
  else price = priceGuard.suggestMid;
  if (!price || price <= 0) price = quote.price;
  if (!price || price <= 0) return;
  form.price = Number(price.toFixed(2));
  if (!silent) notifyInfo('已填入参考价', `委托价已更新为 ¥${formatMoney(form.price)}`);
};

const setQtyByRatio = (ratio: number) => {
  if (isBuy.value) {
    if (!form.price || form.price <= 0) {
      notifyError('价格未填写', '无法按比例估算可买数量。');
      return;
    }
    const budget = Number(store.dashboard.available || 0) * ratio;
    form.qty = alignedQty(budget / (form.price * 1.00025));
  } else {
    form.qty = alignedQty(maxSellQty.value * ratio);
  }
};

const setQtyLots = (lots: number) => {
  form.qty = Math.max(1, Math.floor(Number(lots || 1))) * 100;
};

const fetchMarketEtfs = async (manual = false) => {
  etfLoading.value = true;
  try {
    const res: any = await api.getMarketEtfs(true);
    marketEtfs.value = (Array.isArray(res?.items) ? res.items : []).map((x: any) => ({
      symbol: String(x?.symbol || ''),
      name: String(x?.name || ''),
      price: Number(x?.price || 0),
      change_pct: Number(x?.change_pct || 0)
    }));
    if (manual) notifyInfo('ETF 行情已刷新', `已加载 ${marketEtfs.value.length} 个 ETF`);
  } catch {
    if (manual) notifyError('ETF 刷新失败');
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
      notifyWarning('超出价格笼子，订单将暂存', `当前${isBuy.value ? '买入上限' : '卖出下限'}为 ¥${formatMoney(isBuy.value ? priceGuard.buyUp : priceGuard.sellDown)}。`);
    } else {
      notifyError('超出价格笼子区间', `当前${isBuy.value ? '买入上限' : '卖出下限'}为 ¥${formatMoney(isBuy.value ? priceGuard.buyUp : priceGuard.sellDown)}。`);
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
    form.remark = '';
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

const cancelAll = async () => {
  if (!store.pendingOrders.length) return;
  if (!window.confirm(`确认一键撤销 ${store.pendingOrders.length} 笔挂单？`)) return;
  for (const o of store.pendingOrders.slice(0, 50)) {
    try { await api.cancel(o.id); } catch { /* ignore */ }
  }
  await store.fetchAdminData();
  notifySuccess('批量撤单完成');
};

const manualMatch = async () => {
  if (manualMatching.value) return;
  if (!window.confirm('确认立即执行一次撮合？将忽略交易时段限制。')) return;
  const reason = window.prompt('可填写触发原因（可选）')?.trim() || '';
  manualMatching.value = true;
  try {
    const result: any = await api.match({ reason });
    if (result?.skipped) {
      notifyInfo('撮合已跳过', String(result?.reason || '本次撮合被规则跳过。'));
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
  (v) => { side.value = v === 'SELL' ? 'SELL' : 'BUY'; },
  { immediate: true }
);

watch(
  () => form.symbol,
  (val) => {
    if (quoteTimer.value) { window.clearTimeout(quoteTimer.value); quoteTimer.value = null; }
    const code = String(val || '').trim().replace(/\D/g, '').slice(0, 6);
    if (code !== val) form.symbol = code;
    if (/^\d{6}$/.test(code)) {
      quoteTimer.value = window.setTimeout(() => refreshQuote(false), 280);
    } else {
      quote.name = ''; quote.price = 0; quote.change_pct = 0; quote.error = '';
      priceGuard.ready = false; priceGuard.enabled = false;
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

watch(() => side.value, () => {
  if (autoPrice.value) applySmartPrice(isBuy.value ? 'buy' : 'sell', true);
});

onMounted(() => {
  fetchMarketEtfs(false);
});
</script>

<style scoped>
.trade-page {
  display: flex;
  flex-direction: column;
  gap: 14px;
  max-width: 1440px;
}

/* Quote card */
.quote-card { padding: 14px 16px; display: flex; flex-direction: column; gap: 12px; }
.quote-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 10px; flex-wrap: wrap; }
.quote-title { display: flex; flex-direction: column; gap: 4px; }
.quote-kicker { font-size: 10.5px; font-weight: 700; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.12em; }
.quote-name { font-size: 18px; font-weight: 800; color: var(--text-strong); display: flex; align-items: baseline; gap: 10px; }
.quote-code { font-size: 12px; color: var(--text-muted); font-weight: 500; }
.quote-actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.auto-follow { display: inline-flex; align-items: center; gap: 4px; font-size: 12px; color: var(--text-soft); user-select: none; }
.quote-main { display: grid; grid-template-columns: 1fr 1.6fr; gap: 18px; }
.quote-empty { padding: 18px 8px; text-align: center; color: var(--text-faint); font-size: 12.5px; }

.price-block { display: flex; align-items: baseline; gap: 12px; flex-wrap: wrap; }
.price-label { font-size: 11px; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.06em; }
.price-value { font-size: 32px; line-height: 1; font-weight: 800; letter-spacing: -0.02em; }
.price-change { font-size: 14px; font-weight: 700; }

.cage-block { display: grid; grid-template-columns: 1fr 1fr; gap: 6px 18px; align-self: center; }
.cage-row { display: flex; justify-content: space-between; align-items: center; font-size: 12px; gap: 12px; }
.cage-row-strong { grid-column: 1 / -1; padding-top: 6px; border-top: 1px dashed var(--line-soft); }
.cage-label { color: var(--text-muted); }
.cage-value { color: var(--text); font-weight: 600; display: inline-flex; align-items: center; gap: 6px; }
.cage-edge { color: var(--text-muted); font-size: 11.5px; font-weight: 500; }

.quick-price { display: flex; gap: 8px; flex-wrap: wrap; padding-top: 8px; border-top: 1px solid var(--line-soft); }

.etf-strip {
  display: flex;
  gap: 8px;
  overflow-x: auto;
  padding-top: 8px;
  border-top: 1px solid var(--line-soft);
}
.etf-pill {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 6px 10px;
  border: 1px solid var(--line);
  border-radius: var(--r-sm);
  background: var(--bg-subtle);
  flex-shrink: 0;
  min-width: 140px;
}
.etf-name { font-size: 11px; color: var(--text-soft); }
.etf-price { font-size: 12.5px; font-weight: 700; display: inline-flex; gap: 6px; align-items: baseline; }
.etf-price em { font-style: normal; font-size: 10.5px; opacity: 0.85; }

/* 3-column */
.trade-grid {
  display: grid;
  grid-template-columns: minmax(0, 1.05fr) minmax(0, 0.95fr) minmax(0, 0.95fr);
  gap: 14px;
}
@media (max-width: 1180px) {
  .trade-grid { grid-template-columns: 1fr 1fr; }
  .fills-card { grid-column: 1 / -1; }
}
@media (max-width: 780px) {
  .trade-grid { grid-template-columns: 1fr; }
  .quote-main { grid-template-columns: 1fr; }
}

/* Ticket */
.ticket-card { padding: 14px 16px; display: flex; flex-direction: column; gap: 12px; }
.ticket-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 8px; }
.ticket-kicker { font-size: 10.5px; font-weight: 700; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.12em; }
.ticket-title { font-size: 16px; font-weight: 800; color: var(--text-strong); display: flex; align-items: center; gap: 8px; }
.side-badge { display: inline-flex; align-items: center; justify-content: center; width: 22px; height: 22px; border-radius: 4px; font-size: 11px; font-weight: 800; }
.side-badge.side-buy { background: var(--up-soft); color: var(--up); }
.side-badge.side-sell { background: var(--down-soft); color: var(--down); }

.side-switch { display: inline-flex; padding: 2px; background: var(--bg-inset); border-radius: var(--r-sm); gap: 2px; }
.side-btn {
  height: 26px;
  padding: 0 10px;
  border: 0;
  background: transparent;
  font-size: 12px;
  font-weight: 600;
  color: var(--text-soft);
  border-radius: var(--r-xs);
  cursor: pointer;
}
.side-btn.is-active.buy,
.side-btn.is-active { background: var(--text); color: #fff; }

.ticket-body { display: flex; flex-direction: column; gap: 12px; }
.field-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.quick-row { display: flex; flex-direction: column; gap: 6px; padding-top: 4px; border-top: 1px solid var(--line-soft); }
.quick-group { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.quick-label { font-size: 11px; color: var(--text-muted); font-weight: 600; min-width: 32px; }

.ticket-summary { display: flex; flex-direction: column; gap: 4px; padding: 10px 12px; background: var(--bg-subtle); border-radius: var(--r-sm); border: 1px solid var(--line-soft); }
.sum-row { display: flex; justify-content: space-between; align-items: center; font-size: 12px; color: var(--text-soft); }
.sum-row span:last-child { color: var(--text); font-weight: 600; }

/* Order book / Fills */
.orderbook-card, .fills-card { padding: 14px 16px; display: flex; flex-direction: column; gap: 10px; max-height: 520px; }
.orderbook-list, .recent-fills { display: flex; flex-direction: column; gap: 6px; overflow-y: auto; flex: 1; }
.ob-row, .fill-row {
  display: grid;
  grid-template-columns: 24px 1fr;
  gap: 8px;
  padding: 8px 10px;
  background: var(--bg-subtle);
  border: 1px solid var(--line-soft);
  border-radius: var(--r-sm);
}
.ob-side {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 4px;
  font-size: 11px;
  font-weight: 800;
  background: var(--bg-inset);
  color: var(--text-soft);
}
.ob-side.side-buy { background: var(--up-soft); color: var(--up); }
.ob-side.side-sell { background: var(--down-soft); color: var(--down); }

.ob-main { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.ob-top { display: flex; justify-content: space-between; gap: 8px; align-items: baseline; }
.ob-symbol { font-size: 12.5px; font-weight: 600; color: var(--text-strong); }
.ob-meta { font-size: 11.5px; color: var(--text-soft); }
.ob-bot { display: flex; justify-content: space-between; gap: 8px; align-items: center; font-size: 11px; }
</style>
