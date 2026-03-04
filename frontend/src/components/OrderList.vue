<template>
  <div class="glass-card overflow-hidden">
    <div class="flex items-center justify-between border-b border-[var(--line)] px-3 py-2">
      <h3 class="panel-title">委托列表</h3>
      <span class="text-xs text-slate-500">{{ orders.length }} 条</span>
    </div>

    <div v-if="orders.length === 0" class="px-3 py-8 text-center text-xs text-slate-500">暂无委托记录</div>

    <div v-else>
      <div class="space-y-2 p-2 md:hidden">
        <article
          v-for="o in orders"
          :key="o.id"
          class="surface-soft p-2 order-card"
          :class="o.side === 'BUY' ? 'buy' : 'sell'"
        >
          <div class="flex items-center justify-between gap-2">
            <div>
              <div class="text-[13px] font-semibold text-slate-800">{{ o.name || '--' }}</div>
              <div class="font-mono text-[10px] text-slate-500">{{ o.symbol }}</div>
            </div>
            <span :class="orderStatusClass(o.status)">{{ orderStatusText(o.status) }}</span>
          </div>

          <div class="mt-2 grid grid-cols-2 gap-y-1 text-[11px] text-slate-600">
            <div>方向/价格</div>
            <div class="text-right font-mono" :class="o.side === 'BUY' ? 'text-[var(--danger)]' : 'text-[var(--ok)]'">
              {{ o.side === 'BUY' ? '买' : '卖' }} {{ o.price }}
            </div>
            <div>数量/已成</div>
            <div class="text-right font-mono">{{ o.qty }} / {{ o.filled_qty }}</div>
            <div>时间</div>
            <div class="text-right font-mono">{{ o.time || '--' }}</div>
            <div>策略</div>
            <div class="text-right">{{ strategyText(o.strategy_tag) }}</div>
          </div>
          <p v-if="o.remark" class="mt-2 line-clamp-3 rounded-sm border border-[var(--line)] bg-white/70 px-2 py-1 text-[11px] text-slate-600">
            {{ o.remark }}
          </p>

          <div class="mt-2 text-right">
            <button
              v-if="canCancel && o.status === 'PENDING'"
              class="rounded-sm border border-[var(--line-strong)] px-2.5 py-1 text-[11px] font-semibold text-[var(--brand-deep)]"
              @click="$emit('cancel', o.id)"
            >
              撤单
            </button>
          </div>
        </article>
      </div>

      <div class="hidden overflow-x-auto scrollbar-thin md:block">
        <table class="min-w-full table-dense text-[12px]">
          <thead class="data-table-head">
            <tr>
              <th class="px-4 py-3 text-left">标的</th>
              <th class="px-4 py-3 text-right">委托</th>
              <th class="px-4 py-3 text-right">已成</th>
              <th class="px-4 py-3 text-center">策略</th>
              <th class="px-4 py-3 text-center">状态</th>
              <th class="px-4 py-3 text-left">备注</th>
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
              <td class="px-4 py-3 text-center text-[11px] text-slate-700">{{ strategyText(o.strategy_tag) }}</td>
              <td class="px-4 py-3 text-center">
                <span :class="orderStatusClass(o.status)">{{ orderStatusText(o.status) }}</span>
              </td>
              <td class="px-4 py-3 text-xs text-slate-600 max-w-[280px]">
                <span class="line-clamp-2">{{ o.remark || '--' }}</span>
              </td>
              <td class="px-4 py-3 text-right font-mono text-xs text-slate-600">{{ o.time || '--' }}</td>
              <td class="px-4 py-3 text-right">
                <button
                  v-if="canCancel && o.status === 'PENDING'"
                  class="rounded-sm border border-[var(--line-strong)] px-3 py-1.5 text-xs font-semibold text-[var(--brand-deep)] transition hover:bg-emerald-50"
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

const strategyText = (tag?: string) => {
  const raw = String(tag || '').toUpperCase();
  if (!raw) return '--';
  if (raw === 'LONG_STABLE') return '长期稳健';
  if (raw === 'SHORT_AGGRESSIVE') return '短期激进';
  if (raw === 'MID_BALANCED') return '中线均衡';
  return raw;
};

defineProps<{
  orders: any[];
  canCancel?: boolean;
}>();

defineEmits<{
  (e: 'cancel', id: number): void;
}>();
</script>

<style scoped>
.order-card {
  border-left: 3px solid #94a3b8;
}

.order-card.buy {
  border-left-color: var(--danger);
}

.order-card.sell {
  border-left-color: var(--ok);
}

.line-clamp-2,
.line-clamp-3 {
  display: -webkit-box;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.line-clamp-2 {
  -webkit-line-clamp: 2;
}

.line-clamp-3 {
  -webkit-line-clamp: 3;
}
</style>
