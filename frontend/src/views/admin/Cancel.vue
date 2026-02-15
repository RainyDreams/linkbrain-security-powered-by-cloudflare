<template>
  <div class="space-y-3">
    <section class="glass-card p-4">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <h2 class="panel-title">撤单中心</h2>
        <div class="text-xs text-slate-600">可撤订单: {{ pendingCount }}</div>
      </div>
      <p class="mt-2 text-xs text-slate-600">仅状态为“挂单中 / 撮合中”的委托支持撤销；撤销后资金与可卖持仓会自动回补。</p>
      <div class="mt-3 flex gap-2">
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
      title: '撤单时效',
      text: '订单已成交或状态更新后，将无法撤销。建议在挂单后及时关注状态。',
      level: 'risk'
    },
    {
      title: '资金回补',
      text: '买入撤单会释放冻结资金，卖出撤单会恢复可卖持仓。',
      level: 'info'
    },
    {
      title: '批量操作',
      text: '一键撤单将逐笔提交，期间请勿重复点击。',
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
  notifySuccess('撤单成功', `订单 #${id} 已提交撤销。`, '请关注订单状态与资金回补。');
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
    notifySuccess('批量撤单完成', `共处理 ${pendingOrders.value.length} 笔订单。`, '建议刷新后核对状态。');
  } finally {
    bulkCancelling.value = false;
    await store.fetchAdminData();
  }
};
</script>
