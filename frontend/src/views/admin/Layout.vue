<template>
  <div class="admin-shell">
    <header class="admin-head glass-card">
      <div class="head-top">
        <div>
          <p class="brand-kicker">Zero Ben · Trading Terminal</p>
          <h1 class="brand-title">管理交易中枢</h1>
          <p class="head-sub">{{ nowText }} · {{ sessionText }}</p>
        </div>
        <div class="head-actions">
          <button class="btn-solid btn-ghost" @click="refresh">刷新</button>
          <button class="btn-solid btn-ghost hidden md:inline-flex" @click="goVisitor">公开页</button>
          <button class="btn-solid btn-primary" @click="logout">退出</button>
        </div>
      </div>

      <div class="head-metrics">
        <span class="status-chip">挂单 {{ store.pendingOrders.length }}</span>
        <span class="status-chip">可用 ¥{{ formatMoney(store.dashboard.available) }}</span>
        <span class="status-chip">冻结 ¥{{ formatMoney(store.dashboard.frozen) }}</span>
        <span class="status-chip">总资产 ¥{{ formatMoney(store.dashboard.total) }}</span>
        <span v-if="store.lastUpdated" class="status-chip hidden sm:inline-flex">更新 {{ lastUpdatedText }}</span>
      </div>

      <nav class="tab-nav">
        <router-link
          v-for="tab in tabs"
          :key="tab.path"
          :to="tab.path"
          class="tab-item"
          :class="isActive(tab.path) ? 'active' : ''"
        >
          {{ tab.label }}
        </router-link>
      </nav>
    </header>

    <main class="fade-rise">
      <router-view />
    </main>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useMarketStore } from '../../stores/market';
import { formatMoney, isTradingSession, shanghaiNowText } from '../../utils/format';
import { notifyInfo } from '../../utils/notify';

const route = useRoute();
const router = useRouter();
const store = useMarketStore();

const tabs = [
  { path: '/admin/buy', label: '买入委托' },
  { path: '/admin/sell', label: '卖出委托' },
  { path: '/admin/cancel', label: '撤单中心' },
  { path: '/admin/holdings', label: '持仓资金' }
];

const nowText = ref(shanghaiNowText());
const sessionText = computed(() => (isTradingSession() ? '交易时段，可实时撮合' : '非交易时段，可挂单待撮合'));
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

let clockTimer: ReturnType<typeof setInterval> | null = null;
let pullTimer: ReturnType<typeof setInterval> | null = null;

onMounted(async () => {
  await store.fetchAdminData();

  clockTimer = setInterval(() => {
    nowText.value = shanghaiNowText();
  }, 1000);

  pullTimer = setInterval(async () => {
    if (document.visibilityState !== 'visible') return;
    try {
      await store.fetchAdminData(false);
    } catch {
      // ignore periodic polling errors; interceptor already handles notices.
    }
  }, 10000);

  notifyInfo('管理终端已就绪', '系统已开启自动同步（10秒轮询）。', '若需立即更新，可点击“刷新”。', 2200);
});

onUnmounted(() => {
  if (clockTimer) clearInterval(clockTimer);
  if (pullTimer) clearInterval(pullTimer);
});
</script>

<style scoped>
.admin-shell {
  min-height: 100vh;
  width: 100%;
  max-width: 1280px;
  margin: 0 auto;
  padding: 12px;
  display: grid;
  gap: 12px;
}

.admin-head {
  position: sticky;
  top: 8px;
  z-index: 25;
  padding: 12px;
}

.head-top {
  display: flex;
  justify-content: space-between;
  gap: 10px;
}

.brand-kicker {
  margin: 0;
  font-size: 10px;
  letter-spacing: 0.22em;
  text-transform: uppercase;
  color: var(--text-muted);
}

.brand-title {
  margin: 6px 0 0;
  font-size: 21px;
  font-weight: 900;
  line-height: 1.2;
}

.head-sub {
  margin: 4px 0 0;
  font-size: 12px;
  color: var(--text-soft);
}

.head-actions {
  display: flex;
  gap: 6px;
  align-items: flex-start;
}

.head-metrics {
  margin-top: 10px;
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.tab-nav {
  margin-top: 10px;
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 6px;
}

.tab-item {
  border: 1px solid var(--line);
  border-radius: 10px;
  text-align: center;
  padding: 9px 6px;
  font-size: 12px;
  font-weight: 700;
  color: var(--text-soft);
  background: #fff;
  transition: all 0.2s ease;
}

.tab-item.active {
  border-color: #b2ddff;
  background: #eff8ff;
  color: #175cd3;
}

@media (max-width: 768px) {
  .head-top {
    align-items: flex-start;
  }

  .brand-title {
    font-size: 18px;
  }

  .head-actions {
    flex-wrap: wrap;
    justify-content: flex-end;
  }
}

@media (min-width: 920px) {
  .admin-shell {
    padding: 16px 20px;
  }

  .admin-head {
    padding: 14px 16px;
  }

  .tab-item {
    padding: 10px 8px;
    font-size: 13px;
  }
}
</style>
