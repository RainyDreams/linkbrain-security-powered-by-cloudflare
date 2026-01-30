<template>
  <div class="min-h-screen flex flex-col bg-gray-50">
    <!-- Top Header -->
    <header class="bg-white border-b border-gray-200">
      <div class="h-12 flex items-center justify-center relative px-4">
        <div class="flex items-center gap-2">
          <div class="w-6 h-6 rounded bg-gray-900 flex items-center justify-center">
            <span class="text-white text-xs font-bold">零</span>
          </div>
          <h1 class="font-bold text-sm text-gray-900">零本证券</h1>
        </div>
        <div class="absolute right-4 text-[11px] text-gray-500">
           {{ statusText }}
        </div>
      </div>
      
      <!-- Top Navigation Tabs -->
      <nav class="flex text-xs font-medium border-b border-gray-200">
        <router-link to="/admin/buy" replace 
                     class="flex-1 py-3 text-center border-b-2"
                     :class="route.path.includes('buy') ? 'border-red-600 text-red-600' : 'border-transparent text-gray-600 hover:text-gray-900'">
            买入
        </router-link>
        <router-link to="/admin/sell" replace 
                     class="flex-1 py-3 text-center border-b-2"
                     :class="route.path.includes('sell') ? 'border-green-600 text-green-600' : 'border-transparent text-gray-600 hover:text-gray-900'">
            卖出
        </router-link>
        <router-link to="/admin/cancel" replace 
                     class="flex-1 py-3 text-center border-b-2"
                     :class="route.path.includes('cancel') ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-600 hover:text-gray-900'">
            撤单
        </router-link>
        <router-link to="/admin/holdings" replace 
                     class="flex-1 py-3 text-center border-b-2"
                     :class="route.path.includes('holdings') ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-600 hover:text-gray-900'">
            持仓
        </router-link>
      </nav>
    </header>

    <!-- Content -->
    <main class="flex-1 overflow-y-auto">
      <router-view v-slot="{ Component }">
        <keep-alive>
          <component :is="Component" />
        </keep-alive>
      </router-view>
    </main>
    
    <!-- Footer Info -->
    <div class="bg-white border-t border-gray-200 p-2 text-center text-[10px] text-gray-500">
      管理员模式 • {{ now }}
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { useRoute } from 'vue-router';
import { useMarketStore } from '../../stores/market';

const route = useRoute();
const store = useMarketStore();
const now = ref('');

const statusText = computed(() => {
    const h = new Date().getHours();
    const m = new Date().getMinutes();
    const t = h * 100 + m;
    if ((t >= 930 && t<=1130) || (t>=1300 && t<=1500)) return '交易中';
    return '休市';
});

let timer: any;
onMounted(() => {
    store.fetchAdminData();
    const updateTime = () => {
        now.value = new Date().toLocaleTimeString('zh-CN', { 
            hour12: false,
            hour: '2-digit',
            minute: '2-digit'
        });
    };
    updateTime();
    timer = setInterval(() => {
        updateTime();
        if(document.visibilityState === 'visible') store.fetchAdminData();
    }, 3000);
});

onUnmounted(() => clearInterval(timer));
</script>

<style scoped>
.router-link-active {
  font-weight: 600;
}
</style>