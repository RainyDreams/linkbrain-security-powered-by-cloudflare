<template>
  <div class="cancel-page">
    <section class="glass-card head-box">
      <div class="head-row">
        <h2 class="panel-title">订单中心</h2>
        <span class="status-chip">可撤 {{ pendingCount }}</span>
      </div>
      <div class="action-row">
        <button class="btn-solid btn-ghost" @click="refresh">刷新数据</button>
        <button class="btn-solid btn-primary" @click="cancelAllPending" :disabled="pendingCount === 0 || bulkCancelling">
          {{ bulkCancelling ? '处理中...' : '批量撤单' }}
        </button>
      </div>
    </section>

    <OrderList :orders="store.orders" :can-cancel="true" @cancel="onCancel" />
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import api from '../../api';
import OrderList from '../../components/OrderList.vue';
import { useMarketStore } from '../../stores/market';
import { notifySuccess, notifyWarning } from '../../utils/notify';

const store = useMarketStore();
const bulkCancelling = ref(false);

const pendingOrders = computed(() => store.orders.filter((o: any) => o.status === 'PENDING'));
const pendingCount = computed(() => pendingOrders.value.length);

const refresh = async () => {
  await store.fetchAdminData(true);
};

const onCancel = async (id: number) => {
  if (!window.confirm('确认撤销该委托？')) return;
  await api.cancel(id);
  notifySuccess('撤单成功', `订单 #${id} 已提交撤销。`);
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
    notifySuccess('批量撤单完成', `共处理 ${pendingOrders.value.length} 笔订单。`);
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
