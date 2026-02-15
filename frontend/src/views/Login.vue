<template>
  <div class="flex min-h-screen items-center justify-center px-4 py-10">
    <div class="w-full max-w-[980px] grid gap-4 md:grid-cols-[1.1fr,0.9fr]">
      <section class="glass-card hidden p-6 md:block fade-rise">
        <p class="text-[11px] uppercase tracking-[0.24em] text-slate-500">Zero Ben Securities</p>
        <h1 class="mt-2 text-3xl font-extrabold text-slate-900">机构级模拟交易终端</h1>
        <p class="mt-2 text-sm leading-6 text-slate-600">界面风格融合同花顺的数据密度、OpenAI 的清晰结构和 Telegram 的即时反馈，适用于交易演示与风控流程验证。</p>

        <div class="mt-5 space-y-2">
          <article class="prompt-card">
            <div class="prompt-title">交易校验</div>
            <p class="prompt-body">价格、数量、涨跌停、资金与可卖持仓均在服务端进行强校验。</p>
          </article>
          <article class="prompt-card">
            <div class="prompt-title">可视化反馈</div>
            <p class="prompt-body">错误提示包含原因、影响和建议，不再需要打开开发者工具查看。</p>
          </article>
          <article class="prompt-card">
            <div class="prompt-title">风控声明</div>
            <p class="prompt-body">非交易时段允许挂单，成交仅在交易时段自动撮合。</p>
          </article>
        </div>
      </section>

      <section class="glass-card overflow-hidden fade-rise">
        <div class="bg-gradient-to-r from-[#1f8ecf] to-[#0f9a8f] px-6 py-5 text-white">
          <p class="text-xs uppercase tracking-[0.26em] text-white/80">Admin Access</p>
          <h2 class="mt-2 text-2xl font-extrabold">管理入口</h2>
          <p class="mt-1 text-sm text-white/90">请输入管理员密码以进入交易工作台。</p>
        </div>

        <div class="space-y-4 px-6 py-6">
          <label class="block text-sm font-semibold text-slate-700">管理员密码</label>
          <input
            v-model="pwd"
            type="password"
            autocomplete="current-password"
            class="w-full rounded-xl border border-[var(--line)] bg-white px-4 py-3 text-sm text-slate-800 outline-none ring-0 transition focus:border-cyan-500"
            placeholder="请输入密码"
            @keyup.enter="login"
          />

          <button class="btn-solid btn-primary w-full" :disabled="loading" @click="login">
            <span v-if="loading" class="mr-2 inline-block h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white"></span>
            {{ loading ? '登录中...' : '进入管理终端' }}
          </button>

          <div class="rounded-xl border border-[var(--line)] bg-slate-50 px-3 py-2 text-xs text-slate-600">
            登录失败会自动触发限流保护，请勿连续高频尝试。
          </div>

          <div class="flex items-center justify-between text-xs text-slate-600">
            <span>仅管理员可见交易与转账模块</span>
            <router-link to="/" class="font-semibold text-cyan-700 hover:text-cyan-800">返回公开页</router-link>
          </div>
        </div>
      </section>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { useMarketStore } from '../stores/market';
import api from '../api';
import { notifySuccess } from '../utils/notify';

const pwd = ref('');
const loading = ref(false);
const router = useRouter();
const store = useMarketStore();

const login = async () => {
  if (!pwd.value.trim()) return;

  loading.value = true;
  try {
    const res: any = await api.login(pwd.value);
    store.setToken(res.token);
    notifySuccess('登录成功', '已进入管理终端', '请先核对账户资金和持仓后再下单。');
    router.push('/admin/buy');
  } finally {
    loading.value = false;
  }
};
</script>
