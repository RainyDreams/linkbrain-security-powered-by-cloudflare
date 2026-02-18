<template>
  <div class="login-shell">
    <div class="login-grid">
      <section class="glass-card intro fade-rise">
        <p class="intro-kicker">Zero Ben Securities</p>
        <h1>专业交易模拟终端</h1>
        <p class="intro-text">面向移动端优先设计，同时覆盖桌面端操作。系统提供完整的下单、持仓、撤单、银证转账与公开看板链路。</p>

        <div class="prompt-list">
          <article class="prompt-card">
            <div class="prompt-title">风控提示直达界面</div>
            <p class="prompt-body">交易错误会在页面顶部直接提示原因和处理建议，不需要再看控制台。</p>
          </article>
          <article class="prompt-card">
            <div class="prompt-title">交易时段策略</div>
            <p class="prompt-body">支持非交易时段挂单，开市后自动撮合；并保留撤单和状态跟踪。</p>
          </article>
          <article class="prompt-card">
            <div class="prompt-title">资金一致性</div>
            <p class="prompt-body">后端已强化结算与转账原子性，避免资金与订单状态错位。</p>
          </article>
        </div>
      </section>

      <section class="glass-card login-card fade-rise">
        <div class="card-head">
          <p>Admin Access</p>
          <h2>管理入口</h2>
          <span>请输入管理员密码进入交易中枢</span>
        </div>

        <div class="card-body">
          <label class="label">管理员密码</label>
          <input
            v-model="pwd"
            type="password"
            autocomplete="current-password"
            class="field"
            placeholder="请输入密码"
            @keyup.enter="login"
          />

          <button class="btn-solid btn-primary w-full" :disabled="loading" @click="login">
            <span v-if="loading" class="spinner"></span>
            {{ loading ? '登录中...' : '进入管理端' }}
          </button>

          <div class="surface-soft notice">登录失败会触发限流保护，请勿高频尝试。</div>

          <div class="footer-row">
            <span>仅管理员可执行交易与资金操作</span>
            <router-link to="/">返回公开页</router-link>
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
    notifySuccess('登录成功', '已进入管理终端。', '请先核对资金、持仓和挂单状态。');
    router.push('/admin/buy');
  } finally {
    loading.value = false;
  }
};
</script>

<style scoped>
.login-shell {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 14px;
}

.login-grid {
  width: min(980px, 100%);
  display: grid;
  gap: 12px;
}

.intro,
.login-card {
  padding: 14px;
}

.intro-kicker {
  margin: 0;
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.22em;
  color: var(--text-muted);
}

.intro h1 {
  margin: 8px 0 0;
  font-size: 30px;
  line-height: 1.2;
  font-weight: 900;
}

.intro-text {
  margin: 10px 0 0;
  color: var(--text-soft);
  line-height: 1.7;
  font-size: 14px;
}

.prompt-list {
  margin-top: 12px;
  display: grid;
  gap: 8px;
}

.card-head {
  border-bottom: 1px solid var(--line);
  background: var(--surface-soft);
  margin: -14px -14px 0;
  padding: 12px 14px;
}

.card-head p {
  margin: 0;
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.2em;
  color: var(--text-muted);
}

.card-head h2 {
  margin: 6px 0 0;
  font-size: 24px;
  font-weight: 900;
}

.card-head span {
  margin-top: 3px;
  display: block;
  font-size: 12px;
  color: var(--text-soft);
}

.card-body {
  margin-top: 12px;
  display: grid;
  gap: 10px;
}

.label {
  font-size: 13px;
  font-weight: 700;
  color: var(--text-soft);
}

.field {
  width: 100%;
  border: 1px solid var(--line-strong);
  border-radius: 10px;
  padding: 11px 12px;
  font-size: 14px;
  outline: none;
}

.field:focus {
  border-color: var(--brand);
  box-shadow: 0 0 0 2px rgba(20, 136, 252, 0.12);
}

.notice {
  padding: 8px 10px;
  font-size: 12px;
  color: var(--text-soft);
}

.footer-row {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  font-size: 12px;
  color: var(--text-soft);
}

.footer-row a {
  color: var(--brand-deep);
  font-weight: 700;
}

.spinner {
  width: 14px;
  height: 14px;
  border-radius: 999px;
  border: 2px solid rgba(255, 255, 255, 0.45);
  border-top-color: #fff;
  display: inline-block;
  margin-right: 6px;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

@media (min-width: 960px) {
  .login-grid {
    grid-template-columns: 1fr 420px;
  }

  .intro,
  .login-card {
    padding: 16px;
  }

  .card-head {
    margin: -16px -16px 0;
    padding: 13px 16px;
  }
}
</style>
