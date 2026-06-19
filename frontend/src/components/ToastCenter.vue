<template>
  <Teleport to="body">
    <div class="toast-root">
      <transition-group name="toast" tag="div" class="toast-stack">
        <article
          v-for="item in noticeState.items"
          :key="item.id"
          class="toast-item"
          :data-type="item.type"
        >
          <div class="toast-icon">{{ iconText[item.type] }}</div>
          <div class="toast-main">
            <div class="toast-top">
              <h4>{{ item.title }}</h4>
              <span class="mono">{{ formatClock(item.createdAt) }}</span>
            </div>
            <p v-if="item.message">{{ item.message }}</p>
            <div class="toast-foot">
              <span v-if="item.code" class="toast-code mono">code {{ item.code }}</span>
              <span v-if="item.hint" class="toast-hint">{{ item.hint }}</span>
              <button class="btn btn-ghost btn-sm" @click="dismissNotice(item.id)">关闭</button>
            </div>
          </div>
        </article>
      </transition-group>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { dismissNotice, noticeState } from '../utils/notify';

const iconText: Record<string, string> = {
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
  position: fixed;
  top: 12px;
  left: 0;
  right: 0;
  z-index: 120;
  display: flex;
  justify-content: center;
  padding: 0 12px;
  pointer-events: none;
}
.toast-stack {
  width: min(440px, 100%);
  display: grid;
  gap: 8px;
}
.toast-item {
  pointer-events: auto;
  display: grid;
  grid-template-columns: 24px 1fr;
  gap: 10px;
  align-items: start;
  background: var(--bg-elev);
  border: 1px solid var(--line);
  border-radius: var(--r-md);
  padding: 10px 12px;
  box-shadow: var(--shadow-3);
  border-left: 3px solid var(--line-strong);
}
.toast-item[data-type="success"] { border-left-color: var(--up); }
.toast-item[data-type="error"]   { border-left-color: var(--down); }
.toast-item[data-type="info"]    { border-left-color: var(--info); }
.toast-item[data-type="warning"] { border-left-color: var(--warn); }

.toast-icon {
  width: 22px;
  height: 22px;
  border-radius: 999px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  font-weight: 700;
  background: var(--bg-inset);
  color: var(--text-soft);
}
.toast-item[data-type="success"] .toast-icon { background: var(--up-soft); color: var(--up); }
.toast-item[data-type="error"]   .toast-icon { background: var(--down-soft); color: var(--down); }
.toast-item[data-type="info"]    .toast-icon { background: var(--info-soft); color: var(--info); }
.toast-item[data-type="warning"] .toast-icon { background: var(--warn-soft); color: var(--warn); }

.toast-top {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 8px;
}
.toast-top h4 {
  margin: 0;
  font-size: 13px;
  font-weight: 700;
  color: var(--text);
}
.toast-top span {
  font-size: 11px;
  color: var(--text-muted);
}
.toast-main p {
  margin: 5px 0 0;
  font-size: 12.5px;
  color: var(--text-soft);
  line-height: 1.5;
  word-break: break-word;
}
.toast-foot {
  margin-top: 6px;
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.toast-code {
  font-size: 10.5px;
  color: var(--text-muted);
  background: var(--bg-inset);
  border-radius: 4px;
  padding: 1px 6px;
}
.toast-hint {
  font-size: 11px;
  color: var(--text-muted);
  flex: 1;
  min-width: 0;
}

.toast-enter-active,
.toast-leave-active {
  transition: opacity 0.18s ease, transform 0.18s ease;
}
.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  transform: translateY(-8px);
}

@media (max-width: 720px) {
  .toast-root {
    top: auto;
    bottom: 12px;
  }
}
</style>
