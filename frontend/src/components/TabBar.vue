<template>
  <nav class="tabbar glass-card">
    <router-link v-for="item in items" :key="item.to" :to="item.to" custom v-slot="{ navigate, isActive }">
      <button class="tab-btn" :class="isActive ? 'active' : ''" @click="navigate">
        <span class="cn">{{ item.cn }}</span>
        <span class="en">{{ item.en }}</span>
      </button>
    </router-link>
  </nav>
</template>

<script setup lang="ts">
const items = [
  { to: '/admin/trade', cn: '交易', en: 'Trade' },
  { to: '/admin/orders', cn: '订单', en: 'Orders' },
  { to: '/admin/holdings', cn: '持仓', en: 'Assets' },
  { to: '/admin/ai', cn: 'AI', en: 'Assistant' },
  { to: '/admin/audit', cn: '审控', en: 'Audit+Risk' }
];
</script>

<style scoped>
.tabbar {
  position: fixed;
  left: 8px;
  right: 8px;
  bottom: calc(8px + env(safe-area-inset-bottom));
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 4px;
  padding: 6px;
  z-index: 60;
}

.tab-btn {
  border: 1px solid var(--line);
  border-radius: var(--radius-sm);
  background: #fff;
  color: var(--text-soft);
  padding: 6px 4px;
  display: grid;
  gap: 1px;
  justify-items: center;
}

.tab-btn.active {
  border-color: rgba(16, 163, 127, 0.4);
  background: rgba(16, 163, 127, 0.1);
  color: #0f766e;
}

.cn {
  font-size: 11px;
  font-weight: 800;
}

.en {
  font-size: 10px;
  opacity: 0.8;
}
</style>
