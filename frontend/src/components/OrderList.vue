<template>
  <div class="glass-card overflow-hidden">
    <div class="flex items-center justify-between border-b border-[var(--line)] px-4 py-3">
      <h3 class="panel-title">委托列表</h3>
      <span class="text-xs text-slate-500">{{ orders.length }} 条</span>
    </div>

    <div v-if="orders.length === 0" class="px-4 py-10 text-center text-sm text-slate-500">暂无委托记录</div>

    <div v-else>
      <div class="space-y-2 p-3 md:hidden">
        <article v-for="o in orders" :key="o.id" class="surface-soft p-3">
          <div class="flex items-center justify-between gap-2">
            <div>
              <div class="text-sm font-semibold text-slate-800">{{ o.name || '--' }}</div>
              <div class="font-mono text-[11px] text-slate-500">{{ o.symbol }}</div>
            </div>
            <span :class="orderStatusClass(o.status)">{{ orderStatusText(o.status) }}</span>
          </div>

          <div class="mt-2 grid grid-cols-2 gap-y-1 text-xs text-slate-600">
            <div>方向/价格</div>
            <div class="text-right font-mono" :class="o.side === 'BUY' ? 'text-[var(--danger)]' : 'text-[var(--ok)]'">
              {{ o.side === 'BUY' ? '买' : '卖' }} {{ o.price }}
            </div>
            <div>数量/已成</div>
            <div class="text-right font-mono">{{ o.qty }} / {{ o.filled_qty }}</div>
            <div>时间</div>
            <div class="text-right font-mono">{{ o.time || '--' }}</div>
          </div>

          <div class="mt-3 text-right">
            <button
              v-if="canCancel && (o.status === 'PENDING' || o.status === 'MATCHING')"
              class="rounded-lg border border-blue-300 px-3 py-1.5 text-xs font-semibold text-blue-700"
              @click="$emit('cancel', o.id)"
            >
              撤单
            </button>
          </div>
        </article>
      </div>

      <div class="hidden overflow-x-auto scrollbar-thin md:block">
        <table class="min-w-full text-sm">
          <thead class="data-table-head">
            <tr>
              <th class="px-4 py-3 text-left">标的</th>
              <th class="px-4 py-3 text-right">委托</th>
              <th class="px-4 py-3 text-right">已成</th>
              <th class="px-4 py-3 text-center">状态</th>
              <th class="px-4 py-3 text-right">时间</th>
              <th class="px-4 py-3 text-right">操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="o in orders" :key="o.id" class="border-t border-[var(--line)]/70">
              <td class="px-4 py-3">
                <div class="font-semibold text-slate-800">{{ o.name || '--' }}</div>
                <div class="font-mono text-xs text-slate-500">{{ o.symbol }}</div>
              </td>
              <td class="px-4 py-3 text-right font-mono" :class="o.side === 'BUY' ? 'text-[var(--danger)]' : 'text-[var(--ok)]'">
                {{ o.side === 'BUY' ? '买' : '卖' }} {{ o.price }} × {{ o.qty }}
              </td>
              <td class="px-4 py-3 text-right font-mono text-slate-700">{{ o.filled_qty }}</td>
              <td class="px-4 py-3 text-center">
                <span :class="orderStatusClass(o.status)">{{ orderStatusText(o.status) }}</span>
              </td>
              <td class="px-4 py-3 text-right font-mono text-xs text-slate-600">{{ o.time || '--' }}</td>
              <td class="px-4 py-3 text-right">
                <button
                  v-if="canCancel && (o.status === 'PENDING' || o.status === 'MATCHING')"
                  class="rounded-lg border border-blue-300 px-3 py-1.5 text-xs font-semibold text-blue-700 transition hover:bg-blue-50"
                  @click="$emit('cancel', o.id)"
                >
                  撤单
                </button>
                <span v-else class="text-xs text-slate-400">--</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { orderStatusClass, orderStatusText } from '../utils/format';

defineProps<{
  orders: any[];
  canCancel?: boolean;
}>();

defineEmits<{
  (e: 'cancel', id: number): void;
}>();
</script>
