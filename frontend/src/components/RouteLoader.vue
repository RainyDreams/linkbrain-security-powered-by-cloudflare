<template>
  <transition name="loader-fade">
    <div v-if="routeLoader.visible" class="route-loader" aria-live="polite" aria-busy="true">
      <div class="loader-bar-wrap">
        <div class="loader-bar" :style="{ width: `${routeLoader.progress}%` }"></div>
      </div>
      <div class="loader-pill">
        <span class="loader-dot"></span>
        <span>{{ routeLoader.label }}</span>
      </div>
    </div>
  </transition>
</template>

<script setup lang="ts">
import { routeLoader } from '../stores/routeLoader';
</script>

<style scoped>
.route-loader {
  position: fixed;
  inset: 0 auto auto 0;
  width: 100%;
  pointer-events: none;
  z-index: 2600;
}

.loader-bar-wrap {
  width: 100%;
  height: 2px;
  background: rgba(148, 163, 184, 0.2);
}

.loader-bar {
  height: 100%;
  background: linear-gradient(90deg, #10a37f 0%, #0ea5e9 55%, #10a37f 100%);
  box-shadow: 0 0 18px rgba(16, 163, 127, 0.28);
  transition: width 0.18s ease-out;
}

.loader-pill {
  margin: 10px auto 0;
  width: fit-content;
  display: inline-flex;
  align-items: center;
  gap: 7px;
  border: 1px solid rgba(16, 163, 127, 0.3);
  border-radius: 999px;
  padding: 5px 10px;
  background: rgba(255, 255, 255, 0.94);
  color: #0f766e;
  font-size: 11px;
  font-weight: 700;
  box-shadow: 0 6px 18px rgba(15, 23, 42, 0.12);
}

.loader-dot {
  width: 8px;
  height: 8px;
  border-radius: 999px;
  background: #10a37f;
  animation: loader-breath 1s ease-in-out infinite;
}

@keyframes loader-breath {
  0% { transform: scale(0.8); opacity: 0.6; }
  50% { transform: scale(1.2); opacity: 1; }
  100% { transform: scale(0.8); opacity: 0.6; }
}

.loader-fade-enter-active,
.loader-fade-leave-active {
  transition: opacity 0.22s ease;
}

.loader-fade-enter-from,
.loader-fade-leave-to {
  opacity: 0;
}

@media (max-width: 640px) {
  .loader-pill {
    margin-top: 8px;
    font-size: 10px;
    padding: 4px 9px;
  }
}
</style>

