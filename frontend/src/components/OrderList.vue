<template>
    <div class="space-y-2 pb-10">
      <div v-if="orders.length === 0" class="text-center text-gray-500 py-4 text-sm">暂无委托</div>
      
      <div v-for="o in orders" :key="o.id" 
           class="bg-white p-3 rounded-lg border border-gray-200 flex justify-between items-center text-sm border-l-4"
           :class="o.side === 'BUY' ? 'border-l-red-500' : 'border-l-green-500'">
          
          <!-- Left Info -->
          <div class="flex-1 min-w-0">
              <div class="flex items-center gap-2 mb-1">
                  <span class="font-semibold text-gray-900">{{ o.name }}</span>
                  <span class="text-xs text-gray-500 font-mono">{{ o.symbol }}</span>
              </div>
              <div class="flex items-center text-xs text-gray-500">
                  <span>{{ o.time }}</span>
                  <span :class="getStatusColor(o.status)" class="ml-2 font-medium">{{ formatStatus(o.status) }}</span>
              </div>
          </div>
  
          <!-- Right Info -->
          <div class="text-right ml-2">
              <div class="font-mono text-gray-900">{{ o.price }} <span class="text-gray-500">x</span> {{ o.qty }}</div>
              <div class="text-xs text-gray-500 mt-0.5">
                  已成: <span class="text-gray-900 font-medium">{{ o.filled_qty }}</span>
              </div>
          </div>
  
          <!-- Action -->
          <div v-if="o.status === 'PENDING'" class="ml-3 border-l border-gray-200 pl-3">
              <button @click="$emit('cancel', o.id)" 
                      class="text-blue-600 text-xs border border-blue-600 px-2 py-1 rounded hover:bg-blue-50 active:bg-blue-100 transition-colors">
                  撤单
              </button>
          </div>
      </div>
    </div>
  </template>
  
  <script setup>
  defineProps(['orders']);
  defineEmits(['cancel']);
  
  const formatStatus = (s) => {
      const map = { 
          PENDING: '挂单', 
          FILLED: '已成', 
          CANCELLED: '已撤', 
          PARTIAL: '部成', 
          EXPIRED: '废单' 
      };
      return map[s] || s;
  };
  
  const getStatusColor = (s) => {
      if(s === 'PENDING') return 'text-yellow-600';
      if(s === 'FILLED') return 'text-blue-600';
      return 'text-gray-500';
  };
  </script>
  
  <style scoped>
  .font-mono {
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  }
  </style>