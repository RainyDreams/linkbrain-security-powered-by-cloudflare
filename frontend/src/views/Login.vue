<template>
  <div class="h-screen flex items-center justify-center p-6 bg-gray-50">
    <div class="w-full max-w-sm">
      <div class="flex items-center justify-center gap-2 mb-6">
        <div class="w-8 h-8 rounded-lg bg-gray-900 flex items-center justify-center">
          <span class="text-white font-bold text-sm">零</span>
        </div>
        <h1 class="text-lg font-bold text-gray-900">零本证券</h1>
      </div>
      
      <div class="bg-white rounded-xl p-5 border border-gray-200 shadow-sm">
        <h2 class="text-base font-semibold text-gray-900 mb-4">柜台验证</h2>
        <input v-model="pwd" type="password" 
               class="w-full bg-gray-50 border border-gray-300 rounded-lg p-3 text-sm text-gray-900 outline-none mb-4 focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
               placeholder="请输入密码" @keyup.enter="login">
        <button @click="login" 
                class="w-full bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white font-medium p-3 rounded-lg transition-colors">
          进入系统
        </button>
        <div class="text-center mt-4 pt-4 border-t border-gray-200">
          <router-link to="/" class="text-[11px] text-blue-600 hover:text-blue-700">返回访客模式</router-link>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { useMarketStore } from '../stores/market';
import api from '../api';

const pwd = ref('');
const router = useRouter();
const store = useMarketStore();

const login = async () => {
    try {
        const res: any = await api.login(pwd.value);
        store.setToken(res.token);
        router.push('/admin/buy');
    } catch (e) {
        alert("密码错误");
    }
};
</script>

<style scoped>
@import url('https://fonts.googleapis.com/css2?family=Noto+Sans+SC:wght@300;400;500;600;700&display=swap');

:global(*) {
  font-family: 'Noto Sans SC', system-ui, -apple-system, sans-serif;
}
</style>