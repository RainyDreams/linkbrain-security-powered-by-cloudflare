<template>
  <div class="holdings-page">
    <section class="glass-card block-head">
      <div class="head-grid">
        <div class="metric-box">
          <span class="kv-label">总资产</span>
          <strong class="kv-value font-mono">¥{{ formatMoney(store.dashboard.total) }}</strong>
        </div>
        <div class="metric-box">
          <span class="kv-label">证券市值</span>
          <strong class="kv-value font-mono">¥{{ formatMoney(store.dashboard.market_cap) }}</strong>
        </div>
        <div class="metric-box">
          <span class="kv-label">可用资金</span>
          <strong class="kv-value font-mono">¥{{ formatMoney(store.dashboard.available) }}</strong>
        </div>
        <div class="metric-box">
          <span class="kv-label">冻结资金</span>
          <strong class="kv-value font-mono">¥{{ formatMoney(store.dashboard.frozen) }}</strong>
        </div>
      </div>

      <div class="action-row">
        <button class="btn-solid btn-primary" @click="openTransfer('IN')">银证转入</button>
        <button class="btn-solid btn-ghost" @click="openTransfer('OUT')">银证转出</button>
        <button class="btn-solid btn-ghost" @click="refresh">刷新</button>
      </div>
    </section>


    <section class="glass-card overflow-hidden">
      <div class="section-head">
        <h2 class="panel-title">持仓明细</h2>
        <span class="text-xs text-slate-500">{{ rows.length }} 只</span>
      </div>

      <div v-if="rows.length === 0" class="empty-line">暂无持仓</div>

      <div v-else>
        <div class="mobile-cards md:hidden">
          <article v-for="h in rows" :key="h.symbol" class="surface-soft item-card">
            <div class="item-top">
              <div>
                <div class="name">{{ h.name || '--' }}</div>
                <div class="code font-mono">{{ h.symbol }}</div>
              </div>
              <div class="text-right">
                <div class="font-mono text-sm">¥{{ formatMoney(h.current_price) }}</div>
                <div class="text-xs font-mono" :class="getColor(h.pnl)">¥{{ formatMoney(h.pnl) }}</div>
              </div>
            </div>
            <div class="item-meta">
              <span>数量(总/可卖) <strong class="font-mono">{{ formatQty(h.quantity) }} / {{ formatQty(h.available_qty) }}</strong></span>
              <span>仓位 <strong class="font-mono">{{ h.position }}%</strong></span>
            </div>
            <div class="item-actions">
              <button @click="goTrade(h.symbol, 'buy')">买入</button>
              <button @click="goTrade(h.symbol, 'sell')">卖出</button>
            </div>
          </article>
        </div>

        <div class="hidden md:block overflow-x-auto scrollbar-thin">
          <table class="min-w-full table-dense text-[12px]">
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
                  <button class="btn-mini" @click="goTrade(h.symbol, 'buy')">买入</button>
                  <button class="btn-mini" @click="goTrade(h.symbol, 'sell')">卖出</button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </section>
    <Teleport to="body">
      <div v-if="showTransfer" class="modal-wrap" @click.self="closeTransferModal">
        <div class="modal-card" role="dialog" aria-modal="true" tabindex="-1" @click.stop>
          <h3>{{ transferType === 'IN' ? '银证转入' : '银证转出' }}</h3>

          <label class="field-block">
            <span class="field-label">金额(元)</span>
            <input
              v-model="transferAmount"
              type="number"
              step="0.01"
              min="0"
              class="field-input"
              placeholder="0.00"
            />
          </label>

          <div class="surface-soft modal-meta">
            <div>request_id: <span class="font-mono">{{ previewRequestId }}</span></div>
          </div>

          <div class="modal-actions">
            <button class="btn-solid btn-ghost" @click="closeTransferModal">取消</button>
            <button class="btn-solid btn-primary" :disabled="transfering" @click="submitTransfer">
              {{ transfering ? '提交中...' : '确认提交' }}
            </button>
          </div>
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
import { formatMoney, formatQty, getColor } from '../../utils/format';
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

const closeTransferModal = () => {
  showTransfer.value = false;
};

const submitTransfer = async () => {
  const amount = Number(transferAmount.value);
  if (!Number.isFinite(amount) || amount <= 0) {
    notifyError('金额输入无效', '转账金额必须大于 0。');
    return;
  }

  transfering.value = true;
  try {
    await api.transfer({
      amount,
      type: transferType.value,
      request_id: previewRequestId.value
    });

    notifySuccess(transferType.value === 'IN' ? '银证转入提交成功' : '银证转出提交成功', `请求流水号：${previewRequestId.value}`);
    closeTransferModal();
    await store.fetchAdminData();
  } finally {
    transfering.value = false;
  }
};

const goTrade = (symbol: string, side: 'buy' | 'sell') => {
  store.currentTradeSymbol = symbol;
  router.push({ path: '/admin/trade', query: { side: side === 'buy' ? 'BUY' : 'SELL' } });
};

const refresh = async () => {
  await store.fetchAdminData(true);
};

const toggleBodyScroll = (locked: boolean) => {
  if (typeof document === 'undefined') return;
  document.body.style.overflow = locked ? 'hidden' : '';
};

watch(showTransfer, (visible) => {
  toggleBodyScroll(visible);
});

onUnmounted(() => {
  toggleBodyScroll(false);
});
</script>

<style scoped>
.holdings-page {
  display: grid;
  gap: 12px;
}

.block-head {
  padding: 12px;
}

.head-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}

.metric-box {
  border: 1px solid var(--line);
  border-radius: var(--radius-sm);
  background: var(--surface-soft);
  padding: 9px 10px;
}

.action-row {
  margin-top: 10px;
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.section-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  border-bottom: 1px solid var(--line);
  padding: 12px 14px;
}

.empty-line {
  padding: 36px 16px;
  text-align: center;
  color: var(--text-muted);
}

.mobile-cards {
  display: grid;
  gap: 8px;
  padding: 10px;
}

.item-card {
  padding: 10px;
}

.item-top {
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

.item-meta {
  margin-top: 8px;
  display: grid;
  gap: 3px;
  font-size: 12px;
  color: var(--text-soft);
}

.item-actions {
  margin-top: 10px;
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

.item-actions button,
.btn-mini {
  border: 1px solid var(--line-strong);
  border-radius: var(--radius-sm);
  background: #fff;
  color: var(--text-soft);
  padding: 5px 10px;
  font-size: 12px;
  font-weight: 700;
}

.btn-mini + .btn-mini {
  margin-left: 6px;
}

.modal-wrap {
  position: fixed;
  inset: 0;
  background: rgba(11, 18, 33, 0.46);
  backdrop-filter: blur(4px);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 14px;
  z-index: 2400;
}

.modal-card {
  width: min(440px, 96vw);
  max-height: min(88vh, 760px);
  overflow: auto;
  border-radius: var(--radius-lg);
  border: 1px solid var(--line);
  background: #fff;
  padding: 12px;
  display: grid;
  gap: 9px;
  box-shadow: var(--shadow-soft);
}

.modal-card h3 {
  margin: 0;
  font-size: 15px;
  font-weight: 800;
}

.field-block {
  display: grid;
  gap: 6px;
}

.field-label {
  font-size: 11px;
  color: var(--text-soft);
}

.field-input {
  width: 100%;
  border: 1px solid var(--line-strong);
  border-radius: var(--radius-sm);
  padding: 9px;
  font-size: 13px;
}

.modal-meta {
  padding: 8px 10px;
  font-size: 12px;
  color: var(--text-soft);
  display: grid;
  gap: 3px;
}

.modal-actions {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}

@media (max-width: 640px) {
  .modal-wrap {
    padding: 8px;
  }

  .modal-card {
    width: 100%;
    max-height: 92vh;
    padding: 10px;
    gap: 8px;
  }

  .modal-card h3 {
    font-size: 14px;
  }

  .field-input {
    font-size: 12px;
  }
}

@media (min-width: 920px) {
  .head-grid {
    grid-template-columns: repeat(4, minmax(0, 1fr));
  }

  .block-head {
    padding: 14px;
  }
}
</style>
