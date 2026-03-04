<template>
  <div class="audit-center-page">
    <section class="glass-card health-card">
      <div class="health-head">
        <div>
          <h2 class="panel-title">审计与风控中心</h2>
          <p class="sub-text">风控体检与审计日志同屏联动，快速定位并处理异常。</p>
        </div>
        <div class="top-actions">
          <button class="btn-solid btn-ghost" :disabled="busy" @click="refreshAll">刷新</button>
          <button class="btn-solid btn-ghost" :disabled="busy || syncingSchema" @click="syncSchema">
            {{ syncingSchema ? '同步中...' : '结构同步' }}
          </button>
          <button class="btn-solid btn-ghost" :disabled="busy || matching" @click="manualMatch">
            {{ matching ? '撮合中...' : '手动撮合' }}
          </button>
          <button class="btn-solid btn-ghost danger-btn" :disabled="busy || resetting" @click="initializeSystem">
            {{ resetting ? '初始化中...' : '初始化清空' }}
          </button>
        </div>
      </div>

      <div class="metric-grid metric-grid-health">
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
        <article class="metric-box">
          <span>审计总量</span>
          <strong>{{ total }}</strong>
        </article>
      </div>
    </section>

    <section class="risk-grid">
      <article class="glass-card risk-panel">
        <h3 class="panel-title">问题列表</h3>
        <div v-if="integrityLoading" class="empty-line">体检加载中...</div>
        <div v-else-if="!findings.length" class="empty-line">未发现关键一致性问题</div>
        <ul v-else class="findings">
          <li v-for="(f, idx) in findings" :key="idx">{{ f }}</li>
        </ul>
      </article>

      <article class="glass-card risk-panel">
        <h3 class="panel-title">失败热点</h3>
        <div v-if="integrityLoading" class="empty-line">体检加载中...</div>
        <div v-else class="scope-grid">
          <div>
            <p class="scope-title">技术审计</p>
            <ul class="scope-list">
              <li v-for="item in techScopes" :key="`t-${item.scope}`">{{ item.scope || '--' }} <strong>{{ item.total }}</strong></li>
              <li v-if="!techScopes.length" class="scope-empty">暂无</li>
            </ul>
          </div>
          <div>
            <p class="scope-title">财务审计</p>
            <ul class="scope-list">
              <li v-for="item in finScopes" :key="`f-${item.scope}`">{{ item.scope || '--' }} <strong>{{ item.total }}</strong></li>
              <li v-if="!finScopes.length" class="scope-empty">暂无</li>
            </ul>
          </div>
        </div>
      </article>
    </section>

    <section class="glass-card command-card">
      <div class="command-top">
        <div>
          <h3 class="panel-title">审计日志检索</h3>
          <p class="sub-text">支持技术与财务双轨审计，快速回溯交易链路与异常行为。</p>
        </div>
      </div>

      <div class="tab-row">
        <button :class="tabClass('technical')" @click="switchType('technical')">技术审计</button>
        <button :class="tabClass('financial')" @click="switchType('financial')">财务审计</button>
      </div>

      <div class="preset-row">
        <button class="preset-btn" :class="presetClass('all')" @click="applyPreset('all')">全部</button>
        <button class="preset-btn" :class="presetClass('success')" @click="applyPreset('success')">仅成功</button>
        <button class="preset-btn" :class="presetClass('failed')" @click="applyPreset('failed')">仅失败</button>
        <button class="preset-btn" :class="presetClass('trade')" @click="applyPreset('trade')">仅成交</button>
        <button class="preset-btn" :class="presetClass('today')" @click="applyPreset('today')">今日</button>
        <label class="exact-toggle">
          <input v-model="exactMode" type="checkbox" />
          精确匹配
        </label>
        <button class="btn-solid btn-ghost compact" @click="showAdvanced = !showAdvanced">
          {{ showAdvanced ? '收起高级' : '高级筛选' }}
        </button>
      </div>

      <div class="quick-grid">
        <input v-model.trim="filters.keyword" class="filter-input" placeholder="关键词 / event / message" @keyup.enter="search" />
        <input v-model.trim="filters.scope" class="filter-input" placeholder="scope" @keyup.enter="search" />
        <input v-model.trim="filters.status" class="filter-input" placeholder="status" @keyup.enter="search" />
        <input v-model.trim="filters.order_id" class="filter-input" placeholder="order_id" @keyup.enter="search" />
        <input v-model.trim="filters.symbol" class="filter-input" placeholder="symbol" @keyup.enter="search" />
        <input v-model.trim="filters.request_id" class="filter-input" placeholder="request_id" @keyup.enter="search" />
      </div>

      <div v-if="showAdvanced" class="more-grid">
        <input v-model.trim="filters.category" class="filter-input" placeholder="category" />
        <input v-model.trim="filters.subcategory" class="filter-input" placeholder="subcategory" />
        <input v-model.trim="filters.tag" class="filter-input" placeholder="tag" />
        <input v-model.trim="filters.time_from" class="filter-input" placeholder="time_from (YYYY-MM-DD HH:mm:ss)" />
        <input v-model.trim="filters.time_to" class="filter-input" placeholder="time_to (YYYY-MM-DD HH:mm:ss)" />
        <input v-if="type === 'financial'" v-model.trim="filters.amount_min" class="filter-input" placeholder="amount_min (cent)" />
        <input v-if="type === 'financial'" v-model.trim="filters.amount_max" class="filter-input" placeholder="amount_max (cent)" />
      </div>

      <div class="command-actions">
        <button class="btn-solid btn-primary" :disabled="auditLoading" @click="search">查询</button>
        <button class="btn-solid btn-ghost" :disabled="auditLoading" @click="resetFilters">清空</button>
      </div>
    </section>

    <section v-if="showFinancialMismatchTip" class="glass-card diag-tip">
      <div>
        <strong>检测到财务审计有数据，但当前筛选结果为空。</strong>
        <p>可能是 `status / keyword / time / scope` 条件过滤掉了结果。</p>
      </div>
      <button class="btn-solid btn-ghost" @click="resetFilters">一键清空筛选</button>
    </section>

    <section class="glass-card audit-list">
      <div class="list-head">
        <span class="hint">{{ hintText }}</span>
        <span>{{ total }} 条</span>
      </div>

      <div v-if="auditLoading" class="empty-line">加载中...</div>
      <div v-else-if="rows.length === 0" class="empty-line">暂无数据</div>

      <div v-else class="overflow-x-auto scrollbar-thin">
        <table class="min-w-full table-dense text-[12px]">
          <thead class="data-table-head">
            <tr>
              <th class="px-3 py-2 text-left">时间</th>
              <th class="px-3 py-2 text-left">来源</th>
              <th class="px-3 py-2 text-left">scope</th>
              <th class="px-3 py-2 text-left">分类</th>
              <th class="px-3 py-2 text-left">状态</th>
              <th class="px-3 py-2 text-left">实体</th>
              <th class="px-3 py-2 text-left">摘要 / 详情</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="item in rows" :key="`${item.source}-${item.id}`" class="border-t border-[var(--line)]/70">
              <td class="px-3 py-2 font-mono text-[11px]">{{ item.created_at_cst || item.created_at }}</td>
              <td class="px-3 py-2">
                <span class="source-pill" :class="item.source === 'financial' ? 'fin' : 'tech'">
                  {{ item.source === 'financial' ? 'FIN' : 'TECH' }}
                </span>
              </td>
              <td class="px-3 py-2">{{ item.scope || '--' }}</td>
              <td class="px-3 py-2">
                <div>{{ item.category || '--' }}</div>
                <div class="subline">{{ item.subcategory || '--' }}</div>
              </td>
              <td class="px-3 py-2">
                <span class="status-pill" :class="statusClass(item)">{{ prettyStatus(item) }}</span>
              </td>
              <td class="px-3 py-2 font-mono text-[11px]">
                <div>order: {{ entityOrder(item) }}</div>
                <div>symbol: {{ entitySymbol(item) }}</div>
                <div>req: {{ entityReq(item) }}</div>
              </td>
              <td class="px-3 py-2">
                <div class="font-mono text-[11px] detail-block">
                  <div>{{ item.source === 'financial' ? `event: ${item.event_type || '--'}` : `level: ${item.level || '--'}` }}</div>
                  <div v-if="item.source === 'financial'">
                    amount: {{ Number(item.amount || 0) }} / qty: {{ Number(item.qty || 0) }} / price: {{ Number(item.price || 0) }}
                  </div>
                  <div>{{ shortMessage(item) }}</div>
                </div>
                <button class="btn-solid btn-ghost compact mt-1" @click="openDetail(item)">查看详情</button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div class="pager">
        <button class="btn-solid btn-ghost" :disabled="page <= 1 || auditLoading" @click="goPage(page - 1)">上一页</button>
        <span>{{ page }} / {{ totalPages }}</span>
        <button class="btn-solid btn-ghost" :disabled="page >= totalPages || auditLoading" @click="goPage(page + 1)">下一页</button>
      </div>
    </section>

    <Teleport to="body">
      <div v-if="detailVisible" class="modal-mask" @click.self="closeDetail">
        <div class="modal-card">
          <div class="modal-head">
            <h3>审计详情</h3>
            <button class="btn-solid btn-ghost compact" @click="closeDetail">关闭</button>
          </div>
          <div class="modal-body">
            <div class="detail-grid">
              <div class="kv-item"><span>来源</span><strong>{{ detailItem?.source || '--' }}</strong></div>
              <div class="kv-item"><span>状态</span><strong>{{ prettyStatus(detailItem) }}</strong></div>
              <div class="kv-item"><span>scope</span><strong>{{ detailItem?.scope || '--' }}</strong></div>
              <div class="kv-item"><span>分类</span><strong>{{ detailItem?.category || '--' }}/{{ detailItem?.subcategory || '--' }}</strong></div>
              <div class="kv-item"><span>时间</span><strong class="font-mono">{{ detailItem?.created_at_cst || detailItem?.created_at || '--' }}</strong></div>
              <div class="kv-item"><span>请求</span><strong class="font-mono">{{ entityReq(detailItem) }}</strong></div>
              <div class="kv-item"><span>订单</span><strong class="font-mono">{{ entityOrder(detailItem) }}</strong></div>
              <div class="kv-item"><span>标的</span><strong>{{ entitySymbol(detailItem) }}</strong></div>
              <div class="kv-item full"><span>消息</span><strong>{{ String(detailItem?.message || detailItem?.reason || '--') }}</strong></div>
            </div>
            <div class="detail-raw">
              <details open>
                <summary>meta / 原始记录</summary>
                <pre>{{ detailText }}</pre>
              </details>
            </div>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, ref, watch } from 'vue';
import api from '../../api';
import { useMarketStore } from '../../stores/market';
import { notifyError, notifyInfo, notifySuccess } from '../../utils/notify';

type AuditType = 'technical' | 'financial';
type Preset = 'all' | 'success' | 'failed' | 'trade' | 'today';

const store = useMarketStore();

const integrityLoading = ref(false);
const auditLoading = ref(false);
const matching = ref(false);
const resetting = ref(false);
const syncingSchema = ref(false);

const integrity = ref<any>(null);
const type = ref<AuditType>('technical');
const showAdvanced = ref(false);
const exactMode = ref(false);
const page = ref(1);
const pageSize = ref(20);
const total = ref(0);
const totalPages = ref(1);
const rows = ref<any[]>([]);
const detailVisible = ref(false);
const detailText = ref('');
const detailItem = ref<any>(null);
const activePreset = ref<Preset>('all');
const financialBaselineTotal = ref(0);

const filters = reactive({
  keyword: '',
  order_id: '',
  symbol: '',
  request_id: '',
  scope: '',
  status: '',
  category: '',
  subcategory: '',
  tag: '',
  amount_min: '',
  amount_max: '',
  time_from: '',
  time_to: ''
});

const findings = computed(() => Array.isArray(integrity.value?.findings) ? integrity.value.findings : []);
const freezeDiff = computed(() => Number(integrity.value?.checks?.account?.freeze_diff || 0));
const failedTotal = computed(() => {
  const tech = Number(integrity.value?.audit?.failed_technical_total || 0);
  const fin = Number(integrity.value?.audit?.failed_financial_total || 0);
  return tech + fin;
});
const techScopes = computed(() => Array.isArray(integrity.value?.audit?.top_technical_scopes) ? integrity.value.audit.top_technical_scopes : []);
const finScopes = computed(() => Array.isArray(integrity.value?.audit?.top_financial_scopes) ? integrity.value.audit.top_financial_scopes : []);

const busy = computed(() => integrityLoading.value || auditLoading.value || matching.value || resetting.value || syncingSchema.value);
const hintText = computed(() => type.value === 'financial' ? '资金与交易事件审计流' : '系统与业务行为审计流');

const hasActiveFilters = computed(() => {
  const keys = Object.keys(filters) as Array<keyof typeof filters>;
  return keys.some((k) => String(filters[k] || '').trim() !== '') || exactMode.value;
});

const showFinancialMismatchTip = computed(() =>
  type.value === 'financial' &&
  !auditLoading.value &&
  rows.value.length === 0 &&
  financialBaselineTotal.value > 0 &&
  hasActiveFilters.value
);

const tabClass = (target: AuditType) => ['tab-btn', type.value === target ? 'active' : ''];
const presetClass = (preset: Preset) => ['preset-btn', activePreset.value === preset ? 'active' : ''];

const toNumOrUndef = (v: string) => {
  if (!v) return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
};

const clearFiltersState = () => {
  filters.keyword = '';
  filters.order_id = '';
  filters.symbol = '';
  filters.request_id = '';
  filters.scope = '';
  filters.status = '';
  filters.category = '';
  filters.subcategory = '';
  filters.tag = '';
  filters.amount_min = '';
  filters.amount_max = '';
  filters.time_from = '';
  filters.time_to = '';
  exactMode.value = false;
  activePreset.value = 'all';
};

const setTodayRange = () => {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  filters.time_from = `${y}-${m}-${d} 00:00:00`;
  filters.time_to = `${y}-${m}-${d} 23:59:59`;
};

const loadIntegrity = async () => {
  integrityLoading.value = true;
  try {
    integrity.value = await api.getIntegrity();
  } catch {
    notifyError('风控体检加载失败');
  } finally {
    integrityLoading.value = false;
  }
};

const loadFinancialBaseline = async () => {
  try {
    const res: any = await api.getAuditLogs({
      type: 'financial',
      page: 1,
      page_size: 1
    });
    financialBaselineTotal.value = Number(res?.total || 0);
  } catch {
    financialBaselineTotal.value = 0;
  }
};

const loadAudit = async () => {
  auditLoading.value = true;
  try {
    const res: any = await api.getAuditLogs({
      type: type.value,
      page: page.value,
      page_size: pageSize.value,
      keyword: filters.keyword || undefined,
      exact: exactMode.value ? 1 : 0,
      order_id: toNumOrUndef(filters.order_id),
      symbol: filters.symbol || undefined,
      request_id: filters.request_id || undefined,
      scope: filters.scope || undefined,
      status: filters.status || undefined,
      category: filters.category || undefined,
      subcategory: filters.subcategory || undefined,
      tag: filters.tag || undefined,
      amount_min: type.value === 'financial' ? toNumOrUndef(filters.amount_min) : undefined,
      amount_max: type.value === 'financial' ? toNumOrUndef(filters.amount_max) : undefined,
      time_from: filters.time_from || undefined,
      time_to: filters.time_to || undefined
    });
    rows.value = Array.isArray(res?.items) ? res.items.map((x: any) => normalizeAuditRow(x)) : [];
    total.value = Number(res?.total || 0);
    totalPages.value = Math.max(1, Number(res?.total_pages || 1));
  } catch {
    notifyError('审计查询失败');
  } finally {
    auditLoading.value = false;
  }
};

const refreshAll = async () => {
  const auditTask = (async () => {
    if (type.value === 'financial') await loadFinancialBaseline();
    await loadAudit();
  })();
  await Promise.all([loadIntegrity(), auditTask, store.fetchAdminData(false)]);
};

const switchType = async (next: AuditType) => {
  if (type.value === next) return;
  type.value = next;
  clearFiltersState();
  page.value = 1;
  if (next === 'financial') await loadFinancialBaseline();
  await loadAudit();
};

const search = async () => {
  page.value = 1;
  if (type.value === 'financial') await loadFinancialBaseline();
  await loadAudit();
};

const goPage = async (next: number) => {
  if (next < 1 || next > totalPages.value) return;
  page.value = next;
  await loadAudit();
};

const resetFilters = async () => {
  clearFiltersState();
  page.value = 1;
  if (type.value === 'financial') await loadFinancialBaseline();
  await loadAudit();
};

const applyPreset = async (preset: Preset) => {
  activePreset.value = preset;

  if (preset === 'all') {
    filters.status = '';
    filters.keyword = '';
    filters.time_from = '';
    filters.time_to = '';
  } else if (preset === 'trade') {
    type.value = 'financial';
    filters.keyword = 'TRADE_EXECUTE';
    filters.status = '';
    filters.time_from = '';
    filters.time_to = '';
  } else if (preset === 'success') {
    filters.status = 'SUCCESS';
  } else if (preset === 'failed') {
    filters.status = 'FAILED';
  } else if (preset === 'today') {
    setTodayRange();
  }

  page.value = 1;
  if (type.value === 'financial') await loadFinancialBaseline();
  await loadAudit();
};

const manualMatch = async () => {
  if (matching.value) return;
  if (!window.confirm('确认立即执行一次撮合？')) return;

  matching.value = true;
  try {
    const result: any = await api.match({ reason: 'audit-center-manual' });
    const checked = Number(result?.checked || 0);
    const triggered = Number(result?.triggered || 0);
    notifyInfo('撮合完成', `检查 ${checked} 笔，触发 ${triggered} 笔`);
    await refreshAll();
  } finally {
    matching.value = false;
  }
};

const initializeSystem = async () => {
  const first = window.confirm('将清空持仓、委托、成交、审计日志等所有运行数据，是否继续？');
  if (!first) return;

  const second = window.prompt('请输入 RESET 以确认初始化');
  if (second !== 'RESET') {
    notifyError('初始化已取消', '确认字符串不匹配');
    return;
  }

  resetting.value = true;
  try {
    await api.initSystem('RESET');
    notifySuccess('初始化完成', '持仓、订单、成交与审计日志已清空');
    clearFiltersState();
    page.value = 1;
    financialBaselineTotal.value = 0;
    await refreshAll();
  } catch {
    notifyError('初始化失败');
  } finally {
    resetting.value = false;
  }
};

const syncSchema = async () => {
  if (syncingSchema.value) return;
  const ok = window.confirm('执行无损结构同步？将补齐新架构字段与索引，不会清空业务数据。');
  if (!ok) return;
  syncingSchema.value = true;
  try {
    const result: any = await api.initSystem('SYNC');
    const added = Array.isArray(result?.schema_sync?.added_columns) ? result.schema_sync.added_columns.length : 0;
    notifySuccess('结构同步完成', `新增字段 ${added} 项`);
    await refreshAll();
  } catch {
    notifyError('结构同步失败');
  } finally {
    syncingSchema.value = false;
  }
};

const formatMeta = (meta: any) => {
  if (!meta) return '';
  if (typeof meta === 'string') return meta;
  try {
    return JSON.stringify(meta, null, 2);
  } catch {
    return String(meta);
  }
};

const maybeParseJsonText = (value: any) => {
  if (typeof value !== 'string') return value;
  const raw = value.trim();
  if (!raw || (!raw.startsWith('{') && !raw.startsWith('['))) return value;
  try {
    return JSON.parse(raw);
  } catch {
    return value;
  }
};

const normalizeTags = (value: any) => {
  if (Array.isArray(value)) return value.map((x) => String(x || '').trim()).filter(Boolean);
  const text = String(value || '').trim();
  if (!text) return [];
  return text.split(',').map((x) => x.trim()).filter(Boolean);
};

const normalizeAuditRow = (row: any) => {
  const meta = maybeParseJsonText(row?.meta);
  return {
    ...row,
    source: row?.source === 'financial' ? 'financial' : 'technical',
    tags: normalizeTags(row?.tags),
    meta: (meta && typeof meta === 'object') ? meta : {}
  };
};

const shortMessage = (item: any) => {
  const text = String(item?.message || item?.reason || '').trim();
  if (!text) return '--';
  return text.length > 100 ? `${text.slice(0, 100)}...` : text;
};

const openDetail = (item: any) => {
  detailItem.value = normalizeAuditRow(item || {});
  detailText.value = formatMeta({
    ...detailItem.value,
    tags: normalizeTags(detailItem.value?.tags),
    meta: detailItem.value?.meta || {}
  });
  detailVisible.value = true;
};

const closeDetail = () => {
  detailVisible.value = false;
  detailItem.value = null;
};

const toggleBodyScroll = (locked: boolean) => {
  if (typeof document === 'undefined') return;
  document.body.style.overflow = locked ? 'hidden' : '';
};

watch(detailVisible, (visible) => {
  toggleBodyScroll(visible);
});

const prettyStatus = (item: any) => {
  const status = String(item?.status || item?.level || '').toUpperCase();
  return status || '--';
};

const statusClass = (item: any) => {
  const status = String(item?.status || item?.level || '').toUpperCase();
  if (status === 'SUCCESS' || status === 'INFO') return 'ok';
  if (status === 'FAILED' || status === 'ERROR') return 'bad';
  if (status === 'WARN') return 'warn';
  return 'neutral';
};

const entityOrder = (item: any) => {
  const direct = item?.order_id;
  if (direct !== null && direct !== undefined && direct !== '') return direct;
  const m = (item?.meta && typeof item.meta === 'object') ? item.meta : {};
  return m.order_id ?? m.orderId ?? '--';
};

const entitySymbol = (item: any) => {
  const direct = item?.symbol;
  if (direct) return direct;
  const m = (item?.meta && typeof item.meta === 'object') ? item.meta : {};
  return m.symbol || '--';
};

const entityReq = (item: any) => {
  const direct = item?.request_id;
  if (direct) return direct;
  const m = (item?.meta && typeof item.meta === 'object') ? item.meta : {};
  return m.request_id || m.requestId || '--';
};

const bootstrap = async () => {
  await refreshAll();
};

onMounted(() => {
  void bootstrap();
});

onUnmounted(() => {
  toggleBodyScroll(false);
});
</script>

<style scoped>
.audit-center-page {
  display: grid;
  gap: 10px;
}

.health-card,
.command-card,
.risk-panel,
.audit-list {
  padding: 10px;
}

.health-head,
.command-top {
  display: flex;
  justify-content: space-between;
  gap: 10px;
}

.sub-text {
  margin: 4px 0 0;
  font-size: 12px;
  color: var(--text-muted);
}

.top-actions {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}

.metric-grid {
  display: grid;
  gap: 8px;
}

.metric-grid-health {
  grid-template-columns: repeat(5, minmax(0, 1fr));
  margin-top: 8px;
}

.metric-box {
  border: 1px solid var(--line);
  border-radius: var(--radius-sm);
  background: var(--surface-soft);
  padding: 8px 10px;
  display: grid;
  gap: 3px;
}

.metric-box span {
  font-size: 11px;
  color: var(--text-muted);
}

.metric-box strong {
  font-size: 16px;
}

.metric-box .ok {
  color: #067647;
}

.metric-box .bad {
  color: #b42318;
}

.risk-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
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
  margin-top: 8px;
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
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

.scope-list .scope-empty {
  justify-content: center;
  color: var(--text-muted);
}

.command-card {
  display: grid;
  gap: 8px;
  position: sticky;
  top: 58px;
  z-index: 20;
}

.tab-row {
  display: flex;
  gap: 6px;
}

.tab-btn {
  border: 1px solid var(--line-strong);
  background: #fff;
  color: var(--text-soft);
  border-radius: var(--radius-sm);
  padding: 6px 10px;
  font-size: 12px;
  font-weight: 700;
}

.tab-btn.active {
  background: rgba(16, 163, 127, 0.1);
  border-color: rgba(16, 163, 127, 0.4);
  color: #0f766e;
}

.preset-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
}

.preset-btn {
  border: 1px solid var(--line);
  background: #fff;
  color: var(--text-soft);
  border-radius: var(--radius-sm);
  padding: 4px 8px;
  font-size: 11px;
  font-weight: 700;
}

.preset-btn.active {
  border-color: rgba(16, 163, 127, 0.4);
  background: rgba(16, 163, 127, 0.1);
  color: #0f766e;
}

.quick-grid,
.more-grid {
  display: grid;
  grid-template-columns: repeat(6, minmax(0, 1fr));
  gap: 6px;
}

.filter-input {
  width: 100%;
  border: 1px solid var(--line-strong);
  border-radius: var(--radius-sm);
  background: #fff;
  padding: 7px 8px;
  font-size: 12px;
}

.filter-input:focus {
  outline: none;
  border-color: var(--brand);
  box-shadow: 0 0 0 2px rgba(16, 163, 127, 0.12);
}

.command-actions {
  display: flex;
  align-items: center;
  gap: 6px;
}

.compact {
  padding: 5px 8px;
  font-size: 11px;
}

.danger-btn {
  border-color: rgba(220, 38, 38, 0.45);
  color: #991b1b;
}

.exact-toggle {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  margin-left: auto;
}

.diag-tip {
  padding: 10px 12px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  border-color: #bbf7d0;
  background: #f0fdf4;
}

.diag-tip strong {
  display: block;
  font-size: 13px;
  color: #166534;
}

.diag-tip p {
  margin: 4px 0 0;
  font-size: 12px;
  color: #166534;
}

.audit-list {
  overflow: hidden;
}

.list-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0 2px 10px;
  border-bottom: 1px solid var(--line);
  font-size: 12px;
}

.hint {
  color: var(--text-muted);
}

.source-pill {
  display: inline-flex;
  border-radius: var(--radius-sm);
  padding: 2px 6px;
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.06em;
}

.source-pill.fin {
  color: #166534;
  background: #f0fdf4;
  border: 1px solid #bbf7d0;
}

.source-pill.tech {
  color: #344054;
  background: #f2f4f7;
  border: 1px solid #d0d5dd;
}

.status-pill {
  display: inline-flex;
  border-radius: var(--radius-sm);
  padding: 2px 6px;
  font-size: 10px;
  font-weight: 800;
}

.status-pill.ok {
  color: #067647;
  background: #dafbe9;
}

.status-pill.bad {
  color: #b42318;
  background: #fee4e2;
}

.status-pill.warn {
  color: #b54708;
  background: #fffaeb;
}

.status-pill.neutral {
  color: #475467;
  background: #eaecf0;
}

.subline {
  font-size: 11px;
  color: var(--text-muted);
}

.detail-block {
  display: grid;
  gap: 2px;
}

.pager {
  display: flex;
  justify-content: flex-end;
  align-items: center;
  gap: 8px;
  padding: 10px 0 0;
  border-top: 1px solid var(--line);
  margin-top: 8px;
}

.modal-mask {
  position: fixed;
  inset: 0;
  background: rgba(15, 23, 42, 0.44);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
  z-index: 2400;
}

.modal-card {
  width: min(980px, 96vw);
  max-height: 86vh;
  overflow: hidden;
  border-radius: var(--radius-lg);
  border: 1px solid var(--line);
  background: #fff;
  padding: 10px;
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
}

.modal-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}

.modal-head h3 {
  margin: 0;
  font-size: 14px;
}

.modal-body {
  overflow: auto;
  display: grid;
  gap: 10px;
  padding: 2px 2px 0;
}

.detail-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}

.kv-item {
  border: 1px solid var(--line);
  border-radius: var(--radius-sm);
  background: #fff;
  padding: 7px 8px;
  display: grid;
  gap: 2px;
}

.kv-item.full {
  grid-column: 1 / -1;
}

.kv-item span {
  font-size: 10px;
  color: var(--text-muted);
}

.kv-item strong {
  font-size: 12px;
  color: var(--text-soft);
  overflow-wrap: anywhere;
}

.detail-raw {
  border: 1px solid var(--line);
  border-radius: var(--radius-sm);
  background: #fbfdff;
  padding: 8px;
}

.detail-raw summary {
  cursor: pointer;
  font-size: 12px;
  font-weight: 700;
  color: var(--text-soft);
}

.modal-card pre {
  margin: 8px 0 0;
  white-space: pre-wrap;
  font-size: 11px;
  font-family: 'JetBrains Mono', monospace;
  color: var(--text-soft);
  overflow-wrap: anywhere;
}

@media (max-width: 1280px) {
  .metric-grid-health {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }

  .quick-grid,
  .more-grid {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
}

@media (max-width: 960px) {
  .risk-grid,
  .scope-grid {
    grid-template-columns: 1fr;
  }

  .detail-grid {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 760px) {
  .metric-grid-health,
  .quick-grid,
  .more-grid {
    grid-template-columns: 1fr;
  }

  .health-head,
  .command-top {
    flex-direction: column;
  }

  .exact-toggle {
    margin-left: 0;
  }

  .command-card {
    top: 8px;
  }

  .diag-tip {
    flex-direction: column;
    align-items: flex-start;
  }
}
</style>
