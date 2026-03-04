import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import jwt from 'jsonwebtoken';

const BASE = 'http://127.0.0.1:8787';
const JWT_SECRET = 'linkbrainsecurity';

const token = jwt.sign({ role: 'admin', jti: `chaos-${Date.now()}` }, JWT_SECRET, { expiresIn: '2h' });

const authHeaders = {
  Authorization: `Bearer ${token}`,
  'Content-Type': 'application/json'
};

const stat = {
  startedAt: new Date().toISOString(),
  symbol: '',
  quote: null,
  lowPrice: 0,
  highPrice: 0,
  scenarios: {},
  failures: [],
  integrity: null
};

const round2 = (n) => Number(Number(n).toFixed(2));

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

const pickQuote = async () => {
  const candidates = ['600000', '601398', '000001', '000002'];
  for (const code of candidates) {
    const res = await callApi(`/api/public/quote?symbol=${code}`);
    if (res.code === 0 && res.data?.price > 0 && res.data?.prev_close > 0) {
      return { code, quote: res.data };
    }
  }
  throw new Error('failed to fetch any quote from candidate symbols');
};

const extractPendingOrderIds = async () => {
  const ordersRes = await callApi('/api/admin/orders', { auth: true });
  if (ordersRes.code !== 0 || !Array.isArray(ordersRes.data)) return [];
  return ordersRes.data
    .filter((o) => o?.status === 'PENDING')
    .map((o) => Number(o.id))
    .filter((id) => Number.isInteger(id) && id > 0);
};

const placeOrder = async (payload) => callApi('/api/admin/trade', { method: 'POST', auth: true, body: payload });
const cancelOrder = async (orderId) => callApi('/api/admin/cancel', { method: 'POST', auth: true, body: { order_id: orderId } });
const manualMatch = async (reason) => callApi('/api/admin/match', { method: 'POST', auth: true, body: { reason } });
const orderIdOf = (res) => Number(res?.data?.order_id || 0);

const runScenario = async () => {
  const resetRes = await callApi('/api/admin/init', { method: 'POST', auth: true, body: { confirm: 'RESET' } });
  if (resetRes.code !== 0) throw new Error(`init failed: ${resetRes.msg}`);

  const picked = await pickQuote();
  stat.symbol = picked.code;
  stat.quote = picked.quote;

  const prev = Number(picked.quote.prev_close);
  const curr = Number(picked.quote.price);
  stat.lowPrice = round2(Math.max(prev * 0.91, 0.01));
  stat.highPrice = round2(Math.min(prev * 1.09, curr * 1.03));
  if (stat.highPrice <= stat.lowPrice) stat.highPrice = round2(stat.lowPrice + 0.05);

  const invalidCases = [
    { symbol: picked.code, side: 'BUY', price: stat.highPrice, qty: 90 },
    { symbol: picked.code, side: 'BUY', price: 0, qty: 100 },
    { symbol: 'abc', side: 'BUY', price: stat.highPrice, qty: 100 }
  ];
  const invalidRes = await Promise.all(invalidCases.map((x) => placeOrder(x)));
  stat.scenarios.invalidOrders = invalidRes.map((x) => ({ code: x.code, msg: x.msg }));

  const pendingBurst = 24;
  const burstResults = await Promise.all(
    Array.from({ length: pendingBurst }).map((_, i) =>
      placeOrder({
        symbol: picked.code,
        side: 'BUY',
        price: stat.lowPrice,
        qty: 100,
        request_id: `burst-pending-${Date.now()}-${i}`
      })
    )
  );
  const burstOk = burstResults.filter((x) => x.code === 0).length;
  const burstMissingOrderId = burstResults.filter((x) => x.code === 0 && orderIdOf(x) <= 0).length;
  if (burstMissingOrderId > 0) {
    stat.failures.push(`pending burst missing order_id in ${burstMissingOrderId} successful responses`);
  }
  const burstOrderIds = burstResults
    .filter((x) => x.code === 0)
    .map((x) => orderIdOf(x))
    .filter((id) => Number.isInteger(id) && id > 0);
  stat.scenarios.pendingBurst = { total: pendingBurst, success: burstOk, failed: pendingBurst - burstOk };

  const pendingIds = await extractPendingOrderIds();
  const pendingSet = new Set(pendingIds);
  const visibleBurstOrders = burstOrderIds.filter((id) => pendingSet.has(id)).length;
  if (burstOrderIds.length > 0 && visibleBurstOrders === 0) {
    stat.failures.push('successful BUY orders not visible in /api/admin/orders pending list');
  }
  const cancelTargets = pendingIds.slice(0, 8);
  const cancelStormCalls = [];
  for (const id of cancelTargets) {
    cancelStormCalls.push(cancelOrder(id), cancelOrder(id), cancelOrder(id));
  }
  const cancelStormRes = await Promise.all(cancelStormCalls);
  stat.scenarios.cancelStorm = {
    targets: cancelTargets.length,
    totalCalls: cancelStormRes.length,
    success: cancelStormRes.filter((x) => x.code === 0).length,
    rejected: cancelStormRes.filter((x) => x.code !== 0).length
  };

  const aggressiveCount = 12;
  const aggressiveRes = await Promise.all(
    Array.from({ length: aggressiveCount }).map((_, i) =>
      placeOrder({
        symbol: picked.code,
        side: 'BUY',
        price: stat.highPrice,
        qty: 100,
        request_id: `aggressive-buy-${Date.now()}-${i}`
      })
    )
  );
  const aggressiveMissingOrderId = aggressiveRes.filter((x) => x.code === 0 && orderIdOf(x) <= 0).length;
  if (aggressiveMissingOrderId > 0) {
    stat.failures.push(`aggressive buy missing order_id in ${aggressiveMissingOrderId} successful responses`);
  }
  stat.scenarios.aggressiveBuys = {
    total: aggressiveCount,
    success: aggressiveRes.filter((x) => x.code === 0).length
  };

  await Promise.all(
    Array.from({ length: 8 }).map((_, i) => manualMatch(`chaos-buy-match-${i}`))
  );
  await sleep(1200);

  const holdingsRes = await callApi('/api/admin/holdings', { auth: true });
  const holdings = Array.isArray(holdingsRes.data) ? holdingsRes.data : [];
  const targetHolding = holdings.find((h) => h?.symbol?.endsWith(stat.symbol));
  const availableQty = Number(targetHolding?.available_qty || 0);

  let sellPlaced = 0;
  if (availableQty >= 100) {
    const sellUnits = Math.min(8, Math.floor(availableQty / 100));
    const sellPayloads = Array.from({ length: sellUnits }).map((_, i) => ({
      symbol: stat.symbol,
      side: 'SELL',
      price: stat.lowPrice,
      qty: 100,
      request_id: `aggressive-sell-${Date.now()}-${i}`
    }));
    const sellResults = await Promise.all(sellPayloads.map((x) => placeOrder(x)));
    const sellMissingOrderId = sellResults.filter((x) => x.code === 0 && orderIdOf(x) <= 0).length;
    if (sellMissingOrderId > 0) {
      stat.failures.push(`sell race missing order_id in ${sellMissingOrderId} successful responses`);
    }
    sellPlaced = sellResults.filter((x) => x.code === 0).length;

    const sellPendingIds = await extractPendingOrderIds();
    const sellTargets = sellPendingIds.slice(0, 6);
    const raceCalls = [
      ...sellTargets.map((id) => cancelOrder(id)),
      ...Array.from({ length: 6 }).map((_, i) => manualMatch(`chaos-sell-race-${i}`))
    ];
    await Promise.all(raceCalls);
  }
  stat.scenarios.sellRace = { availableQty, sellPlaced };

  const integrityRes = await callApi('/api/admin/integrity', { auth: true });
  stat.integrity = integrityRes.data || null;
  if (integrityRes.code !== 0) {
    stat.failures.push(`integrity api failed: ${integrityRes.msg}`);
  } else {
    const checks = integrityRes.data?.checks || {};
    const freezeDiff = Number(checks?.account?.freeze_diff || 0);
    const invalidH = Number(checks?.holdings?.invalid_rows || 0);
    const invalidO = Number(checks?.orders?.invalid_rows || 0);
    const orphanT = Number(checks?.trades?.orphan_rows || 0);
    const staleM = Number(checks?.orders?.stale_matching || 0);
    if (freezeDiff !== 0) stat.failures.push(`freeze diff not zero: ${freezeDiff}`);
    if (invalidH !== 0) stat.failures.push(`invalid holdings rows: ${invalidH}`);
    if (invalidO !== 0) stat.failures.push(`invalid orders rows: ${invalidO}`);
    if (orphanT !== 0) stat.failures.push(`orphan trades rows: ${orphanT}`);
    if (staleM !== 0) stat.failures.push(`stale matching orders: ${staleM}`);
  }
};

const startWrangler = () => {
  const command = process.platform === 'win32'
    ? 'npx.cmd wrangler dev --local --ip 127.0.0.1 --port 8787'
    : 'npx wrangler dev --local --ip 127.0.0.1 --port 8787';
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

let wrangler = null;
try {
  const skipSpawn = process.env.NO_SPAWN === '1';
  if (!skipSpawn) wrangler = startWrangler();
  await waitForReady();
  await runScenario();
} catch (e) {
  stat.failures.push(String(e?.message || e));
} finally {
  stopProcessTree(wrangler);
}

stat.finishedAt = new Date().toISOString();
stat.ok = stat.failures.length === 0;
console.log(JSON.stringify(stat, null, 2));

if (!stat.ok) process.exit(1);
