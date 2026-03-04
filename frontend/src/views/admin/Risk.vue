<template>
  <div class="risk-page">
    <section class="glass-card risk-head">
      <div class="head-top">
        <div>
          <h2 class="panel-title">风控体检中心</h2>
          <p class="head-sub">资金一致性、订单完整性、审计失败热点统一检查</p>
        </div>
        <div class="head-actions">
          <button class="btn-solid btn-ghost" :disabled="loading" @click="refresh">刷新体检</button>
          <button class="btn-solid btn-ghost" :disabled="matching" @click="manualMatch">{{ matching ? '撮合中...' : '手动撮合' }}</button>
          <button class="btn-solid btn-primary danger" :disabled="resetting" @click="initializeSystem">{{ resetting ? '初始化中...' : '初始化清空' }}</button>
        </div>
      </div>

      <div class="metric-grid">
        <article class="metric-box">
          <span>健康状态</span>
          <strong :class="integrity?.healthy ? 'ok' : 'bad'">{{ integrity?.healthy ? 'HEALTHY' : 'RISK' }}</strong>
        </article>
        <article class="metric-box">
          <span>风险等级</span>
          <strong>{{ integrity?.severity || '--' }}</strong>
        </article>
        <article class="metric-box">
          <span>冻结差异(分)</span>
          <strong :class="freezeDiff === 0 ? 'ok' : 'bad'">{{ freezeDiff }}</strong>
        </article>
        <article class="metric-box">
          <span>失败审计总数</span>
          <strong>{{ failedTotal }}</strong>
        </article>
      </div>
    </section>

    <section class="glass-card risk-list">
      <h3 class="panel-title">问题列表</h3>
      <div v-if="loading" class="empty-line">加载中...</div>
      <div v-else-if="!findings.length" class="empty-line">未发现关键一致性问题</div>
      <ul v-else class="findings">
        <li v-for="(f, idx) in findings" :key="idx">{{ f }}</li>
      </ul>
    </section>

    <section class="glass-card risk-list">
      <h3 class="panel-title">失败审计热点</h3>
      <div class="scope-grid">
        <div>
          <p class="scope-title">技术审计</p>
          <ul class="scope-list">
            <li v-for="item in techScopes" :key="`t-${item.scope}`">{{ item.scope }} <strong>{{ item.total }}</strong></li>
          </ul>
        </div>
        <div>
          <p class="scope-title">财务审计</p>
          <ul class="scope-list">
            <li v-for="item in finScopes" :key="`f-${item.scope}`">{{ item.scope }} <strong>{{ item.total }}</strong></li>
          </ul>
        </div>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import api from '../../api';
import { useMarketStore } from '../../stores/market';
import { notifyError, notifyInfo, notifySuccess } from '../../utils/notify';

const store = useMarketStore();
const loading = ref(false);
const matching = ref(false);
const resetting = ref(false);
const integrity = ref<any>(null);

const findings = computed(() => Array.isArray(integrity.value?.findings) ? integrity.value.findings : []);
const freezeDiff = computed(() => Number(integrity.value?.checks?.account?.freeze_diff || 0));
const failedTotal = computed(() => {
  const tech = Number(integrity.value?.audit?.failed_technical_total || 0);
  const fin = Number(integrity.value?.audit?.failed_financial_total || 0);
  return tech + fin;
});
const techScopes = computed(() => Array.isArray(integrity.value?.audit?.top_technical_scopes) ? integrity.value.audit.top_technical_scopes : []);
const finScopes = computed(() => Array.isArray(integrity.value?.audit?.top_financial_scopes) ? integrity.value.audit.top_financial_scopes : []);

const refresh = async () => {
  loading.value = true;
  try {
    integrity.value = await api.getIntegrity();
  } catch {
    notifyError('风控体检加载失败');
  } finally {
    loading.value = false;
  }
};

const manualMatch = async () => {
  if (matching.value) return;
  if (!window.confirm('确认立即执行一次撮合？')) return;
  matching.value = true;
  try {
    const result: any = await api.match({ reason: 'risk-center-manual' });
    const checked = Number(result?.checked || 0);
    const triggered = Number(result?.triggered || 0);
    notifyInfo('撮合完成', `检查 ${checked} 笔，触发 ${triggered} 笔`);
    await Promise.all([store.fetchAdminData(), refresh()]);
  } finally {
    matching.value = false;
  }
};

const initializeSystem = async () => {
  const pass = window.prompt('危险操作：请输入 RESET 确认清空所有运行数据');
  if (pass !== 'RESET') {
    notifyError('初始化已取消', '确认字符串不匹配');
    return;
  }
  resetting.value = true;
  try {
    await api.initSystem('RESET');
    notifySuccess('初始化完成', '持仓、订单、成交与审计日志已清空');
    await Promise.all([store.fetchAdminData(), refresh()]);
  } catch {
    notifyError('初始化失败');
  } finally {
    resetting.value = false;
  }
};

refresh();
</script>

<style scoped>
.risk-page {
  display: grid;
  gap: 12px;
}

.risk-head {
  padding: 12px;
  display: grid;
  gap: 10px;
}

.head-top {
  display: flex;
  justify-content: space-between;
  gap: 8px;
}

.head-sub {
  margin: 4px 0 0;
  font-size: 12px;
  color: var(--text-muted);
}

.head-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.danger {
  background: #b42318;
}

.danger:hover {
  background: #912018;
}

.metric-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 8px;
}

.metric-box {
  border: 1px solid var(--line);
  border-radius: var(--radius-sm);
  background: var(--surface-soft);
  padding: 9px 10px;
  display: grid;
  gap: 4px;
  font-size: 12px;
  color: var(--text-soft);
}

.metric-box strong {
  font-size: 16px;
  color: var(--text);
}

.ok {
  color: #067647 !important;
}

.bad {
  color: #b42318 !important;
}

.risk-list {
  padding: 12px;
}

.empty-line {
  margin-top: 8px;
  color: var(--text-muted);
  font-size: 12px;
}

.findings {
  margin: 8px 0 0;
  padding-left: 16px;
  display: grid;
  gap: 6px;
  font-size: 12px;
  color: #b42318;
}

.scope-grid {
  margin-top: 10px;
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

.scope-title {
  margin: 0 0 6px;
  font-size: 12px;
  color: var(--text-soft);
  font-weight: 700;
}

.scope-list {
  margin: 0;
  padding: 0;
  list-style: none;
  display: grid;
  gap: 4px;
  font-size: 12px;
}

.scope-list li {
  display: flex;
  justify-content: space-between;
  border: 1px solid var(--line);
  border-radius: var(--radius-sm);
  padding: 6px 8px;
  background: #fff;
}

@media (max-width: 960px) {
  .metric-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .scope-grid {
    grid-template-columns: 1fr;
  }

  .head-top {
    flex-direction: column;
  }
}
</style>
