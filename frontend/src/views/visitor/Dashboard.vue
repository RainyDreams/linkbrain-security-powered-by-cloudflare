<template>
    <div class="min-h-screen bg-gray-50 text-gray-900 pb-10">
      <!-- Header - 沉稳设计 -->
      <div class="px-4 pt-4 pb-3 flex justify-between items-center bg-white border-b border-gray-200">
          <div class="flex items-center gap-3">
              <div class="w-8 h-8 rounded-lg bg-gray-900 flex items-center justify-center">
                  <span class="text-white font-medium text-sm">零</span>
              </div>
              <div>
                  <h1 class="text-base font-bold text-gray-900">零本证券</h1>
                  <p class="text-[11px] text-gray-500 mt-0.5">公开资产总览</p>
              </div>
          </div>
          <button @click="$router.push('/login')" 
                  class="p-2 rounded-lg bg-gray-100 active:bg-gray-200 transition-colors">
              <svg class="w-4 h-4 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"></path>
              </svg>
          </button>
      </div>
  
      <!-- 1. 核心资产卡片 -->
      <div class="mx-4 mt-4 bg-white rounded-xl p-4 border border-gray-200">
          <div class="flex justify-between items-start mb-5">
            <div>
              <p class="text-xs text-gray-500 mb-1">总资产 (CNY)</p>
              <h2 class="text-2xl font-bold font-mono text-gray-900 leading-none">
                {{ formatMoney(data.assets.total) }}
              </h2>
            </div>
            <div class="text-right">
              <span class="inline-flex items-center gap-1 px-2.5 py-1 rounded text-xs font-medium bg-blue-50 text-blue-700">
                累计收益 {{ data.assets.return_total_pct > 0 ? '+' : '' }}{{ data.assets.return_total_pct }}%
              </span>
            </div>
          </div>
  
          <!-- 盈亏卡片组 -->
          <div class="grid grid-cols-2 gap-3 mb-5">
              <div class="bg-gray-50 p-3 rounded-lg border border-gray-100">
                  <p class="text-[11px] text-gray-500 mb-1.5">当日盈亏</p>
                  <div class="flex items-end gap-1">
                      <p class="text-lg font-bold font-mono" :class="getColor(data.assets.day_pnl)">
                          {{ data.assets.day_pnl > 0 ? '+' : '' }}{{ formatMoney(data.assets.day_pnl) }}
                      </p>
                      <span class="text-[13px] font-medium mb-0.5" :class="getColor(data.assets.day_pct)">
                          ({{ data.assets.day_pct > 0 ? '+' : '' }}{{ data.assets.day_pct }}%)
                      </span>
                  </div>
              </div>
              <div class="bg-gray-50 p-3 rounded-lg border border-gray-100">
                   <p class="text-[11px] text-gray-500 mb-1.5">持仓盈亏</p>
                   <p class="text-lg font-bold font-mono text-gray-900">
                     {{ data.assets.pnl_holding > 0 ? '+' : '' }}{{ formatMoney(data.assets.pnl_holding) }}
                   </p>
              </div>
          </div>
  
          <!-- 资产指标 -->
          <div class="grid grid-cols-3 gap-3 pt-4 border-t border-gray-200">
            <div class="text-center">
              <p class="text-[11px] text-gray-500 mb-1">持仓市值</p>
              <p class="text-sm font-semibold font-mono text-gray-900">{{ formatMoney(data.assets.market_cap) }}</p>
            </div>
            <div class="text-center">
              <p class="text-[11px] text-gray-500 mb-1">可用资金</p>
              <p class="text-sm font-semibold font-mono text-gray-900">{{ formatMoney(data.assets.balance) }}</p>
            </div>
            <div class="text-center">
              <p class="text-[11px] text-gray-500 mb-1">最大回撤</p>
              <p class="text-sm font-semibold font-mono text-green-700">{{ data.assets.max_drawdown }}%</p>
            </div>
          </div>
      </div>
  
      <!-- 2. 收益走势图 -->
      <div class="mt-4 px-4">
          <div class="flex justify-between items-center mb-3">
            <div>
              <h3 class="text-sm font-semibold text-gray-900">收益走势</h3>
              <p class="text-[11px] text-gray-500 mt-0.5">日频数据</p>
            </div>
            <span class="text-[11px] text-blue-600 px-2 py-1 bg-blue-50 rounded">Daily</span>
          </div>
          
          <!-- 图表容器 -->
          <div class="bg-white rounded-xl p-3 border border-gray-200">
            <div ref="chartRef" class="h-48 w-full"></div>
          </div>
      </div>
  
      <!-- 3. 最新调仓日志 -->
      <div class="mt-4 px-4">
          <div class="flex justify-between items-center mb-3">
              <h3 class="text-sm font-semibold text-gray-900">最新调仓</h3>
              <span class="text-[11px] text-gray-500">{{ data.logs.length }} 条记录</span>
          </div>
          
          <div class="space-y-2">
               <div v-for="(log, idx) in data.logs" :key="idx" 
                    class="bg-white rounded-lg p-3 border border-gray-200">
                  <div class="flex items-center gap-3">
                      <div class="w-8 h-8 rounded-lg flex items-center justify-center text-xs font-semibold border"
                        :class="log.side === 'BUY' ? 'border-red-300 text-red-700 bg-red-50' : 'border-green-300 text-green-700 bg-green-50'">
                        {{ log.side === 'BUY' ? '买' : '卖' }}
                      </div>
                      <div class="flex-1 min-w-0">
                          <div class="flex justify-between items-center">
                              <span class="text-sm font-medium text-gray-900 truncate">{{ log.text }}</span>
                              <span class="text-[11px] text-gray-500 font-mono shrink-0 ml-2">
                                  {{ log.time.split(' ')[0] }}
                              </span>
                          </div>
                          <div class="mt-1">
                            <span class="text-[11px] text-gray-500 font-mono truncate">{{ log.detail }}</span>
                          </div>
                      </div>
                  </div>
               </div>
          </div>
      </div>
      
      <!-- 4. 证券持仓明细 -->
      <div class="mt-4 px-4 pb-6">
          <div class="flex justify-between items-center mb-3">
              <h3 class="text-sm font-semibold text-gray-900">证券持仓</h3>
              <span class="text-[11px] text-blue-600 font-medium">{{ data.holdings.length }} 只股票</span>
          </div>
          
          <div class="space-y-2">
              <div v-for="h in data.holdings" :key="h.code" 
                   class="bg-white rounded-lg p-4 border border-gray-200">
                  <!-- 第一行：股票名称和价格 -->
                  <div class="flex justify-between items-start mb-3">
                      <div class="flex items-center gap-3">
                          <div class="w-10 h-10 rounded-lg bg-gray-100 flex items-center justify-center">
                              <span class="text-base font-semibold text-gray-700">{{ h.name.charAt(0) }}</span>
                          </div>
                          <div>
                              <div class="font-semibold text-sm text-gray-900">{{ h.name }}</div>
                              <div class="text-[11px] text-gray-500 font-mono mt-0.5">{{ h.code }}</div>
                          </div>
                      </div>
                      <div class="text-right">
                          <div class="font-bold text-base font-mono text-gray-900">{{ h.price }}</div>
                          <div class="text-xs font-bold font-mono mt-1 px-2 py-1 rounded"
                               :class="h.pnl_rate >= 0 ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'">
                              {{ h.pnl_rate > 0 ? '+' : '' }}{{ h.pnl_rate }}%
                          </div>
                      </div>
                  </div>
                  
                  <!-- 第二行：详细指标 -->
                  <div class="grid grid-cols-3 gap-3 pt-3 border-t border-gray-200">
                      <div>
                        <p class="text-[11px] text-gray-500 mb-1">成本价</p>
                        <p class="text-sm font-semibold font-mono text-gray-900">{{ h.cost }}</p>
                      </div>
                      <div class="text-center">
                        <p class="text-[11px] text-gray-500 mb-1">仓位</p>
                        <div class="relative">
                          <div class="h-1 w-full bg-gray-200 rounded-full overflow-hidden">
                            <div class="h-full bg-blue-600 rounded-full" 
                                 :style="{ width: Math.min(h.position_rate, 100) + '%' }"></div>
                          </div>
                          <p class="text-sm font-semibold font-mono text-blue-700 mt-1">
                            {{ h.position_rate }}%
                          </p>
                        </div>
                      </div>
                      <div class="text-right">
                        <p class="text-[11px] text-gray-500 mb-1">浮动盈亏</p>
                        <p class="text-sm font-semibold font-mono" :class="getColor(h.pnl_val)">
                          {{ h.pnl_val > 0 ? '+' : '' }}{{ h.pnl_val }}
                        </p>
                      </div>
                  </div>
              </div>
          </div>
      </div>
  
      <!-- 5. 页脚信息 -->
      <div class="px-4 text-center mt-4 pt-4 border-t border-gray-200">
        <p class="text-[10px] text-gray-400">行情数据来源于腾讯/新浪 • 仅供模拟交易参考</p>
      </div>
    </div>
  </template>
  
  <script setup lang="ts">
  import { ref, onMounted, reactive, nextTick } from 'vue';
  import * as echarts from 'echarts';
  import api from '../../api';
  import { formatMoney, getColor } from '../../utils/format';
  
  const chartRef = ref(null);
  const data = reactive({
      assets: {
          total: 0, market_cap: 0, balance: 0, pnl_holding: 0, day_pnl: 0, day_pct: 0, return_total_pct: 0, max_drawdown: 0
      },
      holdings: [],
      logs: [],
      charts: { asset: [], latest: {} }
  });
  
  const initChart = () => {
      if (!chartRef.value) return;
      const chart = echarts.init(chartRef.value);
      
      // 合并历史数据和最新实时点
      const chartData = [...data.charts.asset];
      if (data.charts.latest && data.charts.latest.value) {
          chartData.push(data.charts.latest);
      }
  
      chart.setOption({
          backgroundColor: 'transparent',
          grid: { 
              top: 15, 
              bottom: 20, 
              left: 40, 
              right: 20 
          },
          xAxis: { 
              type: 'category', 
              data: chartData.map(i => i.date), 
              axisLine: { 
                  show: true,
                  lineStyle: { 
                      color: '#d1d5db',
                      width: 1
                  }
              },
              axisTick: { 
                  show: true,
                  alignWithLabel: true,
                  length: 3,
                  lineStyle: { 
                      color: '#d1d5db'
                  }
              },
              axisLabel: { 
                  color: '#6b7280',
                  fontSize: 10,
                  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
                  margin: 6
              },
              splitLine: {
                  show: false
              }
          },
          yAxis: { 
              type: 'value', 
              min: 'dataMin',
              axisLine: { 
                  show: false
              },
              axisTick: { 
                  show: false
              },
              splitLine: { 
                  lineStyle: { 
                      color: '#f3f4f6',
                      type: 'solid',
                      width: 1
                  }
              },
              axisLabel: { 
                  color: '#6b7280',
                  fontSize: 10,
                  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
                  formatter: (value: number) => {
                      if (value >= 10000) {
                          return '¥' + (value / 10000).toFixed(0) + '万';
                      }
                      return '¥' + value;
                  }
              }
          },
          tooltip: {
              trigger: 'axis',
              backgroundColor: 'rgba(17, 24, 39, 0.95)',
              borderColor: 'rgba(255,255,255,0.1)',
              borderRadius: 6,
              borderWidth: 1,
              padding: [10, 12],
              textStyle: { 
                  color: '#fff', 
                  fontSize: 11,
                  fontFamily: 'system-ui, -apple-system, sans-serif',
                  fontWeight: 'normal'
              },
              axisPointer: {
                  type: 'line',
                  lineStyle: {
                      color: '#2563eb',
                      width: 1,
                      type: 'solid'
                  }
              },
              formatter: (params: any) => {
                const date = params[0].name;
                const value = params[0].value;
                const change = params[0].dataIndex > 0 ? 
                  ((value - chartData[params[0].dataIndex - 1].value) / chartData[params[0].dataIndex - 1].value * 100).toFixed(2) : 0;
                
                return `
                  <div style="margin-bottom: 4px; color: #9ca3af; font-size: 10px; font-family: ui-monospace;">${date}</div>
                  <div style="display: flex; align-items: baseline; gap: 6px;">
                    <div style="font-size: 16px; font-weight: 600; color: #ffffff; font-family: ui-monospace;">¥${formatMoney(value)}</div>
                    ${params[0].dataIndex > 0 ? `
                      <div style="font-size: 11px; font-weight: 500; color: ${change >= 0 ? '#10b981' : '#ef4444'};">
                        ${change >= 0 ? '+' : ''}${change}%
                      </div>
                    ` : ''}
                  </div>
                `;
              }
          },
          series: [{
              data: chartData.map(i => i.value),
              type: 'line',
              smooth: 0.2,
              symbol: 'circle',
              symbolSize: 4,
              showSymbol: chartData.length <= 15,
              itemStyle: { 
                  color: '#2563eb',
                  borderColor: '#ffffff',
                  borderWidth: 1.5
              },
              lineStyle: { 
                  width: 2, 
                  color: '#2563eb'
              },
              areaStyle: {
                  color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
                      { offset: 0, color: 'rgba(37, 99, 235, 0.1)' },
                      { offset: 0.5, color: 'rgba(37, 99, 235, 0.05)' },
                      { offset: 1, color: 'rgba(37, 99, 235, 0.01)' }
                  ])
              }
          }]
      });
  
      window.addEventListener('resize', () => chart.resize());
  };
  
  onMounted(async () => {
      try {
          const res: any = await api.getPublicOverview();
          Object.assign(data, res);
          
          await nextTick();
          initChart();
      } catch (e) {
          console.error("Fetch Error:", e);
      }
  });
  </script>
  
  <style scoped>
  /* 导入思源黑体 */
  @import url('https://fonts.googleapis.com/css2?family=Noto+Sans+SC:wght@300;400;500;600;700&display=swap');
  
  /* 应用思源黑体作为主字体 */
  :global(*) {
    font-family: 'Noto Sans SC', system-ui, -apple-system, sans-serif;
  }
  
  /* 等宽字体 */
  .font-mono {
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  }
  
  /* 涨跌颜色 */
  :deep(.text-red-700) { 
    color: #dc2626 !important; 
  }
  
  :deep(.text-green-700) { 
    color: #059669 !important; 
  }
  
  /* 移动端优化 */
  @media (max-width: 640px) {
    .text-2xl {
      font-size: 1.5rem;
      line-height: 2rem;
    }
    
    .text-lg {
      font-size: 1.125rem;
      line-height: 1.75rem;
    }
    
    .text-base {
      font-size: 1rem;
      line-height: 1.5rem;
    }
    
    .text-sm {
      font-size: 0.875rem;
      line-height: 1.25rem;
    }
    
    .text-xs {
      font-size: 0.75rem;
      line-height: 1rem;
    }
    
    .text-\[11px\] {
      font-size: 0.6875rem;
      line-height: 0.875rem;
    }
    
    .text-\[10px\] {
      font-size: 0.625rem;
      line-height: 0.75rem;
    }
  }
  
  /* 隐藏滚动条 */
  ::-webkit-scrollbar {
    display: none;
  }
  
  /* 去除所有hover放大效果 */
  * {
    -webkit-tap-highlight-color: transparent;
  }
  </style>