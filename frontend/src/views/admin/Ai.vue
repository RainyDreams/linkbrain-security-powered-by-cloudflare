<template>
  <div class="ai-room">
    <section class="glass-card hero-card">
      <div class="hero-top">
        <div>
          <h2 class="panel-title">AI 决策与执行</h2>
          <p class="subline">手动触发仅负责入队，实际执行由 cron 消费。详情页提供结构化展示。</p>
        </div>
        <div class="hero-actions">
          <button class="btn-solid btn-ghost" :disabled="loading" @click="refreshAll">刷新</button>
          <button class="btn-solid btn-ghost" :disabled="running" @click="startManualDiscussion">
            {{ running ? '处理中...' : '发起讨论（待确认）' }}
          </button>
          <button class="btn-solid btn-primary" :disabled="running" @click="startManualExecute">
            {{ running ? '处理中...' : '系统执行一次' }}
          </button>
        </div>
      </div>

      <div class="metric-grid">
        <article class="metric-box">
          <span>状态</span>
          <strong :class="aiState?.enabled ? 'ok' : 'bad'">{{ aiState?.enabled ? 'ENABLED' : 'DISABLED' }}</strong>
        </article>
        <article class="metric-box">
          <span>今日讨论次数</span>
          <strong>{{ aiState?.daily_quota?.run_count ?? 0 }} / {{ aiState?.daily_quota?.run_limit ?? 5 }}</strong>
        </article>
        <article class="metric-box">
          <span>Gemini 请求</span>
          <strong>{{ aiState?.daily_quota?.gemini_requests ?? 0 }} / {{ aiState?.daily_quota?.gemini_request_limit ?? 60 }}</strong>
        </article>
        <article class="metric-box">
          <span>待确认委托</span>
          <strong>{{ pendingTotal }}</strong>
        </article>
      </div>

      <div class="slot-strip">
        <div v-for="slot in scheduleSlots" :key="slot.key" class="slot-pill" :class="slot.consumed ? 'used' : 'idle'">
          <span>{{ slot.label }}</span>
          <strong>{{ slot.start_hhmm }}-{{ slot.end_hhmm }}</strong>
        </div>
      </div>
    </section>

    <section class="glass-card tabs-card">
      <div class="tab-row">
        <button :class="tabBtn('runs')" @click="activeTab = 'runs'">运行记录</button>
        <button :class="tabBtn('pending')" @click="activeTab = 'pending'">待确认委托</button>
        <button :class="tabBtn('tasks')" @click="activeTab = 'tasks'">任务队列</button>
      </div>

      <div v-if="activeTab === 'runs'" class="pane">
        <div class="pane-head">
          <h3>运行记录</h3>
          <span>{{ runsTotal }} 条</span>
        </div>
        <div v-if="loadingRuns" class="empty-line">加载中...</div>
        <div v-else-if="runs.length === 0" class="empty-line">暂无记录</div>
        <div v-else class="overflow-x-auto scrollbar-thin">
          <table class="min-w-full table-dense text-[12px]">
            <thead class="data-table-head">
              <tr>
                <th class="px-3 py-2 text-left">时间</th>
                <th class="px-3 py-2 text-left">触发</th>
                <th class="px-3 py-2 text-left">阶段</th>
                <th class="px-3 py-2 text-left">状态</th>
                <th class="px-3 py-2 text-left">跳过原因</th>
                <th class="px-3 py-2 text-left">执行</th>
                <th class="px-3 py-2 text-left">操作</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in runs" :key="row.run_id" class="border-t border-[var(--line)]/70">
                <td class="px-3 py-2 font-mono text-[11px]">{{ row.created_at_cst || '--' }}</td>
                <td class="px-3 py-2">{{ row.trigger || '--' }}</td>
                <td class="px-3 py-2">{{ row.phase || '--' }}</td>
                <td class="px-3 py-2">
                  <span class="status-pill" :class="statusPillClass(row.status)">{{ row.status || '--' }}</span>
                </td>
                <td class="px-3 py-2">
                  <span class="reason-text">{{ runSkipReason(row) }}</span>
                </td>
                <td class="px-3 py-2">{{ row.executed_total || 0 }} / {{ row.actions_total || 0 }}</td>
                <td class="px-3 py-2">
                  <button class="btn-solid btn-ghost compact" :disabled="loadingDetail && detailRunId === row.run_id" @click="openRunDetail(row.run_id)">详情</button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <div class="pager">
          <button class="btn-solid btn-ghost" :disabled="runPage <= 1 || loadingRuns" @click="goRunPage(runPage - 1)">上一页</button>
          <span>{{ runPage }} / {{ runTotalPages }}</span>
          <button class="btn-solid btn-ghost" :disabled="runPage >= runTotalPages || loadingRuns" @click="goRunPage(runPage + 1)">下一页</button>
        </div>
      </div>

      <div v-if="activeTab === 'pending'" class="pane">
        <div class="pane-head">
          <h3>待确认委托</h3>
          <div class="inline-actions">
            <select v-model="pendingStatus" @change="loadPending">
              <option value="PENDING">PENDING</option>
              <option value="ALL">ALL</option>
              <option value="EXECUTED">EXECUTED</option>
              <option value="REJECTED">REJECTED</option>
              <option value="FAILED">FAILED</option>
            </select>
            <button class="btn-solid btn-primary compact" :disabled="confirming || selectedPendingIds.length === 0" @click="confirmSelected">
              批量确认执行
            </button>
            <button class="btn-solid btn-ghost compact" :disabled="confirming || selectedPendingIds.length === 0" @click="rejectSelected">
              批量拒绝
            </button>
          </div>
        </div>
        <div v-if="loadingPending" class="empty-line">加载中...</div>
        <div v-else-if="pendingRows.length === 0" class="empty-line">暂无待确认动作</div>
        <div v-else class="overflow-x-auto scrollbar-thin">
          <table class="min-w-full table-dense text-[12px]">
            <thead class="data-table-head">
              <tr>
                <th class="px-3 py-2 text-left">
                  <input type="checkbox" :checked="isPendingPageAllChecked" @change="onTogglePendingPageAll($event)" />
                </th>
                <th class="px-3 py-2 text-left">时间</th>
                <th class="px-3 py-2 text-left">Run ID</th>
                <th class="px-3 py-2 text-left">动作</th>
                <th class="px-3 py-2 text-left">状态</th>
                <th class="px-3 py-2 text-left">操作</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in pendingRows" :key="row.id" class="border-t border-[var(--line)]/70">
                <td class="px-3 py-2">
                  <input
                    type="checkbox"
                    :disabled="row.status !== 'PENDING'"
                    :checked="selectedPendingIds.includes(row.id)"
                    @change="onTogglePending(row.id, $event)"
                  />
                </td>
                <td class="px-3 py-2 font-mono text-[11px]">{{ row.created_at_cst || '--' }}</td>
                <td class="px-3 py-2 font-mono text-[11px]">{{ row.run_id }}</td>
                <td class="px-3 py-2">{{ pendingActionLabel(row.action) }}</td>
                <td class="px-3 py-2">
                  <span class="status-pill" :class="statusPillClass(row.status)">{{ row.status }}</span>
                </td>
                <td class="px-3 py-2">
                  <button class="btn-solid btn-ghost compact" @click="openPendingDetail(row)">详情</button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <div class="pager">
          <button class="btn-solid btn-ghost" :disabled="pendingPage <= 1 || loadingPending" @click="goPendingPage(pendingPage - 1)">上一页</button>
          <span>{{ pendingPage }} / {{ pendingTotalPages }}</span>
          <button class="btn-solid btn-ghost" :disabled="pendingPage >= pendingTotalPages || loadingPending" @click="goPendingPage(pendingPage + 1)">下一页</button>
        </div>
      </div>

      <div v-if="activeTab === 'tasks'" class="pane">
        <div class="pane-head">
          <h3>任务队列</h3>
          <span>{{ tasksTotal }} 条</span>
        </div>
        <div v-if="loadingTasks" class="empty-line">加载中...</div>
        <div v-else-if="tasks.length === 0" class="empty-line">暂无任务</div>
        <div v-else class="overflow-x-auto scrollbar-thin">
          <table class="min-w-full table-dense text-[12px]">
            <thead class="data-table-head">
              <tr>
                <th class="px-3 py-2 text-left">创建时间</th>
                <th class="px-3 py-2 text-left">Task ID</th>
                <th class="px-3 py-2 text-left">状态</th>
                <th class="px-3 py-2 text-left">原因</th>
                <th class="px-3 py-2 text-left">执行模式</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="task in tasks" :key="task.task_id" class="border-t border-[var(--line)]/70">
                <td class="px-3 py-2 font-mono text-[11px]">{{ task.created_at_cst || '--' }}</td>
                <td class="px-3 py-2 font-mono text-[11px]">{{ task.task_id }}</td>
                <td class="px-3 py-2">
                  <span class="status-pill" :class="statusPillClass(task.status)">{{ task.status }}</span>
                </td>
                <td class="px-3 py-2">{{ task?.payload?.reason || '--' }}</td>
                <td class="px-3 py-2">{{ task?.payload?.execution_mode || '--' }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div class="pager">
          <button class="btn-solid btn-ghost" :disabled="taskPage <= 1 || loadingTasks" @click="goTaskPage(taskPage - 1)">上一页</button>
          <span>{{ taskPage }} / {{ taskTotalPages }}</span>
          <button class="btn-solid btn-ghost" :disabled="taskPage >= taskTotalPages || loadingTasks" @click="goTaskPage(taskPage + 1)">下一页</button>
        </div>
      </div>
    </section>

    <Teleport to="body">
      <div v-if="detailDialogVisible" class="modal-mask" @click.self="closeDetailDialog">
        <div class="modal-card" role="dialog" aria-modal="true" tabindex="-1">
          <div class="modal-head">
            <h3>{{ detailDialogTitle }}</h3>
            <button class="btn-solid btn-ghost compact" @click="closeDetailDialog">关闭</button>
          </div>

          <div class="modal-body">
          <div v-if="detailDialogType === 'run' && detailRunData" class="detail-grid">
          <section class="detail-panel key-panel">
            <h4>运行摘要</h4>
            <div class="kv-grid">
              <div class="kv-item"><span>Run ID</span><code>{{ detailRunData.run_id || '--' }}</code></div>
              <div class="kv-item"><span>触发</span><strong>{{ detailRunData.trigger || '--' }}</strong></div>
              <div class="kv-item"><span>阶段</span><strong>{{ detailRunData.phase || '--' }}</strong></div>
              <div class="kv-item"><span>状态</span><span class="status-pill" :class="statusPillClass(detailRunData.status)">{{ detailRunData.status || '--' }}</span></div>
              <div class="kv-item"><span>时间</span><strong class="mono">{{ detailRunData.created_at_cst || '--' }}</strong></div>
              <div class="kv-item"><span>当日盈亏</span><strong>{{ runSummary?.performance?.day_pnl ?? '--' }}</strong></div>
            </div>
          </section>

          <section v-if="runSkipInfo.skipped" class="detail-panel full skip-panel">
            <h4>跳过说明</h4>
            <div class="skip-reason">{{ runSkipInfo.reason || '未返回具体跳过原因' }}</div>
            <div v-if="runSkipInfo.blockedCount > 0" class="skip-meta">
              原子预检阻断数：{{ runSkipInfo.blockedCount }}
            </div>
            <ul v-if="runSkipInfo.blockedReasons.length > 0" class="skip-list">
              <li v-for="(item, idx) in runSkipInfo.blockedReasons" :key="`${idx}-${item}`">{{ item }}</li>
            </ul>
            <div v-if="runSkipInfo.nonBlockingCount > 0" class="skip-meta">
              非阻断过滤数：{{ runSkipInfo.nonBlockingCount }}
            </div>
            <ul v-if="runSkipInfo.nonBlockingReasons.length > 0" class="skip-list">
              <li v-for="(item, idx) in runSkipInfo.nonBlockingReasons" :key="`nb-${idx}-${item}`">{{ item }}</li>
            </ul>
          </section>

          <section class="detail-panel key-panel">
            <h4>执行统计</h4>
            <div class="kv-grid">
              <div class="kv-item"><span>动作总数</span><strong>{{ runSummary?.actions_total ?? detailRunData.actions_total ?? 0 }}</strong></div>
              <div class="kv-item"><span>尝试执行</span><strong>{{ runSummary?.execution?.attempted ?? 0 }}</strong></div>
              <div class="kv-item"><span>成功</span><strong>{{ runSummary?.execution?.succeeded ?? detailRunData.executed_total ?? 0 }}</strong></div>
              <div class="kv-item"><span>失败</span><strong>{{ runSummary?.execution?.failed ?? 0 }}</strong></div>
              <div class="kv-item"><span>下单</span><strong>{{ runSummary?.execution?.placed ?? 0 }}</strong></div>
              <div class="kv-item"><span>撤单</span><strong>{{ runSummary?.execution?.cancelled ?? 0 }}</strong></div>
            </div>
          </section>

          <section class="detail-panel full">
            <h4>决策依据</h4>
            <div class="kv-grid">
              <div class="kv-item"><span>经理胜出方</span><strong>{{ runSummary?.manager_winner || '--' }}</strong></div>
              <div class="kv-item"><span>角色降级次数</span><strong>{{ runSummary?.role_fallback_count ?? 0 }}</strong></div>
              <div class="kv-item"><span>Gemini 429</span><strong>{{ runSummary?.gemini_api_throttled ? '是' : '否' }}</strong></div>
              <div class="kv-item"><span>预算超建议值</span><strong>{{ runSummary?.gemini_budget_advisory_exceeded ? '是' : '否' }}</strong></div>
              <div class="kv-item"><span>最大新单</span><strong>{{ runSummary?.risk_limits?.max_new_orders ?? '--' }}</strong></div>
              <div class="kv-item"><span>单笔仓位上限</span><strong>{{ runSummary?.risk_limits?.max_single_order_ratio ?? '--' }}</strong></div>
            </div>
          </section>

          <section class="detail-panel full">
            <h4>参考新闻</h4>
            <div v-if="runNewsReferences.length === 0" class="empty-line">本次未记录新闻引用</div>
            <ul v-else class="news-list">
              <li v-for="item in runNewsReferences" :key="`${item.index}-${item.title}`" class="news-item">
                <div class="news-title-row">
                  <span class="news-index">#{{ item.index }}</span>
                  <a :href="item.link" target="_blank" rel="noopener noreferrer">{{ item.title }}</a>
                </div>
                <div class="news-meta">
                  <span>{{ item.source || '--' }}</span>
                  <span>{{ item.pub_date || '--' }}</span>
                  <span>{{ (item.symbols || []).join(', ') || '--' }}</span>
                </div>
              </li>
            </ul>
          </section>

          <section class="detail-panel full">
            <h4>输入快照（持仓/挂单/历史）</h4>
            <div class="kv-grid">
              <div class="kv-item"><span>当前持仓</span><strong>{{ runInputCounts.holdings }}</strong></div>
              <div class="kv-item"><span>当前挂单</span><strong>{{ runInputCounts.pendingOrders }}</strong></div>
              <div class="kv-item"><span>挂单历史</span><strong>{{ runInputCounts.orderHistory }}</strong></div>
              <div class="kv-item"><span>持仓历史</span><strong>{{ runInputCounts.holdingHistory }}</strong></div>
            </div>
            <details>
              <summary>查看输入片段</summary>
              <pre>{{ pretty(runInputExcerpt) }}</pre>
            </details>
          </section>

          <section class="detail-panel full">
            <h4>讨论过程</h4>
            <div class="debate-grid">
              <article class="debate-card">
                <h5>总裁</h5>
                <p><strong>市场判断：</strong>{{ runDiscussion.president.market_regime || '--' }}</p>
                <p><strong>核心观点：</strong>{{ runDiscussion.president.strategy_thesis || '--' }}</p>
                <p><strong>长期策略：</strong>{{ runDiscussion.president?.strategy_horizons?.long_term || '--' }}</p>
                <p><strong>中期策略：</strong>{{ runDiscussion.president?.strategy_horizons?.mid_term || '--' }}</p>
                <p><strong>短期策略：</strong>{{ runDiscussion.president?.strategy_horizons?.short_term || '--' }}</p>
                <p><strong>做T策略：</strong>{{ runDiscussion.president?.strategy_horizons?.intraday_t || '--' }}</p>
                <p><strong>T+1提示：</strong>{{ runDiscussion.president.t_plus_one_note || '--' }}</p>
                <p><strong>风险提示：</strong>{{ runDiscussion.president.risk_note || '--' }}</p>
              </article>
              <article class="debate-card">
                <h5>经济学家 1</h5>
                <p><strong>观点：</strong>{{ runDiscussion.economist_1.core_view || '--' }}</p>
                <p><strong>反驳要点：</strong>{{ runDiscussion.economist_1.rebuttal || '--' }}</p>
                <p><strong>风险提示：</strong>{{ runDiscussion.economist_1.risk_note || '--' }}</p>
              </article>
              <article class="debate-card">
                <h5>经济学家 2</h5>
                <p><strong>观点：</strong>{{ runDiscussion.economist_2.core_view || '--' }}</p>
                <p><strong>反驳要点：</strong>{{ runDiscussion.economist_2.rebuttal || '--' }}</p>
                <p><strong>风险提示：</strong>{{ runDiscussion.economist_2.risk_note || '--' }}</p>
              </article>
              <article class="debate-card">
                <h5>经理结论</h5>
                <p><strong>胜出方：</strong>{{ runDiscussion.manager.winner || '--' }}</p>
                <p><strong>决策理由：</strong>{{ runDiscussion.manager.decision_reason || '--' }}</p>
                <p><strong>风险提示：</strong>{{ runDiscussion.manager.risk_note || '--' }}</p>
              </article>
            </div>
          </section>

          <section v-if="runExecutionRows.length > 0" class="detail-panel full">
            <h4>动作明细</h4>
            <div class="overflow-x-auto">
              <table class="mini-table">
                <thead>
                  <tr>
                    <th>类型</th>
                    <th>标的</th>
                    <th>方向</th>
                    <th>数量</th>
                    <th>价格</th>
                    <th>结果</th>
                    <th>说明</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="(row, idx) in runExecutionRows" :key="idx">
                    <td>{{ row?.action?.type || '--' }}</td>
                    <td>{{ row?.action?.symbol || '--' }}</td>
                    <td>{{ row?.action?.side || '--' }}</td>
                    <td>{{ row?.action?.qty ?? '--' }}</td>
                    <td>{{ row?.action?.price ?? '--' }}</td>
                    <td>
                      <span class="status-pill" :class="runExecutionStatusClass(row)">
                        {{ runExecutionStatusText(row) }}
                      </span>
                    </td>
                    <td>{{ row?.reason || row?.payload?.msg || '--' }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>

          <section class="detail-panel full">
            <details>
              <summary>原始 JSON（调试）</summary>
              <pre>{{ pretty(detailRunData?.detail || {}) }}</pre>
            </details>
          </section>
          </div>

          <div v-else-if="detailDialogType === 'pending' && detailPendingData" class="detail-grid">
          <section class="detail-panel">
            <h4>待确认动作</h4>
            <div class="kv-grid">
              <div class="kv-item"><span>ID</span><strong>#{{ detailPendingData.id || '--' }}</strong></div>
              <div class="kv-item"><span>Run ID</span><code>{{ detailPendingData.run_id || '--' }}</code></div>
              <div class="kv-item"><span>状态</span><span class="status-pill" :class="statusPillClass(detailPendingData.status)">{{ detailPendingData.status || '--' }}</span></div>
              <div class="kv-item"><span>创建时间</span><strong class="mono">{{ detailPendingData.created_at_cst || '--' }}</strong></div>
              <div class="kv-item"><span>动作类型</span><strong>{{ detailPendingData?.action?.type || '--' }}</strong></div>
              <div class="kv-item"><span>标的/方向</span><strong>{{ detailPendingData?.action?.symbol || '--' }} {{ detailPendingData?.action?.side || '' }}</strong></div>
              <div class="kv-item"><span>数量/价格</span><strong>{{ detailPendingData?.action?.qty ?? '--' }} / {{ detailPendingData?.action?.price ?? '--' }}</strong></div>
              <div class="kv-item"><span>原因</span><strong>{{ detailPendingData?.reason || '--' }}</strong></div>
            </div>
          </section>

          <section class="detail-panel" v-if="pendingResultSummary">
            <h4>执行结果</h4>
            <div class="kv-grid">
              <div class="kv-item"><span>尝试执行</span><strong>{{ pendingResultSummary.attempted ?? 0 }}</strong></div>
              <div class="kv-item"><span>成功</span><strong>{{ pendingResultSummary.succeeded ?? 0 }}</strong></div>
              <div class="kv-item"><span>失败</span><strong>{{ pendingResultSummary.failed ?? 0 }}</strong></div>
              <div class="kv-item"><span>下单</span><strong>{{ pendingResultSummary.placed ?? 0 }}</strong></div>
              <div class="kv-item"><span>撤单</span><strong>{{ pendingResultSummary.cancelled ?? 0 }}</strong></div>
            </div>
          </section>

          <section class="detail-panel full">
            <details>
              <summary>原始 JSON（调试）</summary>
              <pre>{{ pretty(detailPendingData) }}</pre>
            </details>
          </section>
          </div>

            <pre v-else>{{ detailDialogText }}</pre>
          </div>
        </div>
      </div>
    </Teleport>

    <Teleport to="body">
      <div v-if="pendingDecisionVisible" class="modal-mask" @click.self="closePendingDecisionDialog">
        <div class="modal-card pending-decision-card" role="dialog" aria-modal="true" tabindex="-1">
          <div class="modal-head">
            <h3>{{ pendingDecisionAction === 'confirm' ? '确认批量执行待确认委托' : '确认批量拒绝待确认委托' }}</h3>
            <button class="btn-solid btn-ghost compact" @click="closePendingDecisionDialog">关闭</button>
          </div>
          <div class="modal-body">
            <div class="kv-grid">
              <div class="kv-item"><span>动作</span><strong>{{ pendingDecisionAction === 'confirm' ? '批量执行' : '批量拒绝' }}</strong></div>
              <div class="kv-item"><span>条数</span><strong>{{ selectedPendingIds.length }}</strong></div>
            </div>
            <label v-if="pendingDecisionAction === 'reject'" class="decision-reason">
              <span>拒绝原因</span>
              <input v-model.trim="pendingRejectReason" type="text" maxlength="180" placeholder="rejected in frontend batch action" />
            </label>
            <div class="decision-list">
              <table class="mini-table">
                <thead>
                  <tr>
                    <th>ID</th>
                    <th>Run ID</th>
                    <th>动作</th>
                    <th>状态</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="row in selectedPendingPreview" :key="`decision-${row.id}`">
                    <td>#{{ row.id }}</td>
                    <td class="mono">{{ row.run_id || '--' }}</td>
                    <td>{{ pendingActionLabel(row.action) }}</td>
                    <td>{{ row.status }}</td>
                  </tr>
                  <tr v-if="selectedPendingPreview.length === 0">
                    <td colspan="4">未找到可展示的待确认动作</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <div class="decision-actions">
              <button class="btn-solid btn-ghost" :disabled="confirming" @click="closePendingDecisionDialog">取消</button>
              <button class="btn-solid btn-primary" :disabled="confirming" @click="submitPendingDecision">
                {{ confirming ? '提交中...' : (pendingDecisionAction === 'confirm' ? '确认执行' : '确认拒绝') }}
              </button>
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

const loading = ref(false);
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
const loadingDetail = ref(false);
const detailRunId = ref('');

const pendingRows = ref<any[]>([]);
const pendingPage = ref(1);
const pendingPageSize = ref(20);
const pendingTotal = ref(0);
const pendingTotalPages = ref(1);
const loadingPending = ref(false);
const pendingStatus = ref<'ALL' | 'PENDING' | 'EXECUTED' | 'REJECTED' | 'FAILED'>('PENDING');
const selectedPendingIds = ref<number[]>([]);

const tasks = ref<any[]>([]);
const taskPage = ref(1);
const taskPageSize = ref(20);
const tasksTotal = ref(0);
const taskTotalPages = ref(1);
const loadingTasks = ref(false);

const detailDialogVisible = ref(false);
const detailDialogType = ref<'run' | 'pending' | 'text'>('text');
const detailDialogTitle = ref('');
const detailDialogText = ref('');
const detailRunData = ref<any>(null);
const detailPendingData = ref<any>(null);
const pendingDecisionVisible = ref(false);
const pendingDecisionAction = ref<'confirm' | 'reject'>('confirm');
const pendingRejectReason = ref('rejected in frontend batch action');

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
  return {
    president: {},
    economist_1: {},
    economist_2: {},
    manager: {}
  };
});
const runExecutionRows = computed(() => {
  const rows = detailRunData.value?.detail?.execution_results;
  return Array.isArray(rows) ? rows : [];
});
const pendingResultSummary = computed(() => detailPendingData.value?.result?.summary || null);
const runInputExcerpt = computed(() => detailRunData.value?.detail?.input_excerpt || {});
const runInputCounts = computed(() => {
  const src = runInputExcerpt.value || {};
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
  const atomic = (summary?.atomic_precheck && typeof summary.atomic_precheck === 'object')
    ? summary.atomic_precheck
    : null;
  const blockedReasons = Array.isArray(atomic?.blocked_reasons)
    ? atomic.blocked_reasons.map((x: any) => String(x || '').trim()).filter(Boolean).slice(0, 3)
    : [];
  const nonBlockingReasons = Array.isArray(atomic?.non_blocking_reasons)
    ? atomic.non_blocking_reasons.map((x: any) => String(x || '').trim()).filter(Boolean).slice(0, 3)
    : [];
  return {
    skipped,
    reason: String(summary?.reason || detailRunData.value?.reason || '').trim(),
    blockedCount: Number(atomic?.blocked_count || blockedReasons.length || 0),
    blockedReasons,
    nonBlockingCount: Number(atomic?.non_blocking_count || nonBlockingReasons.length || 0),
    nonBlockingReasons
  };
});

const scheduleSlots = computed(() => {
  const slots = aiState.value?.schedule?.slots;
  return Array.isArray(slots) ? slots : [];
});

const isPendingPageAllChecked = computed(() => {
  const pendingIds = pendingRows.value.filter((x) => x.status === 'PENDING').map((x) => Number(x.id));
  if (!pendingIds.length) return false;
  return pendingIds.every((id) => selectedPendingIds.value.includes(id));
});
const selectedPendingPreview = computed(() => {
  const idSet = new Set(selectedPendingIds.value.map((x) => Number(x)));
  return pendingRows.value
    .filter((row) => idSet.has(Number(row.id)))
    .slice(0, 20);
});

const tabBtn = (name: 'runs' | 'pending' | 'tasks') => ['tab-btn', activeTab.value === name ? 'active' : ''];

const statusPillClass = (raw: any) => {
  const status = String(raw || '').toUpperCase();
  if (status === 'SUCCESS' || status === 'DONE' || status === 'EXECUTED') return 'ok';
  if (status === 'SKIPPED' || status === 'PENDING' || status === 'RUNNING' || status === 'QUEUED') return 'warn';
  return 'bad';
};

const runExecutionStatusClass = (row: any) => {
  if (row?.pending === true) return 'warn';
  if (row?.ok === true) return 'ok';
  if (row?.skipped) return 'warn';
  return 'bad';
};

const runExecutionStatusText = (row: any) => {
  if (row?.pending === true) return 'PENDING';
  if (row?.ok === true) return 'SUCCESS';
  if (row?.skipped) return 'SKIPPED';
  return 'FAILED';
};

const pretty = (v: any) => {
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v || '');
  }
};

const pendingActionLabel = (action: any) => {
  if (!action) return '--';
  const qty = Number(action.qty || 0);
  const price = Number(action.price || 0);
  const qtyText = qty > 0 ? ` x${qty}` : '';
  const priceText = price > 0 ? ` @${price}` : '';
  return `${action.type || '--'} ${action.side || ''} ${action.symbol || ''}${qtyText}${priceText}`.trim();
};

const runSkipReason = (row: any) => {
  const status = String(row?.status || '').toUpperCase();
  const skipped = row?.skipped === true || status === 'SKIPPED';
  if (!skipped) return '--';
  const reason = String(row?.reason || '').trim();
  const blocked = Array.isArray(row?.blocked_reasons)
    ? row.blocked_reasons.map((x: any) => String(x || '').trim()).filter(Boolean)
    : [];
  const nonBlocking = Array.isArray(row?.non_blocking_reasons)
    ? row.non_blocking_reasons.map((x: any) => String(x || '').trim()).filter(Boolean)
    : [];
  if (!reason && blocked.length === 0 && nonBlocking.length === 0) return 'SKIPPED (未返回原因)';
  return [reason, blocked[0], nonBlocking[0]].filter(Boolean).join(' | ');
};

const loadState = async () => {
  aiState.value = await api.getAiState();
};

const loadRuns = async () => {
  loadingRuns.value = true;
  try {
    const res: any = await api.getAiRuns({
      page: runPage.value,
      page_size: runPageSize.value
    });
    runs.value = Array.isArray(res?.items) ? res.items : [];
    runsTotal.value = Number(res?.total || 0);
    runTotalPages.value = Math.max(1, Number(res?.total_pages || 1));
  } catch {
    notifyError('AI 运行记录加载失败');
  } finally {
    loadingRuns.value = false;
  }
};

const loadPending = async () => {
  loadingPending.value = true;
  try {
    const status = pendingStatus.value === 'ALL' ? undefined : pendingStatus.value;
    const res: any = await api.getAiPendingActions({
      status,
      page: pendingPage.value,
      page_size: pendingPageSize.value
    });
    pendingRows.value = Array.isArray(res?.items) ? res.items : [];
    pendingTotal.value = Number(res?.total || 0);
    pendingTotalPages.value = Math.max(1, Number(res?.total_pages || 1));
    selectedPendingIds.value = selectedPendingIds.value.filter((id) => pendingRows.value.some((x) => Number(x.id) === id && x.status === 'PENDING'));
  } catch {
    notifyError('待确认动作加载失败');
  } finally {
    loadingPending.value = false;
  }
};

const loadTasks = async () => {
  loadingTasks.value = true;
  try {
    const res: any = await api.getAiTasks({
      page: taskPage.value,
      page_size: taskPageSize.value,
      include_result: 0
    });
    tasks.value = Array.isArray(res?.items) ? res.items : [];
    tasksTotal.value = Number(res?.total || 0);
    taskTotalPages.value = Math.max(1, Number(res?.total_pages || 1));
  } catch {
    notifyError('任务队列加载失败');
  } finally {
    loadingTasks.value = false;
  }
};

const refreshAll = async () => {
  loading.value = true;
  try {
    await Promise.all([loadState(), loadRuns(), loadPending(), loadTasks()]);
  } finally {
    loading.value = false;
  }
};

const openRunDetail = async (runId: string) => {
  if (!runId) return;
  detailRunId.value = runId;
  loadingDetail.value = true;
  try {
    const res: any = await api.getAiRuns({ run_id: runId, include_detail: 1 });
    const item = Array.isArray(res?.items) ? res.items[0] : null;
    if (!item) {
      notifyError('未找到运行详情');
      return;
    }
    detailDialogTitle.value = `运行详情 · ${runId}`;
    detailDialogType.value = 'run';
    detailRunData.value = item;
    detailPendingData.value = null;
    detailDialogText.value = pretty(item?.detail || {});
    detailDialogVisible.value = true;
  } catch {
    notifyError('运行详情加载失败');
  } finally {
    loadingDetail.value = false;
  }
};

const openPendingDetail = (row: any) => {
  detailDialogTitle.value = `待确认动作 #${row?.id || '--'}`;
  detailDialogType.value = 'pending';
  detailRunData.value = null;
  detailPendingData.value = row || null;
  detailDialogText.value = pretty({
    run_id: row?.run_id,
    status: row?.status,
    action: row?.action,
    result: row?.result,
    reason: row?.reason
  });
  detailDialogVisible.value = true;
};

const closeDetailDialog = () => {
  detailDialogVisible.value = false;
  detailDialogType.value = 'text';
  detailRunData.value = null;
  detailPendingData.value = null;
};

const openPendingDecisionDialog = (action: 'confirm' | 'reject') => {
  if (!selectedPendingIds.value.length) return;
  pendingDecisionAction.value = action;
  if (action === 'reject' && !pendingRejectReason.value.trim()) {
    pendingRejectReason.value = 'rejected in frontend batch action';
  }
  pendingDecisionVisible.value = true;
};

const closePendingDecisionDialog = () => {
  pendingDecisionVisible.value = false;
};

const toggleBodyScroll = (locked: boolean) => {
  if (typeof document === 'undefined') return;
  document.body.style.overflow = locked ? 'hidden' : '';
};

const onKeydown = (evt: KeyboardEvent) => {
  if (evt.key !== 'Escape') return;
  if (detailDialogVisible.value) {
    closeDetailDialog();
    return;
  }
  if (pendingDecisionVisible.value) {
    closePendingDecisionDialog();
  }
};

watch([detailDialogVisible, pendingDecisionVisible], ([detailVisible, pendingVisible]) => {
  toggleBodyScroll(detailVisible || pendingVisible);
});

onMounted(() => {
  window.addEventListener('keydown', onKeydown);
});

onUnmounted(() => {
  window.removeEventListener('keydown', onKeydown);
  toggleBodyScroll(false);
});

const startManualDiscussion = async () => {
  running.value = true;
  try {
    const result: any = await api.runAi({
      force: true,
      dry_run: false,
      reason: 'frontend-manual-review',
      immediate: true,
      manual_request: true,
      review_only: true
    });
    const inBackground = result?.queued_only === true || result?.execute_via === 'cron' || result?.executed === false;
    notifyInfo(
      inBackground ? '已发起人工讨论，已入队等待 cron 执行' : '已发起人工讨论（不计入自动配额）',
      `task_id: ${result?.task_id || '--'}`
    );
    const runId = result?.run?.run_id || result?.task?.result?.run_id || '';
    await refreshAll();
    if (runId) await openRunDetail(runId);
  } catch {
    // Interceptor already shows normalized API errors.
  } finally {
    running.value = false;
  }
};

const startManualExecute = async () => {
  running.value = true;
  try {
    const result: any = await api.runAi({
      force: true,
      dry_run: false,
      reason: 'frontend-manual-execute',
      immediate: true,
      manual_request: true,
      execution_mode: 'AUTO_EXECUTE'
    });
    const inBackground = result?.queued_only === true || result?.execute_via === 'cron' || result?.executed === false;
    (inBackground ? notifyInfo : notifySuccess)(
      inBackground ? '已触发系统执行，已入队等待 cron 执行' : '已触发系统执行（委托下单）',
      `task_id: ${result?.task_id || '--'}`
    );
    const runId = result?.run?.run_id || result?.task?.result?.run_id || '';
    await refreshAll();
    if (runId) await openRunDetail(runId);
  } catch {
    // Interceptor already shows normalized API errors.
  } finally {
    running.value = false;
  }
};

const togglePending = (id: number, checked: boolean) => {
  const numId = Number(id);
  if (!Number.isInteger(numId) || numId <= 0) return;
  const set = new Set(selectedPendingIds.value);
  if (checked) set.add(numId);
  else set.delete(numId);
  selectedPendingIds.value = Array.from(set);
};

const onTogglePending = (id: number, evt: Event) => {
  const input = evt?.target as HTMLInputElement | null;
  togglePending(id, !!input?.checked);
};

const togglePendingPageAll = (checked: boolean) => {
  const ids = pendingRows.value.filter((x) => x.status === 'PENDING').map((x) => Number(x.id));
  if (checked) {
    selectedPendingIds.value = Array.from(new Set([...selectedPendingIds.value, ...ids]));
  } else {
    const del = new Set(ids);
    selectedPendingIds.value = selectedPendingIds.value.filter((id) => !del.has(id));
  }
};

const onTogglePendingPageAll = (evt: Event) => {
  const input = evt?.target as HTMLInputElement | null;
  togglePendingPageAll(!!input?.checked);
};

const confirmSelected = async () => {
  openPendingDecisionDialog('confirm');
};

const rejectSelected = async () => {
  openPendingDecisionDialog('reject');
};

const submitPendingDecision = async () => {
  if (!selectedPendingIds.value.length) {
    closePendingDecisionDialog();
    return;
  }
  confirming.value = true;
  try {
    const ids = [...selectedPendingIds.value];
    if (pendingDecisionAction.value === 'confirm') {
      const res: any = await api.confirmAiPendingActions({ ids });
      notifySuccess('批量确认完成', `executed=${res?.executed ?? 0}, failed=${res?.failed ?? 0}`);
    } else {
      const reason = pendingRejectReason.value.trim() || 'rejected in frontend batch action';
      const res: any = await api.rejectAiPendingActions({ ids, reason });
      notifySuccess('批量拒绝完成', `rejected=${res?.rejected ?? 0}`);
    }
    selectedPendingIds.value = [];
    closePendingDecisionDialog();
    await Promise.all([loadPending(), loadRuns(), loadState()]);
  } catch {
    notifyError(pendingDecisionAction.value === 'confirm' ? '批量确认失败' : '批量拒绝失败');
  } finally {
    confirming.value = false;
  }
};

watch(selectedPendingIds, (next) => {
  if (next.length === 0 && pendingDecisionVisible.value) {
    closePendingDecisionDialog();
  }
});

const goRunPage = async (next: number) => {
  if (next < 1 || next > runTotalPages.value) return;
  runPage.value = next;
  await loadRuns();
};

const goPendingPage = async (next: number) => {
  if (next < 1 || next > pendingTotalPages.value) return;
  pendingPage.value = next;
  await loadPending();
};

const goTaskPage = async (next: number) => {
  if (next < 1 || next > taskTotalPages.value) return;
  taskPage.value = next;
  await loadTasks();
};

refreshAll();
</script>

<style scoped>
.ai-room {
  display: grid;
  gap: 12px;
}

.hero-card {
  padding: 12px;
  background:
    radial-gradient(1200px 320px at 0% 0%, rgba(16, 163, 127, 0.12), transparent 50%),
    radial-gradient(900px 240px at 100% 0%, rgba(14, 116, 144, 0.1), transparent 52%),
    #fff;
}

.hero-top {
  display: flex;
  justify-content: space-between;
  gap: 10px;
}

.subline {
  margin: 4px 0 0;
  font-size: 12px;
  color: var(--text-muted);
}

.hero-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.metric-grid {
  margin-top: 10px;
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 8px;
}

.metric-box {
  border: 1px solid var(--line);
  border-radius: var(--radius-sm);
  background: #fff;
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

.slot-strip {
  margin-top: 10px;
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 8px;
}

.slot-pill {
  border: 1px solid var(--line);
  border-radius: var(--radius-sm);
  padding: 6px 8px;
  display: grid;
  gap: 2px;
}

.slot-pill span {
  font-size: 11px;
  color: var(--text-muted);
}

.slot-pill strong {
  font-size: 12px;
}

.slot-pill.idle {
  background: #f9fafb;
}

.slot-pill.used {
  background: #ecfdf3;
  border-color: #a4f4bf;
}

.tabs-card {
  padding: 12px;
}

.tab-row {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  margin-bottom: 8px;
}

.tab-btn {
  border: 1px solid var(--line-strong);
  border-radius: var(--radius-sm);
  background: #fff;
  color: var(--text-soft);
  padding: 6px 10px;
  font-size: 12px;
  font-weight: 700;
}

.tab-btn.active {
  background: rgba(16, 163, 127, 0.12);
  border-color: rgba(16, 163, 127, 0.4);
  color: #0f766e;
}

.pane {
  display: grid;
  gap: 8px;
}

.pane-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
}

.pane-head h3 {
  margin: 0;
  font-size: 14px;
}

.inline-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.inline-actions select {
  border: 1px solid var(--line-strong);
  border-radius: var(--radius-sm);
  background: #fff;
  padding: 6px 8px;
  font-size: 12px;
}

.compact {
  padding: 5px 8px;
  font-size: 11px;
}

.empty-line {
  color: var(--text-muted);
  font-size: 12px;
  padding: 12px 4px;
}

.reason-text {
  font-size: 11px;
  color: var(--text-soft);
  display: inline-block;
  max-width: 320px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
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

.ok {
  color: #067647;
}

.bad {
  color: #b42318;
}

.pager {
  display: flex;
  justify-content: flex-end;
  align-items: center;
  gap: 8px;
}

.modal-mask {
  position: fixed;
  inset: 0;
  background: rgba(15, 23, 42, 0.42);
  backdrop-filter: blur(5px);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 14px;
  z-index: 2400;
  animation: modal-fade-in 0.16s ease-out;
}

.modal-card {
  width: min(1120px, 96vw);
  max-height: min(90vh, 920px);
  overflow: hidden;
  border-radius: var(--radius-lg);
  border: 1px solid var(--line);
  background: #fff;
  box-shadow: 0 26px 56px rgba(15, 23, 42, 0.24);
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  animation: modal-rise-in 0.2s ease-out;
}

.modal-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border-bottom: 1px solid var(--line);
  background:
    radial-gradient(900px 220px at 0% 0%, rgba(16, 163, 127, 0.09), transparent 55%),
    #fff;
}

.modal-head h3 {
  margin: 0;
  font-size: 14px;
  font-weight: 900;
  letter-spacing: 0.02em;
}

.modal-body {
  overflow: auto;
  padding: 10px;
  display: grid;
  gap: 10px;
  background: linear-gradient(180deg, #fbfdff 0%, #f8fafc 100%);
  overscroll-behavior: contain;
}

.modal-card pre {
  margin: 0;
  white-space: pre-wrap;
  font-size: 11px;
  font-family: 'JetBrains Mono', monospace;
  color: var(--text-soft);
}

.detail-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
  grid-auto-flow: dense;
  align-items: start;
  gap: 12px;
}

.detail-panel {
  border: 1px solid var(--line);
  border-radius: var(--radius-sm);
  background: linear-gradient(180deg, #ffffff 0%, #f8fafc 100%);
  padding: 10px;
  box-shadow: 0 1px 0 rgba(16, 24, 40, 0.03);
}

.detail-panel.full {
  grid-column: 1 / -1;
}

.detail-panel.key-panel {
  border-color: rgba(16, 163, 127, 0.32);
  background:
    radial-gradient(700px 160px at 0% 0%, rgba(16, 163, 127, 0.08), transparent 58%),
    #fff;
}

.detail-panel h4 {
  margin: 0 0 8px;
  font-size: 12px;
  font-weight: 800;
  color: var(--text-soft);
}

.skip-panel {
  border-color: #fedf89;
  background:
    radial-gradient(700px 160px at 0% 0%, rgba(245, 158, 11, 0.12), transparent 58%),
    #fff;
}

.skip-reason {
  font-size: 12px;
  color: #7a2e0e;
  font-weight: 700;
}

.skip-meta {
  margin-top: 6px;
  font-size: 11px;
  color: #92400e;
}

.skip-list {
  margin: 8px 0 0;
  padding-left: 16px;
  display: grid;
  gap: 4px;
  font-size: 11px;
  color: #78350f;
}

.kv-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}

.kv-item {
  border: 1px solid var(--line);
  border-radius: var(--radius-sm);
  background: #fff;
  padding: 6px 8px;
  display: grid;
  gap: 2px;
}

.kv-item span {
  font-size: 10px;
  color: var(--text-muted);
}

.kv-item strong,
.kv-item code {
  font-size: 12px;
  font-weight: 700;
  color: var(--text-soft);
  overflow-wrap: anywhere;
}

.mono {
  font-family: 'JetBrains Mono', monospace;
}

.mini-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 11px;
  background: #fff;
}

.mini-table th,
.mini-table td {
  border: 1px solid var(--line);
  padding: 6px 7px;
  text-align: left;
  vertical-align: top;
  overflow-wrap: anywhere;
}

.mini-table th {
  background: #f1f5f9;
  color: var(--text-soft);
  font-weight: 700;
}

.news-list {
  margin: 0;
  padding: 0;
  list-style: none;
  display: grid;
  gap: 8px;
}

.news-item {
  border: 1px solid var(--line);
  border-radius: var(--radius-sm);
  background: #fff;
  padding: 8px;
  display: grid;
  gap: 4px;
}

.news-title-row {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
}

.news-title-row a {
  color: #175cd3;
  text-decoration: none;
}

.news-title-row a:hover {
  text-decoration: underline;
}

.news-index {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 22px;
  height: 18px;
  border-radius: 6px;
  font-size: 10px;
  font-weight: 700;
  color: #344054;
  background: #eef2ff;
}

.news-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  color: var(--text-muted);
  font-size: 11px;
}

.debate-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}

.debate-card {
  border: 1px solid var(--line);
  border-radius: var(--radius-sm);
  background: #fff;
  padding: 8px;
  display: grid;
  gap: 4px;
}

.debate-card h5 {
  margin: 0;
  font-size: 12px;
  color: var(--text-soft);
}

.debate-card p {
  margin: 0;
  font-size: 11px;
  color: var(--text-soft);
  overflow-wrap: anywhere;
}

.pending-decision-card {
  width: min(860px, 96vw);
}

.decision-reason {
  display: grid;
  gap: 6px;
}

.decision-reason span {
  font-size: 11px;
  color: var(--text-muted);
}

.decision-reason input {
  border: 1px solid var(--line-strong);
  border-radius: var(--radius-sm);
  background: #fff;
  padding: 7px 8px;
  font-size: 12px;
}

.decision-list {
  max-height: min(38vh, 320px);
  overflow: auto;
  border: 1px solid var(--line);
  border-radius: var(--radius-sm);
  background: #fff;
}

.decision-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

.detail-panel details > summary {
  cursor: pointer;
  font-size: 12px;
  font-weight: 700;
  color: var(--text-soft);
  margin-bottom: 8px;
}

@keyframes modal-fade-in {
  from { opacity: 0; }
  to { opacity: 1; }
}

@keyframes modal-rise-in {
  from {
    opacity: 0;
    transform: translateY(8px) scale(0.992);
  }
  to {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
}

@media (max-width: 980px) {
  .metric-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .slot-strip {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .hero-top,
  .pane-head {
    flex-direction: column;
    align-items: flex-start;
  }

  .inline-actions {
    flex-wrap: wrap;
  }

  .detail-grid,
  .kv-grid {
    grid-template-columns: 1fr;
  }

  .debate-grid {
    grid-template-columns: 1fr;
  }

  .modal-mask {
    padding: 8px;
  }

  .modal-card {
    width: 100%;
    max-height: 92vh;
  }
}
</style>



