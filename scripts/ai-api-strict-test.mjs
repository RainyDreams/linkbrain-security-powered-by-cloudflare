import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import jwt from 'jsonwebtoken';

const BASE = process.env.AI_TEST_BASE || 'http://127.0.0.1:8788';
const JWT_SECRET = process.env.JWT_SECRET || 'linkbrainsecurity';

const token = jwt.sign({ role: 'admin', jti: `ai-strict-${Date.now()}` }, JWT_SECRET, { expiresIn: '2h' });
const authHeaders = {
  Authorization: `Bearer ${token}`,
  'Content-Type': 'application/json'
};

const report = {
  startedAt: new Date().toISOString(),
  steps: [],
  failures: [],
  context: {
    symbol: '',
    seeded_order_id: 0,
    confirm_pending_id: 0,
    reject_pending_id: 0,
    queued_task_id: ''
  },
  snapshots: {}
};

const assertOk = (cond, message, detail = null) => {
  if (!cond) {
    report.failures.push(detail ? `${message} | ${JSON.stringify(detail)}` : message);
  }
};

const callApi = async (path, { method = 'GET', body, auth = false } = {}) => {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: auth ? authHeaders : { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await res.text();
  let payload = null;
  try {
    payload = JSON.parse(text);
  } catch {
    payload = { code: -1, msg: text, data: null };
  }
  return {
    httpOk: res.ok,
    status: res.status,
    code: Number(payload?.code),
    msg: String(payload?.msg || ''),
    data: payload?.data,
    raw: text
  };
};

const waitForReady = async () => {
  const deadline = Date.now() + 45000;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`${BASE}/api/public/overview`);
      if (r.ok) return true;
    } catch {
      // ignore
    }
    await sleep(500);
  }
  return false;
};

const startWrangler = () => {
  const command = process.platform === 'win32'
    ? 'npx.cmd wrangler dev --local --ip 127.0.0.1 --port 8788'
    : 'npx wrangler dev --local --ip 127.0.0.1 --port 8788';
  const child = spawn(command, {
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: true
  });
  child.stdout.on('data', (d) => process.stdout.write(`[wrangler] ${d}`));
  child.stderr.on('data', (d) => process.stderr.write(`[wrangler] ${d}`));
  return child;
};

const stopProcessTree = (child) => {
  if (!child || child.killed) return;
  if (process.platform === 'win32') {
    const killer = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    killer.on('error', () => {
      try {
        child.kill('SIGTERM');
      } catch {
        // ignore
      }
    });
    return;
  }
  try {
    child.kill('SIGTERM');
  } catch {
    // ignore
  }
};

const round2 = (n) => Number(Number(n).toFixed(2));

const extractRun = (data) => data?.run || data?.task?.result || data?.task?.run || null;

const pickQuote = async () => {
  const candidates = ['600000', '601398', '000001', '000002', '600519'];
  for (const symbol of candidates) {
    const res = await callApi(`/api/public/quote?symbol=${symbol}`);
    if (res.code === 0 && Number(res?.data?.price || 0) > 0) {
      return {
        symbol,
        quote: res.data
      };
    }
  }
  return null;
};

const getPendingActions = async () => {
  const res = await callApi('/api/admin/ai/pending?status=PENDING&page=1&page_size=100', { auth: true });
  const items = Array.isArray(res?.data?.items) ? res.data.items : [];
  return { res, items };
};

const getAiTasks = async () => {
  const res = await callApi('/api/admin/ai/tasks?page=1&page_size=100&include_result=1', { auth: true });
  const items = Array.isArray(res?.data?.items) ? res.data.items : [];
  return { res, items };
};

const waitTaskFinished = async (taskId, timeoutMs = 20000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const { items } = await getAiTasks();
    const task = items.find((x) => String(x?.task_id || '') === String(taskId));
    if (task && task.status !== 'PENDING' && task.status !== 'RUNNING') return task;
    await sleep(800);
  }
  return null;
};

const runStrictApiTest = async () => {
  const init = await callApi('/api/admin/init', {
    method: 'POST',
    auth: true,
    body: { confirm: 'RESET' }
  });
  assertOk(init.code === 0, 'init failed', { msg: init.msg, status: init.status });
  report.steps.push('init_done');

  const quotePick = await pickQuote();
  assertOk(!!quotePick, 'no quote available from candidate symbols');
  if (!quotePick) return;

  const symbol = String(quotePick.symbol);
  report.context.symbol = symbol;
  const price = Number(quotePick.quote.price || 0);
  const prevClose = Number(quotePick.quote.prev_close || price || 0);
  const lowPrice = round2(Math.max((prevClose || price) * 0.95, 0.01));

  const cfg = await callApi('/api/admin/ai/config', {
    method: 'POST',
    auth: true,
    body: {
      enabled: true,
      interval_min: 3,
      daily_run_target: 5,
      gemini_max_requests: 60,
      watchlist: [symbol],
      clear_ai_cache: true
    }
  });
  assertOk(cfg.code === 0, 'ai config update failed', { msg: cfg.msg });
  report.steps.push('config_updated');

  const seedOrder = await callApi('/api/admin/trade', {
    method: 'POST',
    auth: true,
    body: {
      symbol,
      side: 'BUY',
      qty: 100,
      price: lowPrice
    }
  });
  assertOk(seedOrder.code === 0, 'seed order failed', { msg: seedOrder.msg });
  const seedOrderId = Number(seedOrder?.data?.order_id || 0);
  report.context.seeded_order_id = seedOrderId;
  assertOk(seedOrderId > 0, 'seed order_id missing', { payload: seedOrder.data });
  report.steps.push('seed_order_created');

  const runReview = await callApi('/api/admin/ai/run', {
    method: 'POST',
    auth: true,
    body: {
      force: true,
      dry_run: false,
      immediate: true,
      manual_request: true,
      execution_mode: 'USER_CONFIRM',
      reason: 'strict-review'
    }
  });
  assertOk(runReview.code === 0, 'ai user_confirm run failed', { msg: runReview.msg });
  const reviewRun = extractRun(runReview.data || {});
  report.snapshots.review_run = reviewRun;
  assertOk(!!reviewRun, 'review run summary missing');
  assertOk(reviewRun?.execution_mode === 'USER_CONFIRM', 'execution_mode mismatch for review run', { execution_mode: reviewRun?.execution_mode });
  assertOk(Number(reviewRun?.actions_total || 0) > 0, 'review run generated zero actions', reviewRun);
  assertOk(Number(reviewRun?.pending_actions || 0) > 0, 'review run generated zero pending actions', reviewRun);
  report.steps.push('review_run_done');

  const pendingBeforeConfirm = await getPendingActions();
  assertOk(pendingBeforeConfirm.res.code === 0, 'query pending actions failed', { msg: pendingBeforeConfirm.res.msg });
  assertOk(pendingBeforeConfirm.items.length > 0, 'pending actions list empty after review run');
  const confirmId = Number(pendingBeforeConfirm.items?.[0]?.id || 0);
  report.context.confirm_pending_id = confirmId;
  assertOk(confirmId > 0, 'invalid pending id for confirm');

  if (confirmId > 0) {
    const confirm = await callApi('/api/admin/ai/pending/confirm', {
      method: 'POST',
      auth: true,
      body: { ids: [confirmId] }
    });
    assertOk(confirm.code === 0, 'confirm pending action failed', { msg: confirm.msg, data: confirm.data });
    assertOk(Number(confirm?.data?.found || 0) >= 1, 'confirm found count invalid', confirm.data);
    assertOk(Number(confirm?.data?.executed || 0) + Number(confirm?.data?.failed || 0) >= 1, 'confirm execution result missing', confirm.data);
  }
  report.steps.push('pending_confirm_done');

  const runReview2 = await callApi('/api/admin/ai/run', {
    method: 'POST',
    auth: true,
    body: {
      force: true,
      dry_run: false,
      immediate: true,
      manual_request: true,
      execution_mode: 'USER_CONFIRM',
      reason: 'strict-review-reject'
    }
  });
  assertOk(runReview2.code === 0, 'second review run failed', { msg: runReview2.msg });

  const pendingForReject = await getPendingActions();
  const rejectId = Number(pendingForReject.items?.[0]?.id || 0);
  report.context.reject_pending_id = rejectId;
  assertOk(rejectId > 0, 'invalid pending id for reject');
  if (rejectId > 0) {
    const reject = await callApi('/api/admin/ai/pending/reject', {
      method: 'POST',
      auth: true,
      body: {
        ids: [rejectId],
        reason: 'strict-api-test reject path'
      }
    });
    assertOk(reject.code === 0, 'reject pending action failed', { msg: reject.msg, data: reject.data });
    assertOk(Number(reject?.data?.rejected || 0) >= 1, 'reject count invalid', reject.data);
  }
  report.steps.push('pending_reject_done');

  const runAuto = await callApi('/api/admin/ai/run', {
    method: 'POST',
    auth: true,
    body: {
      force: true,
      dry_run: false,
      immediate: true,
      manual_request: true,
      execution_mode: 'AUTO_EXECUTE',
      reason: 'strict-auto'
    }
  });
  assertOk(runAuto.code === 0, 'auto execute run failed', { msg: runAuto.msg });
  const autoRun = extractRun(runAuto.data || {});
  report.snapshots.auto_run = autoRun;
  assertOk(!!autoRun, 'auto run summary missing');
  assertOk(autoRun?.execution_mode === 'AUTO_EXECUTE', 'execution_mode mismatch for auto run', { execution_mode: autoRun?.execution_mode });
  assertOk(Number(autoRun?.actions_total || 0) > 0, 'auto run generated zero actions', autoRun);
  assertOk(Number(autoRun?.execution?.attempted || 0) > 0, 'auto run attempted zero actions', autoRun);
  report.steps.push('auto_run_done');

  const queued = await callApi('/api/admin/ai/run', {
    method: 'POST',
    auth: true,
    body: {
      force: true,
      dry_run: false,
      immediate: false,
      manual_request: true,
      execution_mode: 'AUTO_EXECUTE',
      reason: 'strict-queued'
    }
  });
  assertOk(queued.code === 0, 'queue ai task failed', { msg: queued.msg });
  const queuedTaskId = String(queued?.data?.task_id || '');
  report.context.queued_task_id = queuedTaskId;
  assertOk(queuedTaskId.length > 0, 'queued task_id missing', queued.data);
  report.steps.push('task_queued');

  const scheduledRes = await fetch(`${BASE}/cdn-cgi/handler/scheduled`);
  assertOk(scheduledRes.ok, 'scheduled endpoint trigger failed', { status: scheduledRes.status });
  report.steps.push('scheduled_triggered');

  if (queuedTaskId) {
    const task = await waitTaskFinished(queuedTaskId, 20000);
    assertOk(!!task, 'queued task not finished in time');
    if (task) {
      report.snapshots.queued_task = task;
      assertOk(task.status === 'DONE' || task.status === 'FAILED', 'queued task invalid final status', task);
    }
  }
  report.steps.push('task_processed');

  const matchRes = await callApi('/api/admin/match', {
    method: 'POST',
    auth: true,
    body: { reason: 'strict-api-test' }
  });
  assertOk(matchRes.code === 0, 'manual match failed', { msg: matchRes.msg });

  const ordersRes = await callApi('/api/admin/orders?days=7', { auth: true });
  const holdingsRes = await callApi('/api/admin/holdings', { auth: true });
  assertOk(ordersRes.code === 0, 'orders api failed', { msg: ordersRes.msg });
  assertOk(holdingsRes.code === 0, 'holdings api failed', { msg: holdingsRes.msg });
  report.snapshots.orders_count = Array.isArray(ordersRes.data) ? ordersRes.data.length : 0;
  report.snapshots.holdings_count = Array.isArray(holdingsRes.data) ? holdingsRes.data.length : 0;

  const state = await callApi('/api/admin/ai/state', { auth: true });
  assertOk(state.code === 0, 'ai state api failed', { msg: state.msg });
  report.snapshots.state = state.data;

  const runs = await callApi('/api/admin/ai/runs?page=1&page_size=20', { auth: true });
  assertOk(runs.code === 0, 'ai runs api failed', { msg: runs.msg });
  assertOk(Array.isArray(runs?.data?.items), 'ai runs list malformed');
  report.snapshots.runs_count = Array.isArray(runs?.data?.items) ? runs.data.items.length : 0;

  const tasks = await getAiTasks();
  assertOk(tasks.res.code === 0, 'ai tasks api failed', { msg: tasks.res.msg });
  report.snapshots.tasks_count = tasks.items.length;

  const integrity = await callApi('/api/admin/integrity', { auth: true });
  assertOk(integrity.code === 0, 'integrity api failed', { msg: integrity.msg });
  report.snapshots.integrity = integrity.data;
  if (integrity.code === 0) {
    const checks = integrity.data?.checks || {};
    const freezeDiff = Number(checks?.account?.freeze_diff || 0);
    const invalidHoldings = Number(checks?.holdings?.invalid_rows || 0);
    const invalidOrders = Number(checks?.orders?.invalid_rows || 0);
    const orphanTrades = Number(checks?.trades?.orphan_rows || 0);
    const staleMatching = Number(checks?.orders?.stale_matching || 0);
    assertOk(freezeDiff === 0, 'freeze diff not zero', checks?.account);
    assertOk(invalidHoldings === 0, 'invalid holdings rows found', checks?.holdings);
    assertOk(invalidOrders === 0, 'invalid orders rows found', checks?.orders);
    assertOk(orphanTrades === 0, 'orphan trades rows found', checks?.trades);
    assertOk(staleMatching === 0, 'stale matching rows found', checks?.orders);
  }
  report.steps.push('integrity_checked');
};

let wrangler = null;
try {
  const skipSpawn = process.env.NO_SPAWN === '1';
  if (!skipSpawn) wrangler = startWrangler();
  const ready = await waitForReady();
  assertOk(ready, 'wrangler dev not ready in 45s');
  if (ready) {
    report.steps.push('wrangler_ready');
    await runStrictApiTest();
  }
} catch (e) {
  report.failures.push(String(e?.message || e));
} finally {
  stopProcessTree(wrangler);
}

report.finishedAt = new Date().toISOString();
report.ok = report.failures.length === 0;
console.log(JSON.stringify(report, null, 2));

if (!report.ok) process.exit(1);
