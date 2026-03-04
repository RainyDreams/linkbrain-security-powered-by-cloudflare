import { ensureRuntimeSchema } from './db.js';

const MAX_MESSAGE_LEN = 2000;
const MAX_STACK_LEN = 8000;
const MAX_META_LEN = 8000;
const MAX_TAGS_LEN = 400;
const MAX_TAG_LEN = 40;

const clampText = (value, maxLen) => {
    if (value === null || value === undefined) return '';
    const text = String(value);
    if (text.length <= maxLen) return text;
    return text.slice(0, maxLen);
};

const toIntegerOrNull = (value) => {
    if (value === null || value === undefined || value === '') return null;
    const num = Number(value);
    if (!Number.isFinite(num)) return null;
    return Math.trunc(num);
};

const safeJson = (value) => {
    if (value === undefined) return '';
    try {
        const text = JSON.stringify(value);
        return clampText(text, MAX_META_LEN);
    } catch {
        return '';
    }
};

const tokenizeTagInput = (value) => {
    if (value === null || value === undefined) return [];
    if (Array.isArray(value)) return value.flatMap((item) => tokenizeTagInput(item));
    return String(value)
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);
};

const normalizeTagToken = (value) => {
    return String(value || '')
        .trim()
        .toLowerCase()
        .replace(/\s+/g, '_')
        .replace(/[^a-z0-9._:-]/g, '')
        .slice(0, MAX_TAG_LEN);
};

const normalizeTags = (...values) => {
    const seen = new Set();
    const tags = [];

    for (const value of values) {
        for (const raw of tokenizeTagInput(value)) {
            const token = normalizeTagToken(raw);
            if (!token || seen.has(token)) continue;
            seen.add(token);
            tags.push(token);
            if (tags.length >= 30) break;
        }
        if (tags.length >= 30) break;
    }

    return clampText(tags.join(','), MAX_TAGS_LEN);
};

export const formatCstTimestamp = (date = new Date()) => {
    const dt = date instanceof Date ? date : new Date(date);
    const formatter = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Shanghai',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
    });
    const parts = formatter.formatToParts(dt);
    const get = (type) => parts.find((x) => x.type === type)?.value || '00';
    return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')}:${get('second')}`;
};

export const logTechnicalAudit = async (env, entry = {}) => {
    if (!env?.DB) return;
    try {
        await ensureRuntimeSchema(env);
        const level = clampText(entry.level || 'INFO', 16).toUpperCase();
        const scope = clampText(entry.scope || 'system', 64);
        const category = clampText(entry.category || 'runtime', 64);
        const subcategory = clampText(entry.subcategory || '', 64);
        const status = clampText(entry.status || '', 32).toUpperCase();
        const tags = normalizeTags(entry.tags, scope, category, subcategory, level, status);
        const orderId = toIntegerOrNull(entry.order_id);
        const symbol = clampText(entry.symbol || '', 24);
        const requestId = clampText(entry.request_id || '', 80);
        const message = clampText(entry.message || '', MAX_MESSAGE_LEN);
        const stack = clampText(entry.stack || '', MAX_STACK_LEN);
        const meta = safeJson(entry.meta);
        const createdAtCst = formatCstTimestamp();

        await env.DB.prepare(`
            INSERT INTO audit_technical (
                level, scope, category, subcategory, tags, status, order_id, symbol, request_id,
                message, stack, meta, created_at_cst
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).bind(
            level,
            scope,
            category,
            subcategory,
            tags,
            status,
            orderId,
            symbol,
            requestId,
            message,
            stack,
            meta,
            createdAtCst
        ).run();
    } catch (e) {
        console.error('technical audit log failed', e);
    }
};

export const logFinancialAudit = async (env, entry = {}) => {
    if (!env?.DB) return;
    try {
        await ensureRuntimeSchema(env);
        const eventType = clampText(entry.event_type || 'UNKNOWN', 64).toUpperCase();
        const scope = clampText(entry.scope || 'finance', 64);
        const category = clampText(entry.category || 'trade', 64);
        const subcategory = clampText(entry.subcategory || '', 64);
        const status = clampText(entry.status || 'UNKNOWN', 32).toUpperCase();
        const orderId = toIntegerOrNull(entry.order_id);
        const symbol = clampText(entry.symbol || '', 24);
        const requestId = clampText(entry.request_id || '', 80);
        const side = clampText(entry.side || '', 8).toUpperCase();
        const tags = normalizeTags(entry.tags, scope, category, subcategory, status, eventType, side);
        const qty = toIntegerOrNull(entry.qty);
        const price = toIntegerOrNull(entry.price);
        const amount = toIntegerOrNull(entry.amount);
        const fee = toIntegerOrNull(entry.fee) ?? 0;
        const tax = toIntegerOrNull(entry.tax) ?? 0;
        const freezeBefore = toIntegerOrNull(entry.freeze_before);
        const freezeAfter = toIntegerOrNull(entry.freeze_after);
        const availableBefore = toIntegerOrNull(entry.available_before);
        const availableAfter = toIntegerOrNull(entry.available_after);
        const balanceBefore = toIntegerOrNull(entry.balance_before);
        const balanceAfter = toIntegerOrNull(entry.balance_after);
        const holdingsBefore = toIntegerOrNull(entry.holdings_before);
        const holdingsAfter = toIntegerOrNull(entry.holdings_after);
        const message = clampText(entry.message || '', MAX_MESSAGE_LEN);
        const errorStack = clampText(entry.error_stack || '', MAX_STACK_LEN);
        const meta = safeJson(entry.meta);
        const createdAtCst = formatCstTimestamp();

        await env.DB.prepare(`
            INSERT INTO audit_financial (
                event_type, scope, category, subcategory, tags, status, order_id, symbol, request_id,
                side, qty, price, amount, fee, tax, freeze_before, freeze_after,
                available_before, available_after, balance_before, balance_after,
                holdings_before, holdings_after, message, error_stack, meta, created_at_cst
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).bind(
            eventType,
            scope,
            category,
            subcategory,
            tags,
            status,
            orderId,
            symbol,
            requestId,
            side,
            qty,
            price,
            amount,
            fee,
            tax,
            freezeBefore,
            freezeAfter,
            availableBefore,
            availableAfter,
            balanceBefore,
            balanceAfter,
            holdingsBefore,
            holdingsAfter,
            message,
            errorStack,
            meta,
            createdAtCst
        ).run();
    } catch (e) {
        console.error('financial audit log failed', e);
        await logTechnicalAudit(env, {
            level: 'ERROR',
            scope: 'audit.financial',
            category: 'audit',
            subcategory: 'write_failed',
            status: 'FAILED',
            tags: ['audit', 'financial', 'fallback'],
            order_id: entry?.order_id,
            symbol: entry?.symbol,
            request_id: entry?.request_id,
            message: 'financial audit log failed',
            stack: e?.stack || '',
            meta: {
                error: String(e?.message || e || ''),
                event_type: entry?.event_type || '',
                source_scope: entry?.scope || ''
            }
        });
    }
};

export const logError = async (env, error, meta = {}, scope = 'backend') => {
    const message = error?.message || String(error || 'unknown error');
    const stack = error?.stack || '';
    await logTechnicalAudit(env, {
        level: 'ERROR',
        scope,
        category: 'runtime',
        subcategory: 'exception',
        status: 'FAILED',
        order_id: meta?.order_id,
        symbol: meta?.symbol,
        request_id: meta?.request_id,
        message,
        stack,
        meta
    });
};

export const logBizError = async (env, payload = {}) => {
    const statusCode = Number(payload.status || 400);
    const level = payload.level || (statusCode >= 500 ? 'ERROR' : 'WARN');
    await logTechnicalAudit(env, {
        level,
        scope: payload.scope || 'business',
        category: payload.category || 'business',
        subcategory: payload.subcategory || '',
        tags: payload.tags,
        status: payload.biz_status || (statusCode >= 400 ? 'FAILED' : 'SUCCESS'),
        order_id: payload.meta?.order_id,
        symbol: payload.meta?.symbol,
        request_id: payload.meta?.request_id,
        message: payload.message || '',
        stack: '',
        meta: payload.meta || {}
    });
};
