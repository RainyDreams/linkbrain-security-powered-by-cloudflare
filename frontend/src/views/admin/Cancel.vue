<template>
  <div class="orders-page">
    <section class="surface head-card">
      <div class="head-grid">
        <div class="metric">
          <span class="m-label">挂单中</span>
          <span class="m-value mono num-strong">{{ pendingCount }}</span>
        </div>
        <div class="metric">
          <span class="m-label">撮合中</span>
          <span class="m-value mono num-strong">{{ matchingCount }}</span>
        </div>
        <div class="metric">
          <span class="m-label">今日成交</span>
          <span class="m-value mono num-strong">{{ filledCount }}</span>
        </div>
        <div class="metric">
          <span class="m-label">已撤 / 异常</span>
          <span class="m-value mono text-muted">{{ cancelledCount }} / {{ errorCount }}</span>
        </div>
      </div>
      <div class="head-actions">
        <button class="btn btn-secondary" @click="refresh" :disabled="loading">
          <svg viewBox="0 0 16 16" width="12" height="12" fill="none">
            <path d="M2 8a6 6 0 0 1 10.5-4M14 8A6 6 0 0 1 3.5 12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
            <path d="M12 1v3h-3M4 15v-3h3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
          <span>{{ loading ? '刷新中...' : '刷新' }}</span>
        </button>
        <button class="btn btn-danger" :disabled="bulkCancelling || pendingCount === 0" @click="cancelAllPending">
          {{ bulkCancelling ? '处理中...' : '批量撤单' }}
        </button>
      </div>
    </section>

    <section class="surface table-card">
      <header class="table-head">
        <div class="filters">
          <button v-for="f in filters" :key="f.value"
            :class="['filter-btn', { 'is-active': status === f.value }]"
            @click="setStatus(f.value)">
            {{ f.label }}
            <span class="filter-count">{{ countsByStatus[f.value] || 0 }}</span>
          </button>
        </div>
      </header>

      <div v-if="visibleOrders.length === 0" class="empty">
        <span class="empty-title">暂无{{ statusLabel }}委托</span>
        <span class="text-faint">提交新委托后会出现在这里</span>
      </div>

      <div v-else class="tbl-wrap scroll-thin">
        <table class="tbl tbl-condensed">
          <thead>
            <tr>
              <th class="is-num">#</th>
              <th>时间</th>
              <th>证券</th>
              <th>方向</th>
              <th class="is-num">价格</th>
              <th class="is-num">数量 / 成交</th>
              <th>状态</th>
              <th>策略 / 备注</th>
              <th class="is-num">操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="o in visibleOrders" :key="o.id">
              <td class="is-num mono text-muted">#{{ o.id }}</td>
              <td class="mono text-faint" style="font-size:11px;">{{ (o.time || (o.created_at || '')).slice(0, 19) }}</td>
              <td>
                <div class="cell-name">{{ o.name || '--' }}</div>
                <div class="cell-code mono">{{ o.symbol }}</div>
              </td>
              <td>
                <span :class="['side-pill', o.side === 'BUY' ? 'side-buy' : 'side-sell']">
                  {{ o.side === 'BUY' ? 'B' : 'S' }}
                </span>
              </td>
              <td class="is-num mono">¥{{ formatMoney(o.price) }}</td>
              <td class="is-num mono">
                {{ formatQty(o.qty) }}
                <span v-if="o.filled_qty > 0" class="text-faint"> / {{ formatQty(o.filled_qty) }}</span>
              </td>
              <td>
                <span :class="['tag', statusTagClass(o.status)]">{{ statusLabel(o.status) }}</span>
              </td>
              <td>
                <div class="cell-tag" v-if="o.strategy_tag">{{ o.strategy_tag }}</div>
                <div class="cell-remark text-muted" v-if="o.remark">{{ o.remark }}</div>
              </td>
              <td class="is-num">
                <button v-if="o.status === 'PENDING'" class="btn btn-ghost btn-sm" @click="onCancel(o.id)">撤</button>
                <span v-else class="text-faint">--</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import api from '../../api';
import { useMarketStore } from '../../stores/market';
import { formatMoney, formatQty } from '../../utils/format';
import { notifySuccess, notifyWarning } from '../../utils/notify';

const store = useMarketStore();
const loading = ref(false);
const bulkCancelling = ref(false);
const status = ref<'ALL' | 'PENDING' | 'MATCHING' | 'FILLED' | 'CANCELLED'>('ALL');

const filters = [
  { value: 'ALL', label: '全部' },
  { value: 'PENDING', label: '挂单' },
  { value: 'MATCHING', label: '撮合' },
  { value: 'FILLED', label: '成交' },
  { value: 'CANCELLED', label: '已撤' }
] as const;

const statusLabelMap: Record<string, string> = {
  PENDING: '挂单中',
  MATCHING: '撮合中',
  FILLED: '已成交',
  PARTIAL: '部分成交',
  CANCELLED: '已撤单',
  EXPIRED: '已过期',
  ERROR: '异常'
};
const statusTagMap: Record<string, string> = {
  PENDING: 'tag-neutral',
  MATCHING: 'tag-info',
  FILLED: 'tag-up',
  PARTIAL: 'tag-warn',
  CANCELLED: 'tag-down',
  EXPIRED: 'tag-neutral',
  ERROR: 'bg-down'
};
const statusLabel = (s: string) => statusLabelMap[s] || s;
const statusTagClass = (s: string) => statusTagMap[s] || 'tag-neutral';

const pendingCount = computed(() => store.orders.filter((o: any) => o.status === 'PENDING').length);
const matchingCount = computed(() => store.orders.filter((o: any) => o.status === 'MATCHING').length);
const filledCount = computed(() => store.orders.filter((o: any) => o.status === 'FILLED' || o.status === 'PARTIAL').length);
const cancelledCount = computed(() => store.orders.filter((o: any) => o.status === 'CANCELLED' || o.status === 'EXPIRED').length);
const errorCount = computed(() => store.orders.filter((o: any) => o.status === 'ERROR').length);

const countsByStatus = computed(() => {
  const map: Record<string, number> = { ALL: store.orders.length };
  for (const o of store.orders) map[o.status] = (map[o.status] || 0) + 1;
  return map;
});

const visibleOrders = computed(() => {
  if (status.value === 'ALL') return store.orders;
  return store.orders.filter((o: any) => o.status === status.value);
});

const statusLabel_text = computed(() => filters.find((f) => f.value === status.value)?.label || '');
// keep reactivity alive (statusLabel used in template)
void statusLabel_text;

const setStatus = (s: typeof status.value) => { status.value = s; };

const refresh = async () => {
  loading.value = true;
  try { await store.fetchAdminData(true); }
  finally { loading.value = false; }
};

const onCancel = async (id: number) => {
  if (!window.confirm('确认撤销该委托？')) return;
  await api.cancel(id);
  notifySuccess('撤单成功', `订单 #${id} 已撤销。`);
  await store.fetchAdminData();
};

const cancelAllPending = async () => {
  const pendings = store.orders.filter((o: any) => o.status === 'PENDING');
  if (pendings.length === 0) {
    notifyWarning('当前无可撤订单');
    return;
  }
  if (!window.confirm(`确认撤销 ${pendings.length} 笔挂单？`)) return;
  bulkCancelling.value = true;
  try {
    for (const o of pendings) {
      try { await api.cancel(o.id); } catch { /* ignore */ }
    }
    notifySuccess('批量撤单完成', `共处理 ${pendings.length} 笔订单。`);
  } finally {
    bulkCancelling.value = false;
    await store.fetchAdminData();
  }
};

onMounted(refresh);
</script>

<style scoped>
.orders-page { display: flex; flex-direction: column; gap: 14px; max-width: 1440px; }

.head-card { padding: 16px; display: flex; flex-direction: column; gap: 14px; }
.head-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px 24px; }
.metric { display: flex; flex-direction: column; gap: 2px; }
.m-label { font-size: 11px; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.06em; font-weight: 600; }
.m-value { font-size: 18px; font-weight: 700; color: var(--text-strong); }
.head-actions { display: flex; gap: 8px; flex-wrap: wrap; padding-top: 8px; border-top: 1px solid var(--line-soft); }
@media (min-width: 980px) { .head-grid { grid-template-columns: repeat(4, minmax(0, 1fr)); } }

.table-card { padding: 0; }
.table-head { padding: 10px 14px; border-bottom: 1px solid var(--line); }
.filters { display: flex; gap: 4px; flex-wrap: wrap; }
.filter-btn {
  display: inline-flex; align-items: center; gap: 6px;
  height: 28px; padding: 0 10px; border: 1px solid var(--line);
  border-radius: var(--r-sm); background: var(--bg-elev);
  font-size: 12px; font-weight: 600; color: var(--text-soft);
  cursor: pointer;
}
.filter-btn:hover { background: var(--bg-subtle); color: var(--text); }
.filter-btn.is-active { background: var(--text); color: #fff; border-color: var(--text); }
.filter-count {
  font-size: 10.5px; font-weight: 700; padding: 0 5px;
  border-radius: 999px; background: var(--bg-inset); color: var(--text-muted);
}
.filter-btn.is-active .filter-count { background: rgba(255,255,255,0.18); color: #fff; }

.tbl-wrap { overflow: auto; max-height: 70vh; }

.cell-name { font-size: 13px; font-weight: 600; color: var(--text-strong); }
.cell-code { font-size: 11px; color: var(--text-muted); }
.cell-tag { font-size: 10.5px; color: var(--text-soft); font-weight: 600; }
.cell-remark { font-size: 11.5px; color: var(--text-muted); max-width: 240px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

.side-pill { display: inline-flex; align-items: center; justify-content: center; width: 22px; height: 22px; border-radius: 4px; font-size: 11px; font-weight: 800; }
.side-pill.side-buy { background: var(--up-soft); color: var(--up); }
.side-pill.side-sell { background: var(--down-soft); color: var(--down); }
</style>
