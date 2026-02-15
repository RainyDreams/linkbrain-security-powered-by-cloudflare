<template>
  <div class="mx-auto flex min-h-screen w-full max-w-[1320px] flex-col px-3 pb-4 pt-3 md:px-6 md:pt-5">
    <header class="glass-card mb-3 px-4 py-3 md:px-5 fade-rise">
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p class="text-[11px] uppercase tracking-[0.22em] text-slate-500">Zero Ben · Trading Console</p>
          <h1 class="mt-1 text-xl font-extrabold text-slate-900">交易工作台</h1>
          <p class="text-xs text-slate-600">{{ nowText }} · {{ sessionText }}</p>
        </div>

        <div class="flex items-center gap-2">
          <button class="btn-solid btn-ghost" @click="refresh">刷新数据</button>
          <button class="btn-solid btn-ghost" @click="goVisitor">公开页</button>
          <button class="btn-solid bg-slate-800 text-white hover:bg-slate-700" @click="logout">退出登录</button>
        </div>
      </div>

      <div class="mt-3 flex flex-wrap items-center gap-2 text-[11px]">
        <span class="status-chip">挂单 {{ store.pendingOrders.length }} 笔</span>
        <span class="status-chip">可用资金 ¥{{ formatMoney(store.dashboard.available) }}</span>
        <span class="status-chip">冻结资金 ¥{{ formatMoney(store.dashboard.frozen) }}</span>
        <span v-if="store.lastUpdated" class="status-chip">最近刷新 {{ lastUpdatedText }}</span>
      </div>

      <nav class="mt-4 grid grid-cols-2 gap-2 text-sm font-semibold md:grid-cols-4">
        <router-link
          v-for="tab in tabs"
          :key="tab.path"
          :to="tab.path"
          class="rounded-xl border px-3 py-2 text-center transition"
          :class="isActive(tab.path)
            ? 'border-cyan-500 bg-cyan-50 text-cyan-700'
            : 'border-[var(--line)] bg-white/70 text-slate-600 hover:bg-white hover:text-slate-800'"
        >
          {{ tab.label }}
        </router-link>
      </nav>
    </header>

    <main class="flex-1 fade-rise">
      <router-view />
    </main>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useMarketStore } from '../../stores/market';
import { formatMoney, isTradingSession, shanghaiNowText } from '../../utils/format';

const route = useRoute();
const router = useRouter();
const store = useMarketStore();

const tabs = [
  { path: '/admin/buy', label: '买入委托' },
  { path: '/admin/sell', label: '卖出委托' },
  { path: '/admin/cancel', label: '撤单中心' },
  { path: '/admin/holdings', label: '持仓总览' }
];

const nowText = ref(shanghaiNowText());

const sessionText = computed(() => (isTradingSession() ? '交易时段（可撮合）' : '非交易时段（可挂单）'));
const lastUpdatedText = computed(() => {
  if (!store.lastUpdated) return '--';
  const d = new Date(store.lastUpdated);
  return d.toLocaleTimeString('zh-CN', { hour12: false });
});

const isActive = (path: string) => route.path === path;

const refresh = async () => {
  await store.fetchAdminData(true);
};

const goVisitor = () => router.push('/');

const logout = () => {
  store.logout();
  router.push('/login');
};

let timer: ReturnType<typeof setInterval> | null = null;

onMounted(async () => {
  await store.fetchAdminData();
  timer = setInterval(() => {
    nowText.value = shanghaiNowText();
  }, 1000);
});

onUnmounted(() => {
  if (timer) clearInterval(timer);
});
</script>
