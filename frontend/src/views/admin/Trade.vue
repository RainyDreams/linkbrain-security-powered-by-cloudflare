<template>
    <div class="space-y-4 p-4">
      <!-- Balance Info -->
      <div class="flex justify-between text-[11px] text-gray-500 px-1">
        <div>可用: <span class="text-gray-900 font-mono font-medium">{{ formatMoney(availableAmount) }}</span></div>
        <div v-if="!isBuy">持仓: <span class="text-gray-900 font-mono font-medium">{{ maxSellQty }}</span></div>
      </div>
  
      <!-- Inputs -->
      <div class="space-y-3">
        <!-- Code -->
        <div class="bg-white rounded-lg p-2 flex items-center border border-gray-300 focus-within:border-blue-500 focus-within:ring-1 focus-within:ring-blue-500">
          <span class="w-10 text-center text-[11px] text-gray-600 font-medium">代码</span>
          <input v-model="form.symbol" @input="onSymbolInput" maxlength="6" type="tel" 
                 class="flex-1 bg-transparent outline-none text-sm font-mono px-2 text-gray-900 placeholder-gray-400"
                 placeholder="600xxx">
          <div v-if="preview.name" class="text-right ml-2">
            <div class="text-xs font-medium text-gray-900 truncate max-w-[80px]">{{ preview.name }}</div>
            <div class="text-xs font-mono" :class="preview.pct >=0 ? 'text-red-600' : 'text-green-600'">
              {{ preview.price }}
            </div>
          </div>
        </div>
  
        <!-- Price -->
        <div class="flex gap-2">
          <div class="flex-1 bg-white rounded-lg p-2 flex items-center border border-gray-300 focus-within:border-blue-500 focus-within:ring-1 focus-within:ring-blue-500">
            <span class="w-10 text-center text-[11px] text-gray-600 font-medium">价格</span>
            <input v-model.number="form.price" type="number" step="0.01"
                   class="flex-1 bg-transparent outline-none text-sm font-mono px-2 text-gray-900 placeholder-gray-400"
                   placeholder="0.00">
          </div>
        </div>
  
        <!-- Qty -->
        <div class="bg-white rounded-lg p-2 flex items-center border border-gray-300 focus-within:border-blue-500 focus-within:ring-1 focus-within:ring-blue-500">
          <span class="w-10 text-center text-[11px] text-gray-600 font-medium">数量</span>
          <input v-model.number="form.qty" type="number"
                 class="flex-1 bg-transparent outline-none text-sm font-mono px-2 text-gray-900 placeholder-gray-400"
                 placeholder="0">
        </div>
        
        <!-- Quick Ratios -->
        <div class="grid grid-cols-4 gap-2">
          <button v-for="r in [0.25, 0.33, 0.5, 1]" :key="r" @click="setQtyByRatio(r)"
                  class="bg-gray-100 hover:bg-gray-200 active:bg-gray-300 py-2 rounded text-xs font-mono text-gray-700 transition-colors">
            {{ r === 1 ? '全' : (r === 0.33 ? '1/3' : (r*100).toFixed(0)+'%') }}
          </button>
        </div>
      </div>
  
      <!-- Action Button -->
      <button @click="submit" :disabled="loading"
              class="w-full py-3 rounded-lg font-medium text-base text-white"
              :class="isBuy ? 
                'bg-red-600 hover:bg-red-700 active:bg-red-800' : 
                'bg-green-600 hover:bg-green-700 active:bg-green-800'">
        {{ isBuy ? '买 入' : '卖 出' }}
      </button>
  
      <!-- Order List -->
      <div class="pt-4 border-t border-gray-200">
        <h3 class="text-sm font-semibold text-gray-900 mb-2">当日委托</h3>
        <OrderList :orders="store.orders" @cancel="doCancel" />
      </div>
    </div>
  </template>
  
  <script setup lang="ts">
  import { ref, reactive, computed, watch, onMounted } from 'vue';
  import { useRoute } from 'vue-router';
  import { useMarketStore } from '../../stores/market';
  import { fetchStockPrice } from '../../utils/quote';
  import { formatMoney } from '../../utils/format';
  import OrderList from '../../components/OrderList.vue';
  import api from '../../api';
  
  const route = useRoute();
  const store = useMarketStore();
  const isBuy = computed(() => route.path.includes('buy'));
  
  const form = reactive({ symbol: '', price: '' as any, qty: '' as any });
  const preview = reactive({ name: '', price: 0, pct: 0 });
  const loading = ref(false);
  
  const availableAmount = computed(() => isBuy.value ? store.dashboard.available : 0);
  const maxSellQty = computed(() => {
      if(isBuy.value) return 0;
      const h = store.holdings.find((x: any) => x.symbol === form.symbol);
      return h ? h.available_qty : 0;
  });
  
  onMounted(() => {
      if (store.currentTradeSymbol) {
          form.symbol = store.currentTradeSymbol;
          onSymbolInput();
          store.currentTradeSymbol = '';
      }
  });
  
  const onSymbolInput = async () => {
      if (form.symbol.length === 6) {
          const data = await fetchStockPrice(form.symbol);
          if (data) {
              preview.name = data.name;
              preview.price = data.price;
              preview.pct = 0;
              if(!form.price) form.price = data.price;
          }
      }
  };
  
  const setQtyByRatio = (r: number) => {
      if (!form.price) return alert("请先输入价格");
      if (isBuy.value) {
          const cash = store.dashboard.available * r;
          const rawQty = Math.floor(cash / (form.price * 1.0003) / 100) * 100;
          form.qty = rawQty;
      } else {
          form.qty = Math.floor(maxSellQty.value * r);
      }
  };
  
  const submit = async () => {
      if(!form.symbol || !form.price || !form.qty) return;
      loading.value = true;
      try {
          await api.trade({
              symbol: form.symbol,
              side: isBuy.value ? 'BUY' : 'SELL',
              price: Number(form.price),
              qty: Number(form.qty)
          });
          form.qty = '';
          store.fetchAdminData();
      } catch(e) {
          // Handled by interceptor
      } finally {
          loading.value = false;
      }
  };
  
  const doCancel = async (id: any) => {
      if(confirm('撤销此单?')) {
          await api.cancel(id);
          store.fetchAdminData();
      }
  };
  
  watch(() => route.path, () => {
      form.symbol = ''; form.price = ''; form.qty = '';
      preview.name = '';
  });
  </script>
  
  <style scoped>
  .font-mono {
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  }
  </style>