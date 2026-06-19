<template>
  <div class="admin-shell">
    <div v-if="debugMode" class="debug-banner">⚠ DEBUG MODE — 调试模式已启用 · 模拟撮合/跳过风控生效中</div>

    <!-- Top bar -->
    <header class="admin-topbar topbar">
      <div class="topbar-left">
        <router-link to="/admin/trade" class="topbar-brand">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none">
            <rect x="2" y="2" width="20" height="20" rx="5" fill="currentColor"/>
            <path d="M7 14l3-3 3 3 4-6" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
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
          <span class="mono clock-text">{{ nowText }}</span>
        </nav>
      </div>

      <div class="topbar-right">
        <div class="topbar-stats admin-metrics">
          <div class="t-stat admin-metric">
            <span class="t-stat-label admin-metric-label">总资产</span>
            <span class="t-stat-value admin-metric-value mono num-strong">¥{{ formatMoney(store.dashboard.total) }}</span>
          </div>
          <div class="t-stat admin-metric">
            <span class="t-stat-label admin-metric-label">可用</span>
            <span class="t-stat-value admin-metric-value mono num-strong">¥{{ formatMoney(store.dashboard.available) }}</span>
          </div>
          <div class="t-stat admin-metric">
            <span class="t-stat-label admin-metric-label">冻结</span>
            <span class="t-stat-value admin-metric-value mono text-muted">¥{{ formatMoney(store.dashboard.frozen) }}</span>
          </div>
          <div class="t-stat admin-metric">
            <span class="t-stat-label admin-metric-label">挂单</span>
            <span class="t-stat-value admin-metric-value mono num-strong">{{ store.pendingOrders.length }}</span>
          </div>
        </div>

        <button class="btn btn-secondary btn-sm" @click="refresh" :disabled="store.loadingAdmin" aria-label="刷新">
          <svg viewBox="0 0 16 16" width="13" height="13" fill="none">
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
            <button class="user-menu-item" @click="toggleDebug">{{ debugMode ? '🔴 退出调试模式' : '🔧 启用调试模式' }}</button>
            <button class="user-menu-item" @click="goVisitor">访问公开页</button>
            <button class="user-menu-item danger" @click="logout">退出登录</button>
          </div>
        </div>
      </div>
    </header>

    <div class="admin-body">
      <!-- Side nav (IconPark 风格) -->
      <aside class="admin-sidenav sidenav">
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
const debugMode = ref(false);

const marketState = computed(() => (isTradingSession() ? 'open' : 'closed'));

// IconPark 风格图标（线条 + 圆角 + 现代）
const tabs = [
  {
    path: '/admin/trade',
    label: '交易',
    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 17l5-5 4 4 8-9"/><path d="M14 7h6v6"/></svg>'
  },
  {
    path: '/admin/orders',
    label: '订单',
    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="4" width="16" height="16" rx="2"/><path d="M8 9h8M8 13h8M8 17h5"/></svg>'
  },
  {
    path: '/admin/holdings',
    label: '持仓',
    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20V10m5 10V4m5 16v-7m5 7v-3"/><circle cx="9" cy="4" r="1.2" fill="currentColor"/></svg>'
  },
  {
    path: '/admin/reports',
    label: '报告',
    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3h9l4 4v13a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z"/><path d="M15 3v4h4M8 12h8M8 16h6"/></svg>'
  },
  {
    path: '/admin/ai',
    label: 'AI 决策',
    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"/><circle cx="12" cy="12" r="4"/><circle cx="12" cy="12" r="1.5" fill="currentColor"/></svg>'
  },
  {
    path: '/admin/audit',
    label: '审计',
    icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2l8 4v6c0 5-3.5 9-8 10-4.5-1-8-5-8-10V6l8-4z"/><path d="M9 12l2 2 4-4"/></svg>'
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

const toggleDebug = () => {
  showMenu.value = false;
  const key = (typeof window !== 'undefined' ? window.prompt('请输入 Debug 密钥：') : '') || '';
  if (!key) return;
  if (key === localStorage.getItem('__debug_key')) {
    debugMode.value = !debugMode.value;
    document.documentElement.classList.toggle('debug-mode', debugMode.value);
    store.fetchAdminData(false).catch(() => {});
    return;
  }
  if (typeof window !== 'undefined') {
    fetch('/api/admin/debug/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Debug-Key': key }
    })
      .then(r => r.json())
      .then((d: any) => {
        if (d?.code === 0) {
          debugMode.value = true;
          document.documentElement.classList.add('debug-mode');
          localStorage.setItem('__debug_key', key);
          store.fetchAdminData(false).catch(() => {});
        } else {
          window.alert('密钥错误，无法启用调试模式');
        }
      })
      .catch(() => window.alert('校验失败'));
  }
};

const vClickOutside = (e: MouseEvent) => {
  if (showMenu.value) showMenu.value = false;
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
  // Restore debug mode if key cached
  const cachedKey = localStorage.getItem('__debug_key');
  if (cachedKey) {
    fetch('/api/admin/debug/verify', {
      method: 'POST',
      headers: { 'X-Debug-Key': cachedKey }
    })
      .then(r => r.json())
      .then((d: any) => {
        if (d?.code === 0) {
          debugMode.value = true;
          document.documentElement.classList.add('debug-mode');
        } else {
          localStorage.removeItem('__debug_key');
        }
      })
      .catch(() => {});
  }
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
.admin-topbar {
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
  min-width: 0;
}
.topbar-left {
  display: flex;
  align-items: center;
  gap: 16px;
  min-width: 0;
  flex-shrink: 1;
}
.topbar-brand {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  color: var(--text-strong);
  flex-shrink: 0;
}
.topbar-brand svg { flex-shrink: 0; }
.topbar-brand-name {
  font-size: 14px;
  font-weight: 800;
  letter-spacing: -0.01em;
  white-space: nowrap;
}
.topbar-brand-sub {
  font-size: 11px;
  font-weight: 500;
  color: var(--text-muted);
  letter-spacing: 0.04em;
  padding-left: 8px;
  margin-left: 8px;
  border-left: 1px solid var(--line);
  white-space: nowrap;
}
.topbar-meta {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: var(--text-soft);
  min-width: 0;
  white-space: nowrap;
}
.meta-sep { color: var(--text-faint); }
.clock-text { white-space: nowrap; }

.status-pill {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 24px;
  padding: 0 9px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 700;
  background: var(--bg-inset);
  color: var(--text-soft);
  border: 1px solid var(--line-soft);
  white-space: nowrap;
  flex-shrink: 0;
}
.status-pill .status-dot { width: 6px; height: 6px; border-radius: 999px; }
.status-pill[data-state="open"] { background: var(--up-soft); color: var(--up); border-color: var(--up-line); }
.status-pill[data-state="open"] .status-dot { background: var(--up); }
.status-pill[data-state="closed"] { background: var(--bg-inset); color: var(--text-muted); }
.status-pill[data-state="closed"] .status-dot { background: var(--text-muted); }

.topbar-right {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}
.admin-metrics {
  display: flex;
  align-items: stretch;
  gap: 0;
  margin-right: 8px;
  border: 1px solid var(--line);
  border-radius: var(--r-sm);
  overflow: hidden;
  background: var(--bg-subtle);
}
.admin-metric {
  display: flex;
  flex-direction: column;
  gap: 1px;
  padding: 4px 12px;
  border-right: 1px solid var(--line-soft);
  min-width: 0;
}
.admin-metric:last-child { border-right: 0; }
.admin-metric-label {
  font-size: 10px;
  color: var(--text-muted);
  letter-spacing: 0.04em;
  font-weight: 600;
  text-transform: uppercase;
  white-space: nowrap;
}
.admin-metric-value {
  font-size: 13px;
  font-weight: 700;
  color: var(--text-strong);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.topbar-user { position: relative; }
.user-avatar {
  width: 32px;
  height: 32px;
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
  width: 220px;
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
.admin-sidenav {
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
.admin-sidenav nav {
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
  white-space: nowrap;
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

/* ===== Tablet ===== */
@media (min-width: 721px) and (max-width: 980px) {
  .admin-body { grid-template-columns: 1fr; }
  .admin-sidenav {
    position: sticky;
    top: var(--topbar-h);
    height: auto;
    border-right: 0;
    border-bottom: 1px solid var(--line);
  }
  .admin-sidenav nav {
    flex-direction: row;
    overflow-x: auto;
  }
  .admin-sidenav .sidenav-foot { display: none; }
}

/* ===== Mobile ===== */
@media (max-width: 720px) {
  .admin-body { grid-template-columns: 1fr; }
  .admin-sidenav {
    position: sticky;
    top: var(--topbar-h);
    height: auto;
    border-right: 0;
    border-bottom: 1px solid var(--line);
    padding: 6px;
  }
  .admin-sidenav nav {
    flex-direction: row;
    overflow-x: auto;
    overflow-y: hidden;
    gap: 4px;
    -webkit-overflow-scrolling: touch;
    scrollbar-width: none;
  }
  .admin-sidenav nav::-webkit-scrollbar { display: none; }
  .admin-sidenav .sidenav-foot { display: none; }
  .admin-metrics { margin-right: 4px; }
  .admin-metric { padding: 4px 8px; min-width: 0; }
  .admin-metric-label { font-size: 9px; }
  .admin-metric-value { font-size: 12px; }
  .topbar-brand-sub { display: none; }
  .topbar-meta .clock-text { display: none; }
  .admin-main { padding: 12px; }
}

@media (max-width: 480px) {
  .admin-topbar {
    flex-wrap: wrap;
    height: auto;
    padding: 8px 10px;
    gap: 6px;
  }
  .topbar-left { width: 100%; min-width: 0; gap: 8px; }
  .topbar-right { width: 100%; min-width: 0; gap: 6px; }
  .admin-metrics {
    flex: 1;
    margin-right: 0;
    overflow-x: auto;
    overflow-y: hidden;
    scrollbar-width: none;
  }
  .admin-metrics::-webkit-scrollbar { display: none; }
  .admin-metric { flex: 0 0 auto; min-width: 70px; padding: 4px 6px; }
  .admin-metric-label { font-size: 9px; }
  .admin-metric-value { font-size: 11px; }
  .topbar-right { flex-wrap: nowrap; }
  .topbar-brand-name { font-size: 13px; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .topbar-brand svg { width: 18px !important; height: 18px !important; }
  .topbar-meta { gap: 6px; min-width: 0; flex: 1; }
  .topbar-meta .status-pill { font-size: 10px; padding: 0 7px; }
  .topbar-meta .clock-text { display: none; }
  .user-avatar { width: 28px; height: 28px; font-size: 11px; }
}
</style>