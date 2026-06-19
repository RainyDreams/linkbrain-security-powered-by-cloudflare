<template>
  <div class="holdings-page">
    <!-- Portfolio summary -->
    <section class="surface summary-card">
      <div class="summary-grid">
        <div class="summary-item">
          <span class="s-label">总资产</span>
          <span class="s-value mono num-strong">¥{{ formatMoney(store.dashboard.total) }}</span>
        </div>
        <div class="summary-item">
          <span class="s-label">证券市值</span>
          <span class="s-value mono num-strong">¥{{ formatMoney(store.dashboard.market_cap) }}</span>
        </div>
        <div class="summary-item">
          <span class="s-label">可用资金</span>
          <span class="s-value mono num-strong">¥{{ formatMoney(store.dashboard.available) }}</span>
        </div>
        <div class="summary-item">
          <span class="s-label">冻结资金</span>
          <span class="s-value mono text-muted">¥{{ formatMoney(store.dashboard.frozen) }}</span>
        </div>
      </div>
      <div class="summary-actions">
        <button class="btn btn-primary" @click="openTransfer('IN')">
          <svg viewBox="0 0 16 16" width="12" height="12" fill="none">
            <path d="M8 3v10M3 8h10" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
          </svg>
          <span>银证转入</span>
        </button>
        <button class="btn btn-secondary" @click="openTransfer('OUT')">银证转出</button>
        <button class="btn btn-ghost" @click="refresh">刷新</button>
      </div>
    </section>

    <!-- Holdings table -->
    <section class="surface table-card">
      <header class="table-head">
        <div>
          <h3 class="t-title">持仓明细</h3>
          <p class="t-sub">{{ rows.length }} 只 · 按当前价估算</p>
        </div>
      </header>

      <div v-if="rows.length === 0" class="empty">
        <span class="empty-title">暂无持仓</span>
        <span class="text-faint">成交后会自动出现在这里</span>
      </div>

      <div v-else class="tbl-wrap scroll-thin">
        <table class="tbl tbl-condensed">
          <thead>
            <tr>
              <th>证券</th>
              <th class="is-num">数量 (总/可卖)</th>
              <th class="is-num">现价</th>
              <th class="is-num">浮盈亏</th>
              <th class="is-num">仓位</th>
              <th class="is-num">操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="h in rows" :key="h.symbol">
              <td>
                <div class="cell-name">{{ h.name || '--' }}</div>
                <div class="cell-code mono">{{ h.symbol }}</div>
              </td>
              <td class="is-num">
                <span class="mono num-strong">{{ formatQty(h.quantity) }}</span>
                <span class="text-faint mono"> / {{ formatQty(h.available_qty) }}</span>
              </td>
              <td class="is-num mono">¥{{ formatMoney(h.current_price) }}</td>
              <td class="is-num mono num-strong" :class="Number(h.pnl) >= 0 ? 'num-up' : 'num-down'">
                {{ Number(h.pnl) >= 0 ? '+' : '' }}¥{{ formatMoney(h.pnl) }}
              </td>
              <td class="is-num mono">{{ h.position }}%</td>
              <td class="is-num">
                <div class="row-actions">
                  <button class="btn btn-secondary btn-sm" @click="goTrade(h.symbol, 'buy')">买</button>
                  <button class="btn btn-secondary btn-sm" @click="goTrade(h.symbol, 'sell')">卖</button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <!-- Transfer modal -->
    <Teleport to="body">
      <div v-if="showTransfer" class="modal-mask" @click.self="closeTransfer">
        <div class="modal-shell" style="max-width: 420px;">
          <header class="modal-header">
            <h3 class="modal-title">{{ transferType === 'IN' ? '银证转入' : '银证转出' }}</h3>
            <button class="btn btn-ghost btn-icon" @click="closeTransfer">×</button>
          </header>
          <div class="modal-body">
            <div class="field">
              <label class="field-label">金额 (元)</label>
              <input
                v-model="transferAmount"
                type="number"
                step="0.01"
                min="0"
                class="input input-lg input-mono"
                placeholder="0.00"
              />
              <p class="field-hint">单笔上限 ¥5,000,000 · 当日累计上限 ¥10,000,000</p>
            </div>
            <div class="surface-soft meta-block">
              <div>
                <span class="text-muted">流水号</span>
                <span class="mono text-strong">{{ previewRequestId }}</span>
              </div>
              <div>
                <span class="text-muted">当前可用</span>
                <span class="mono text-strong">¥{{ formatMoney(store.dashboard.available) }}</span>
              </div>
            </div>
          </div>
          <footer class="modal-footer">
            <button class="btn btn-secondary" @click="closeTransfer">取消</button>
            <button class="btn btn-primary" :disabled="transfering" @click="submitTransfer">
              <span v-if="transfering" class="spinner"></span>
              <span>{{ transfering ? '提交中...' : '确认' }}</span>
            </button>
          </footer>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import api from '../../api';
import { useMarketStore } from '../../stores/market';
import { formatMoney, formatQty } from '../../utils/format';
import { notifyError, notifySuccess } from '../../utils/notify';

const store = useMarketStore();
const router = useRouter();

const rows = computed(() => {
  const total = Number(store.dashboard.total || 0);
  return store.holdings.map((h: any) => {
    const qty = Number(h.quantity || 0);
    const mv = Number(h.current_price || 0) * qty;
    const cost = Number(h.total_cost || 0);
    const pnl = mv - cost;
    return {
      ...h,
      marketValue: mv,
      pnl,
      position: total > 0 ? ((mv / total) * 100).toFixed(2) : '0.00'
    };
  });
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

const closeTransfer = () => { showTransfer.value = false; };

const submitTransfer = async () => {
  const amount = Number(transferAmount.value);
  if (!Number.isFinite(amount) || amount <= 0) {
    notifyError('金额输入无效', '转账金额必须大于 0。');
    return;
  }
  transfering.value = true;
  try {
    await api.transfer({ amount, type: transferType.value, request_id: previewRequestId.value });
    notifySuccess(transferType.value === 'IN' ? '银证转入提交成功' : '银证转出提交成功', `流水号：${previewRequestId.value}`);
    closeTransfer();
    await store.fetchAdminData();
  } finally {
    transfering.value = false;
  }
};

const goTrade = (symbol: string, side: 'buy' | 'sell') => {
  store.currentTradeSymbol = symbol;
  router.push({ path: '/admin/trade', query: { side: side === 'buy' ? 'BUY' : 'SELL' } });
};

const refresh = async () => { await store.fetchAdminData(true); };

const toggleBodyScroll = (locked: boolean) => {
  if (typeof document === 'undefined') return;
  document.body.style.overflow = locked ? 'hidden' : '';
};

watch(showTransfer, (v) => toggleBodyScroll(v));
onUnmounted(() => toggleBodyScroll(false));
</script>

<style scoped>
.holdings-page { display: flex; flex-direction: column; gap: 14px; max-width: 1440px; }

.summary-card { padding: 16px; display: flex; flex-direction: column; gap: 14px; }
.summary-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px 24px; }
.summary-item { display: flex; flex-direction: column; gap: 2px; padding: 6px 0; }
.s-label { font-size: 11px; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.06em; font-weight: 600; }
.s-value { font-size: 18px; font-weight: 700; color: var(--text-strong); }
.summary-actions { display: flex; gap: 8px; flex-wrap: wrap; padding-top: 8px; border-top: 1px solid var(--line-soft); }

@media (min-width: 980px) {
  .summary-grid { grid-template-columns: repeat(4, minmax(0, 1fr)); }
}

.table-card { padding: 0; }
.table-head { padding: 14px 18px; border-bottom: 1px solid var(--line); }
.t-title { font-size: 14px; font-weight: 700; color: var(--text-strong); }
.t-sub { font-size: 12px; color: var(--text-muted); margin-top: 2px; }
.tbl-wrap { overflow: auto; max-height: 60vh; }

.cell-name { font-size: 13px; font-weight: 600; color: var(--text-strong); }
.cell-code { font-size: 11px; color: var(--text-muted); margin-top: 1px; }

.row-actions { display: inline-flex; gap: 4px; }
.meta-block {
  display: grid; grid-template-columns: 1fr 1fr; gap: 8px 12px; padding: 8px 10px;
  font-size: 12px; color: var(--text-soft);
}
.meta-block .mono { color: var(--text); font-weight: 600; }
</style>
