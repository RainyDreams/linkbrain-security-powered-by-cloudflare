<template>
  <div class="toast-root">
    <transition-group name="toast" tag="div" class="toast-stack">
      <article
        v-for="item in noticeState.items"
        :key="item.id"
        class="toast-item"
        :class="toastClass[item.type]"
      >
        <div class="toast-icon" :class="iconClass[item.type]">{{ iconText[item.type] }}</div>
        <div class="toast-main">
          <div class="toast-top">
            <h4>{{ item.title }}</h4>
            <span>{{ formatClock(item.createdAt) }}</span>
          </div>
          <p v-if="item.message">{{ item.message }}</p>
          <p v-if="item.hint" class="toast-hint">建议：{{ item.hint }}</p>
          <div class="toast-foot">
            <span v-if="item.code" class="toast-code">Code {{ item.code }}</span>
            <button @click="dismissNotice(item.id)">关闭</button>
          </div>
        </div>
      </article>
    </transition-group>
  </div>
</template>

<script setup lang="ts">
import { dismissNotice, noticeState } from '../utils/notify';

const toastClass = {
  success: 'toast-success',
  error: 'toast-error',
  info: 'toast-info',
  warning: 'toast-warning'
};

const iconClass = {
  success: 'icon-success',
  error: 'icon-error',
  info: 'icon-info',
  warning: 'icon-warning'
};

const iconText = {
  success: '✓',
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
.toast-root {
  pointer-events: none;
  position: fixed;
  inset-inline: 0;
  top: 10px;
  z-index: 120;
  display: flex;
  justify-content: center;
  padding: 0 10px;
}

.toast-stack {
  width: min(480px, 100%);
  display: grid;
  gap: 8px;
}

.toast-item {
  pointer-events: auto;
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 10px;
  border: 1px solid var(--line);
  border-radius: 12px;
  background: #fff;
  padding: 10px;
  box-shadow: 0 10px 24px rgba(8, 20, 38, 0.15);
}

.toast-success {
  border-color: #abefc6;
}

.toast-error {
  border-color: #fecdca;
}

.toast-info {
  border-color: #b2ddff;
}

.toast-warning {
  border-color: #fedf89;
}

.toast-icon {
  width: 22px;
  height: 22px;
  border-radius: 999px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  font-weight: 800;
  margin-top: 1px;
}

.icon-success {
  color: #067647;
  background: #dafbe9;
}

.icon-error {
  color: #b42318;
  background: #fee4e2;
}

.icon-info {
  color: #175cd3;
  background: #eff8ff;
}

.icon-warning {
  color: #b54708;
  background: #fffaeb;
}

.toast-main {
  min-width: 0;
}

.toast-top {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  align-items: center;
}

.toast-top h4 {
  margin: 0;
  font-size: 14px;
  font-weight: 800;
  color: var(--text);
}

.toast-top span {
  font-size: 11px;
  color: var(--text-muted);
}

.toast-main p {
  margin: 6px 0 0;
  font-size: 13px;
  color: var(--text-soft);
  line-height: 1.5;
}

.toast-hint {
  background: #f7f9fc;
  border: 1px dashed var(--line);
  border-radius: 8px;
  padding: 5px 7px;
}

.toast-foot {
  margin-top: 7px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
}

.toast-code {
  font-size: 11px;
  color: var(--text-muted);
  border: 1px solid var(--line);
  border-radius: 999px;
  padding: 2px 8px;
}

.toast-foot button {
  border: 0;
  background: transparent;
  color: var(--text-soft);
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
}

.toast-enter-active,
.toast-leave-active {
  transition: all 0.2s ease;
}

.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  transform: translateY(-8px);
}

@media (max-width: 640px) {
  .toast-root {
    top: auto;
    bottom: 10px;
  }
}
</style>
