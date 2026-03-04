<template>
  <div class="admin-shell">
    <aside class="admin-side glass-card">
      <div class="side-brand">
        <p class="brand-kicker">Zero Ben · Trading Terminal</p>
        <h1 class="brand-title">管理交易中枢</h1>
        <p class="head-sub hide-mobile">{{ nowText }} · {{ sessionText }}</p>
      </div>

      <nav class="side-nav">
        <router-link
          v-for="tab in tabs"
          :key="tab.path"
          :to="tab.path"
          class="side-tab"
          :class="isActive(tab.path) ? 'active' : ''"
        >
          {{ tab.label }}
        </router-link>
      </nav>

      <div class="side-metrics">
        <div class="metric-tile">
          <span>挂单</span>
          <strong>{{ store.pendingOrders.length }}</strong>
        </div>
        <div class="metric-tile">
          <span>可用</span>
          <strong>¥{{ formatMoney(store.dashboard.available) }}</strong>
        </div>
        <div class="metric-tile">
          <span>冻结</span>
          <strong>¥{{ formatMoney(store.dashboard.frozen) }}</strong>
        </div>
        <div class="metric-tile">
          <span>总资产</span>
          <strong>¥{{ formatMoney(store.dashboard.total) }}</strong>
        </div>
        <div v-if="store.lastUpdated" class="metric-time">更新 {{ lastUpdatedText }}</div>
      </div>

      <div class="side-actions">
        <button class="btn-solid btn-ghost" @click="refresh">刷新</button>
        <button class="btn-solid btn-ghost" @click="goVisitor">公开页</button>
        <button class="btn-solid btn-primary" @click="logout">退出</button>
      </div>
    </aside>

    <div class="admin-main">
      <header class="admin-head glass-card">
        <div class="head-top">
          <div>
            <p class="head-title">交易管理台</p>
            <p class="head-sub hide-mobile">{{ nowText }} · {{ sessionText }}</p>
          </div>
          <div class="head-actions">
            <button class="btn-solid btn-ghost sm:hidden" @click="mobileMetricExpanded = !mobileMetricExpanded">
              {{ mobileMetricExpanded ? '收起指标' : '展开指标' }}
            </button>
            <button class="btn-solid btn-ghost" @click="refresh">刷新</button>
            <button class="btn-solid btn-ghost hidden sm:inline-flex" @click="goVisitor">公开页</button>
            <button class="btn-solid btn-primary" @click="logout">退出</button>
          </div>
        </div>

        <div v-show="!isMobileCompact || mobileMetricExpanded" class="head-metrics">
          <span class="status-chip">挂单 {{ store.pendingOrders.length }}</span>
          <span class="status-chip">可用 ¥{{ formatMoney(store.dashboard.available) }}</span>
          <span class="status-chip">冻结 ¥{{ formatMoney(store.dashboard.frozen) }}</span>
          <span class="status-chip">总资产 ¥{{ formatMoney(store.dashboard.total) }}</span>
          <span v-if="store.lastUpdated" class="status-chip hidden sm:inline-flex">更新 {{ lastUpdatedText }}</span>
        </div>
      </header>

      <main class="fade-rise">
        <router-view />
      </main>
    </div>

    <nav class="bottom-nav">
      <router-link
        v-for="tab in tabs"
        :key="tab.path"
        :to="tab.path"
        class="bottom-tab"
        :class="isActive(tab.path) ? 'active' : ''"
      >
        {{ tab.short || tab.label }}
      </router-link>
    </nav>
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
  { path: '/admin/trade', label: '交易执行', short: '交易' },
  { path: '/admin/reports', label: '交易报告', short: '报告' },
  { path: '/admin/orders', label: '订单中心', short: '订单' },
  { path: '/admin/holdings', label: '持仓资金', short: '持仓' },
  { path: '/admin/ai', label: 'AI决策室', short: 'AI' },
  { path: '/admin/audit', label: '审计风控', short: '审控' }
];

const nowText = ref(shanghaiNowText());
const isMobileCompact = ref(typeof window !== 'undefined' ? window.innerWidth <= 640 : false);
const mobileMetricExpanded = ref(false);
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

const syncMobileLayout = () => {
  if (typeof window === 'undefined') return;
  isMobileCompact.value = window.innerWidth <= 640;
  if (!isMobileCompact.value) mobileMetricExpanded.value = true;
};

onMounted(async () => {
  await store.fetchAdminData();
  syncMobileLayout();

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

  window.addEventListener('resize', syncMobileLayout);
});

onUnmounted(() => {
  if (clockTimer) clearInterval(clockTimer);
  if (pullTimer) clearInterval(pullTimer);
  window.removeEventListener('resize', syncMobileLayout);
});
</script>

<style scoped>
.admin-shell {
  min-height: 100vh;
  width: 100%;
  max-width: 1560px;
  margin: 0 auto;
  padding: 8px 8px calc(72px + env(safe-area-inset-bottom));
  display: grid;
  gap: 8px;
}

.admin-side {
  display: none;
  padding: 12px;
  gap: 12px;
}

.side-brand {
  display: grid;
  gap: 4px;
}

.brand-kicker {
  margin: 0;
  font-size: 10px;
  letter-spacing: 0.22em;
  text-transform: uppercase;
  color: var(--text-muted);
}

.brand-title {
  margin: 0;
  font-size: 18px;
  font-weight: 900;
  line-height: 1.2;
}

.head-sub {
  margin: 0;
  font-size: 12px;
  color: var(--text-soft);
}

.side-nav {
  display: grid;
  gap: 8px;
}

.side-tab {
  border: 1px solid var(--line);
  border-radius: var(--radius-sm);
  padding: 9px 10px;
  font-size: 12px;
  font-weight: 700;
  color: var(--text-soft);
  background: #fff;
  transition: all 0.2s ease;
}

.side-tab:hover {
  border-color: #c9d5e4;
  background: #f8fafc;
}

.side-tab.active {
  border-color: rgba(16, 163, 127, 0.4);
  color: #0f766e;
  background: rgba(16, 163, 127, 0.1);
}

.side-metrics {
  display: grid;
  gap: 8px;
}

.metric-tile {
  border: 1px solid var(--line);
  border-radius: var(--radius-sm);
  background: var(--surface-soft);
  padding: 6px 8px;
  display: flex;
  justify-content: space-between;
  gap: 8px;
  font-size: 11px;
  color: var(--text-soft);
}

.metric-tile strong {
  font-size: 13px;
  color: var(--text);
}

.metric-time {
  font-size: 11px;
  color: var(--text-muted);
}

.side-actions {
  margin-top: auto;
  display: grid;
  gap: 8px;
}

.admin-main {
  display: grid;
  gap: 12px;
}

.admin-head {
  position: sticky;
  top: 6px;
  z-index: 25;
  padding: 10px;
  display: grid;
  gap: 10px;
  background: linear-gradient(180deg, #ffffff 0%, #fbfdff 100%);
}

.head-top {
  display: flex;
  justify-content: space-between;
  gap: 10px;
}

.head-title {
  margin: 0;
  font-size: 14px;
  font-weight: 800;
  letter-spacing: 0.03em;
}

.head-actions {
  display: flex;
  gap: 6px;
  align-items: flex-start;
}

.head-metrics {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.bottom-nav {
  position: fixed;
  left: 8px;
  right: 8px;
  bottom: calc(6px + env(safe-area-inset-bottom));
  display: grid;
  grid-template-columns: repeat(6, minmax(0, 1fr));
  gap: 4px;
  padding: 6px;
  background: rgba(255, 255, 255, 0.96);
  border: 1px solid var(--line);
  border-radius: var(--radius-lg);
  box-shadow: 0 8px 22px rgba(15, 23, 42, 0.12);
  z-index: 30;
  backdrop-filter: blur(10px);
}

.bottom-tab {
  border: 1px solid var(--line);
  border-radius: var(--radius-sm);
  text-align: center;
  padding: 6px 4px;
  font-size: 10px;
  font-weight: 700;
  color: var(--text-soft);
  background: #fff;
}

.bottom-tab:hover {
  border-color: #c9d5e4;
  background: #f8fafc;
}

.bottom-tab.active {
  border-color: rgba(16, 163, 127, 0.4);
  background: rgba(16, 163, 127, 0.1);
  color: #0f766e;
}

@media (min-width: 1080px) {
  .admin-shell {
    grid-template-columns: 240px minmax(0, 1fr);
    padding: 12px 16px;
  }

  .admin-side {
    display: grid;
    position: sticky;
    top: 16px;
    height: fit-content;
  }

  .admin-head {
    padding: 12px 14px;
  }

  .head-top {
    display: none;
  }

  .bottom-nav {
    display: none;
  }
}

@media (max-width: 640px) {
  .head-actions {
    flex-wrap: wrap;
    justify-content: flex-end;
  }

  .head-metrics {
    overflow-x: auto;
    padding-bottom: 4px;
  }
}
</style>
