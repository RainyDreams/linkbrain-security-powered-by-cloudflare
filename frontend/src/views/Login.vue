<template>
  <div class="oa-login-shell">
    <div class="oa-login-layout">
      <section class="brand-card fade-rise">
        <p class="brand-kicker">ZERO BEN ADMIN</p>
        <h1>管理终端登录</h1>
        <p class="brand-sub">简洁、安全、可审计的管理入口</p>

        <div class="feature-list">
          <article class="feature-item">
            <span>交易执行</span>
            <strong>实时下单与撤单</strong>
          </article>
          <article class="feature-item">
            <span>风控检查</span>
            <strong>仓位与资金联动校验</strong>
          </article>
          <article class="feature-item">
            <span>审计追踪</span>
            <strong>关键操作全程留痕</strong>
          </article>
        </div>
      </section>

      <section class="login-card fade-rise">
        <div class="login-head">
          <p>Admin Access</p>
          <h2>身份验证</h2>
          <span>请输入管理员密码进入交易管理终端</span>
        </div>

        <form class="login-form" @submit.prevent="login">
          <label class="label" for="admin-pwd">管理员密码</label>
          <div class="field-wrap">
            <input
              id="admin-pwd"
              v-model="pwd"
              :type="showPwd ? 'text' : 'password'"
              autocomplete="current-password"
              class="field"
              placeholder="请输入密码"
              @keyup.enter="login"
            />
            <button type="button" class="toggle-btn" @click="showPwd = !showPwd">
              {{ showPwd ? '隐藏' : '显示' }}
            </button>
          </div>

          <button class="submit-btn" type="submit" :disabled="loading">
            <span v-if="loading" class="spinner"></span>
            {{ loading ? '登录中...' : '进入管理端' }}
          </button>
        </form>

        <div class="tip">提示: 频繁失败尝试会触发限流保护。</div>

        <div class="footer-row">
          <span>仅管理员可执行交易与资金操作</span>
          <router-link to="/">返回公开页</router-link>
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
import { notifyError, notifySuccess } from '../utils/notify';

const pwd = ref('');
const showPwd = ref(false);
const loading = ref(false);
const router = useRouter();
const store = useMarketStore();

const login = async () => {
  const input = pwd.value.trim();
  if (!input) {
    notifyError('请输入管理员密码');
    return;
  }

  loading.value = true;
  try {
    const res: any = await api.login(input);
    store.setToken(res.token);
    notifySuccess('登录成功', '已进入管理终端。');
    router.push('/admin/buy');
  } catch {
    // error notice is handled by API interceptor
  } finally {
    loading.value = false;
  }
};
</script>

<style scoped>
.oa-login-shell {
  min-height: 100vh;
  width: min(1240px, 100%);
  margin: 0 auto;
  padding: 12px;
  display: flex;
  align-items: center;
  color: #111827;
  background:
    radial-gradient(860px 300px at 12% -20%, rgba(16, 163, 127, 0.08), transparent 62%),
    #f8fafc;
}

.oa-login-layout {
  width: 100%;
  display: grid;
  gap: 12px;
}

.brand-card,
.login-card {
  border: 1px solid #e5eaf0;
  border-radius: 14px;
  background: #ffffff;
  box-shadow: 0 1px 2px rgba(15, 23, 42, 0.04), 0 10px 30px rgba(15, 23, 42, 0.05);
  padding: 16px;
}

.brand-kicker {
  margin: 0;
  font-size: 10px;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: #6b7280;
}

.brand-card h1 {
  margin: 10px 0 0;
  font-size: 34px;
  line-height: 1.12;
  font-weight: 800;
  color: #0f172a;
}

.brand-sub {
  margin: 8px 0 0;
  font-size: 14px;
  color: #64748b;
}

.feature-list {
  margin-top: 16px;
  display: grid;
  gap: 8px;
}

.feature-item {
  border: 1px solid #e6ecf3;
  border-radius: 10px;
  background: #fbfdff;
  padding: 10px 12px;
  display: flex;
  justify-content: space-between;
  gap: 10px;
}

.feature-item span {
  font-size: 12px;
  color: #64748b;
}

.feature-item strong {
  font-size: 12px;
  color: #0f172a;
}

.login-card {
  display: grid;
  gap: 12px;
}

.login-head {
  border: 1px solid #e6ecf3;
  border-radius: 10px;
  background: #fbfdff;
  padding: 11px 12px;
}

.login-head p {
  margin: 0;
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.2em;
  color: #64748b;
}

.login-head h2 {
  margin: 6px 0 0;
  font-size: 24px;
  line-height: 1.2;
  font-weight: 800;
  color: #0f172a;
}

.login-head span {
  margin-top: 4px;
  display: block;
  font-size: 12px;
  color: #64748b;
}

.login-form {
  display: grid;
  gap: 10px;
}

.label {
  font-size: 13px;
  font-weight: 700;
  color: #334155;
}

.field-wrap {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 8px;
}

.field {
  width: 100%;
  border: 1px solid #d7e0ea;
  border-radius: 10px;
  padding: 11px 12px;
  font-size: 14px;
  outline: none;
  background: #ffffff;
  color: #0f172a;
}

.field::placeholder {
  color: #94a3b8;
}

.field:focus {
  border-color: #10a37f;
  box-shadow: 0 0 0 2px rgba(16, 163, 127, 0.12);
}

.toggle-btn {
  border: 1px solid #d7e0ea;
  border-radius: 10px;
  background: #ffffff;
  color: #334155;
  min-width: 66px;
  font-size: 12px;
  font-weight: 700;
}

.submit-btn {
  width: 100%;
  border: 1px solid #0f8f6f;
  border-radius: 10px;
  padding: 10px 12px;
  font-size: 13px;
  font-weight: 800;
  color: #ffffff;
  background: linear-gradient(180deg, #16b58d 0%, #10a37f 100%);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
}

.submit-btn:disabled {
  opacity: 0.62;
}

.tip {
  border: 1px solid #e6ecf3;
  border-radius: 10px;
  background: #fbfdff;
  color: #64748b;
  font-size: 12px;
  padding: 8px 10px;
}

.footer-row {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  font-size: 12px;
  color: #64748b;
}

.footer-row a {
  color: #0f8f6f;
  font-weight: 700;
}

.spinner {
  width: 14px;
  height: 14px;
  border-radius: 999px;
  border: 2px solid rgba(255, 255, 255, 0.5);
  border-top-color: #ffffff;
  display: inline-block;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

@media (min-width: 1000px) {
  .oa-login-layout {
    grid-template-columns: 1.1fr 0.9fr;
  }

  .brand-card,
  .login-card {
    padding: 18px;
  }
}

@media (max-width: 720px) {
  .oa-login-shell {
    padding: 8px;
    align-items: stretch;
  }

  .brand-card h1 {
    font-size: 28px;
  }

  .field-wrap {
    grid-template-columns: 1fr;
  }

  .toggle-btn {
    min-height: 36px;
  }

  .footer-row {
    flex-direction: column;
    align-items: flex-start;
  }
}
</style>
