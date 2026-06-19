<template>
  <div class="ai-page">
    <!-- Status strip -->
    <section class="surface status-card">
      <div class="status-top">
        <div>
          <h3 class="t-title">AI 决策委员会</h3>
          <p class="t-sub">多角色辩论决策 · 手动触发仅入队，实际执行由 cron 消费</p>
        </div>
        <div class="head-actions">
          <button class="btn btn-secondary" :disabled="running" @click="startManualDiscussion">
            <span v-if="running" class="spinner"></span>
            <span>{{ running ? '处理中...' : '发起讨论（待确认）' }}</span>
          </button>
          <button class="btn btn-primary" :disabled="running" @click="startManualExecute">
            <span v-if="running" class="spinner"></span>
            <span>{{ running ? '处理中...' : '系统执行一次' }}</span>
          </button>
        </div>
      </div>

      <div class="status-grid">
        <div class="status-cell">
          <span class="s-label">状态</span>
          <span :class="['tag', aiState?.enabled ? 'tag-up' : 'bg-down']">
            {{ aiState?.enabled ? 'ENABLED' : 'DISABLED' }}
          </span>
        </div>
        <div class="status-cell">
          <span class="s-label">今日讨论</span>
          <span class="s-value mono num-strong">{{ aiState?.daily_quota?.run_count ?? 0 }} / {{ aiState?.daily_quota?.run_limit ?? 5 }}</span>
        </div>
        <div class="status-cell">
          <span class="s-label">Gemini 请求</span>
          <span class="s-value mono num-strong">{{ aiState?.daily_quota?.gemini_requests ?? 0 }} / {{ aiState?.daily_quota?.gemini_request_limit ?? 60 }}</span>
        </div>
        <div class="status-cell">
          <span class="s-label">待确认委托</span>
          <span class="s-value mono num-strong">{{ pendingTotal }}</span>
        </div>
      </div>

      <div v-if="scheduleSlots.length > 0" class="slot-strip">
        <div v-for="slot in scheduleSlots" :key="slot.key" :class="['slot-pill', slot.consumed ? 'used' : 'idle']">
          <span class="slot-label">{{ slot.label }}</span>
          <span class="slot-time mono">{{ slot.start_hhmm }}-{{ slot.end_hhmm }}</span>
        </div>
      </div>
    </section>

    <!-- Tabs -->
    <section class="surface tabs-card">
      <div class="tabs">
        <button v-for="t in tabList" :key="t.value"
          :class="['tab', activeTab === t.value ? 'is-active' : '']"
          @click="activeTab = t.value">
          {{ t.label }}
          <span v-if="t.badge > 0" class="tab-badge">{{ t.badge }}</span>
        </button>
      </div>

      <!-- Runs tab -->
      <div v-if="activeTab === 'runs'" class="pane">
        <div v-if="loadingRuns" class="loading-line"><span class="spinner"></span><span>加载中...</span></div>
        <div v-else-if="runs.length === 0" class="empty">
          <span class="empty-title">暂无运行记录</span>
        </div>
        <div v-else class="tbl-wrap scroll-thin">
          <table class="tbl tbl-condensed">
            <thead>
              <tr>
                <th>时间</th>
                <th>触发</th>
                <th>阶段</th>
                <th>状态</th>
                <th>跳过原因</th>
                <th class="is-num">执行</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in runs" :key="row.run_id">
                <td class="mono text-faint" style="font-size:11px;">{{ row.created_at_cst || '--' }}</td>
                <td>{{ row.trigger || '--' }}</td>
                <td>{{ row.phase || '--' }}</td>
                <td><span :class="['tag', runStatusClass(row)]">{{ row.status || '--' }}</span></td>
                <td class="text-muted" style="max-width:240px;">{{ runSkipReason(row) }}</td>
                <td class="is-num mono">{{ row.executed_total || 0 }} / {{ row.actions_total || 0 }}</td>
                <td class="is-num">
                  <button class="btn btn-ghost btn-sm" @click="openRunDetail(row.run_id)">详情</button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <footer class="pager">
          <span class="mono text-muted">{{ runPage }} / {{ runTotalPages }}</span>
          <div>
            <button class="btn btn-secondary btn-sm" :disabled="runPage <= 1" @click="goRunPage(runPage - 1)">上一页</button>
            <button class="btn btn-secondary btn-sm" :disabled="runPage >= runTotalPages" @click="goRunPage(runPage + 1)">下一页</button>
          </div>
        </footer>
      </div>

      <!-- Pending tab -->
      <div v-if="activeTab === 'pending'" class="pane">
        <div class="pane-head">
          <select v-model="pendingStatus" class="select" @change="loadPending">
            <option value="PENDING">PENDING</option>
            <option value="ALL">ALL</option>
            <option value="EXECUTED">EXECUTED</option>
            <option value="REJECTED">REJECTED</option>
            <option value="FAILED">FAILED</option>
          </select>
          <div class="head-actions">
            <button class="btn btn-primary btn-sm" :disabled="confirming || selectedPendingIds.length === 0" @click="confirmSelected">批量确认</button>
            <button class="btn btn-ghost btn-sm" :disabled="confirming || selectedPendingIds.length === 0" @click="rejectSelected">批量拒绝</button>
          </div>
        </div>

        <div v-if="loadingPending" class="loading-line"><span class="spinner"></span></div>
        <div v-else-if="pendingRows.length === 0" class="empty">
          <span class="empty-title">暂无待确认动作</span>
        </div>
        <div v-else class="tbl-wrap scroll-thin">
          <table class="tbl tbl-condensed">
            <thead>
              <tr>
                <th style="width:32px;">
                  <input type="checkbox" :checked="isPendingPageAllChecked" @change="onTogglePendingPageAll($event)" />
                </th>
                <th>时间</th>
                <th>Run</th>
                <th>动作</th>
                <th>状态</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="r in pendingRows" :key="r.id">
                <td>
                  <input type="checkbox" :disabled="r.status !== 'PENDING'" :checked="selectedPendingIds.includes(r.id)" @change="onTogglePending(r.id, $event)" />
                </td>
                <td class="mono text-faint" style="font-size:11px;">{{ r.created_at_cst || '--' }}</td>
                <td class="mono text-faint" style="font-size:11px;">{{ r.run_id }}</td>
                <td>{{ pendingActionLabel(r.action) }}</td>
                <td><span :class="['tag', statusTagClass(r.status)]">{{ r.status }}</span></td>
                <td class="is-num">
                  <button class="btn btn-ghost btn-sm" @click="openPendingDetail(r)">详情</button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- Tasks tab -->
      <div v-if="activeTab === 'tasks'" class="pane">
        <div v-if="loadingTasks" class="loading-line"><span class="spinner"></span></div>
        <div v-else-if="tasks.length === 0" class="empty">
          <span class="empty-title">暂无任务</span>
        </div>
        <div v-else class="tbl-wrap scroll-thin">
          <table class="tbl tbl-condensed">
            <thead>
              <tr>
                <th>创建时间</th>
                <th>Task ID</th>
                <th>状态</th>
                <th>原因</th>
                <th>执行模式</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="t in tasks" :key="t.task_id">
                <td class="mono text-faint" style="font-size:11px;">{{ t.created_at_cst || '--' }}</td>
                <td class="mono text-faint" style="font-size:11px;">{{ t.task_id }}</td>
                <td><span :class="['tag', statusTagClass(t.status)]">{{ t.status }}</span></td>
                <td>{{ t?.payload?.reason || '--' }}</td>
                <td>{{ t?.payload?.execution_mode || '--' }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </section>

    <!-- Detail modal -->
    <Teleport to="body">
      <div v-if="detailDialogVisible" class="modal-mask" @click.self="closeDetailDialog">
        <div class="modal-shell is-2xl">
          <header class="modal-header">
            <div>
              <h3 class="modal-title">{{ detailDialogTitle }}</h3>
              <p v-if="detailRunData" class="t-sub" style="margin-top:2px;">run_id <span class="mono">{{ detailRunData.run_id }}</span></p>
            </div>
            <button class="btn btn-ghost btn-icon" @click="closeDetailDialog">×</button>
          </header>
          <div class="modal-body">
            <div v-if="detailDialogType === 'run' && detailRunData" class="detail-grid">
              <section v-if="runSkipInfo.skipped" class="skip-panel">
                <h4 class="panel-h">跳过说明</h4>
                <div class="skip-reason">{{ runSkipInfo.reason || '未返回原因' }}</div>
                <ul v-if="runSkipInfo.blockedReasons.length" class="skip-list">
                  <li v-for="(it, i) in runSkipInfo.blockedReasons" :key="`b${i}`">{{ it }}</li>
                </ul>
              </section>

              <section class="panel">
                <h4 class="panel-h">执行统计</h4>
                <div class="kv-grid">
                  <div class="kv"><span>尝试</span><strong class="mono">{{ runSummary?.execution?.attempted ?? 0 }}</strong></div>
                  <div class="kv"><span>成功</span><strong class="mono num-up">{{ runSummary?.execution?.succeeded ?? 0 }}</strong></div>
                  <div class="kv"><span>失败</span><strong class="mono num-down">{{ runSummary?.execution?.failed ?? 0 }}</strong></div>
                  <div class="kv"><span>下单</span><strong class="mono">{{ runSummary?.execution?.placed ?? 0 }}</strong></div>
                  <div class="kv"><span>撤单</span><strong class="mono">{{ runSummary?.execution?.cancelled ?? 0 }}</strong></div>
                  <div class="kv"><span>当日盈亏</span><strong class="mono">{{ runSummary?.performance?.day_pnl ?? '--' }}</strong></div>
                </div>
              </section>

              <section class="panel panel-full">
                <h4 class="panel-h">决策依据</h4>
                <div class="kv-grid">
                  <div class="kv"><span>经理胜出</span><strong>{{ runSummary?.manager_winner || '--' }}</strong></div>
                  <div class="kv"><span>角色降级</span><strong>{{ runSummary?.role_fallback_count ?? 0 }}</strong></div>
                  <div class="kv"><span>Gemini 429</span><strong>{{ runSummary?.gemini_api_throttled ? '是' : '否' }}</strong></div>
                  <div class="kv"><span>预算超额</span><strong>{{ runSummary?.gemini_budget_advisory_exceeded ? '是' : '否' }}</strong></div>
                  <div class="kv"><span>新单上限</span><strong class="mono">{{ runSummary?.risk_limits?.max_new_orders ?? '--' }}</strong></div>
                  <div class="kv"><span>单笔仓位上限</span><strong class="mono">{{ runSummary?.risk_limits?.max_single_order_ratio ?? '--' }}</strong></div>
                </div>
              </section>

              <section v-if="runNewsReferences.length > 0" class="panel panel-full">
                <h4 class="panel-h">参考新闻</h4>
                <ul class="news-list">
                  <li v-for="(it, i) in runNewsReferences" :key="`n${i}-${it.title}`" class="news-item">
                    <a :href="it.link" target="_blank" rel="noopener noreferrer" class="news-title">#{{ it.index }} · {{ it.title }}</a>
                    <div class="news-meta mono">
                      <span>{{ it.source || '--' }}</span>
                      <span>{{ it.pub_date || '--' }}</span>
                      <span>{{ (it.symbols || []).join(', ') || '--' }}</span>
                    </div>
                  </li>
                </ul>
              </section>

              <section class="panel panel-full">
                <h4 class="panel-h">讨论过程</h4>
                <div class="debate-grid">
                  <article class="debate-card">
                    <h5>总裁</h5>
                    <p><strong>市场判断：</strong>{{ runDiscussion.president.market_regime || '--' }}</p>
                    <p><strong>核心观点：</strong>{{ runDiscussion.president.strategy_thesis || '--' }}</p>
                    <p><strong>长期：</strong>{{ runDiscussion.president?.strategy_horizons?.long_term || '--' }}</p>
                    <p><strong>中期：</strong>{{ runDiscussion.president?.strategy_horizons?.mid_term || '--' }}</p>
                    <p><strong>短期：</strong>{{ runDiscussion.president?.strategy_horizons?.short_term || '--' }}</p>
                    <p><strong>做T：</strong>{{ runDiscussion.president?.strategy_horizons?.intraday_t || '--' }}</p>
                    <p><strong>T+1：</strong>{{ runDiscussion.president.t_plus_one_note || '--' }}</p>
                  </article>
                  <article class="debate-card">
                    <h5>经济学家 1</h5>
                    <p>{{ runDiscussion.economist_1.core_view || '--' }}</p>
                    <p><strong>反驳：</strong>{{ runDiscussion.economist_1.rebuttal || '--' }}</p>
                    <p><strong>风险：</strong>{{ runDiscussion.economist_1.risk_note || '--' }}</p>
                  </article>
                  <article class="debate-card">
                    <h5>经济学家 2</h5>
                    <p>{{ runDiscussion.economist_2.core_view || '--' }}</p>
                    <p><strong>反驳：</strong>{{ runDiscussion.economist_2.rebuttal || '--' }}</p>
                    <p><strong>风险：</strong>{{ runDiscussion.economist_2.risk_note || '--' }}</p>
                  </article>
                  <article class="debate-card">
                    <h5>经理结论</h5>
                    <p><strong>胜出：</strong>{{ runDiscussion.manager.winner || '--' }}</p>
                    <p><strong>理由：</strong>{{ runDiscussion.manager.decision_reason || '--' }}</p>
                    <p><strong>风险：</strong>{{ runDiscussion.manager.risk_note || '--' }}</p>
                  </article>
                </div>
              </section>

              <section v-if="runExecutionRows.length > 0" class="panel panel-full">
                <h4 class="panel-h">动作明细</h4>
                <table class="tbl tbl-condensed">
                  <thead>
                    <tr><th>类型</th><th>标的</th><th>方向</th><th class="is-num">数量</th><th class="is-num">价格</th><th>结果</th><th>说明</th></tr>
                  </thead>
                  <tbody>
                    <tr v-for="(r, i) in runExecutionRows" :key="`ex${i}`">
                      <td>{{ r?.action?.type || '--' }}</td>
                      <td class="mono">{{ r?.action?.symbol || '--' }}</td>
                      <td>{{ r?.action?.side || '--' }}</td>
                      <td class="is-num mono">{{ r?.action?.qty ?? '--' }}</td>
                      <td class="is-num mono">{{ r?.action?.price ?? '--' }}</td>
                      <td>
                        <span :class="['tag', runExecStatusClass(r)]">{{ runExecStatusText(r) }}</span>
                      </td>
                      <td class="text-muted" style="max-width:280px;">{{ r?.reason || r?.payload?.msg || '--' }}</td>
                    </tr>
                  </tbody>
                </table>
              </section>
            </div>

            <div v-else-if="detailDialogType === 'pending' && detailPendingData" class="detail-grid">
              <section class="panel">
                <h4 class="panel-h">待确认动作</h4>
                <div class="kv-grid">
                  <div class="kv"><span>ID</span><strong class="mono">#{{ detailPendingData.id }}</strong></div>
                  <div class="kv"><span>Run</span><strong class="mono">{{ detailPendingData.run_id }}</strong></div>
                  <div class="kv"><span>状态</span><strong>{{ detailPendingData.status }}</strong></div>
                  <div class="kv"><span>时间</span><strong class="mono">{{ detailPendingData.created_at_cst }}</strong></div>
                  <div class="kv"><span>类型</span><strong>{{ detailPendingData?.action?.type }}</strong></div>
                  <div class="kv"><span>方向</span><strong>{{ detailPendingData?.action?.side || '--' }}</strong></div>
                  <div class="kv"><span>标的</span><strong class="mono">{{ detailPendingData?.action?.symbol }}</strong></div>
                  <div class="kv"><span>数量/价</span><strong class="mono">{{ detailPendingData?.action?.qty ?? '--' }} / {{ detailPendingData?.action?.price ?? '--' }}</strong></div>
                </div>
              </section>
              <section v-if="pendingResultSummary" class="panel">
                <h4 class="panel-h">执行结果</h4>
                <div class="kv-grid">
                  <div class="kv"><span>尝试</span><strong class="mono">{{ pendingResultSummary.attempted ?? 0 }}</strong></div>
                  <div class="kv"><span>成功</span><strong class="mono num-up">{{ pendingResultSummary.succeeded ?? 0 }}</strong></div>
                  <div class="kv"><span>失败</span><strong class="mono num-down">{{ pendingResultSummary.failed ?? 0 }}</strong></div>
                  <div class="kv"><span>下单</span><strong class="mono">{{ pendingResultSummary.placed ?? 0 }}</strong></div>
                  <div class="kv"><span>撤单</span><strong class="mono">{{ pendingResultSummary.cancelled ?? 0 }}</strong></div>
                </div>
              </section>
            </div>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import api from '../../api';
import { notifyError, notifyInfo, notifySuccess } from '../../utils/notify';

const running = ref(false);
const confirming = ref(false);
const aiState = ref<any>(null);

const activeTab = ref<'runs' | 'pending' | 'tasks'>('runs');

const runs = ref<any[]>([]);
const runPage = ref(1);
const runPageSize = ref(20);
const runsTotal = ref(0);
const runTotalPages = ref(1);
const loadingRuns = ref(false);
const detailRunId = ref('');

const pendingRows = ref<any[]>([]);
const pendingPage = ref(1);
const pendingPageSize = ref(20);
const pendingTotal = ref(0);
const pendingTotalBadge = computed(() => Number(aiState.value?.tasks?.summary?.pending || pendingTotal.value || 0));
const pendingStatus = ref<'ALL' | 'PENDING' | 'EXECUTED' | 'REJECTED' | 'FAILED'>('PENDING');
const selectedPendingIds = ref<number[]>([]);
const loadingPending = ref(false);

const tasks = ref<any[]>([]);
const taskPage = ref(1);
const taskPageSize = ref(20);
const tasksTotal = ref(0);
const taskTotalPages = ref(1);
const loadingTasks = ref(false);

const detailDialogVisible = ref(false);
const detailDialogType = ref<'run' | 'pending' | 'text'>('text');
const detailDialogTitle = ref('');
const detailRunData = ref<any>(null);
const detailPendingData = ref<any>(null);

const scheduleSlots = computed(() => {
  const slots = aiState.value?.schedule?.slots;
  return Array.isArray(slots) ? slots : [];
});

const tabList = computed(() => [
  { value: 'runs' as const, label: '运行记录', badge: runsTotal.value },
  { value: 'pending' as const, label: '待确认', badge: pendingTotalBadge.value },
  { value: 'tasks' as const, label: '任务队列', badge: tasksTotal.value }
]);

const runSummary = computed(() => detailRunData.value?.detail?.summary || null);
const runNewsReferences = computed(() => {
  const refs = detailRunData.value?.detail?.news_references || runSummary.value?.news_references;
  return Array.isArray(refs) ? refs : [];
});
const runDiscussion = computed(() => {
  const digest = detailRunData.value?.detail?.discussion_digest || runSummary.value?.discussion_digest;
  if (digest && typeof digest === 'object') {
    return {
      president: digest?.president || {},
      economist_1: digest?.economist_1 || {},
      economist_2: digest?.economist_2 || {},
      manager: digest?.manager || {}
    };
  }
  return { president: {}, economist_1: {}, economist_2: {}, manager: {} };
});
const runExecutionRows = computed(() => {
  const rows = detailRunData.value?.detail?.execution_results;
  return Array.isArray(rows) ? rows : [];
});
const pendingResultSummary = computed(() => detailPendingData.value?.result?.summary || null);
const runInputCounts = computed(() => {
  const src = detailRunData.value?.detail?.input_excerpt || {};
  return {
    holdings: Array.isArray(src?.holdings) ? src.holdings.length : 0,
    pendingOrders: Array.isArray(src?.pending_orders) ? src.pending_orders.length : 0,
    orderHistory: Array.isArray(src?.order_history) ? src.order_history.length : 0,
    holdingHistory: Array.isArray(src?.holding_history) ? src.holding_history.length : 0
  };
});
const runSkipInfo = computed(() => {
  const summary = runSummary.value || {};
  const status = String(detailRunData.value?.status || '').toUpperCase();
  const skipped = summary?.skipped === true || status === 'SKIPPED';
  const atomic = (summary?.atomic_precheck && typeof summary.atomic_precheck === 'object') ? summary.atomic_precheck : null;
  const blocked = Array.isArray(atomic?.blocked_reasons) ? atomic.blocked_reasons.map((x: any) => String(x || '').trim()).filter(Boolean).slice(0, 3) : [];
  const nonBlocking = Array.isArray(atomic?.non_blocking_reasons) ? atomic.non_blocking_reasons.map((x: any) => String(x || '').trim()).filter(Boolean).slice(0, 3) : [];
  return {
    skipped,
    reason: String(summary?.reason || detailRunData.value?.reason || '').trim(),
    blockedCount: blocked.length,
    blockedReasons: blocked,
    nonBlockingCount: nonBlocking.length,
    nonBlockingReasons: nonBlocking
  };
});

const runStatusClass = (row: any) => {
  const s = String(row?.status || '').toUpperCase();
  if (s === 'SUCCESS' || s === 'DONE' || s === 'EXECUTED') return 'tag-up';
  if (s === 'FAILED' || s === 'ERROR' || s === 'REJECTED') return 'bg-down';
  if (s === 'SKIPPED') return 'tag-warn';
  return 'tag-neutral';
};
const statusTagClass = (s: string) => {
  const v = String(s || '').toUpperCase();
  if (['SUCCESS', 'DONE', 'EXECUTED'].includes(v)) return 'tag-up';
  if (['FAILED', 'ERROR', 'REJECTED'].includes(v)) return 'bg-down';
  if (['SKIPPED', 'PENDING', 'RUNNING', 'QUEUED'].includes(v)) return 'tag-warn';
  return 'tag-neutral';
};
const runExecStatusClass = (r: any) => {
  if (r?.pending) return 'tag-warn';
  if (r?.ok) return 'tag-up';
  if (r?.skipped) return 'tag-neutral';
  return 'bg-down';
};
const runExecStatusText = (r: any) => {
  if (r?.pending) return 'PENDING';
  if (r?.ok) return 'SUCCESS';
  if (r?.skipped) return 'SKIPPED';
  return 'FAILED';
};

const runSkipReason = (row: any) => {
  const status = String(row?.status || '').toUpperCase();
  const skipped = row?.skipped === true || status === 'SKIPPED';
  if (!skipped) return '--';
  const reason = String(row?.reason || '').trim();
  const blocked = Array.isArray(row?.blocked_reasons) ? row.blocked_reasons.map((x: any) => String(x || '').trim()).filter(Boolean) : [];
  const nonBlocking = Array.isArray(row?.non_blocking_reasons) ? row.non_blocking_reasons.map((x: any) => String(x || '').trim()).filter(Boolean) : [];
  if (!reason && !blocked.length && !nonBlocking.length) return 'SKIPPED (未返回原因)';
  return [reason, blocked[0], nonBlocking[0]].filter(Boolean).join(' | ');
};

const pendingActionLabel = (a: any) => {
  if (!a) return '--';
  const qty = Number(a.qty || 0);
  const price = Number(a.price || 0);
  return `${a.type || '--'} ${a.side || ''} ${a.symbol || ''}${qty > 0 ? ` x${qty}` : ''}${price > 0 ? ` @${price}` : ''}`.trim();
};

const pretty = (v: any) => { try { return JSON.stringify(v, null, 2); } catch { return String(v || ''); } };

const isPendingPageAllChecked = computed(() => {
  const ids = pendingRows.value.filter((x) => x.status === 'PENDING').map((x) => Number(x.id));
  if (!ids.length) return false;
  return ids.every((id) => selectedPendingIds.value.includes(id));
});
const onTogglePending = (id: number, evt: Event) => {
  const checked = (evt?.target as HTMLInputElement | null)?.checked;
  const numId = Number(id);
  if (!Number.isInteger(numId) || numId <= 0) return;
  const set = new Set(selectedPendingIds.value);
  if (checked) set.add(numId); else set.delete(numId);
  selectedPendingIds.value = Array.from(set);
};
const onTogglePendingPageAll = (evt: Event) => {
  const checked = (evt?.target as HTMLInputElement | null)?.checked;
  const ids = pendingRows.value.filter((x) => x.status === 'PENDING').map((x) => Number(x.id));
  if (checked) {
    selectedPendingIds.value = Array.from(new Set([...selectedPendingIds.value, ...ids]));
  } else {
    const del = new Set(ids);
    selectedPendingIds.value = selectedPendingIds.value.filter((id) => !del.has(id));
  }
};

const loadState = async () => { aiState.value = await api.getAiState(); };
const loadRuns = async () => {
  loadingRuns.value = true;
  try {
    const r: any = await api.getAiRuns({ page: runPage.value, page_size: runPageSize.value });
    runs.value = Array.isArray(r?.items) ? r.items : [];
    runsTotal.value = Number(r?.total || 0);
    runTotalPages.value = Math.max(1, Number(r?.total_pages || 1));
  } catch { notifyError('AI 运行记录加载失败'); }
  finally { loadingRuns.value = false; }
};
const loadPending = async () => {
  loadingPending.value = true;
  try {
    const status = pendingStatus.value === 'ALL' ? undefined : pendingStatus.value;
    const r: any = await api.getAiPendingActions({ status, page: pendingPage.value, page_size: pendingPageSize.value });
    pendingRows.value = Array.isArray(r?.items) ? r.items : [];
    pendingTotal.value = Number(r?.total || 0);
    selectedPendingIds.value = selectedPendingIds.value.filter((id) => pendingRows.value.some((x) => Number(x.id) === id && x.status === 'PENDING'));
  } catch { notifyError('待确认动作加载失败'); }
  finally { loadingPending.value = false; }
};
const loadTasks = async () => {
  loadingTasks.value = true;
  try {
    const r: any = await api.getAiTasks({ page: taskPage.value, page_size: taskPageSize.value, include_result: 0 });
    tasks.value = Array.isArray(r?.items) ? r.items : [];
    tasksTotal.value = Number(r?.total || 0);
    taskTotalPages.value = Math.max(1, Number(r?.total_pages || 1));
  } catch { notifyError('任务队列加载失败'); }
  finally { loadingTasks.value = false; }
};
const refreshAll = async () => { await Promise.all([loadState(), loadRuns(), loadPending(), loadTasks()]); };

const openRunDetail = async (runId: string) => {
  if (!runId) return;
  detailRunId.value = runId;
  try {
    const r: any = await api.getAiRuns({ run_id: runId, include_detail: 1 });
    const item = Array.isArray(r?.items) ? r.items[0] : null;
    if (!item) { notifyError('未找到运行详情'); return; }
    detailDialogTitle.value = `运行详情 · ${runId.slice(0, 8)}`;
    detailDialogType.value = 'run';
    detailRunData.value = item;
    detailPendingData.value = null;
    detailDialogVisible.value = true;
  } catch { notifyError('运行详情加载失败'); }
};
const openPendingDetail = (row: any) => {
  detailDialogTitle.value = `待确认动作 #${row?.id || '--'}`;
  detailDialogType.value = 'pending';
  detailRunData.value = null;
  detailPendingData.value = row || null;
  detailDialogVisible.value = true;
};
const closeDetailDialog = () => {
  detailDialogVisible.value = false;
  detailDialogType.value = 'text';
  detailRunData.value = null;
  detailPendingData.value = null;
};

const toggleBodyScroll = (locked: boolean) => {
  if (typeof document === 'undefined') return;
  document.body.style.overflow = locked ? 'hidden' : '';
};
watch([detailDialogVisible], ([v]) => toggleBodyScroll(!!v));
onUnmounted(() => toggleBodyScroll(false));

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, Math.max(0, ms)));

const pickRunIdFromResult = (result: any): string => {
  if (!result) return '';
  return String(result?.run_id || result?.run?.run_id || result?.task?.result?.run_id || result?.task?.run_id || '');
};

const pollRunUntilDone = async (taskId: string) => {
  const startedAt = Date.now();
  const timeoutMs = 180000;
  const intervalMs = 2500;
  while (Date.now() - startedAt < timeoutMs) {
    await sleep(intervalMs);
    try {
      const task: any = await api.getAiTasks({ page: 1, page_size: 20, include_result: 1 });
      const match = (task?.items || []).find((x: any) => x?.task_id === taskId);
      if (match && (match.status === 'DONE' || match.status === 'FAILED')) {
        return String(match?.result?.run_id || '');
      }
    } catch { /* ignore */ }
  }
  return '';
};

const startManualDiscussion = async () => {
  running.value = true;
  try {
    const r: any = await api.runAi({
      force: true, dry_run: false,
      reason: 'frontend-manual-review', immediate: true,
      manual_request: true, review_only: true
    });
    notifyInfo('已发起人工讨论', `task_id: ${r?.task_id || '--'}，后台执行中`);
    const taskId = String(r?.task_id || '');
    await refreshAll();
    if (taskId) {
      const runId = await pollRunUntilDone(taskId);
      await refreshAll();
      if (runId) await openRunDetail(runId);
    }
  } finally { running.value = false; }
};
const startManualExecute = async () => {
  running.value = true;
  try {
    const r: any = await api.runAi({
      force: true, dry_run: false,
      reason: 'frontend-manual-execute', immediate: true,
      manual_request: true, execution_mode: 'AUTO_EXECUTE'
    });
    notifyInfo('已触发系统执行', `task_id: ${r?.task_id || '--'}，后台执行中`);
    const taskId = String(r?.task_id || '');
    await refreshAll();
    if (taskId) {
      const runId = await pollRunUntilDone(taskId);
      await refreshAll();
      if (runId) await openRunDetail(runId);
    }
  } finally { running.value = false; }
};

const confirmSelected = async () => {
  if (!selectedPendingIds.value.length) return;
  confirming.value = true;
  try {
    const r: any = await api.confirmAiPendingActions({ ids: [...selectedPendingIds.value] });
    notifySuccess('批量确认完成', `executed=${r?.executed ?? 0}, failed=${r?.failed ?? 0}`);
    selectedPendingIds.value = [];
    await Promise.all([loadPending(), loadRuns(), loadState()]);
  } finally { confirming.value = false; }
};
const rejectSelected = async () => {
  if (!selectedPendingIds.value.length) return;
  if (!window.confirm(`确认拒绝 ${selectedPendingIds.value.length} 笔待确认委托？`)) return;
  confirming.value = true;
  try {
    const r: any = await api.rejectAiPendingActions({ ids: [...selectedPendingIds.value], reason: 'rejected in frontend batch action' });
    notifySuccess('批量拒绝完成', `rejected=${r?.rejected ?? 0}`);
    selectedPendingIds.value = [];
    await loadPending();
  } finally { confirming.value = false; }
};

const goRunPage = async (n: number) => {
  if (n < 1 || n > runTotalPages.value) return;
  runPage.value = n;
  await loadRuns();
};

onMounted(refreshAll);
</script>

<style scoped>
.ai-page { display: flex; flex-direction: column; gap: 14px; max-width: 1440px; }

.status-card { padding: 16px; display: flex; flex-direction: column; gap: 14px; }
.status-top { display: flex; justify-content: space-between; align-items: flex-start; gap: 10px; flex-wrap: wrap; }
.t-title { font-size: 14px; font-weight: 700; color: var(--text-strong); }
.t-sub { font-size: 12px; color: var(--text-muted); margin-top: 2px; }
.head-actions { display: flex; gap: 6px; flex-wrap: wrap; }
.status-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px 16px; }
.status-cell { display: flex; flex-direction: column; gap: 3px; }
.s-label { font-size: 11px; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.06em; font-weight: 600; }
.s-value { font-size: 16px; font-weight: 700; color: var(--text-strong); }
@media (min-width: 980px) { .status-grid { grid-template-columns: repeat(4, minmax(0, 1fr)); } }

.slot-strip { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 6px; padding-top: 10px; border-top: 1px solid var(--line-soft); }
.slot-pill { display: flex; flex-direction: column; gap: 2px; padding: 6px 10px; border: 1px solid var(--line); border-radius: var(--r-sm); background: var(--bg-subtle); }
.slot-pill.used { background: var(--up-soft); border-color: var(--up-line); }
.slot-label { font-size: 10.5px; color: var(--text-muted); }
.slot-time { font-size: 12.5px; font-weight: 600; color: var(--text-strong); }

.tabs-card { padding: 0; }
.tabs { display: flex; padding: 8px 14px 0; gap: 4px; border-bottom: 1px solid var(--line); }
.tab { display: inline-flex; align-items: center; gap: 6px; height: 32px; padding: 0 12px; border: 0; background: transparent; font-size: 12.5px; font-weight: 600; color: var(--text-soft); cursor: pointer; border-radius: var(--r-sm) var(--r-sm) 0 0; }
.tab.is-active { background: var(--bg-elev); color: var(--text-strong); border-bottom: 2px solid var(--text); margin-bottom: -1px; }
.tab-badge { padding: 0 6px; border-radius: 999px; background: var(--bg-inset); font-size: 10.5px; font-weight: 700; }
.tab.is-active .tab-badge { background: var(--text); color: #fff; }

.pane { padding: 0; }
.pane-head { display: flex; justify-content: space-between; align-items: center; gap: 8px; padding: 10px 14px; border-bottom: 1px solid var(--line-soft); }
.pane-head select { width: 140px; }
.tbl-wrap { overflow: auto; max-height: 60vh; }
.loading-line { padding: 28px; text-align: center; color: var(--text-muted); }
.loading-line .spinner { vertical-align: middle; }
.pager { padding: 10px 14px; display: flex; justify-content: space-between; align-items: center; border-top: 1px solid var(--line-soft); }
.pager > div { display: flex; gap: 6px; }

/* Detail modal */
.detail-grid { display: flex; flex-direction: column; gap: 10px; }
.panel { padding: 12px 14px; border: 1px solid var(--line); border-radius: var(--r-md); background: var(--bg-elev); }
.panel-full { grid-column: 1 / -1; }
.panel-h { font-size: 12px; font-weight: 700; color: var(--text-soft); text-transform: uppercase; letter-spacing: 0.06em; margin-bottom: 8px; }
.kv-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 6px 10px; }
.kv { padding: 6px 10px; background: var(--bg-subtle); border-radius: var(--r-sm); border: 1px solid var(--line-soft); display: flex; flex-direction: column; gap: 2px; }
.kv span { font-size: 10.5px; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.06em; }
.kv strong { font-size: 12.5px; color: var(--text-strong); }

.skip-panel { background: var(--warn-soft); border-color: var(--warn-line); }
.skip-reason { font-size: 12.5px; color: var(--text-strong); font-weight: 600; }
.skip-list { margin: 8px 0 0 16px; padding: 0; display: grid; gap: 3px; font-size: 12px; color: var(--text-soft); }

.news-list { display: flex; flex-direction: column; gap: 6px; }
.news-item { padding: 8px 10px; border: 1px solid var(--line-soft); border-radius: var(--r-sm); background: var(--bg-subtle); }
.news-title { font-size: 12.5px; color: var(--info); font-weight: 600; word-break: break-word; }
.news-title:hover { text-decoration: underline; }
.news-meta { margin-top: 4px; display: flex; gap: 10px; font-size: 10.5px; color: var(--text-muted); }

.debate-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
@media (max-width: 800px) { .debate-grid { grid-template-columns: 1fr; } }
.debate-card { padding: 10px 12px; border: 1px solid var(--line-soft); border-radius: var(--r-sm); background: var(--bg-subtle); }
.debate-card h5 { font-size: 12px; font-weight: 700; color: var(--text-strong); margin-bottom: 6px; }
.debate-card p { font-size: 12px; color: var(--text-soft); line-height: 1.5; margin-bottom: 4px; }
</style>
