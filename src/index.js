// src/index.js
import { signToken, verifyAuth, verifyPassword } from './auth.js';
import { placeOrder, cancelOrder, matchOrders } from './trade.js';
import { handleScheduled } from './cron.js';
import { jsonResponse, errorResponse, Money, Time } from './utils.js';
import { fetchStockPrice } from './market.js';

export default {
    async fetch(request, env, ctx) {
        const url = new URL(request.url);
        const method = request.method;
        
        // CORS
        if (method === "OPTIONS") {
            return new Response(null, { headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*" } });
        }

        try {

if (url.pathname === '/api/public/overview' && method === 'GET') {
    const account = await env.DB.prepare("SELECT * FROM account WHERE id=1").first();
    const { results: holdings } = await env.DB.prepare("SELECT * FROM holdings WHERE quantity > 0").all();
    const { results: logs } = await env.DB.prepare("SELECT * FROM trades ORDER BY id DESC LIMIT 10").all();
    const { results: snaps } = await env.DB.prepare("SELECT * FROM snapshots ORDER BY date ASC").all();

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
            pnl_rate: h.avg_cost > 0 ? parseFloat(((curPriceCent - h.avg_cost) / h.avg_cost * 100).toFixed(2)) : 0,
            val_cent: valCent
        });
    }));

    // --- 核心修复 1: 总资产计算公式 ---
    // account.balance 已经是总现金(含冻结)，所以不要再加 frozen_balance
    const totalAssetsCent = account.balance + marketCap; 
    const totalAssetsYuan = Money.toYuan(totalAssetsCent);

    holdingList.forEach(h => {
        h.position_rate = totalAssetsCent > 0 ? parseFloat(((h.val_cent / totalAssetsCent) * 100).toFixed(2)) : 0;
        delete h.val_cent;
    });

    // --- 核心修复 2: 当日盈亏基准 ---
    const todayStr = new Date(new Date().getTime() + 8 * 3600000).toISOString().split('T')[0];
    // 寻找最近的一个非今天的快照作为对比基准
    const lastSnap = snaps.filter(s => s.date !== todayStr).pop() || { total_assets: account.initial_capital };
    const dayPnlCent = totalAssetsCent - lastSnap.total_assets;

    // --- 核心修复 3: 图表去重逻辑 ---
    // 如果 snaps 里已经有今天了，就不把今天的放在 asset 列表里，统一由 latest 处理
    const historicalAssets = snaps
        .filter(s => s.date !== todayStr)
        .map(s => ({ date: s.date, value: Money.toYuan(s.total_assets) }));

    return jsonResponse({
        assets: {
            total: totalAssetsYuan,
            market_cap: Money.toYuan(marketCap),
            balance: Money.toYuan(account.balance - account.frozen_balance), // 访客看到的"余额"应该是"可用余额"
            frozen: Money.toYuan(account.frozen_balance),
            pnl_holding: Money.toYuan(marketCap - totalCost),
            day_pnl: Money.toYuan(dayPnlCent),
            day_pct: parseFloat(((dayPnlCent / lastSnap.total_assets) * 100).toFixed(2)),
            return_total_pct: parseFloat(((totalAssetsCent - account.initial_capital) / account.initial_capital * 100).toFixed(2)),
            max_drawdown: 0 // 简化处理
        },
        holdings: holdingList.sort((a, b) => b.position_rate - a.position_rate),
        // src/index.js -> /api/public/overview 内部的 logs.map 部分

logs: logs.map(l => {
    // 强制容错：如果是 null 或 undefined，显示 0.00
    const pre = (l.pre_pos_ratio || 0).toFixed(2);
    const post = (l.post_pos_ratio || 0).toFixed(2);
    
    const action = l.side === 'BUY' ? '加仓' : '减仓';

    return {
        text: `${l.name} ${l.symbol} ${pre}% -> ${post}%`,
        detail: `${action}价格: ${Money.toYuan(l.price)} | ${l.trade_time.split(' ')[1].substring(0, 5)}`,
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

            // === Public: Comments ===
            if (url.pathname === '/api/public/comments') {
                if (method === 'GET') {
                    const { results } = await env.DB.prepare("SELECT * FROM comments ORDER BY id DESC LIMIT 50").all();
                    return jsonResponse(results);
                }
                if (method === 'POST') {
                    const body = await request.json();
                    await env.DB.prepare("INSERT INTO comments (nickname, content) VALUES (?, ?)").bind(body.nickname || 'Guest', body.content).run();
                    return jsonResponse({ msg: 'ok' });
                }
            }

            // === Auth ===
            if (url.pathname === '/api/auth/login' && method === 'POST') {
                const { password } = await request.json();
                if (await verifyPassword(password, env)) {
                    return jsonResponse({ token: signToken(env) });
                }
                return errorResponse("Password Error", 401);
            }

            // === Admin ===
            if (url.pathname.startsWith('/api/admin/')) {
                if (!verifyAuth(request, env)) return errorResponse("Unauthorized", 401);

                // src/index.js 里的 /api/admin/dashboard 逻辑

// src/index.js -> /api/admin/dashboard 完整替换

if (url.pathname === '/api/admin/dashboard' && method === 'GET') {
    const acc = await env.DB.prepare("SELECT * FROM account WHERE id=1").first();
    const { results: holds } = await env.DB.prepare("SELECT * FROM holdings").all();
    
    let marketCap = 0;
    for (const h of holds) {
        const m = await fetchStockPrice(h.symbol);
        const priceCent = m ? Money.toCent(m.price) : h.avg_cost;
        marketCap += priceCent * h.quantity;
    }

    const availableCent = acc.balance - acc.frozen_balance;

    return jsonResponse({
        // 总资产 = 总现金 + 市值
        total: Money.toYuan(acc.balance + marketCap),
        market_cap: Money.toYuan(marketCap),
        // 给管理员看明确的“可用”和“冻结”
        available: Money.toYuan(availableCent),
        frozen: Money.toYuan(acc.frozen_balance),
        withdrawable: Money.toYuan(availableCent)
    });
}

                if (url.pathname === '/api/admin/orders') {
                    // 合并 PENDING 和 今日的已成交/已撤销
                    const { results } = await env.DB.prepare(`
                        SELECT * FROM orders 
                        WHERE status = 'PENDING' 
                        OR created_at >= date('now', 'localtime')
                        ORDER BY id DESC
                    `).all();
                    return jsonResponse(results.map(o => ({
                        ...o,
                        price: Money.toYuan(o.price),
                        time: o.created_at.substring(11, 19)
                    })));
                }

                if (url.pathname === '/api/admin/trade') {
                    const res = await placeOrder(env, await request.json());
                    // 尝试触发撮合(非阻塞)
                    ctx.waitUntil(matchOrders(env));
                    return res;
                }

                if (url.pathname === '/api/admin/cancel') {
                    const { order_id } = await request.json();
                    return await cancelOrder(env, order_id);
                }
                
                // src/index.js 里的 /api/admin/holdings 逻辑

if (url.pathname === '/api/admin/holdings' && method === 'GET') {
    const { results } = await env.DB.prepare("SELECT * FROM holdings").all();
    const list = [];
    
    for (const h of results) {
        const m = await fetchStockPrice(h.symbol);
        // 重要：后端在这里统一转为元，前端就不用再除以100了
        const curPriceYuan = m ? parseFloat(m.price) : Money.toYuan(h.avg_cost);
        
        list.push({
            symbol: h.symbol,
            name: h.name,
            quantity: h.quantity,
            available_qty: h.available_qty,
            avg_cost: Money.toYuan(h.avg_cost), // 转为元
            current_price: curPriceYuan,        // 元
            total_cost: Money.toYuan(h.total_cost) // 转为元
        });
    }
    return jsonResponse(list);
}
                if (url.pathname === '/api/admin/transfer' && method === 'POST') {
                    const { amount, type } = await request.json(); // amount 为元, type 为 'IN' 或 'OUT'
                    const amountCent = Money.toCent(amount);
                
                    if (amountCent <= 0) return errorResponse("金额必须大于0");
                
                    if (type === 'IN') {
                        // 入金：增加 balance
                        await env.DB.prepare("UPDATE account SET balance = balance + ? WHERE id = 1").bind(amountCent).run();
                        return jsonResponse({ message: `入金成功: ¥${amount}` });
                    } else {
                        // 出金：校验可用余额 (balance - frozen)
                        const acc = await env.DB.prepare("SELECT (balance - frozen_balance) as available FROM account WHERE id = 1").first();
                        if (acc.available < amountCent) return errorResponse("可用余额不足", 400, 4001);
                        
                        await env.DB.prepare("UPDATE account SET balance = balance - ? WHERE id = 1").bind(amountCent).run();
                        return jsonResponse({ message: `出金成功: ¥${amount}` });
                    }
                }
            }
            

            return errorResponse("Not Found", 404);
        } catch (e) {
            return errorResponse(e.message, 500, 5000, e.stack);
        }
    },
    
    async scheduled(event, env, ctx) {
        ctx.waitUntil(handleScheduled(event, env));
    }
};