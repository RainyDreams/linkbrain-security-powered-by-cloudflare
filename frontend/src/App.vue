<template>
  <RouteLoader />
  <router-view v-slot="{ Component, route }">
    <transition name="page-fade" mode="out-in">
      <component :is="Component" :key="route.fullPath" />
    </transition>
  </router-view>
  <ToastCenter />
</template>

<script setup lang="ts">
import RouteLoader from './components/RouteLoader.vue';
import ToastCenter from './components/ToastCenter.vue';
</script>

