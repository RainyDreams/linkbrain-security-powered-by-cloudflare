<template>
    <div class="p-4">
      <h2 class="text-sm font-semibold text-gray-900 mb-3">当前委托</h2>
      
      <div v-if="pendingOrders.length === 0" class="text-center text-gray-500 py-8">
        <p class="text-sm mb-1">暂无活动委托</p>
        <p class="text-[11px] text-gray-400">委托记录将在交易完成后自动消失</p>
      </div>
      
      <div v-for="order in pendingOrders" :key="order.id" 
           class="bg-white rounded-lg p-3 mb-2 border border-gray-200 flex justify-between items-center">
          <div class="flex-1 min-w-0">
              <div class="flex items-center gap-2 mb-1">
                  <span class="text-[11px] px-1.5 py-0.5 rounded text-white font-medium"
                        :class="order.side === 'BUY' ? 'bg-red-600' : 'bg-green-600'">
                      {{ order.side === 'BUY' ? '买' : '卖' }}
                  </span>
                  <span class="text-sm font-medium text-gray-900 truncate">{{ order.name }}</span>
              </div>
              <div class="flex justify-between items-center text-[11px] text-gray-500">
                <span class="font-mono">{{ order.price }}元 / {{ order.qty }}股</span>
                <span>{{ order.time }}</span>
              </div>
          </div>
          <button @click="doCancel(order.id)" 
                  class="ml-3 px-3 py-1.5 rounded text-xs font-medium border border-blue-600 text-blue-600 hover:bg-blue-50 active:bg-blue-100 transition-colors">
              撤单
          </button>
      </div>
    </div>
  </template>
  
  <script setup lang="ts">
  import { computed } from 'vue';
  import { useMarketStore } from '../../stores/market';
  import api from '../../api';
  
  const store = useMarketStore();
  const pendingOrders = computed(() => store.orders.filter((o:any) => o.status === 'PENDING'));
  
  const doCancel = async (id: number) => {
      if(!confirm('确认撤单?')) return;
      await api.cancel(id);
      store.fetchAdminData();
  };
  </script>
  
  <style scoped>
  .font-mono {
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  }
  </style>