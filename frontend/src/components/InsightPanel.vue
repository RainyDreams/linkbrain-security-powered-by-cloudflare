<template>
  <section class="glass-card p-3">
    <div class="flex items-center justify-between">
      <h3 class="panel-title">{{ title }}</h3>
    </div>

    <div class="mt-2 space-y-2">
      <article v-for="(item, idx) in items" :key="idx" class="prompt-card">
        <div class="flex items-start gap-2">
          <span class="mt-0.5 h-2 w-2 shrink-0 rounded-full" :class="dotClass[item.level || 'info']"></span>
          <div>
            <div class="prompt-title">{{ item.title }}</div>
            <p class="prompt-body">{{ item.text }}</p>
          </div>
        </div>
      </article>
    </div>
  </section>
</template>

<script setup lang="ts">
interface InsightItem {
  title: string;
  text: string;
  level?: 'info' | 'risk' | 'ok';
}

defineProps<{
  title: string;
  items: InsightItem[];
}>();

const dotClass = {
  info: 'bg-[var(--tg-blue)]',
  risk: 'bg-[var(--warn)]',
  ok: 'bg-[var(--openai-teal)]'
};
</script>
