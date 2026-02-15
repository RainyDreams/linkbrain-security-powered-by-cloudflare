<template>
  <div class="pointer-events-none fixed right-4 top-4 z-[120] flex w-[min(94vw,430px)] flex-col gap-2">
    <transition-group name="toast" tag="div">
      <article
        v-for="item in noticeState.items"
        :key="item.id"
        class="pointer-events-auto overflow-hidden rounded-2xl border shadow-2xl backdrop-blur-md"
        :class="toastClass[item.type]"
      >
        <div class="flex items-start gap-3 p-3.5">
          <div class="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold" :class="iconClass[item.type]">
            {{ iconText[item.type] }}
          </div>

          <div class="flex-1">
            <div class="flex items-center justify-between gap-2">
              <h4 class="text-sm font-semibold leading-5">{{ item.title }}</h4>
              <span class="text-[11px] opacity-70">{{ formatClock(item.createdAt) }}</span>
            </div>
            <p v-if="item.message" class="mt-1 text-[13px] leading-5 opacity-90">{{ item.message }}</p>
            <p v-if="item.hint" class="mt-1 rounded-lg bg-black/5 px-2 py-1 text-[12px] leading-5">建议：{{ item.hint }}</p>

            <div class="mt-2 flex items-center justify-between">
              <span v-if="item.code" class="rounded-full border border-current/25 px-2 py-0.5 text-[11px]">Code {{ item.code }}</span>
              <button class="text-[11px] opacity-80 hover:opacity-100" @click="dismissNotice(item.id)">关闭</button>
            </div>
          </div>
        </div>
      </article>
    </transition-group>
  </div>
</template>

<script setup lang="ts">
import { dismissNotice, noticeState } from '../utils/notify';

const toastClass = {
  success: 'border-emerald-200/80 bg-emerald-50/95 text-emerald-900',
  error: 'border-rose-200/80 bg-rose-50/95 text-rose-900',
  info: 'border-sky-200/80 bg-sky-50/95 text-sky-900',
  warning: 'border-amber-200/80 bg-amber-50/95 text-amber-900'
};

const iconClass = {
  success: 'bg-emerald-100 text-emerald-700',
  error: 'bg-rose-100 text-rose-700',
  info: 'bg-sky-100 text-sky-700',
  warning: 'bg-amber-100 text-amber-700'
};

const iconText = {
  success: 'OK',
  error: '!',
  info: 'i',
  warning: '!'
};

const formatClock = (ts: number) => {
  const d = new Date(ts);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
};
</script>

<style scoped>
.toast-enter-active,
.toast-leave-active {
  transition: all 0.26s ease;
}

.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  transform: translateY(-10px) scale(0.97);
}
</style>
