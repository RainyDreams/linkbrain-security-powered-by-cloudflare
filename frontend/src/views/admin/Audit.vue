<template>
  <div class="audit-page">
    <!-- Health strip -->
    <section class="surface health-card">
      <header class="card-head">
        <div>
          <h3 class="t-title">系统健康度</h3>
          <p class="t-sub">资金一致性、审计异常与可执行的运维动作</p>
        </div>
        <div class="head-actions">
          <button class="btn btn-secondary" :disabled="busy" @click="loadIntegrity">
            <span v-if="integrityLoading" class="spinner"></span>
            <span>{{ integrityLoading ? '刷新中...' : '体检' }}</span>
          </button>
          <button class="btn btn-secondary" :disabled="busy || syncingSchema" @click="syncSchema">
            <span v-if="syncingSchema" class="spinner"></span>
            <span>{{ syncingSchema ? '同步中...' : '结构同步' }}</span>
          </button>
          <button class="btn btn-secondary" :disabled="busy || matching" @click="manualMatch">
            <span v-if="matching" class="spinner"></span>
            <span>{{ matching ? '撮合中...' : '手动撮合' }}</span>
          </button>
          <button class="btn btn-danger" :disabled="busy || resetting" @click="initializeSystem">
            <span v-if="resetting" class="spinner"></span>
            <span>{{ resetting ? '初始化中...' : '初始化清空' }}</span>
          </button>
        </div>
      </header>

      <div class="health-grid">
        <div class="health-cell">
          <span class="h-label">健康</span>
          <span :class="['tag', integrity?.healthy ? 'tag-up' : 'bg-down']">
            {{ integrity?.healthy ? 'HEALTHY' : 'RISK' }}
          </span>
        </div>
        <div class="health-cell">
          <span class="h-label">风险等级</span>
          <span class="h-value mono">{{ integrity?.severity || '--' }}</span>
        </div>
        <div class="health-cell">
          <span class="h-label">冻结差异 (分)</span>
          <span :class="['h-value mono', freezeDiff === 0 ? 'num-up' : 'num-down']">{{ freezeDiff }}</span>
        </div>
        <div class="health-cell">
          <span class="h-label">失败审计</span>
          <span class="h-value mono">{{ failedTotal }}</span>
        </div>
        <div class="health-cell">
          <span class="h-label">审计总量</span>
          <span class="h-value mono">{{ total }}</span>
        </div>
      </div>

      <div class="health-findings" v-if="findings.length > 0">
        <strong>问题列表：</strong>
        <ul>
          <li v-for="(f, i) in findings" :key="i">{{ f }}</li>
        </ul>
      </div>
    </section>

    <!-- Audit query panel -->
    <section class="surface query-card">
      <header class="card-head">
        <div class="tabs">
          <button v-for="t in tabs" :key="t.value"
            :class="['tab', type === t.value ? 'is-active' : '']"
            @click="switchType(t.value)">
            {{ t.label }}
          </button>
        </div>
        <div class="head-actions">
          <button class="btn btn-secondary" :disabled="auditLoading" @click="search">查询</button>
          <button class="btn btn-ghost" :disabled="auditLoading" @click="resetFilters">清空</button>
        </div>
      </header>

      <div class="preset-row">
        <button v-for="p in presets" :key="p.value"
          :class="['preset-btn', activePreset === p.value ? 'is-active' : '']"
          @click="applyPreset(p.value)">
          {{ p.label }}
        </button>
        <label class="exact-toggle">
          <input type="checkbox" v-model="exactMode" />
          <span>精确匹配</span>
        </label>
      </div>

      <div class="filter-grid">
        <input v-model.trim="filters.keyword" class="input" placeholder="关键词 / event / message" @keyup.enter="search" />
        <input v-model.trim="filters.scope" class="input" placeholder="scope" @keyup.enter="search" />
        <input v-model.trim="filters.status" class="input" placeholder="status" @keyup.enter="search" />
        <input v-model.trim="filters.order_id" class="input input-mono" placeholder="order_id" @keyup.enter="search" />
        <input v-model.trim="filters.symbol" class="input" placeholder="symbol" @keyup.enter="search" />
        <input v-model.trim="filters.request_id" class="input" placeholder="request_id" @keyup.enter="search" />
        <input v-model.trim="filters.tag" class="input" placeholder="tag" @keyup.enter="search" />
        <input v-model.trim="filters.category" class="input" placeholder="category" @keyup.enter="search" />
        <input v-model.trim="filters.time_from" class="input input-mono" placeholder="time_from (YYYY-MM-DD HH:MM:SS)" />
        <input v-model.trim="filters.time_to" class="input input-mono" placeholder="time_to (YYYY-MM-DD HH:MM:SS)" />
        <template v-if="type === 'financial'">
          <input v-model.trim="filters.amount_min" class="input input-mono" placeholder="amount_min (cent)" />
          <input v-model.trim="filters.amount_max" class="input input-mono" placeholder="amount_max (cent)" />
        </template>
      </div>
    </section>

    <!-- Result table -->
    <section class="surface result-card">
      <header class="card-head compact">
        <div>
          <h3 class="t-title">审计日志</h3>
          <p class="t-sub">{{ type === 'financial' ? '资金与交易事件审计' : '系统与业务行为审计' }} · 共 {{ total }} 条</p>
        </div>
      </header>

      <div v-if="auditLoading" class="empty">
        <span class="spinner"></span>
      </div>
      <div v-else-if="rows.length === 0" class="empty">
        <span class="empty-title">暂无{{ type === 'financial' ? '财务' : '技术' }}审计记录</span>
        <span class="text-faint">尝试清空筛选条件或切换 tab</span>
      </div>

      <div v-else class="tbl-wrap scroll-thin">
        <table class="tbl tbl-condensed">
          <thead>
            <tr>
              <th>时间 (CST)</th>
              <th>来源</th>
              <th>scope</th>
              <th>分类</th>
              <th>状态</th>
              <th>事件/级别</th>
              <th>实体</th>
              <th>消息</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="r in rows" :key="`${r.source}-${r.id}`" class="tbl-clickable" @click="openDetail(r)">
              <td class="mono text-faint" style="font-size:11px;">{{ r.created_at_cst || '--' }}</td>
              <td>
                <span :class="['source-pill', r.source === 'financial' ? 'fin' : 'tech']">
                  {{ r.source === 'financial' ? 'FIN' : 'TECH' }}
                </span>
              </td>
              <td class="mono" style="font-size:11px;">{{ r.scope || '--' }}</td>
              <td>
                <div>{{ r.category || '--' }}</div>
                <div class="text-faint" style="font-size:11px;">{{ r.subcategory || '' }}</div>
              </td>
              <td>
                <span :class="['tag', statusTagClass(r.status)]">{{ String(r.status || r.level || '--').toUpperCase() }}</span>
              </td>
              <td class="mono" style="font-size:11px;">
                {{ r.source === 'financial' ? (r.event_type || '--') : (r.level || '--') }}
              </td>
              <td class="mono text-faint" style="font-size:11px;">
                <div>o: {{ entityOrder(r) }}</div>
                <div>s: {{ r.symbol || '--' }}</div>
              </td>
              <td class="message-cell">
                <div class="msg-headline">{{ shortMessage(r) }}</div>
                <div v-if="r.source === 'financial'" class="text-faint mono" style="font-size:11px;">
                  amt {{ r.amount || 0 }} · qty {{ r.qty || 0 }} · fee {{ r.fee || 0 }}
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <footer class="pager">
        <span class="mono text-muted">{{ page }} / {{ totalPages }}</span>
        <div>
          <button class="btn btn-secondary btn-sm" :disabled="page <= 1" @click="goPage(page - 1)">上一页</button>
          <button class="btn btn-secondary btn-sm" :disabled="page >= totalPages" @click="goPage(page + 1)">下一页</button>
        </div>
      </footer>
    </section>

    <!-- Detail modal -->
    <Teleport to="body">
      <div v-if="detailVisible" class="modal-mask" @click.self="closeDetail">
        <div class="modal-shell is-xl">
          <header class="modal-header">
            <div>
              <h3 class="modal-title">审计详情</h3>
              <p class="t-sub" style="margin-top:2px;">{{ detailItem?.source === 'financial' ? '财务审计' : '技术审计' }} · #{{ detailItem?.id || '--' }}</p>
            </div>
            <button class="btn btn-ghost btn-icon" @click="closeDetail">×</button>
          </header>
          <div class="modal-body">
            <div class="detail-grid">
              <div class="kv"><span>来源</span><strong>{{ detailItem?.source || '--' }}</strong></div>
              <div class="kv"><span>状态</span><strong>{{ detailItem?.status || detailItem?.level || '--' }}</strong></div>
              <div class="kv"><span>scope</span><strong>{{ detailItem?.scope || '--' }}</strong></div>
              <div class="kv"><span>分类</span><strong>{{ detailItem?.category || '--' }} / {{ detailItem?.subcategory || '--' }}</strong></div>
              <div class="kv"><span>时间</span><strong class="mono">{{ detailItem?.created_at_cst || detailItem?.created_at || '--' }}</strong></div>
              <div class="kv"><span>请求</span><strong class="mono">{{ detailItem?.request_id || '--' }}</strong></div>
              <div class="kv"><span>订单</span><strong class="mono">{{ entityOrder(detailItem) }}</strong></div>
              <div class="kv"><span>标的</span><strong>{{ detailItem?.symbol || '--' }}</strong></div>
              <div class="kv kv-full"><span>消息</span><strong>{{ detailItem?.message || detailItem?.reason || '--' }}</strong></div>
            </div>
            <details open class="raw-details">
              <summary>meta / 原始记录</summary>
              <pre>{{ detailText }}</pre>
            </details>
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
const exactMode = ref(false);
const page = ref(1);
const pageSize = ref(20);
const totalRows = ref(0);
const totalPages = ref(1);
const rows = ref<any[]>([]);
const detailVisible = ref(false);
const detailText = ref('');
const detailItem = ref<any>(null);
const activePreset = ref<Preset>('all');

const filters = reactive({
  keyword: '', order_id: '', symbol: '', request_id: '',
  scope: '', status: '', category: '', subcategory: '',
  tag: '', amount_min: '', amount_max: '',
  time_from: '', time_to: ''
});

const tabs = [
  { value: 'technical' as AuditType, label: '技术审计' },
  { value: 'financial' as AuditType, label: '财务审计' }
];
const presets: Array<{ value: Preset; label: string }> = [
  { value: 'all', label: '全部' },
  { value: 'success', label: '仅成功' },
  { value: 'failed', label: '仅失败' },
  { value: 'trade', label: '仅成交' },
  { value: 'today', label: '今日' }
];

const findings = computed(() => Array.isArray(integrity.value?.findings) ? integrity.value.findings : []);
const freezeDiff = computed(() => Number(integrity.value?.checks?.account?.freeze_diff || 0));
const failedTotal = computed(() => {
  const tech = Number(integrity.value?.audit?.failed_technical_total || 0);
  const fin = Number(integrity.value?.audit?.failed_financial_total || 0);
  return tech + fin;
});
const totalAudits = computed(() => Number(integrity.value?.audit?.failed_technical_total || 0) + Number(integrity.value?.audit?.failed_financial_total || 0));
const busy = computed(() => integrityLoading.value || auditLoading.value || matching.value || resetting.value || syncingSchema.value);

const statusTagClass = (s: string) => {
  const v = String(s || '').toUpperCase();
  if (v === 'SUCCESS' || v === 'INFO' || v === 'DONE' || v === 'EXECUTED') return 'tag-up';
  if (v === 'FAILED' || v === 'ERROR' || v === 'REJECTED') return 'bg-down';
  if (v === 'WARN' || v === 'WARNING' || v === 'SKIPPED' || v === 'PENDING') return 'tag-warn';
  return 'tag-neutral';
};

const toNumOrUndef = (v: string) => {
  if (!v) return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
};

const clearFiltersState = () => {
  for (const k of Object.keys(filters) as Array<keyof typeof filters>) filters[k] = '';
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
  try { integrity.value = await api.getIntegrity(); }
  catch { notifyError('体检加载失败'); }
  finally { integrityLoading.value = false; }
};

const loadAudit = async () => {
  auditLoading.value = true;
  try {
    const res: any = await api.getAuditLogs({
      type: type.value,
      page: page.value, page_size: pageSize.value,
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
    rows.value = Array.isArray(res?.items) ? res.items : [];
    totalRows.value = Number(res?.total || 0);
    totalPages.value = Math.max(1, Number(res?.total_pages || 1));
  } catch {
    notifyError('审计查询失败');
  } finally {
    auditLoading.value = false;
  }
};

const refreshAll = async () => {
  await Promise.all([loadIntegrity(), loadAudit()]);
};

const switchType = async (next: AuditType) => {
  if (type.value === next) return;
  type.value = next;
  clearFiltersState();
  page.value = 1;
  await loadAudit();
};

const search = async () => { page.value = 1; await loadAudit(); };
const goPage = async (n: number) => {
  if (n < 1 || n > totalPages.value) return;
  page.value = n;
  await loadAudit();
};
const resetFilters = async () => { clearFiltersState(); page.value = 1; await loadAudit(); };

const applyPreset = async (preset: Preset) => {
  activePreset.value = preset;
  if (preset === 'all') { filters.status = ''; filters.keyword = ''; filters.time_from = ''; filters.time_to = ''; }
  else if (preset === 'trade') { type.value = 'financial'; filters.keyword = 'TRADE_EXECUTE'; filters.status = ''; filters.time_from = ''; filters.time_to = ''; }
  else if (preset === 'success') { filters.status = 'SUCCESS'; }
  else if (preset === 'failed') { filters.status = 'FAILED'; }
  else if (preset === 'today') { setTodayRange(); }
  page.value = 1;
  await loadAudit();
};

const manualMatch = async () => {
  if (matching.value) return;
  if (!window.confirm('确认立即执行一次撮合？')) return;
  matching.value = true;
  try {
    const r: any = await api.match({ reason: 'audit-center-manual' });
    notifyInfo('撮合完成', `检查 ${r?.checked || 0} 笔，触发 ${r?.triggered || 0} 笔`);
    await Promise.all([loadAudit(), store.fetchAdminData(false)]);
  } finally { matching.value = false; }
};

const initializeSystem = async () => {
  if (!window.confirm('将清空持仓、委托、成交、审计日志等所有运行数据，是否继续？')) return;
  const second = window.prompt('请输入 RESET 以确认初始化');
  if (second !== 'RESET') { notifyError('初始化已取消', '确认字符串不匹配'); return; }
  resetting.value = true;
  try {
    await api.initSystem('RESET');
    notifySuccess('初始化完成', '持仓、订单、成交与审计日志已清空');
    clearFiltersState(); page.value = 1;
    await refreshAll();
  } catch { notifyError('初始化失败'); }
  finally { resetting.value = false; }
};

const syncSchema = async () => {
  if (syncingSchema.value) return;
  if (!window.confirm('执行无损结构同步？将补齐新架构字段与索引，不会清空业务数据。')) return;
  syncingSchema.value = true;
  try {
    const r: any = await api.initSystem('SYNC');
    const added = Array.isArray(r?.schema_sync?.added_columns) ? r.schema_sync.added_columns.length : 0;
    notifySuccess('结构同步完成', `新增字段 ${added} 项`);
    await refreshAll();
  } catch { notifyError('结构同步失败'); }
  finally { syncingSchema.value = false; }
};

const formatMeta = (meta: any) => {
  if (!meta) return '';
  if (typeof meta === 'string') return meta;
  try { return JSON.stringify(meta, null, 2); } catch { return String(meta); }
};

const normalizeAuditRow = (row: any) => {
  const m = (row?.meta && typeof row.meta === 'object') ? row.meta : {};
  return {
    ...row,
    source: row?.source === 'financial' ? 'financial' : 'technical',
    meta: m
  };
};

const shortMessage = (item: any) => {
  const text = String(item?.message || item?.reason || '').trim();
  if (!text) return '--';
  return text.length > 100 ? `${text.slice(0, 100)}…` : text;
};

const entityOrder = (item: any) => {
  if (!item) return '--';
  if (item.order_id) return item.order_id;
  return item.meta?.order_id || '--';
};

const openDetail = (item: any) => {
  detailItem.value = normalizeAuditRow(item);
  detailText.value = formatMeta(detailItem.value);
  detailVisible.value = true;
};
const closeDetail = () => { detailVisible.value = false; detailItem.value = null; };

const toggleBodyScroll = (locked: boolean) => {
  if (typeof document === 'undefined') return;
  document.body.style.overflow = locked ? 'hidden' : '';
};
watch(detailVisible, (v) => toggleBodyScroll(v));
onUnmounted(() => toggleBodyScroll(false));

onMounted(() => { void refreshAll(); });
</script>

<style scoped>
.audit-page { display: flex; flex-direction: column; gap: 14px; max-width: 1440px; }

.health-card, .query-card, .result-card { padding: 0; }
.card-head { padding: 14px 18px; border-bottom: 1px solid var(--line); display: flex; justify-content: space-between; align-items: center; gap: 10px; flex-wrap: wrap; }
.card-head.compact { padding: 10px 18px; }
.t-title { font-size: 14px; font-weight: 700; color: var(--text-strong); }
.t-sub { font-size: 12px; color: var(--text-muted); margin-top: 2px; }
.head-actions { display: flex; gap: 6px; flex-wrap: wrap; }
.head-actions .btn { min-width: 0; }

.health-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px 16px; padding: 12px 18px; border-top: 1px solid var(--line-soft); }
.health-cell { display: flex; flex-direction: column; gap: 3px; }
.h-label { font-size: 11px; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.06em; font-weight: 600; }
.h-value { font-size: 16px; font-weight: 700; color: var(--text-strong); }
@media (min-width: 1080px) { .health-grid { grid-template-columns: repeat(5, minmax(0, 1fr)); } }

.health-findings { padding: 10px 18px 14px; border-top: 1px solid var(--line-soft); background: var(--bg-subtle); }
.health-findings strong { font-size: 12.5px; color: var(--down); margin-right: 6px; }
.health-findings ul { margin: 6px 0 0 16px; padding: 0; display: grid; gap: 4px; font-size: 12.5px; color: var(--text-soft); }

.tabs { display: inline-flex; padding: 2px; background: var(--bg-inset); border-radius: var(--r-sm); gap: 2px; }
.tab { height: 28px; padding: 0 14px; border: 0; background: transparent; font-size: 12.5px; font-weight: 600; color: var(--text-soft); border-radius: var(--r-xs); cursor: pointer; }
.tab.is-active { background: var(--bg-elev); color: var(--text-strong); box-shadow: var(--shadow-1); }

.preset-row { padding: 10px 18px; display: flex; gap: 6px; align-items: center; flex-wrap: wrap; border-top: 1px solid var(--line-soft); }
.preset-btn { height: 28px; padding: 0 12px; border: 1px solid var(--line); border-radius: var(--r-sm); background: var(--bg-elev); font-size: 12px; font-weight: 600; color: var(--text-soft); cursor: pointer; }
.preset-btn:hover { background: var(--bg-subtle); }
.preset-btn.is-active { background: var(--text); color: #fff; border-color: var(--text); }
.exact-toggle { display: inline-flex; align-items: center; gap: 4px; font-size: 12px; color: var(--text-soft); margin-left: auto; }

.filter-grid { padding: 10px 18px 14px; display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 6px; border-top: 1px solid var(--line-soft); }
@media (max-width: 1100px) { .filter-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); } }
@media (max-width: 720px) {
  .filter-grid { grid-template-columns: 1fr 1fr; padding: 10px 12px; }
  .preset-row { padding: 8px 12px; }
  .tabs { width: 100%; overflow-x: auto; }
  .tabs .tab { padding: 0 12px; font-size: 12px; }
  .card-head { padding: 10px 12px; gap: 8px; }
  .health-grid { padding: 10px 12px; gap: 8px 10px; }
  .health-findings { padding: 8px 12px 12px; }
  .tbl thead th { padding: 6px 8px; font-size: 10px; }
  .tbl tbody td { padding: 8px; font-size: 11.5px; }
}
@media (max-width: 480px) {
  .head-actions .btn { padding: 0 8px; height: 28px; font-size: 11px; flex: 1 1 calc(50% - 3px); justify-content: center; }
  .head-actions .btn span { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
}

.tbl-wrap { overflow: auto; max-height: 65vh; }
.tbl tbody tr { transition: background 0.1s ease; }
.source-pill { display: inline-flex; align-items: center; padding: 2px 6px; border-radius: 4px; font-size: 10px; font-weight: 800; letter-spacing: 0.06em; }
.source-pill.fin { color: var(--up); background: var(--up-soft); border: 1px solid var(--up-line); }
.source-pill.tech { color: var(--text-soft); background: var(--bg-inset); border: 1px solid var(--line-soft); }

.message-cell { max-width: 360px; }
.msg-headline { font-size: 12.5px; color: var(--text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

.pager { padding: 10px 18px; display: flex; justify-content: space-between; align-items: center; border-top: 1px solid var(--line-soft); }
.pager > div { display: flex; gap: 6px; }

.detail-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
.kv { padding: 8px 10px; border: 1px solid var(--line); border-radius: var(--r-sm); background: var(--bg-subtle); display: flex; flex-direction: column; gap: 2px; }
.kv-full { grid-column: 1 / -1; }
.kv span { font-size: 11px; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.06em; }
.kv strong { font-size: 12.5px; color: var(--text-strong); word-break: break-all; }
.raw-details { margin-top: 8px; padding: 8px 10px; border: 1px solid var(--line); border-radius: var(--r-sm); background: var(--bg-inset); }
.raw-details summary { cursor: pointer; font-size: 12px; font-weight: 600; color: var(--text-soft); }
.raw-details pre { margin: 8px 0 0; padding: 8px; font-size: 11px; font-family: 'JetBrains Mono', monospace; color: var(--text); white-space: pre-wrap; word-break: break-all; max-height: 40vh; overflow: auto; }
</style>
