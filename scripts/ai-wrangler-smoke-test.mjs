import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import jwt from 'jsonwebtoken';

const BASE = 'http://127.0.0.1:8788';
const JWT_SECRET = 'linkbrainsecurity';

const token = jwt.sign({ role: 'admin', jti: `ai-smoke-${Date.now()}` }, JWT_SECRET, { expiresIn: '2h' });
const authHeaders = {
  Authorization: `Bearer ${token}`,
  'Content-Type': 'application/json'
};

const stat = {
  startedAt: new Date().toISOString(),
  steps: [],
  failures: [],
  run: null,
  rssAuditSample: null,
  state: null
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
    code: payload?.code,
    msg: payload?.msg,
    data: payload?.data
  };
};

const waitForReady = async () => {
  const deadline = Date.now() + 45000;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`${BASE}/api/public/overview`);
      if (r.ok) return;
    } catch {
      // ignore and retry
    }
    await sleep(500);
  }
  throw new Error('wrangler dev not ready in 45s');
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

const assertOk = (cond, message) => {
  if (!cond) stat.failures.push(message);
};

let wrangler = null;
try {
  wrangler = startWrangler();
  await waitForReady();
  stat.steps.push('wrangler_ready');

  const initRes = await callApi('/api/admin/init', {
    method: 'POST',
    auth: true,
    body: { confirm: 'RESET' }
  });
  assertOk(initRes.code === 0, `init failed: ${initRes.msg}`);
  stat.steps.push('init_done');

  const configRes = await callApi('/api/admin/ai/config', {
    method: 'POST',
    auth: true,
    body: {
      enabled: true,
      interval_min: 3,
      daily_run_target: 5,
      gemini_max_requests: 60,
      clear_ai_cache: true,
      rss_feeds: [
        'https://rss.sina.com.cn/not-exists-feed.xml',
        'https://rss.sina.com.cn/rollnews/finance.xml'
      ]
    }
  });
  assertOk(configRes.code === 0, `ai config failed: ${configRes.msg}`);
  stat.steps.push('ai_config_done');

  const runResults = [];
  for (let i = 0; i < 5; i += 1) {
    const runRes = await callApi('/api/admin/ai/run', {
      method: 'POST',
      auth: true,
      body: {
        force: true,
        dry_run: false,
        immediate: true,
        manual_request: true,
        review_only: true,
        reason: `wrangler-ai-smoke-test-${i + 1}`
      }
    });
    assertOk(runRes.code === 0, `ai run failed at attempt ${i + 1}: ${runRes.msg}`);
    runResults.push(runRes.data || null);
  }
  stat.run = runResults;
  const runIds = runResults
    .map((x) => String(x?.run?.run_id || x?.task?.result?.run_id || ''))
    .filter(Boolean);
  assertOk(runIds.length > 0, 'expected at least one ai run id from immediate runs');
  stat.steps.push('ai_run_done');

  const stateRes = await callApi('/api/admin/ai/state', { auth: true });
  assertOk(stateRes.code === 0, `ai state failed: ${stateRes.msg}`);
  stat.state = stateRes.data;
  const dailyQuota = stateRes.data?.daily_quota || {};
  assertOk(Number(dailyQuota.run_count || 0) <= Number(dailyQuota.run_limit || 0), 'daily run count exceeds run limit');
  assertOk(Number(dailyQuota.gemini_requests || 0) <= Number(dailyQuota.gemini_request_limit || 0), 'daily gemini requests exceeds limit');
  stat.steps.push('ai_state_loaded');

  const runsRes = await callApi('/api/admin/ai/runs?page=1&page_size=20', { auth: true });
  assertOk(runsRes.code === 0, `runs query failed: ${runsRes.msg}`);
  const runItems = Array.isArray(runsRes.data?.items) ? runsRes.data.items : [];
  assertOk(runItems.length > 0, 'expected ai runs list to contain new rows');
  stat.steps.push('runs_loaded');

  const pendingRes = await callApi('/api/admin/ai/pending?status=PENDING&page=1&page_size=100', { auth: true });
  assertOk(pendingRes.code === 0, `pending query failed: ${pendingRes.msg}`);
  const pendingItems = Array.isArray(pendingRes.data?.items) ? pendingRes.data.items : [];
  assertOk(pendingItems.length > 0, 'expected pending actions from review_only runs');
  stat.steps.push('pending_loaded');
} catch (e) {
  stat.failures.push(String(e?.message || e));
} finally {
  stopProcessTree(wrangler);
}

stat.finishedAt = new Date().toISOString();
stat.ok = stat.failures.length === 0;
console.log(JSON.stringify(stat, null, 2));

if (!stat.ok) process.exit(1);
