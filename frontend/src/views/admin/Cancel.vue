<template>
  <div class="cancel-page">
    <section class="glass-card head-box">
      <div class="head-row">
        <h2 class="panel-title">撤单中心</h2>
        <span class="status-chip">可撤 {{ pendingCount }}</span>
      </div>
      <p class="desc">仅状态为“挂单中 / 撮合中”的委托支持撤销。撤销成功后，冻结资金或可卖持仓将自动回补。</p>
      <div class="action-row">
        <button class="btn-solid btn-ghost" @click="refresh">刷新数据</button>
        <button class="btn-solid btn-primary" @click="cancelAllPending" :disabled="pendingCount === 0 || bulkCancelling">
          {{ bulkCancelling ? '处理中...' : '一键撤销挂单' }}
        </button>
      </div>
    </section>

    <InsightPanel title="撤单执行提示" :items="insightItems" />

    <OrderList :orders="store.orders" :can-cancel="true" @cancel="onCancel" />
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import api from '../../api';
import InsightPanel from '../../components/InsightPanel.vue';
import OrderList from '../../components/OrderList.vue';
import { useMarketStore } from '../../stores/market';
import { notifySuccess, notifyWarning } from '../../utils/notify';

const store = useMarketStore();
const bulkCancelling = ref(false);

const pendingOrders = computed(() => store.orders.filter((o: any) => o.status === 'PENDING' || o.status === 'MATCHING'));
const pendingCount = computed(() => pendingOrders.value.length);

const insightItems = computed(() => {
  return [
    {
      title: '撤单窗口',
      text: '订单一旦成交或状态更新，撤单将被拒绝。',
      level: 'risk'
    },
    {
      title: '资金回补',
      text: '买单撤销释放冻结资金，卖单撤销恢复可卖持仓。',
      level: 'info'
    },
    {
      title: '批量策略',
      text: '一键撤单按顺序逐笔执行，处理中请勿重复点击。',
      level: 'info'
    }
  ] as Array<{ title: string; text: string; level: 'info' | 'risk' | 'ok' }>;
});

const refresh = async () => {
  await store.fetchAdminData(true);
};

const onCancel = async (id: number) => {
  if (!window.confirm('确认撤销该委托？')) return;
  await api.cancel(id);
  notifySuccess('撤单成功', `订单 #${id} 已提交撤销。`, '请刷新核对资金与持仓回补。');
  await store.fetchAdminData();
};

const cancelAllPending = async () => {
  if (pendingOrders.value.length === 0) {
    notifyWarning('当前无可撤订单', '没有处于挂单或撮合中的订单。');
    return;
  }
  if (!window.confirm(`确认撤销 ${pendingOrders.value.length} 笔挂单？`)) return;

  bulkCancelling.value = true;
  try {
    for (const order of pendingOrders.value) {
      await api.cancel(order.id);
    }
    notifySuccess('批量撤单完成', `共处理 ${pendingOrders.value.length} 笔订单。`, '建议刷新后再次核对状态。');
  } finally {
    bulkCancelling.value = false;
    await store.fetchAdminData();
  }
};
</script>

<style scoped>
.cancel-page {
  display: grid;
  gap: 12px;
}

.head-box {
  padding: 12px;
}

.head-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
}

.desc {
  margin: 8px 0 0;
  font-size: 12px;
  line-height: 1.6;
  color: var(--text-soft);
}

.action-row {
  margin-top: 10px;
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

@media (min-width: 920px) {
  .head-box {
    padding: 14px;
  }
}
</style>
