<template>
  <div class="login-shell">
    <div class="login-canvas">
      <div class="login-grid">
        <section class="brand-panel">
          <div class="brand-mark">
            <svg viewBox="0 0 24 24" width="22" height="22" fill="none">
              <path d="M3 17l4-6 4 4 5-7 5 9" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
              <circle cx="3" cy="17" r="1.4" fill="currentColor"/>
              <circle cx="7" cy="11" r="1.4" fill="currentColor"/>
              <circle cx="11" cy="15" r="1.4" fill="currentColor"/>
              <circle cx="16" cy="8" r="1.4" fill="currentColor"/>
              <circle cx="21" cy="17" r="1.4" fill="currentColor"/>
            </svg>
            <span>Zero Ben Securities</span>
          </div>

          <h1>AI-Native 交易终端</h1>
          <p class="brand-sub">集成实时行情、风控与多 Agent 投研的 A 股交易演示平台</p>

          <ul class="feature-list">
            <li>
              <div class="feat-dot"></div>
              <div>
                <strong>实时撮合与价格笼子</strong>
                <span>主创/科创/北交所差异化价格笼子，违规订单自动暂存或拒收</span>
              </div>
            </li>
            <li>
              <div class="feat-dot"></div>
              <div>
                <strong>多角色 AI 投研委员会</strong>
                <span>总裁 / 经济学家×2 / 经理的辩论决策，每轮产出可执行委托</span>
              </div>
            </li>
            <li>
              <div class="feat-dot"></div>
              <div>
                <strong>双轨审计与风控体检</strong>
                <span>技术 + 财务双审计、冻结资金对账、持仓完整性自动检查</span>
              </div>
            </li>
          </ul>

          <div class="brand-meta">
            <span>实盘交易日 · 09:30-11:30 / 13:00-15:00</span>
            <span>T+1 结算 / 100 股一手</span>
          </div>
        </section>

        <section class="login-panel surface">
          <header class="login-header">
            <p class="login-kicker">Admin Access</p>
            <h2>身份验证</h2>
            <p class="login-hint">仅管理员可进入交易管理终端</p>
          </header>

          <form class="login-form" @submit.prevent="login">
            <div class="field">
              <label class="field-label" for="admin-pwd">管理员密码</label>
              <div class="input-group">
                <input
                  id="admin-pwd"
                  v-model="pwd"
                  :type="showPwd ? 'text' : 'password'"
                  autocomplete="current-password"
                  class="input input-mono"
                  placeholder="请输入密码"
                  @keyup.enter="login"
                />
                <button type="button" class="input-group-affix" @click="showPwd = !showPwd">
                  {{ showPwd ? '隐藏' : '显示' }}
                </button>
              </div>
            </div>

            <button class="btn btn-primary btn-lg btn-block" type="submit" :disabled="loading">
              <span v-if="loading" class="spinner"></span>
              <span>{{ loading ? '登录中...' : '进入管理端' }}</span>
            </button>
          </form>

          <div class="login-tip">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none">
              <circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="1.6"/>
              <path d="M12 8v5M12 16h.01" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
            </svg>
            <span>提示：5 次失败登录将触发 30 分钟 IP 级限流</span>
          </div>

          <footer class="login-foot">
            <span>Zero Ben · Trading Terminal</span>
            <router-link to="/">返回公开页</router-link>
          </footer>
        </section>
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
const showPwd = ref(false);
const loading = ref(false);
const router = useRouter();
const store = useMarketStore();

const login = async () => {
  const input = pwd.value.trim();
  if (!input) return;
  loading.value = true;
  try {
    const res: any = await api.login(input);
    store.setToken(res.token);
    router.push('/admin/trade');
  } catch {
    // error handled by API interceptor
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
  background:
    radial-gradient(900px 400px at 0% 0%, rgba(16, 163, 127, 0.07), transparent 60%),
    radial-gradient(700px 380px at 100% 100%, rgba(37, 99, 235, 0.05), transparent 65%),
    var(--bg);
  padding: 24px 16px;
}
.login-canvas {
  width: 100%;
  max-width: 1100px;
  margin: 0 auto;
}
.login-grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: 16px;
}

/* Brand panel */
.brand-panel {
  padding: 28px 24px;
  display: flex;
  flex-direction: column;
  gap: 20px;
  border-radius: var(--r-xl);
  background: var(--bg-elev);
  border: 1px solid var(--line);
  box-shadow: var(--shadow-1);
}
.brand-mark {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  font-weight: 700;
  color: var(--text-strong);
  letter-spacing: 0.04em;
}
.brand-mark svg {
  background: var(--text);
  color: #fff;
  border-radius: var(--r-sm);
  padding: 4px;
}
.brand-panel h1 {
  font-size: 32px;
  line-height: 1.12;
  letter-spacing: -0.02em;
  font-weight: 800;
  color: var(--text-strong);
}
.brand-sub {
  font-size: 14px;
  color: var(--text-soft);
  line-height: 1.55;
  max-width: 460px;
}
.feature-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 14px;
}
.feature-list li {
  display: flex;
  gap: 12px;
  align-items: flex-start;
}
.feat-dot {
  width: 8px;
  height: 8px;
  border-radius: 999px;
  background: var(--text);
  margin-top: 7px;
  flex-shrink: 0;
}
.feature-list strong {
  display: block;
  font-size: 13.5px;
  color: var(--text-strong);
  font-weight: 700;
  margin-bottom: 2px;
}
.feature-list span {
  font-size: 12.5px;
  color: var(--text-muted);
  line-height: 1.55;
}
.brand-meta {
  display: flex;
  gap: 14px;
  flex-wrap: wrap;
  font-size: 11.5px;
  color: var(--text-muted);
  border-top: 1px solid var(--line-soft);
  padding-top: 16px;
  font-family: 'JetBrains Mono', monospace;
}

/* Login panel */
.login-panel {
  padding: 28px 24px;
  display: flex;
  flex-direction: column;
  gap: 18px;
}
.login-header {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.login-kicker {
  font-size: 10.5px;
  font-weight: 700;
  letter-spacing: 0.16em;
  color: var(--text-muted);
  text-transform: uppercase;
}
.login-header h2 {
  font-size: 22px;
  font-weight: 800;
  color: var(--text-strong);
  letter-spacing: -0.01em;
}
.login-hint {
  font-size: 13px;
  color: var(--text-muted);
}
.login-form {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.login-tip {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--text-muted);
  background: var(--bg-subtle);
  border: 1px solid var(--line-soft);
  border-radius: var(--r-sm);
  padding: 8px 10px;
}
.login-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 12px;
  color: var(--text-muted);
  padding-top: 8px;
  border-top: 1px solid var(--line-soft);
}
.login-foot a {
  color: var(--text-strong);
  font-weight: 600;
}
.login-foot a:hover { text-decoration: underline; }

@media (min-width: 880px) {
  .login-grid {
    grid-template-columns: 1.1fr 0.9fr;
    align-items: stretch;
  }
  .brand-panel h1 { font-size: 36px; }
  .login-panel { padding: 32px 28px; }
}

@media (max-width: 720px) {
  .brand-panel { padding: 22px 18px; }
  .brand-panel h1 { font-size: 26px; }
  .login-panel { padding: 22px 18px; }
}
</style>
