// src/index.js
import { signToken, verifyAuth, verifyPassword } from './auth.js';
import { placeOrder, cancelOrder, matchOrders } from './trade.js';
import { handleScheduled } from './cron.js';
import { jsonResponse, errorResponse, Money, Time, TradeRules } from './utils.js';
import { fetchStockPrice } from './market.js';
import { ensureRuntimeSchema, withTransaction } from './db.js';

const LOGIN_MAX_FAILURES = 5;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_LOCK_MS = 30 * 60 * 1000;

const getClientIp = (request) => {
    const cfIp = request.headers.get('CF-Connecting-IP');
    if (cfIp) return cfIp;
    const forwarded = request.headers.get('X-Forwarded-For');
    if (forwarded) return forwarded.split(',')[0].trim();
    return 'unknown';
};

const parseBody = async (request) => {
    try {
        return await request.json();
    } catch {
        return null;
    }
};

const asTrimmed = (value) => (typeof value === 'string' ? value.trim() : '');

const getLockState = async (env, ip) => {
    const row = await env.DB.prepare('SELECT fail_count, first_fail_at, locked_until FROM login_attempts WHERE ip=?')
        .bind(ip).first();
    if (!row) return { locked: false };

    const now = Date.now();
    const lockedUntilTs = row.locked_until ? Date.parse(row.locked_until) : 0;
    if (lockedUntilTs > now) {
        return { locked: true, remainMs: lockedUntilTs - now };
    }

    return { locked: false, row };
};

const recordLoginFailure = async (env, ip) => {
    const now = Date.now();
    const nowIso = new Date(now).toISOString();
    const row = await env.DB.prepare('SELECT fail_count, first_fail_at FROM login_attempts WHERE ip=?').bind(ip).first();

    if (!row) {
        await env.DB.prepare(
            'INSERT INTO login_attempts (ip, fail_count, first_fail_at, locked_until, updated_at) VALUES (?, 1, ?, NULL, CURRENT_TIMESTAMP)'
        ).bind(ip, nowIso).run();
        return;
    }

    const firstTs = row.first_fail_at ? Date.parse(row.first_fail_at) : 0;
    let failCount = row.fail_count;
    let firstFailAt = row.first_fail_at || nowIso;

    if (!firstTs || now - firstTs > LOGIN_WINDOW_MS) {
        failCount = 1;
        firstFailAt = nowIso;
    } else {
        failCount += 1;
    }

    let lockedUntil = null;
    if (failCount >= LOGIN_MAX_FAILURES) {
        lockedUntil = new Date(now + LOGIN_LOCK_MS).toISOString();
        failCount = 0;
        firstFailAt = nowIso;
    }

    await env.DB.prepare(
        'UPDATE login_attempts SET fail_count=?, first_fail_at=?, locked_until=?, updated_at=CURRENT_TIMESTAMP WHERE ip=?'
    ).bind(failCount, firstFailAt, lockedUntil, ip).run();
};

const clearLoginFailures = async (env, ip) => {
    await env.DB.prepare('DELETE FROM login_attempts WHERE ip=?').bind(ip).run();
};

const normalizeTransferType = (type) => String(type || '').toUpperCase();

const buildTransferResponse = (record) => ({
    request_id: record.request_id,
    type: record.type,
    status: record.status,
    amount: Money.toYuan(record.amount),
    created_at: record.created_at,
    processed_at: record.processed_at,
    reason: record.reason || null
});

const handleTransfer = async (env, body) => {
    if (!body || typeof body !== 'object') return errorResponse('参数错误', 400, 4100);

    if (!Time.isBankTransferOpen()) {
        return errorResponse('当前不在银证转账时段（工作日 09:00-16:00）', 400, 4101);
    }

    const type = normalizeTransferType(body.type);
    if (type !== 'IN' && type !== 'OUT') return errorResponse('type 仅支持 IN/OUT', 400, 4102);

    if (!Money.hasAtMostTwoDecimals(body.amount)) return errorResponse('amount 格式非法', 400, 4103);
    const amountCent = Money.toCent(body.amount);
    if (!Number.isInteger(amountCent) || amountCent <= 0) return errorResponse('金额必须大于0', 400, 4104);

    if (amountCent > TradeRules.MAX_SINGLE_TRANSFER_CENT) {
        return errorResponse(`单笔转账超过限制（${Money.toYuan(TradeRules.MAX_SINGLE_TRANSFER_CENT)}元）`, 400, 4105);
    }

    const cstDate = Time.formatCSTDate();
    const requestIdInput = asTrimmed(body.request_id);
    const requestId = requestIdInput || crypto.randomUUID();
    if (requestId.length > 80) return errorResponse('request_id 过长', 400, 4107);

    try {
        const result = await withTransaction(env, async () => {
            const existing = await env.DB.prepare('SELECT * FROM bank_transfers WHERE request_id=?').bind(requestId).first();
            if (existing) {
                return { type: 'EXISTING', record: existing };
            }

            const daily = await env.DB.prepare(
                "SELECT COALESCE(SUM(amount), 0) AS total FROM bank_transfers WHERE cst_date=? AND status='SUCCESS'"
            ).bind(cstDate).first();
            if ((Number(daily?.total || 0) + amountCent) > TradeRules.MAX_DAILY_TRANSFER_CENT) {
                return { type: 'LIMIT' };
            }

            const createRes = await env.DB.prepare(
                'INSERT INTO bank_transfers (request_id, type, amount, cst_date, status) VALUES (?, ?, ?, ?, ?)'
            ).bind(requestId, type, amountCent, cstDate, 'PROCESSING').run();
            if ((createRes?.meta?.changes || 0) === 0) {
                throw new Error('transfer create failed');
            }

            if (type === 'IN') {
                const inRes = await env.DB.prepare('UPDATE account SET balance = balance + ? WHERE id = 1')
                    .bind(amountCent).run();
                if ((inRes?.meta?.changes || 0) === 0) throw new Error('account update failed');
            } else {
                const outRes = await env.DB.prepare(
                    'UPDATE account SET balance = balance - ? WHERE id = 1 AND (balance - frozen_balance) >= ?'
                ).bind(amountCent, amountCent).run();
                if ((outRes?.meta?.changes || 0) === 0) {
                    await env.DB.prepare(
                        "UPDATE bank_transfers SET status='FAILED', reason='可用余额不足', processed_at=CURRENT_TIMESTAMP WHERE request_id=?"
                    ).bind(requestId).run();
                    const failed = await env.DB.prepare('SELECT * FROM bank_transfers WHERE request_id=?').bind(requestId).first();
                    return { type: 'INSUFFICIENT', record: failed };
                }
            }

            const doneRes = await env.DB.prepare(
                "UPDATE bank_transfers SET status='SUCCESS', processed_at=CURRENT_TIMESTAMP WHERE request_id=?"
            ).bind(requestId).run();
            if ((doneRes?.meta?.changes || 0) === 0) throw new Error('transfer finalize failed');

            const done = await env.DB.prepare('SELECT * FROM bank_transfers WHERE request_id=?').bind(requestId).first();
            return { type: 'SUCCESS', record: done };
        });

        if (result.type === 'EXISTING') return jsonResponse(buildTransferResponse(result.record));
        if (result.type === 'LIMIT') {
            return errorResponse(`当日累计转账超过限制（${Money.toYuan(TradeRules.MAX_DAILY_TRANSFER_CENT)}元）`, 400, 4106);
        }
        if (result.type === 'INSUFFICIENT') return errorResponse('可用余额不足', 400, 4001);
        return jsonResponse(buildTransferResponse(result.record));
    } catch (e) {
        await env.DB.prepare(
            "UPDATE bank_transfers SET status='FAILED', reason=?, processed_at=CURRENT_TIMESTAMP WHERE request_id=? AND status='PROCESSING'"
        ).bind(String(e?.message || 'transfer failed').slice(0, 120), requestId).run();
        return errorResponse('转账失败，请稍后重试', 500, 5100);
    }
};

export default {
    async fetch(request, env, ctx) {
        const url = new URL(request.url);
        const method = request.method;

        if (method === 'OPTIONS') {
            return new Response(null, {
                headers: {
                    'Access-Control-Allow-Origin': '*',
                    'Access-Control-Allow-Headers': '*',
                    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
                }
            });
        }

        try {
            await ensureRuntimeSchema(env);

            if (url.pathname === '/api/public/quote') {
                if (method !== 'GET') return errorResponse('Method Not Allowed', 405, 4050);
                const symbol = asTrimmed(url.searchParams.get('symbol'));
                if (!symbol) return errorResponse('symbol 不能为空', 400, 4007);

                const quote = await fetchStockPrice(symbol);
                if (!quote) return errorResponse('无法获取行情', 400, 4005);

                const lastPrice = Number(quote.price || 0);
                const prevClose = Number(quote.prevClose || 0);
                const pct = prevClose > 0 ? Number((((lastPrice - prevClose) / prevClose) * 100).toFixed(2)) : 0;
                return jsonResponse({
                    symbol: quote.symbol,
                    name: quote.name,
                    price: Number(lastPrice.toFixed(2)),
                    prev_close: prevClose > 0 ? Number(prevClose.toFixed(2)) : null,
                    change_pct: pct,
                    source: quote.source || 'unknown'
                });
            }

            if (url.pathname === '/api/public/overview') {
                if (method !== 'GET') return errorResponse('Method Not Allowed', 405, 4050);

                const account = await env.DB.prepare('SELECT * FROM account WHERE id=1').first();
                const { results: holdings } = await env.DB.prepare('SELECT * FROM holdings WHERE quantity > 0').all();
                const { results: logs } = await env.DB.prepare('SELECT * FROM trades ORDER BY id DESC LIMIT 10').all();
                const { results: snaps } = await env.DB.prepare('SELECT * FROM snapshots ORDER BY date ASC').all();

                let marketCap = 0;
                let totalCost = 0;
                const holdingList = [];

                await Promise.all(holdings.map(async (h) => {
                    const m = await fetchStockPrice(h.symbol);
                    const curPriceCent = m ? Money.toCent(m.price) : h.avg_cost;
                    const valCent = curPriceCent * h.quantity;
                    marketCap += valCent;
                    totalCost += h.total_cost;

                    holdingList.push({
                        name: h.name,
                        code: h.symbol,
                        quantity: h.quantity,
                        cost: Money.toYuan(h.avg_cost),
                        price: Money.toYuan(curPriceCent),
                        pnl_val: Money.toYuan(valCent - h.total_cost),
                        pnl_rate: h.avg_cost > 0 ? parseFloat((((curPriceCent - h.avg_cost) / h.avg_cost) * 100).toFixed(2)) : 0,
                        val_cent: valCent
                    });
                }));

                const totalAssetsCent = account.balance + marketCap;
                const totalAssetsYuan = Money.toYuan(totalAssetsCent);

                holdingList.forEach((h) => {
                    h.position_rate = totalAssetsCent > 0
                        ? parseFloat(((h.val_cent / totalAssetsCent) * 100).toFixed(2))
                        : 0;
                    delete h.val_cent;
                });

                const todayStr = Time.formatCSTDate();
                const lastSnap = snaps.filter((s) => s.date !== todayStr).pop() || { total_assets: account.initial_capital };
                const dayPnlCent = totalAssetsCent - lastSnap.total_assets;
                const historicalAssets = snaps
                    .filter((s) => s.date !== todayStr)
                    .map((s) => ({ date: s.date, value: Money.toYuan(s.total_assets) }));

                return jsonResponse({
                    assets: {
                        total: totalAssetsYuan,
                        market_cap: Money.toYuan(marketCap),
                        balance: Money.toYuan(account.balance - account.frozen_balance),
                        frozen: Money.toYuan(account.frozen_balance),
                        pnl_holding: Money.toYuan(marketCap - totalCost),
                        day_pnl: Money.toYuan(dayPnlCent),
                        day_pct: lastSnap.total_assets > 0
                            ? parseFloat(((dayPnlCent / lastSnap.total_assets) * 100).toFixed(2))
                            : 0,
                        return_total_pct: account.initial_capital > 0
                            ? parseFloat((((totalAssetsCent - account.initial_capital) / account.initial_capital) * 100).toFixed(2))
                            : 0,
                        max_drawdown: 0
                    },
                    holdings: holdingList.sort((a, b) => b.position_rate - a.position_rate),
                    logs: logs.map((l) => {
                        const pre = (l.pre_pos_ratio || 0).toFixed(2);
                        const post = (l.post_pos_ratio || 0).toFixed(2);
                        const action = l.side === 'BUY' ? '加仓' : '减仓';
                        const tradeTime = typeof l.trade_time === 'string' ? l.trade_time : '';
                        const hhmm = tradeTime.includes(' ') ? tradeTime.split(' ')[1].substring(0, 5) : '--:--';

                        return {
                            text: `${l.name} ${l.symbol} ${pre}% -> ${post}%`,
                            detail: `${action}价格: ${Money.toYuan(l.price)} | ${hhmm}`,
                            side: l.side,
                            time: l.trade_time
                        };
                    }),
                    charts: {
                        asset: historicalAssets,
                        latest: { date: todayStr, value: totalAssetsYuan }
                    }
                });
            }

            if (url.pathname === '/api/public/comments') {
                if (method === 'GET') {
                    const { results } = await env.DB.prepare('SELECT * FROM comments ORDER BY id DESC LIMIT 50').all();
                    return jsonResponse(results);
                }
                if (method === 'POST') {
                    const body = await parseBody(request);
                    if (!body) return errorResponse('请求体非法', 400, 4200);

                    const nickname = asTrimmed(body.nickname) || 'Guest';
                    const content = asTrimmed(body.content);
                    if (!content) return errorResponse('评论内容不能为空', 400, 4201);
                    if (nickname.length > 20) return errorResponse('昵称长度不能超过20', 400, 4202);
                    if (content.length > 500) return errorResponse('评论长度不能超过500', 400, 4203);

                    await env.DB.prepare('INSERT INTO comments (nickname, content) VALUES (?, ?)')
                        .bind(nickname, content).run();
                    return jsonResponse({ msg: 'ok' });
                }
                return errorResponse('Method Not Allowed', 405, 4050);
            }

            if (url.pathname === '/api/auth/login') {
                if (method !== 'POST') return errorResponse('Method Not Allowed', 405, 4050);

                const ip = getClientIp(request);
                const lock = await getLockState(env, ip);
                if (lock.locked) {
                    const minutes = Math.max(1, Math.ceil(lock.remainMs / 60000));
                    return errorResponse(`登录失败次数过多，请 ${minutes} 分钟后重试`, 429, 4291);
                }

                const body = await parseBody(request);
                const password = body?.password;
                if (typeof password !== 'string' || !password) {
                    await recordLoginFailure(env, ip);
                    return errorResponse('用户名或密码错误', 401, 4011);
                }

                if (await verifyPassword(password, env)) {
                    await clearLoginFailures(env, ip);
                    return jsonResponse({ token: signToken(env) });
                }

                await recordLoginFailure(env, ip);
                return errorResponse('用户名或密码错误', 401, 4011);
            }

            if (url.pathname.startsWith('/api/admin/')) {
                if (!verifyAuth(request, env)) return errorResponse('Unauthorized', 401, 4010);

                if (url.pathname === '/api/admin/dashboard') {
                    if (method !== 'GET') return errorResponse('Method Not Allowed', 405, 4050);

                    const acc = await env.DB.prepare('SELECT * FROM account WHERE id=1').first();
                    const { results: holds } = await env.DB.prepare('SELECT * FROM holdings').all();

                    let marketCap = 0;
                    for (const h of holds) {
                        const m = await fetchStockPrice(h.symbol);
                        const priceCent = m ? Money.toCent(m.price) : h.avg_cost;
                        marketCap += priceCent * h.quantity;
                    }

                    const availableCent = acc.balance - acc.frozen_balance;

                    return jsonResponse({
                        total: Money.toYuan(acc.balance + marketCap),
                        market_cap: Money.toYuan(marketCap),
                        available: Money.toYuan(availableCent),
                        frozen: Money.toYuan(acc.frozen_balance),
                        withdrawable: Money.toYuan(availableCent)
                    });
                }

                if (url.pathname === '/api/admin/orders') {
                    if (method !== 'GET') return errorResponse('Method Not Allowed', 405, 4050);

                    const { results } = await env.DB.prepare(`
                        SELECT * FROM orders
                        WHERE status = 'PENDING'
                           OR created_at >= date('now', 'localtime')
                        ORDER BY id DESC
                    `).all();
                    return jsonResponse(results.map((o) => ({
                        ...o,
                        price: Money.toYuan(o.price),
                        time: o.created_at.substring(11, 19)
                    })));
                }

                if (url.pathname === '/api/admin/trade') {
                    if (method !== 'POST') return errorResponse('Method Not Allowed', 405, 4050);
                    const body = await parseBody(request);
                    if (!body) return errorResponse('请求体非法', 400, 4300);

                    const res = await placeOrder(env, body);
                    ctx.waitUntil(matchOrders(env));
                    return res;
                }

                if (url.pathname === '/api/admin/cancel') {
                    if (method !== 'POST') return errorResponse('Method Not Allowed', 405, 4050);
                    const body = await parseBody(request);
                    if (!body) return errorResponse('请求体非法', 400, 4300);

                    return await cancelOrder(env, body.order_id);
                }

                if (url.pathname === '/api/admin/holdings') {
                    if (method !== 'GET') return errorResponse('Method Not Allowed', 405, 4050);

                    const { results } = await env.DB.prepare('SELECT * FROM holdings').all();
                    const list = [];

                    for (const h of results) {
                        const m = await fetchStockPrice(h.symbol);
                        const curPriceYuan = m ? parseFloat(m.price) : Money.toYuan(h.avg_cost);

                        list.push({
                            symbol: h.symbol,
                            name: h.name,
                            quantity: h.quantity,
                            available_qty: h.available_qty,
                            avg_cost: Money.toYuan(h.avg_cost),
                            current_price: curPriceYuan,
                            total_cost: Money.toYuan(h.total_cost)
                        });
                    }
                    return jsonResponse(list);
                }

                if (url.pathname === '/api/admin/transfer') {
                    if (method !== 'POST') return errorResponse('Method Not Allowed', 405, 4050);
                    const body = await parseBody(request);
                    return await handleTransfer(env, body);
                }
            }

            return errorResponse('Not Found', 404, 4040);
        } catch (e) {
            console.error('Unhandled Error', e);
            return errorResponse('Internal Server Error', 500, 5000);
        }
    },

    async scheduled(event, env, ctx) {
        ctx.waitUntil(handleScheduled(event, env));
    }
};

