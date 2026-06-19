<template>
  <div class="admin-shell">
    <!-- Top bar -->
    <header class="topbar">
      <div class="topbar-left">
        <router-link to="/admin/trade" class="topbar-brand">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none">
            <path d="M3 17l4-6 4 4 5-7 5 9" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
          <span class="topbar-brand-name">Zero Ben</span>
          <span class="topbar-brand-sub">Trading Terminal</span>
        </router-link>

        <nav class="topbar-meta">
          <span class="status-pill" :data-state="marketState">
            <span class="status-dot" :class="marketState"></span>
            {{ marketState === 'open' ? '交易时段' : '非交易时段' }}
          </span>
          <span class="meta-sep">·</span>
          <span class="mono">{{ nowText }}</span>
        </nav>
      </div>

      <div class="topbar-right">
        <div class="topbar-stats" v-if="!isMobile">
          <div class="t-stat">
            <span class="t-stat-label">总资产</span>
            <span class="t-stat-value mono num-strong">¥{{ formatMoney(store.dashboard.total) }}</span>
          </div>
          <div class="t-stat">
            <span class="t-stat-label">可用</span>
            <span class="t-stat-value mono num-strong">¥{{ formatMoney(store.dashboard.available) }}</span>
          </div>
          <div class="t-stat">
            <span class="t-stat-label">冻结</span>
            <span class="t-stat-value mono text-muted">¥{{ formatMoney(store.dashboard.frozen) }}</span>
          </div>
          <div class="t-stat">
            <span class="t-stat-label">挂单</span>
            <span class="t-stat-value mono num-strong">{{ store.pendingOrders.length }}</span>
          </div>
        </div>

        <button class="btn btn-secondary btn-sm" @click="refresh" :disabled="store.loadingAdmin">
          <svg viewBox="0 0 16 16" width="12" height="12" fill="none">
            <path d="M2 8a6 6 0 0 1 10.5-4M14 8A6 6 0 0 1 3.5 12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
            <path d="M12 1v3h-3M4 15v-3h3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
          <span>刷新</span>
        </button>
        <button class="btn btn-secondary btn-sm" @click="goVisitor">公开页</button>
        <div class="topbar-user">
          <div class="user-avatar" @click.stop="showMenu = !showMenu">A</div>
          <div v-if="showMenu" class="user-menu" @click.stop>
            <div class="user-menu-info">
              <strong>管理员</strong>
              <span class="mono">admin</span>
            </div>
            <hr/>
            <button class="user-menu-item" @click="goVisitor">访问公开页</button>
            <button class="user-menu-item danger" @click="logout">退出登录</button>
          </div>
        </div>
      </div>
    </header>

    <div class="admin-body">
      <!-- Side nav -->
      <aside class="sidenav">
        <nav>
          <router-link
            v-for="tab in tabs"
            :key="tab.path"
            :to="tab.path"
            class="side-item"
            :class="{ active: isActive(tab.path) }"
          >
            <span class="side-icon" v-html="tab.icon"></span>
            <span class="side-label">{{ tab.label }}</span>
            <span v-if="tab.badge" class="tag tag-brand side-badge">{{ tab.badge }}</span>
          </router-link>
        </nav>

        <div class="sidenav-foot">
          <button class="btn btn-ghost btn-block" @click="goVisitor">
            <svg viewBox="0 0 16 16" width="13" height="13" fill="none">
              <path d="M9 3h4v10H9M3 8h6m0 0L6 5m3 3L6 11" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
            <span>公开看板</span>
          </button>
        </div>
      </aside>

      <!-- Main content -->
      <main class="admin-main">
        <router-view />
      </main>
    </div>
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

const nowText = ref(shanghaiNowText());
const isMobile = ref(typeof window !== 'undefined' ? window.innerWidth <= 720 : false);
const showMenu = ref(false);

const marketState = computed(() => (isTradingSession() ? 'open' : 'closed'));

const tabs = [
  {
    path: '/admin/trade',
    label: '交易',
    icon: '<svg viewBox="0 0 16 16" fill="none"><path d="M2 11l4-4 3 3 5-6M14 4h-3M14 4v3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>'
  },
  {
    path: '/admin/orders',
    label: '订单',
    icon: '<svg viewBox="0 0 16 16" fill="none"><rect x="2.5" y="2.5" width="11" height="11" rx="1.5" stroke="currentColor" stroke-width="1.4"/><path d="M5 6h6M5 9h6M5 12h4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>'
  },
  {
    path: '/admin/holdings',
    label: '持仓',
    icon: '<svg viewBox="0 0 16 16" fill="none"><path d="M3 12V6m4 6V3m4 9V8m2 4V5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>'
  },
  {
    path: '/admin/reports',
    label: '报告',
    icon: '<svg viewBox="0 0 16 16" fill="none"><path d="M3 2.5h7l3 3v8a.5.5 0 0 1-.5.5H3a.5.5 0 0 1-.5-.5V3a.5.5 0 0 1 .5-.5z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/><path d="M5 7h6M5 9.5h6M5 12h3" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>'
  },
  {
    path: '/admin/ai',
    label: 'AI 决策',
    icon: '<svg viewBox="0 0 16 16" fill="none"><path d="M8 2l1.6 3.4L13 7l-3.4 1.6L8 12l-1.6-3.4L3 7l3.4-1.6L8 2z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/></svg>'
  },
  {
    path: '/admin/audit',
    label: '审计',
    icon: '<svg viewBox="0 0 16 16" fill="none"><path d="M3 13l1.5-5L8 3l3.5 5 1.5 5H3z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/><path d="M6 13V9.5h4V13" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>'
  }
];

const isActive = (path: string) => route.path === path;

const refresh = async () => {
  await store.fetchAdminData(true);
};

const goVisitor = () => router.push('/');
const logout = () => {
  store.logout();
  router.push('/login');
};

const vClickOutside = (e: MouseEvent) => {
  showMenu.value = false;
};

let clockTimer: ReturnType<typeof setInterval> | null = null;
let pullTimer: ReturnType<typeof setInterval> | null = null;
let resizeHandler: (() => void) | null = null;

const onResize = () => {
  if (typeof window === 'undefined') return;
  isMobile.value = window.innerWidth <= 720;
};

onMounted(async () => {
  await store.fetchAdminData();
  clockTimer = setInterval(() => { nowText.value = shanghaiNowText(); }, 1000);
  pullTimer = setInterval(async () => {
    if (document.visibilityState !== 'visible') return;
    try { await store.fetchAdminData(false); } catch { /* ignore */ }
  }, 12000);
  resizeHandler = onResize;
  window.addEventListener('resize', onResize);
  document.addEventListener('click', vClickOutside);
});

onUnmounted(() => {
  if (clockTimer) clearInterval(clockTimer);
  if (pullTimer) clearInterval(pullTimer);
  if (resizeHandler) window.removeEventListener('resize', resizeHandler);
  document.removeEventListener('click', vClickOutside);
});
</script>

<style scoped>
.admin-shell {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  background: var(--bg);
}

/* ===== Top bar ===== */
.topbar {
  height: var(--topbar-h);
  background: var(--bg-elev);
  border-bottom: 1px solid var(--line);
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 16px;
  gap: 16px;
  position: sticky;
  top: 0;
  z-index: 30;
}
.topbar-left {
  display: flex;
  align-items: center;
  gap: 20px;
  min-width: 0;
}
.topbar-brand {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  color: var(--text-strong);
}
.topbar-brand svg {
  background: var(--text);
  color: #fff;
  border-radius: var(--r-sm);
  padding: 4px;
}
.topbar-brand-name {
  font-size: 14px;
  font-weight: 800;
  letter-spacing: -0.01em;
}
.topbar-brand-sub {
  font-size: 11px;
  font-weight: 500;
  color: var(--text-muted);
  letter-spacing: 0.04em;
  padding-left: 8px;
  margin-left: 8px;
  border-left: 1px solid var(--line);
}
.topbar-meta {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: var(--text-soft);
}
.meta-sep { color: var(--text-faint); }
.status-pill {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 22px;
  padding: 0 8px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 700;
  background: var(--bg-inset);
  color: var(--text-soft);
  border: 1px solid var(--line-soft);
}
.status-pill .status-dot {
  width: 6px; height: 6px; border-radius: 999px;
  background: var(--text-muted);
  position: relative;
}
.status-pill[data-state="open"] { background: var(--up-soft); color: var(--up); border-color: var(--up-line); }
.status-pill[data-state="open"] .status-dot { background: var(--up); }
.status-pill[data-state="open"] .status-dot::after {
  content: ''; position: absolute; inset: -3px; border-radius: 999px; background: var(--up); opacity: 0.22;
}
.status-pill[data-state="closed"] { background: var(--bg-inset); color: var(--text-muted); }

.topbar-right {
  display: flex;
  align-items: center;
  gap: 8px;
}
.topbar-stats {
  display: flex;
  align-items: stretch;
  gap: 0;
  margin-right: 8px;
  border: 1px solid var(--line);
  border-radius: var(--r-sm);
  overflow: hidden;
  background: var(--bg-subtle);
}
.t-stat {
  display: flex;
  flex-direction: column;
  gap: 1px;
  padding: 4px 12px;
  border-right: 1px solid var(--line-soft);
}
.t-stat:last-child { border-right: 0; }
.t-stat-label {
  font-size: 10px;
  color: var(--text-muted);
  letter-spacing: 0.04em;
  font-weight: 600;
  text-transform: uppercase;
}
.t-stat-value {
  font-size: 13px;
  font-weight: 700;
  color: var(--text-strong);
}

.topbar-user {
  position: relative;
}
.user-avatar {
  width: 30px;
  height: 30px;
  border-radius: 999px;
  background: var(--text);
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
  user-select: none;
}
.user-menu {
  position: absolute;
  right: 0;
  top: 38px;
  width: 200px;
  background: var(--bg-elev);
  border: 1px solid var(--line);
  border-radius: var(--r-md);
  box-shadow: var(--shadow-3);
  padding: 6px;
  z-index: 50;
}
.user-menu-info {
  padding: 8px 10px;
  display: flex;
  flex-direction: column;
  gap: 1px;
}
.user-menu-info strong { font-size: 12.5px; font-weight: 700; }
.user-menu-info span { font-size: 10.5px; color: var(--text-muted); }
.user-menu hr { border: 0; border-top: 1px solid var(--line-soft); margin: 4px 0; }
.user-menu-item {
  width: 100%;
  text-align: left;
  background: transparent;
  border: 0;
  padding: 7px 10px;
  font-size: 12.5px;
  color: var(--text);
  border-radius: var(--r-xs);
  cursor: pointer;
}
.user-menu-item:hover { background: var(--bg-inset); }
.user-menu-item.danger { color: var(--down); }
.user-menu-item.danger:hover { background: var(--down-soft); }

/* ===== Body / Side nav ===== */
.admin-body {
  flex: 1;
  display: grid;
  grid-template-columns: var(--sidenav-w) minmax(0, 1fr);
  min-height: 0;
}
.sidenav {
  background: var(--bg-elev);
  border-right: 1px solid var(--line);
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  position: sticky;
  top: var(--topbar-h);
  height: calc(100vh - var(--topbar-h));
}
.sidenav nav {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.side-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  border-radius: var(--r-sm);
  color: var(--text-soft);
  font-size: 12.5px;
  font-weight: 600;
  transition: background 0.1s ease, color 0.1s ease;
  border: 1px solid transparent;
}
.side-item:hover {
  background: var(--bg-subtle);
  color: var(--text);
}
.side-item.active {
  background: var(--text);
  color: #fff;
}
.side-icon {
  width: 18px;
  height: 18px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: currentColor;
  flex-shrink: 0;
}
.side-icon :deep(svg) {
  width: 18px;
  height: 18px;
}
.side-label { flex: 1; }
.side-badge { margin-left: auto; }
.side-item.active .side-badge { background: rgba(255,255,255,0.18); color: #fff; border-color: transparent; }
.sidenav-foot { margin-top: auto; }

.admin-main {
  padding: 18px;
  min-width: 0;
  max-width: 100%;
}

@media (max-width: 980px) {
  .admin-body { grid-template-columns: 1fr; }
  .sidenav {
    position: fixed;
    top: var(--topbar-h);
    bottom: 0;
    left: 0;
    width: 220px;
    z-index: 25;
    transform: translateX(-100%);
    transition: transform 0.18s ease;
  }
  .sidenav.is-open { transform: translateX(0); }
  .topbar-brand-sub { display: none; }
}

@media (max-width: 720px) {
  .topbar-stats { display: none; }
  .topbar-brand-sub { display: none; }
  .admin-main { padding: 12px; }
}
</style>
