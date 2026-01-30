<template>
  <div class="pb-6 space-y-3">
    <!-- 1. 顶部资产卡片 -->
    <div class="bg-white rounded-xl p-4 border border-gray-200">
      <div class="mb-4 text-center border-b border-gray-200 pb-4">
        <div class="text-[11px] text-gray-500 mb-1">总资产(CNY)</div>
        <div class="text-2xl font-bold font-mono text-gray-900">
          {{ formatMoney(totalAssets) }}
        </div>
      </div>

      <div class="grid grid-cols-2 gap-3 mb-4 text-center">
        <div class="bg-gray-50 p-3 rounded-lg border border-gray-100">
          <div class="text-[11px] text-gray-500 mb-1">持仓盈亏</div>
          <div class="font-mono font-bold text-base" :class="getColor(totalHoldingPnl)">
            {{ totalHoldingPnl > 0 ? '+' : ''}}{{ formatMoney(totalHoldingPnl) }}
          </div>
          <div class="text-[11px]" :class="getColor(totalHoldingPnlRate)">
            {{ totalHoldingPnlRate }}%
          </div>
        </div>
        <div class="bg-gray-50 p-3 rounded-lg border border-gray-100">
          <div class="text-[11px] text-gray-500 mb-1">当日盈亏</div>
          <div class="font-mono font-bold text-base" :class="getColor(dayPnl)">
            {{ dayPnl > 0 ? '+' : ''}}{{ formatMoney(dayPnl) }}
          </div>
          <div class="text-[11px]" :class="getColor(dayPnl)">
            {{ ((dayPnl / totalAssets) * 100).toFixed(2) }}%
          </div>
        </div>
      </div>

      <div class="grid grid-cols-3 gap-2 text-center bg-gray-50 rounded-lg py-3">
        <div>
          <div class="text-[10px] text-gray-500">总市值</div>
          <div class="font-medium text-sm text-gray-900">{{ formatMoney(store.dashboard.market_cap) }}</div>
        </div>
        <div>
          <div class="text-[10px] text-gray-500">可用</div>
          <div class="font-medium text-sm text-gray-900">{{ formatMoney(store.dashboard.available) }}</div>
        </div>
        <div>
          <div class="text-[10px] text-gray-500">可取</div>
          <div class="font-medium text-sm text-gray-900">{{ formatMoney(store.dashboard.available) }}</div>
        </div>
      </div>
    </div>

    <!-- 2. 功能按钮区 -->
    <div class="flex gap-2">
      <button @click="showTransferModal = true" 
              class="flex-1 bg-white border border-gray-300 active:bg-gray-100 py-3 rounded-lg flex items-center justify-center gap-2 transition-colors">
        <svg class="w-4 h-4 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4"></path>
        </svg>
        <span class="font-medium text-sm text-gray-900">银证转账</span>
      </button>
      
      <button @click="goToAnalysis" 
              class="flex-1 bg-white border border-gray-300 active:bg-gray-100 py-3 rounded-lg flex items-center justify-center gap-2 transition-colors">
        <svg class="w-4 h-4 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"></path>
        </svg>
        <span class="font-medium text-sm text-gray-900">账户分析</span>
      </button>
    </div>

    <!-- 3. 持仓列表 -->
    <div class="space-y-2 pb-4">
      <div v-if="processedHoldings.length === 0" class="text-center text-gray-500 py-8">
        暂无持仓
      </div>

      <div v-for="item in processedHoldings" :key="item.symbol" 
           class="bg-white rounded-lg overflow-hidden border border-gray-200">
        <div class="p-3">
          <div class="flex justify-between items-start mb-2">
            <div class="flex items-center gap-2">
              <div class="w-8 h-8 rounded bg-gray-100 flex items-center justify-center">
                <span class="text-sm font-medium text-gray-700">{{ item.name.charAt(0) }}</span>
              </div>
              <div>
                <div class="text-sm font-semibold text-gray-900">{{ item.name }}</div>
                <div class="text-[11px] text-gray-500 font-mono">{{ item.symbol }}</div>
              </div>
            </div>
            <div class="text-right">
              <div class="text-base font-mono font-medium" :class="getColor(item.pnl_rate)">
                {{ formatMoney(item.current_price) }}
              </div>
              <div class="text-xs font-medium mt-0.5 px-1.5 py-0.5 rounded"
                   :class="item.pnl_rate >= 0 ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'">
                {{ item.pnl_rate > 0 ? '+' : ''}}{{ item.pnl_rate }}%
              </div>
            </div>
          </div>

          <div class="grid grid-cols-3 gap-y-1.5 gap-x-2 text-xs pt-2 border-t border-gray-100">
            <div>
              <span class="text-gray-500 block text-[11px]">持仓/可用</span>
              <span class="text-gray-900 font-mono">{{ item.quantity }} / {{ item.available_qty }}</span>
            </div>
            <div class="text-center">
              <span class="text-gray-500 block text-[11px]">成本</span>
              <span class="text-gray-900 font-mono">{{ item.avg_cost }}</span>
            </div>
            <div class="text-right">
              <span class="text-gray-500 block text-[11px]">市值</span>
              <span class="text-gray-900 font-mono">{{ formatMoney(item.market_value) }}</span>
            </div>

            <div>
              <span class="text-gray-500 block text-[11px]">持仓盈亏</span>
              <span class="font-mono font-medium" :class="getColor(item.pnl)">{{ item.pnl }}</span>
            </div>
            <div class="text-center">
              <span class="text-gray-500 block text-[11px]">仓位</span>
              <div class="relative">
                <div class="h-1 w-full bg-gray-200 rounded-full overflow-hidden mt-0.5">
                  <div class="h-full bg-blue-600 rounded-full" 
                       :style="{ width: Math.min(item.position_rate, 100) + '%' }"></div>
                </div>
                <span class="text-[11px] text-blue-600 mt-0.5 block">{{ item.position_rate }}%</span>
              </div>
            </div>
            <div class="text-right">
              <button @click="toggleExpand(item.symbol)" 
                      class="text-[11px] text-blue-600 px-2 py-0.5 hover:bg-blue-50 rounded">
                {{ expandedSymbol === item.symbol ? '收起' : '操作' }}
              </button>
            </div>
          </div>
        </div>

        <!-- 展开的操作栏 -->
        <div v-if="expandedSymbol === item.symbol" class="grid grid-cols-2 border-t border-gray-200 bg-gray-50">
          <button @click.stop="trade('buy', item.symbol)" 
                  class="py-2.5 text-center text-red-600 font-medium hover:bg-red-50 active:bg-red-100">
            买入
          </button>
          <button @click.stop="trade('sell', item.symbol)" 
                  class="py-2.5 text-center text-green-600 font-medium border-l border-gray-200 hover:bg-green-50 active:bg-green-100">
            卖出
          </button>
        </div>
      </div>
    </div>

    <!-- 转账模态框 -->
    <div v-if="showTransferModal" class="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-black/60">
      <div @click.stop class="w-full max-w-md bg-white rounded-xl overflow-hidden border border-gray-300">
        <div class="p-4">
          <div class="flex justify-between items-center mb-4">
            <h3 class="text-base font-semibold text-gray-900">银证转账</h3>
            <button @click="showTransferModal = false" class="text-gray-500 hover:text-gray-700">
              <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>
              </svg>
            </button>
          </div>

          <!-- 金额输入 -->
          <div class="mb-4 relative">
            <span class="absolute left-0 top-1/2 -translate-y-1/2 text-2xl font-bold text-gray-500">¥</span>
            <input v-model="transferAmount" type="number" step="0.01" autofocus
                   class="w-full bg-transparent border-b border-gray-300 text-3xl font-bold font-mono text-gray-900 pl-8 focus:outline-none focus:border-blue-500 placeholder-gray-400"
                   placeholder="0.00">
          </div>

          <!-- 方向选择 -->
          <div class="flex gap-2 mb-4">
            <button @click="transferType = 'IN'" 
                    :class="transferType === 'IN' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-700'"
                    class="flex-1 py-2.5 rounded-lg font-medium transition-colors">
              入金 (转入)
            </button>
            <button @click="transferType = 'OUT'" 
                    :class="transferType === 'OUT' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-700'"
                    class="flex-1 py-2.5 rounded-lg font-medium transition-colors">
              出金 (转出)
            </button>
          </div>

          <!-- 确认按钮 -->
          <button @click="handleTransfer" :disabled="loading || !transferAmount"
                  class="w-full py-3 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex justify-center items-center">
            <span v-if="loading" class="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin mr-2"></span>
            确认提交
          </button>
          
          <p class="text-center text-[11px] text-gray-500 mt-3">资金将即时到达账户可用余额</p>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { useMarketStore } from '../../stores/market';
import { formatMoney, getColor } from '../../utils/format';
import api from '../../api';

const store = useMarketStore();
const router = useRouter();
const expandedSymbol = ref('');

const processedHoldings = computed(() => {
    const total = Number(store.dashboard.total) || 1;
    return store.holdings.map((h: any) => {
        const currentPrice = Number(h.current_price);
        const avgCost = Number(h.avg_cost);
        const qty = Number(h.quantity);
        
        const marketVal = currentPrice * qty;
        const pnl = (currentPrice - avgCost) * qty;
        const pnlRate = avgCost > 0 ? ((currentPrice - avgCost) / avgCost * 100) : 0;
        const positionRate = (marketVal / total * 100).toFixed(2);

        return {
            ...h,
            market_value: marketVal,
            pnl: pnl.toFixed(2),
            pnl_rate: pnlRate.toFixed(2),
            position_rate: positionRate
        };
    });
});

const totalAssets = computed(() => Number(store.dashboard.total));
const totalHoldingPnl = computed(() => {
    return processedHoldings.value.reduce((acc, cur) => acc + Number(cur.pnl), 0);
});

const totalHoldingPnlRate = computed(() => {
    const totalCost = store.holdings.reduce((acc, cur) => acc + (Number(cur.avg_cost) * Number(cur.quantity)), 0);
    if(totalCost === 0) return '0.00';
    return ((totalHoldingPnl.value / totalCost) * 100).toFixed(2);
});

const dayPnl = ref(0);

const toggleExpand = (symbol: string) => {
    expandedSymbol.value = expandedSymbol.value === symbol ? '' : symbol;
};

const trade = (side: string, symbol: string) => {
    store.currentTradeSymbol = symbol;
    router.push({ path: `/admin/${side}` });
};

const goToAnalysis = () => {
    router.push('/');
};

const showTransferModal = ref(false);
const transferAmount = ref('');
const transferType = ref<'IN' | 'OUT'>('IN');
const loading = ref(false);

const handleTransfer = async () => {
    if (!transferAmount.value || isNaN(Number(transferAmount.value))) return;
    
    loading.value = true;
    try {
        await api.transfer({
            amount: Number(transferAmount.value),
            type: transferType.value
        });
        
        alert(`${transferType.value === 'IN' ? '入金' : '出金'}成功！`);
        showTransferModal.value = false;
        transferAmount.value = '';
        store.fetchAdminData();
    } catch (e) {
        // 拦截器已处理错误弹窗
    } finally {
        loading.value = false;
    }
};

onMounted(async () => {
    await store.fetchAdminData();
    try {
        const publicData: any = await api.getPublicOverview();
        if(publicData && publicData.assets) {
            dayPnl.value = Number(publicData.assets.day_pnl || 0);
        }
    } catch(e) {}
});
</script>

<style scoped>
.font-mono {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
}
</style>