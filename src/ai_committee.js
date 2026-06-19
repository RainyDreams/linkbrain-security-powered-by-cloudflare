import { Money, Time } from './utils.js';
import { fetchStockPrice } from './market.js';
import { cancelOrder, getPriceAssist, matchOrders, placeOrder } from './trade.js';
import { formatCstTimestamp, logBizError, logError, logFinancialAudit, logTechnicalAudit } from './audit.js';
import { DEFAULT_ROLE_PROMPTS, ROLE_KEYS, getPromptMetaKey, getRoleOutputSchema, isValidRoleKey } from './ai_prompts.js';

const DEFAULT_WATCHLIST = Object.freeze([]);

const EASTMONEY_NEWS_CHANNEL_PRESETS = Object.freeze({
    broad: {
        key: 'broad',
        label: 'A-share broad momentum',
        fid: 'f3',
        fs: 'm:1+t:2,m:1+t:23,m:0+t:6,m:0+t:13,m:0+t:80,m:0+t:81+s:2048'
    },
    turnover: {
        key: 'turnover',
        label: 'A-share turnover hot',
        fid: 'f6',
        fs: 'm:1+t:2,m:1+t:23,m:0+t:6,m:0+t:13,m:0+t:80,m:0+t:81+s:2048'
    },
    sh: {
        key: 'sh',
        label: 'Shanghai momentum',
        fid: 'f3',
        fs: 'm:1+t:2,m:1+t:23'
    },
    sz: {
        key: 'sz',
        label: 'Shenzhen/ChiNext momentum',
        fid: 'f3',
        fs: 'm:0+t:6,m:0+t:80,m:0+t:13'
    },
    bj: {
        key: 'bj',
        label: 'Beijing board momentum',
        fid: 'f3',
        fs: 'm:0+t:81+s:2048'
    }
});
const DEFAULT_EASTMONEY_CHANNEL_KEYS = Object.freeze(['broad', 'turnover', 'sz']);

const MAX_PROMPT_LENGTH = 12000;
const MAX_ACTIONS_PER_ROUND = 12;
const MIN_INTERVAL_MINUTES = 1;
const MAX_INTERVAL_MINUTES = 15;
const MIN_DAILY_RUN_TARGET = 5;
const MAX_DAILY_RUN_TARGET = 5;
const DEFAULT_DAILY_RUN_TARGET = 5;
const AUTO_DAILY_DISCUSSION_LIMIT = 5;
const MIN_GEMINI_MAX_REQUESTS = 1;
const MAX_GEMINI_MAX_REQUESTS = 120;
const DEFAULT_GEMINI_MAX_REQUESTS = 60;
const MAX_ROLE_OUTPUT_JSON = 18000;
const MAX_RSS_RAW = 2000;
const MAX_RSS_FEEDS_PER_RUN = 3;
const RSS_FEED_FETCH_INTERVAL_MS = 160;
const MAX_NEWS_ITEMS_PER_FEED = 8;
const MAX_NEWS_ITEMS_TOTAL = 28;
const MAX_GEMINI_ERROR_RAW = 4000;
const MAX_GEMINI_ERROR_DETAILS = 12;
const GEMINI_RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);
const GEMINI_MAX_RETRIES_PER_MODEL = 0;
const GEMINI_MIN_REQUEST_INTERVAL_MS = 2600;
const GEMINI_429_MIN_COOLDOWN_MS = 12000;
const GEMINI_429_GLOBAL_COOLDOWN_MAX_MS = 60000;
const GEMINI_MODEL_429_COOLDOWN_MS = 180000;
const GEMINI_MODEL_ERROR_COOLDOWN_MS = 45000;
const GEMINI_MODEL_COOLDOWN_MAX_MS = 30 * 60 * 1000;
const AI_RETRY_BACKOFF_MINUTES = Object.freeze([3, 5, 8]);
const AI_MAX_AUTO_RETRY = 3;
const ENABLE_REBUTTAL_DISCUSSION = true;
const REBUTTAL_RESERVED_REQUESTS = 8;
const GEMINI_ALLOWED_MODELS = Object.freeze([
    'gemini-3-flash-preview',
    'gemini-flash-latest',
    'gemini-flash-lite-latest',
    'gemini-2.5-flash',
    'gemini-2.5-flash-lite'
]);
const DEFAULT_GEMINI_MODELS = Object.freeze([
    'gemini-2.5-flash',
    'gemini-flash-latest',
    'gemini-3-flash-preview',
    'gemini-2.5-flash-lite',
    'gemini-flash-lite-latest'
]);
const MAX_SYMBOL_UNIVERSE = 20;
const QUOTE_FETCH_INTERVAL_MS = 120;
const MIN_AI_ORDER_LOTS = 2;
const DEFAULT_AI_ORDER_LOTS = 3;
const MARKET_ETF_SYMBOLS = Object.freeze([
    'sh510300',
    'sh510500',
    'sh510050',
    'sz159915',
    'sh588000'
]);
const SECTOR_ETF_SYMBOLS = Object.freeze([
    'sh512880', // securities
    'sh512800', // banking
    'sh512170', // medical
    'sh512010', // pharma
    'sh512660', // defense
    'sh512690', // liquor/consumption
    'sh512760', // semiconductor
    'sh515790'  // solar/new energy
]);
const MAX_TASKS_PER_CRON = 2;
const AUTO_DISCUSSION_SLOTS = Object.freeze([
    { key: 'am_1', label: 'morning_1', start_hhmm: 935, end_hhmm: 1005 },
    { key: 'am_2', label: 'morning_2', start_hhmm: 1030, end_hhmm: 1115 },
    { key: 'pm_1', label: 'afternoon_1', start_hhmm: 1310, end_hhmm: 1350 },
    { key: 'pm_2', label: 'afternoon_2', start_hhmm: 1410, end_hhmm: 1450 },
    { key: 'night_1', label: 'night_21', start_hhmm: 2100, end_hhmm: 2110 }
]);
const AI_TASK_STATUS = Object.freeze({
    PENDING: 'PENDING',
    RUNNING: 'RUNNING',
    DONE: 'DONE',
    FAILED: 'FAILED'
});
const AI_PENDING_ACTION_STATUS = Object.freeze({
    PENDING: 'PENDING',
    EXECUTED: 'EXECUTED',
    REJECTED: 'REJECTED',
    FAILED: 'FAILED'
});
const AI_EXECUTION_MODE = Object.freeze({
    AUTO_EXECUTE: 'AUTO_EXECUTE',
    USER_CONFIRM: 'USER_CONFIRM'
});
const CHINESE_OUTPUT_CLAUSE = '所有文本字段必须使用简体中文，语句简短、可执行。';
const NON_BLOCKING_PRECHECK_REASONS = new Set([
    'no pending order found',
    'no holdings for sell symbol',
    't+1 restriction: no sellable quantity today',
    'insufficient available holdings',
    'buy budget/risk limit not enough for one lot',
    'symbol forbidden by president risk limit',
    'max_new_orders reached',
    'action limit reached',
    'invalid order_id',
    'invalid symbol for cancel pending',
    'unknown action type',
    'invalid side',
    'invalid symbol',
    'invalid price',
    'qty less than one lot'
]);

const META_KEYS = Object.freeze({
    ENABLED: 'ai.enabled',
    INTERVAL_MIN: 'ai.interval_min',
    DAILY_RUN_TARGET: 'ai.daily.run_target',
    GEMINI_MAX_REQUESTS: 'ai.gemini.max_requests',
    WATCHLIST: 'ai.watchlist',
    RSS_FEEDS: 'ai.rss.feeds',
    RSS_CACHE: 'ai.rss.cache',
    STOCK_CANDIDATE_CACHE: 'ai.stock.candidate.cache',
    GEMINI_MODEL_COOLDOWNS: 'ai.gemini.model.cooldowns',
    PENALTY_MANAGER: 'ai.penalty.manager',
    PENALTY_PRESIDENT: 'ai.penalty.president',
    LAST_RUN: 'ai.last_run'
});

const DEFAULT_CONFIG = Object.freeze({
    [META_KEYS.ENABLED]: '1',
    [META_KEYS.INTERVAL_MIN]: '3',
    [META_KEYS.DAILY_RUN_TARGET]: String(DEFAULT_DAILY_RUN_TARGET),
    [META_KEYS.GEMINI_MAX_REQUESTS]: String(DEFAULT_GEMINI_MAX_REQUESTS),
    [META_KEYS.WATCHLIST]: DEFAULT_WATCHLIST.join(','),
    [META_KEYS.RSS_FEEDS]: DEFAULT_EASTMONEY_CHANNEL_KEYS.join('\n'),
    [META_KEYS.PENALTY_MANAGER]: '0',
    [META_KEYS.PENALTY_PRESIDENT]: '0'
});

const asTrimmed = (value) => (typeof value === 'string' ? value.trim() : '');

const clampNumber = (value, min, max) => {
    const n = Number(value);
    if (!Number.isFinite(n)) return min;
    if (n < min) return min;
    if (n > max) return max;
    return n;
};

const clampInt = (value, min, max) => Math.trunc(clampNumber(value, min, max));

const parseBool = (value) => {
    if (typeof value === 'boolean') return value;
    const raw = String(value || '').trim().toLowerCase();
    return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on';
};

const parseIntSafe = (value, fallback = 0) => {
    const n = Number.parseInt(String(value || ''), 10);
    return Number.isFinite(n) ? n : fallback;
};

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

const unique = (list) => [...new Set((list || []).filter(Boolean))];

const safeJsonParse = (value, fallback = null) => {
    if (value === null || value === undefined || value === '') return fallback;
    if (typeof value !== 'string') return value;
    try {
        return JSON.parse(value);
    } catch {
        return fallback;
    }
};

const safeJsonStringify = (value, fallback = '{}') => {
    try {
        return JSON.stringify(value);
    } catch {
        return fallback;
    }
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(ms) || 0)));

const parseRetryAfterMs = (value) => {
    const raw = String(value || '').trim();
    if (!raw) return 0;
    const sec = Number.parseInt(raw, 10);
    if (Number.isFinite(sec) && sec > 0) return sec * 1000;
    const ts = Date.parse(raw);
    if (!Number.isFinite(ts)) return 0;
    return Math.max(0, ts - Date.now());
};

const applyGeminiPacing = async (runtimeLimits = {}, minIntervalMs = GEMINI_MIN_REQUEST_INTERVAL_MS) => {
    if (!isObject(runtimeLimits)) return;
    const now = Date.now();
    const blockUntil = Number(runtimeLimits.gemini_block_until || 0);
    if (blockUntil > now) {
        await sleep(blockUntil - now);
    }

    const now2 = Date.now();
    const nextAt = Number(runtimeLimits.gemini_next_allowed_at || 0);
    if (nextAt > now2) {
        await sleep(nextAt - now2);
    }
    runtimeLimits.gemini_next_allowed_at = Date.now() + Math.max(200, Number(minIntervalMs || 0));
};

const tryParseModelJson = (rawText) => {
    const text = String(rawText || '').trim().slice(0, MAX_ROLE_OUTPUT_JSON);
    if (!text) return null;

    const unwrapped = text.replace(/^```json/i, '').replace(/^```/i, '').replace(/```$/, '').trim();
    try {
        return JSON.parse(unwrapped);
    } catch {
        // continue
    }

    const firstObj = unwrapped.indexOf('{');
    const lastObj = unwrapped.lastIndexOf('}');
    if (firstObj >= 0 && lastObj > firstObj) {
        const candidate = unwrapped.slice(firstObj, lastObj + 1);
        try {
            return JSON.parse(candidate);
        } catch {
            // continue
        }
    }

    const firstArr = unwrapped.indexOf('[');
    const lastArr = unwrapped.lastIndexOf(']');
    if (firstArr >= 0 && lastArr > firstArr) {
        const candidate = unwrapped.slice(firstArr, lastArr + 1);
        try {
            return JSON.parse(candidate);
        } catch {
            return null;
        }
    }
    return null;
};

const normalizeSymbol = (symbol) => {
    const raw = String(symbol || '').trim().toLowerCase();
    if (!raw) return '';
    if (/^(sh|sz|bj)\d{6}$/.test(raw)) return raw;
    if (/^\d{6}$/.test(raw)) {
        if (raw.startsWith('6') || raw.startsWith('5')) return `sh${raw}`;
        if (raw.startsWith('8') || raw.startsWith('4')) return `bj${raw}`;
        return `sz${raw}`;
    }
    return raw;
};

const decodeXmlText = (value) => String(value || '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();

const extractTag = (text, tag) => {
    const regex = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i');
    const matched = String(text || '').match(regex);
    return decodeXmlText(matched?.[1] || '');
};

const parseRssXml = (xmlText, sourceUrl) => {
    const xml = String(xmlText || '');
    if (!xml) return [];
    const matches = xml.match(/<item[\s\S]*?<\/item>/gi) || [];
    const items = [];
    for (const block of matches) {
        const title = extractTag(block, 'title');
        const link = extractTag(block, 'link');
        const pubDate = extractTag(block, 'pubDate') || extractTag(block, 'dc:date');
        if (!title) continue;
        const ts = Date.parse(pubDate || '') || 0;
        items.push({
            title: title.slice(0, 200),
            link: link.slice(0, 300),
            pub_date: pubDate.slice(0, 80),
            ts,
            source: sourceUrl
        });
    }
    return items;
};

const parseListInput = (value) => {
    if (Array.isArray(value)) return value.map((x) => String(x || '').trim()).filter(Boolean);
    return String(value || '')
        .split(/[\n,;|]/g)
        .map((x) => x.trim())
        .filter(Boolean);
};

const resolveEastmoneyChannelKeys = (value) => {
    const tokens = unique(parseListInput(value).map((x) => String(x || '').trim().toLowerCase()));
    const valid = tokens.filter((x) => !!EASTMONEY_NEWS_CHANNEL_PRESETS[x]);
    if (valid.length > 0) return valid.slice(0, 8);
    return [...DEFAULT_EASTMONEY_CHANNEL_KEYS];
};

const resolveEastmoneyChannelConfigs = (value) => {
    const keys = resolveEastmoneyChannelKeys(value);
    return keys
        .map((key) => EASTMONEY_NEWS_CHANNEL_PRESETS[key])
        .filter(Boolean);
};

const inferAshareSymbol = (raw) => {
    const token = String(raw || '').trim().toLowerCase();
    if (!token) return '';
    if (/^(sh|sz|bj)\d{6}$/.test(token)) return token;
    if (!/^\d{6}$/.test(token)) return '';
    if (token.startsWith('8') || token.startsWith('4')) return `bj${token}`;
    if (token.startsWith('6') || token.startsWith('5') || token.startsWith('9')) return `sh${token}`;
    return `sz${token}`;
};

const extractSymbolsFromNewsItems = (newsItems) => {
    const found = [];
    const addFromText = (text) => {
        if (!text) return;
        const raw = String(text);
        const prefixed = raw.match(/(?:sh|sz|bj)\d{6}/gi) || [];
        for (const m of prefixed) {
            const lower = m.toLowerCase();
            if (unique(found).includes(lower)) continue;
            found.push(lower);
        }
        const bareMatches = raw.match(/(?<![0-9])[0-9]{6}(?![0-9])/g) || [];
        for (const m of bareMatches) {
            const symbol = inferAshareSymbol(m);
            if (symbol && !found.includes(symbol)) found.push(symbol);
        }
    };
    for (const item of newsItems || []) {
        addFromText(item?.title || '');
        addFromText(item?.link || '');
        addFromText(item?.pub_date || '');
    }
    return unique(found);
};

const fetchHotSymbolsFromStockInterface = async (env) => {
    // Eastmoney quote ranking endpoint (JSON) for A-share active symbols.
    const url = 'https://push2.eastmoney.com/api/qt/clist/get'
        + '?pn=1&pz=120&po=1&np=1&fltt=2&invt=2'
        + '&fid=f6'
        + '&fs=m:1+t:2,m:1+t:23,m:0+t:6,m:0+t:13,m:0+t:80,m:0+t:81+s:2048'
        + '&fields=f12,f14,f2,f3,f6';
    const resp = await fetch(url, { headers: { Referer: 'https://quote.eastmoney.com/' } });
    if (!resp.ok) {
        await logTechnicalAudit(env, {
            level: 'WARN',
            scope: 'ai.market.candidate',
            category: 'ai',
            subcategory: 'stock_interface',
            status: 'FAILED',
            message: 'stock candidate interface http not ok',
            meta: { status: resp.status, url }
        });
        return [];
    }
    const json = safeJsonParse(await resp.text(), null);
    const diff = Array.isArray(json?.data?.diff) ? json.data.diff : [];
    const symbols = [];
    for (const row of diff) {
        const symbol = inferAshareSymbol(row?.f12);
        if (symbol) symbols.push(symbol);
    }
    return unique(symbols);
};

const loadStockCandidates = async (env, refresh = false) => {
    const now = Date.now();
    const cstDate = Time.formatCSTDate();
    if (!refresh) {
        const cached = safeJsonParse(await getMetaValue(env, META_KEYS.STOCK_CANDIDATE_CACHE), null);
        if (
            cached?.at
            && cached?.cst_date === cstDate
            && (now - Number(cached.at)) < 120000
            && Array.isArray(cached.symbols)
        ) {
            return cached.symbols;
        }
    }
    try {
        const symbols = await fetchHotSymbolsFromStockInterface(env);
        if (symbols.length > 0) {
            await setMetaValue(env, META_KEYS.STOCK_CANDIDATE_CACHE, safeJsonStringify({
                at: now,
                cst_date: cstDate,
                symbols
            }));
            return symbols;
        }
    } catch {
        await logTechnicalAudit(env, {
            level: 'WARN',
            scope: 'ai.market.candidate',
            category: 'ai',
            subcategory: 'stock_interface',
            status: 'FAILED',
            message: 'stock candidate fetch exception, fallback cache'
        });
    }
    const fallback = safeJsonParse(await getMetaValue(env, META_KEYS.STOCK_CANDIDATE_CACHE), null);
    if (Array.isArray(fallback?.symbols)) {
        if (!fallback?.cst_date || fallback.cst_date === cstDate) {
            return fallback.symbols;
        }
    }
    return [];
};

const normalizeGeminiModel = (value) => String(value || '').trim().toLowerCase();

const resolveGeminiModelCandidates = (env) => {
    const merged = [
        ...parseListInput(env.GEMINI_MODELS),
        ...parseListInput(env.GEMINI_MODEL),
        ...DEFAULT_GEMINI_MODELS
    ].map(normalizeGeminiModel).filter(Boolean);

    const allow = new Set(GEMINI_ALLOWED_MODELS.map(normalizeGeminiModel));
    const dedup = unique(merged).filter((x) => allow.has(x));

    if (!dedup.length) return [...DEFAULT_GEMINI_MODELS];

    const orderMap = new Map(DEFAULT_GEMINI_MODELS.map((model, idx) => [normalizeGeminiModel(model), idx]));
    return dedup.sort((a, b) => {
        const ia = orderMap.has(a) ? orderMap.get(a) : 999;
        const ib = orderMap.has(b) ? orderMap.get(b) : 999;
        return ia - ib;
    });
};

const getGeminiModelCooldownMap = async (env, runtimeLimits = {}) => {
    if (isObject(runtimeLimits) && isObject(runtimeLimits.gemini_model_cooldown_map)) {
        return runtimeLimits.gemini_model_cooldown_map;
    }
    const parsed = safeJsonParse(await getMetaValue(env, META_KEYS.GEMINI_MODEL_COOLDOWNS), {});
    const normalized = {};
    for (const [modelRaw, tsRaw] of Object.entries(isObject(parsed) ? parsed : {})) {
        const model = normalizeGeminiModel(modelRaw);
        const ts = Number(tsRaw || 0);
        if (!model || !Number.isFinite(ts) || ts <= 0) continue;
        normalized[model] = ts;
    }
    if (isObject(runtimeLimits)) runtimeLimits.gemini_model_cooldown_map = normalized;
    return normalized;
};

const saveGeminiModelCooldownMap = async (env, runtimeLimits = {}, cooldownMap = {}) => {
    const now = Date.now();
    const normalized = {};
    for (const [modelRaw, tsRaw] of Object.entries(isObject(cooldownMap) ? cooldownMap : {})) {
        const model = normalizeGeminiModel(modelRaw);
        const ts = Number(tsRaw || 0);
        if (!model || !Number.isFinite(ts)) continue;
        if (ts <= now) continue;
        normalized[model] = Math.min(ts, now + GEMINI_MODEL_COOLDOWN_MAX_MS);
    }
    if (isObject(runtimeLimits)) runtimeLimits.gemini_model_cooldown_map = normalized;
    await setMetaValue(env, META_KEYS.GEMINI_MODEL_COOLDOWNS, safeJsonStringify(normalized, '{}'));
    return normalized;
};

const resolveGeminiApiKey = (env) => {
    const candidates = [
        env?.GEMINI_API_KEY,
        env?.GOOGLE_API_KEY,
        env?.GOOGLE_GENERATIVE_AI_API_KEY,
        env?.GEMINI_KEY
    ];
    for (const key of candidates) {
        const value = asTrimmed(key);
        if (value) return value;
    }
    return '';
};

const toCounterInt = (value, fallback = 0) => {
    const n = Number.parseInt(String(value ?? ''), 10);
    return Number.isFinite(n) ? n : fallback;
};

const dailyCounterKey = (name, cstDate) => `ai.day.${name}.${cstDate}`;

const getDailyCounter = async (env, key) => {
    const row = await env.DB.prepare('SELECT value FROM meta WHERE key=?').bind(key).first();
    return Math.max(0, toCounterInt(row?.value, 0));
};

const tryConsumeCounterBudget = async (env, key, delta, limit) => {
    const step = Math.max(1, Number(delta || 1));
    const max = Math.max(1, Number(limit || 1));
    await env.DB.prepare(
        "INSERT OR IGNORE INTO meta (key, value, updated_at) VALUES (?, '0', CURRENT_TIMESTAMP)"
    ).bind(key).run();

    const upd = await env.DB.prepare(`
        UPDATE meta
        SET value = CAST(COALESCE(NULLIF(TRIM(value), ''), '0') AS INTEGER) + ?,
            updated_at = CURRENT_TIMESTAMP
        WHERE key = ?
          AND (CAST(COALESCE(NULLIF(TRIM(value), ''), '0') AS INTEGER) + ?) <= ?
    `).bind(step, key, step, max).run();

    const current = await getDailyCounter(env, key);
    return {
        ok: Number(upd?.meta?.changes || 0) > 0,
        current,
        limit: max
    };
};

const incrementDailyCounter = async (env, key, delta = 1) => {
    const step = Math.max(1, Number(delta || 1));
    await env.DB.prepare(
        "INSERT OR IGNORE INTO meta (key, value, updated_at) VALUES (?, '0', CURRENT_TIMESTAMP)"
    ).bind(key).run();

    await env.DB.prepare(`
        UPDATE meta
        SET value = CAST(COALESCE(NULLIF(TRIM(value), ''), '0') AS INTEGER) + ?,
            updated_at = CURRENT_TIMESTAMP
        WHERE key = ?
    `).bind(step, key).run();

    return await getDailyCounter(env, key);
};

const buildDailyQuotaKeys = (cstDate) => ({
    run_count: dailyCounterKey('run_count', cstDate),
    gemini_requests: dailyCounterKey('gemini_requests', cstDate)
});

const slotMetaKey = (cstDate, slotKey) => `ai.day.slot.${cstDate}.${slotKey}`;

const getHhmm = (cst) => (cst.getHours() * 100) + cst.getMinutes();

const resolveAutoDiscussionSlot = (cst) => {
    const day = cst.getDay();
    if (day === 0 || day === 6) return null;
    const hhmm = getHhmm(cst);
    for (const slot of AUTO_DISCUSSION_SLOTS) {
        if (hhmm >= slot.start_hhmm && hhmm <= slot.end_hhmm) return slot;
    }
    return null;
};

const getSlotProgress = async (env, cstDate) => {
    const flags = await Promise.all(
        AUTO_DISCUSSION_SLOTS.map(async (slot) => {
            const used = await getMetaValue(env, slotMetaKey(cstDate, slot.key));
            return {
                ...slot,
                consumed: !!used
            };
        })
    );
    return flags;
};

const acquireDailyRunPermit = async (env, cst, config, options = {}) => {
    const manualRequest = options.manual_request === true;
    const cstDate = Time.formatCSTDate(cst);
    const keys = buildDailyQuotaKeys(cstDate);
    const runLimit = AUTO_DAILY_DISCUSSION_LIMIT;
    const currentRuns = await getDailyCounter(env, keys.run_count);
    if (manualRequest) {
        return {
            ok: true,
            manual_request: true,
            counted: false,
            quota: {
                run_count: currentRuns,
                run_limit: runLimit,
                cst_date: cstDate
            }
        };
    }

    if (currentRuns >= runLimit) {
        return {
            ok: false,
            reason: 'daily run quota reached',
            quota: { run_count: currentRuns, run_limit: runLimit, cst_date: cstDate }
        };
    }

    const slot = resolveAutoDiscussionSlot(cst);
    if (!slot) {
        return {
            ok: false,
            reason: 'outside scheduled discussion slots',
            quota: { run_count: currentRuns, run_limit: runLimit, cst_date: cstDate }
        };
    }

    const slotRes = await env.DB.prepare(
        'INSERT OR IGNORE INTO meta (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)'
    ).bind(slotMetaKey(cstDate, slot.key), '1').run();
    if ((slotRes?.meta?.changes || 0) === 0) {
        return {
            ok: false,
            reason: 'scheduled slot already consumed',
            quota: {
                run_count: currentRuns,
                run_limit: runLimit,
                cst_date: cstDate,
                slot_key: slot.key,
                slot_label: slot.label
            }
        };
    }

    const consumed = await tryConsumeCounterBudget(env, keys.run_count, 1, runLimit);
    if (!consumed.ok) {
        return {
            ok: false,
            reason: 'daily run quota reached',
            quota: { run_count: consumed.current, run_limit: runLimit, cst_date: cstDate }
        };
    }

    return {
        ok: true,
        counted: true,
        slot,
        quota: {
            run_count: consumed.current,
            run_limit: runLimit,
            cst_date: cstDate,
            slot_key: slot.key,
            slot_label: slot.label
        },
        cst_date: cstDate
    };
};

const recordGeminiRequestUsage = async (env, cstDate, maxRequests, runtimeLimits = null) => {
    const keys = buildDailyQuotaKeys(cstDate);
    const limit = clampInt(maxRequests, MIN_GEMINI_MAX_REQUESTS, MAX_GEMINI_MAX_REQUESTS);
    const current = await incrementDailyCounter(env, keys.gemini_requests, 1);
    const overLimit = current > limit;

    if (isObject(runtimeLimits)) {
        runtimeLimits.gemini_request_used = current;
        runtimeLimits.gemini_request_limit = limit;
        if (overLimit) runtimeLimits.gemini_request_limit_exceeded = true;
    }

    return {
        current,
        limit,
        over_limit: overLimit
    };
};

const getMetaValue = async (env, key) => {
    const row = await env.DB.prepare('SELECT value FROM meta WHERE key=?').bind(key).first();
    return row?.value ?? null;
};

const setMetaValue = async (env, key, value) => {
    await env.DB.prepare(`
        INSERT INTO meta (key, value, updated_at)
        VALUES (?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(key) DO UPDATE SET
            value=excluded.value,
            updated_at=CURRENT_TIMESTAMP
    `).bind(key, String(value ?? '')).run();
};

const ensureDefaults = async (env) => {
    const inserts = [];
    for (const [key, value] of Object.entries(DEFAULT_CONFIG)) {
        inserts.push(
            env.DB.prepare('INSERT OR IGNORE INTO meta (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)').bind(key, value)
        );
    }
    for (const [role, prompt] of Object.entries(DEFAULT_ROLE_PROMPTS)) {
        inserts.push(
            env.DB.prepare('INSERT OR IGNORE INTO meta (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)')
                .bind(getPromptMetaKey(role), prompt)
        );
    }
    await env.DB.batch(inserts);
};

const getConfig = async (env) => {
    await ensureDefaults(env);
    const [
        enabledRaw,
        intervalRaw,
        dailyRunTargetRaw,
        geminiMaxRequestsRaw,
        watchlistRaw,
        rssFeedsRaw,
        penaltyManagerRaw,
        penaltyPresidentRaw
    ] = await Promise.all([
        getMetaValue(env, META_KEYS.ENABLED),
        getMetaValue(env, META_KEYS.INTERVAL_MIN),
        getMetaValue(env, META_KEYS.DAILY_RUN_TARGET),
        getMetaValue(env, META_KEYS.GEMINI_MAX_REQUESTS),
        getMetaValue(env, META_KEYS.WATCHLIST),
        getMetaValue(env, META_KEYS.RSS_FEEDS),
        getMetaValue(env, META_KEYS.PENALTY_MANAGER),
        getMetaValue(env, META_KEYS.PENALTY_PRESIDENT)
    ]);

    const intervalMin = clampInt(parseIntSafe(intervalRaw, 3), MIN_INTERVAL_MINUTES, MAX_INTERVAL_MINUTES);
    const dailyRunTarget = clampInt(
        parseIntSafe(dailyRunTargetRaw, DEFAULT_DAILY_RUN_TARGET),
        MIN_DAILY_RUN_TARGET,
        MAX_DAILY_RUN_TARGET
    );
    const geminiMaxRequests = clampInt(
        parseIntSafe(geminiMaxRequestsRaw, DEFAULT_GEMINI_MAX_REQUESTS),
        MIN_GEMINI_MAX_REQUESTS,
        MAX_GEMINI_MAX_REQUESTS
    );
    return {
        enabled: parseBool(enabledRaw),
        interval_min: intervalMin,
        daily_run_target: dailyRunTarget,
        gemini_max_requests: geminiMaxRequests,
        watchlist: unique(parseListInput(watchlistRaw || DEFAULT_CONFIG[META_KEYS.WATCHLIST]).map(normalizeSymbol))
            .filter((x) => /^(sh|sz|bj)\d{6}$/.test(x)),
        rss_feeds: resolveEastmoneyChannelKeys(rssFeedsRaw || DEFAULT_CONFIG[META_KEYS.RSS_FEEDS]),
        manager_penalty: clampInt(parseIntSafe(penaltyManagerRaw, 0), 0, 100),
        president_penalty: clampInt(parseIntSafe(penaltyPresidentRaw, 0), 0, 100)
    };
};

const normalizeEastmoneyPrice = (value) => {
    const n = Number(value);
    if (!Number.isFinite(n)) return 0;
    if (Math.abs(n) >= 100000) return Number((n / 100).toFixed(2));
    return Number(n.toFixed(2));
};

const fetchEastmoneyNewsItems = async (env, cst, channel, maxCount = 24) => {
    const cfg = isObject(channel) ? channel : EASTMONEY_NEWS_CHANNEL_PRESETS.broad;
    const fid = String(cfg?.fid || 'f3');
    const fs = String(cfg?.fs || EASTMONEY_NEWS_CHANNEL_PRESETS.broad.fs);
    const channelKey = String(cfg?.key || 'broad');

    const url = 'https://push2.eastmoney.com/api/qt/clist/get'
        + '?pn=1&pz=120&po=1&np=1&fltt=2&invt=2'
        + `&fid=${encodeURIComponent(fid)}`
        + `&fs=${encodeURIComponent(fs)}`
        + '&fields=f12,f14,f2,f3,f6';

    const resp = await fetch(url, {
        headers: { Referer: 'https://quote.eastmoney.com/' }
    });
    if (!resp.ok) {
        return {
            ok: false,
            status: Number(resp.status || 0),
            error: `http_${resp.status}`,
            raw: ''
        };
    }

    const raw = await resp.text();
    const json = safeJsonParse(raw, null);
    const diff = Array.isArray(json?.data?.diff) ? json.data.diff : [];
    if (diff.length === 0) {
        return {
            ok: false,
            status: Number(resp.status || 0),
            error: 'empty_diff',
            raw: String(raw || '').slice(0, MAX_RSS_RAW)
        };
    }

    const nowTs = cst.getTime();
    const pubDate = formatCstTimestamp();
    const items = [];
    for (const row of diff) {
        const symbol = inferAshareSymbol(row?.f12);
        if (!symbol) continue;
        const name = String(row?.f14 || symbol).trim().slice(0, 50);
        const pct = Number(row?.f3 || 0);
        const price = normalizeEastmoneyPrice(row?.f2);
        const amount = normalizeEastmoneyPrice(row?.f6);
        const direction = pct >= 0 ? 'UP' : 'DOWN';
        const title = `${name}(${symbol}) ${direction} ${Math.abs(pct).toFixed(2)}% last ${price.toFixed(2)} turnover ${amount.toFixed(2)}`;
        items.push({
            title: title.slice(0, 200),
            link: `https://quote.eastmoney.com/${symbol.slice(2)}.html`,
            pub_date: pubDate,
            ts: nowTs,
            source: `eastmoney.push2.${channelKey}`
        });
        if (items.length >= maxCount) break;
    }
    return {
        ok: items.length > 0,
        status: Number(resp.status || 0),
        error: items.length > 0 ? '' : 'no_valid_items',
        items,
        raw: String(raw || '').slice(0, MAX_RSS_RAW)
    };
};
const dedupeNewsItems = (items = []) => {
    const seen = new Set();
    const result = [];
    for (const item of items || []) {
        const title = String(item?.title || '').trim();
        const link = String(item?.link || '').trim();
        if (!title) continue;
        const key = `${title.toLowerCase()}|${link.toLowerCase()}`;
        if (seen.has(key)) continue;
        seen.add(key);
        result.push({
            title: title.slice(0, 200),
            link: link.slice(0, 300),
            pub_date: String(item?.pub_date || '').slice(0, 80),
            ts: Number(item?.ts || 0),
            source: String(item?.source || 'unknown').slice(0, 120)
        });
    }
    return result;
};

const loadRssItems = async (env, config, cst, refresh = false) => {
    const now = Date.now();
    const cstDate = Time.formatCSTDate(cst);
    if (!refresh) {
        const cached = safeJsonParse(await getMetaValue(env, META_KEYS.RSS_CACHE), null);
        if (
            cached?.at
            && cached?.cst_date === cstDate
            && (now - Number(cached.at)) < 120000
            && Array.isArray(cached.items)
        ) {
            return cached.items;
        }
    }

    const mergedItems = [];
    const channels = resolveEastmoneyChannelConfigs(config?.rss_feeds || DEFAULT_EASTMONEY_CHANNEL_KEYS)
        .slice(0, MAX_RSS_FEEDS_PER_RUN);

    for (let i = 0; i < channels.length; i += 1) {
        const channel = channels[i];
        const news = await fetchEastmoneyNewsItems(env, cst, channel, MAX_NEWS_ITEMS_PER_FEED);
        if (Array.isArray(news?.items) && news.items.length > 0) {
            mergedItems.push(...news.items);
        } else {
            await logTechnicalAudit(env, {
                level: 'WARN',
                scope: 'ai.news.eastmoney',
                category: 'ai',
                subcategory: 'channel_fetch_failed',
                status: 'FAILED',
                message: 'eastmoney channel fetch failed',
                meta: {
                    channel: String(channel?.key || ''),
                    status: Number(news?.status || 0),
                    error: String(news?.error || 'unknown'),
                    raw: String(news?.raw || '').slice(0, MAX_RSS_RAW)
                }
            });
        }
        if (i < channels.length - 1) await sleep(RSS_FEED_FETCH_INTERVAL_MS);
    }

    const items = dedupeNewsItems(mergedItems)
        .sort((a, b) => Number(b?.ts || 0) - Number(a?.ts || 0))
        .slice(0, MAX_NEWS_ITEMS_TOTAL);

    if (items.length > 0) {
        await setMetaValue(env, META_KEYS.RSS_CACHE, safeJsonStringify({
            at: now,
            cst_date: cstDate,
            items
        }));
        return items;
    }

    const fallbackCached = safeJsonParse(await getMetaValue(env, META_KEYS.RSS_CACHE), null);
    if (Array.isArray(fallbackCached?.items)) {
        await logTechnicalAudit(env, {
            level: 'WARN',
            scope: 'ai.news.aggregate',
            category: 'ai',
            subcategory: 'cache_fallback',
            status: 'FAILED',
            message: 'all news sources unavailable, fallback cache'
        });
        return fallbackCached.items.slice(0, MAX_NEWS_ITEMS_TOTAL);
    }
    return [];
};

const loadRolePrompts = async (env) => {
    await ensureDefaults(env);
    const roles = Object.values(ROLE_KEYS);
    const prompts = {};
    for (const role of roles) {
        const key = getPromptMetaKey(role);
        const value = await getMetaValue(env, key);
        const base = asTrimmed(value) || DEFAULT_ROLE_PROMPTS[role];
        const hasChinese = /[\u4E00-\u9FFF]/.test(base);
        prompts[role] = hasChinese ? base : `${base}\n\n${CHINESE_OUTPUT_CLAUSE}`;
    }
    return prompts;
};

export const getAiPrompts = async (env) => {
    const prompts = await loadRolePrompts(env);
    return {
        updated_at: formatCstTimestamp(),
        prompts
    };
};

export const setAiPrompt = async (env, role, prompt, actor = 'admin') => {
    if (!isValidRoleKey(role)) {
        throw new Error('invalid role');
    }
    const content = String(prompt || '').trim();
    if (!content) throw new Error('prompt is empty');
    if (content.length > MAX_PROMPT_LENGTH) throw new Error('prompt is too long');

    await setMetaValue(env, getPromptMetaKey(role), content);
    await logTechnicalAudit(env, {
        level: 'INFO',
        scope: 'ai.prompt.update',
        category: 'ai',
        subcategory: role,
        status: 'SUCCESS',
        tags: ['ai', 'prompt', 'update'],
        message: 'ai role prompt updated',
        meta: { role, actor, length: content.length }
    });
};

const buildSymbolUniverse = (config, holdings, pendings, newsSymbols, stockCandidates) => {
    const list = [
        ...MARKET_ETF_SYMBOLS,
        ...SECTOR_ETF_SYMBOLS,
        ...(stockCandidates || []),
        ...(newsSymbols || []),
        ...config.watchlist,
        ...(holdings || []).map((x) => normalizeSymbol(x.symbol)),
        ...(pendings || []).map((x) => normalizeSymbol(x.symbol))
    ];
    return unique(list).filter((x) => /^(sh|sz|bj)\d{6}$/.test(x)).slice(0, MAX_SYMBOL_UNIVERSE);
};

const loadQuotes = async (env, symbols, runMeta = {}) => {
    const map = {};
    const list = Array.isArray(symbols) ? symbols : [];
    for (let i = 0; i < list.length; i += 1) {
        const symbol = list[i];
        try {
            const quote = await fetchStockPrice(symbol);
            if (quote) {
                const priceCent = Money.toCent(quote.price);
                const prevCloseCent = Money.toCent(quote.prevClose || quote.price);
                const assist = getPriceAssist(symbol, priceCent, prevCloseCent, { apply_cage: Time.isContinuousAuction() });
                map[symbol] = {
                    symbol,
                    name: quote.name || symbol,
                    price: Number(quote.price || 0),
                    prev_close: Number(quote.prevClose || quote.price || 0),
                    source: quote.source || 'unknown',
                    board: assist.board,
                    suggest: {
                        buy: Money.toYuan(assist?.suggest?.buy || priceCent),
                        sell: Money.toYuan(assist?.suggest?.sell || priceCent)
                    }
                };
            }
        } catch (error) {
            await logTechnicalAudit(env, {
                level: 'WARN',
                scope: 'ai.quote.load',
                category: 'ai',
                subcategory: 'fetch_exception',
                status: 'FAILED',
                message: 'quote fetch exception',
                meta: { run_id: runMeta.run_id || '', symbol, error: String(error || '') }
            });
        }

        if (i < list.length - 1) {
            await sleep(QUOTE_FETCH_INTERVAL_MS);
        }
    }

    for (const symbol of list) {
        if (!map[symbol]) {
            await logTechnicalAudit(env, {
                level: 'WARN',
                scope: 'ai.quote.load',
                category: 'ai',
                subcategory: 'missing_quote',
                status: 'FAILED',
                symbol,
                message: 'quote missing for symbol in ai cycle',
                meta: { run_id: runMeta.run_id || '' }
            });
        }
    }
    return map;
};

const getAccountContext = async (env) => {
    const [account, holdingsRows, pendingOrderRows, recentTradeRows, orderHistoryRows, holdingHistoryRows, reportRows, experienceRows] = await Promise.all([
        env.DB.prepare('SELECT balance, frozen_balance, initial_capital FROM account WHERE id=1').first(),
        env.DB.prepare(`
            SELECT symbol, name, quantity, available_qty, avg_cost, total_cost
            FROM holdings
            WHERE quantity > 0
            ORDER BY quantity DESC
        `).all(),
        env.DB.prepare(`
            SELECT id, symbol, side, status, price, qty, filled_qty, freeze_amount, remark, strategy_tag, created_at,
                   datetime(created_at, '+8 hours') AS created_at_cst,
                   updated_at
            FROM orders
            WHERE status='PENDING'
            ORDER BY id DESC
            LIMIT 80
        `).all(),
        env.DB.prepare(`
            SELECT id, symbol, side, price, qty, amount, trade_time
            FROM trades
            ORDER BY id DESC
            LIMIT 30
        `).all(),
        env.DB.prepare(`
            SELECT id, symbol, side, status, price, qty, filled_qty, freeze_amount, remark, strategy_tag, created_at,
                   datetime(created_at, '+8 hours') AS created_at_cst,
                   updated_at
            FROM orders
            ORDER BY id DESC
            LIMIT 120
        `).all(),
        env.DB.prepare(`
            SELECT id, event_type, status, symbol, side, qty, price, amount, holdings_before, holdings_after, created_at_cst
            FROM audit_financial
            WHERE symbol IS NOT NULL AND symbol != ''
            ORDER BY id DESC
            LIMIT 120
        `).all(),
        env.DB.prepare(`
            SELECT id, period_type, period_key, title, summary, experience, source, created_at_cst
            FROM trade_reports
            ORDER BY id DESC
            LIMIT 30
        `).all(),
        env.DB.prepare(`
            SELECT id, content, weight, source, created_at_cst
            FROM trade_experiences
            ORDER BY weight DESC, id DESC
            LIMIT 50
        `).all()
    ]);
    const holdings = holdingsRows?.results || [];
    const pendingOrders = pendingOrderRows?.results || [];
    const recentTrades = recentTradeRows?.results || [];
    const orderHistory = orderHistoryRows?.results || [];
    const holdingHistory = holdingHistoryRows?.results || [];
    const tradeReports = reportRows?.results || [];
    const tradeExperiences = experienceRows?.results || [];
    return {
        account: {
            balance_cent: Number(account?.balance || 0),
            frozen_cent: Number(account?.frozen_balance || 0),
            available_cent: Number(account?.balance || 0) - Number(account?.frozen_balance || 0),
            initial_capital_cent: Number(account?.initial_capital || 0)
        },
        holdings: (holdings || []).map((x) => ({
            symbol: normalizeSymbol(x.symbol),
            name: x.name || '',
            quantity: Number(x.quantity || 0),
            available_qty: Number(x.available_qty || 0),
            avg_cost: Money.toYuan(x.avg_cost),
            total_cost: Money.toYuan(x.total_cost)
        })),
        pending_orders: (pendingOrders || []).map((x) => ({
            id: Number(x.id),
            symbol: normalizeSymbol(x.symbol),
            side: String(x.side || '').toUpperCase(),
            status: String(x.status || '').toUpperCase(),
            price: Money.toYuan(x.price),
            qty: Number(x.qty || 0),
            filled_qty: Number(x.filled_qty || 0),
            freeze_amount: Money.toYuan(x.freeze_amount || 0),
            remark: String(x.remark || ''),
            strategy_tag: String(x.strategy_tag || ''),
            created_at: x.created_at_cst || x.created_at || '',
            updated_at: x.updated_at || ''
        })),
        recent_trades: (recentTrades || []).map((x) => ({
            id: Number(x.id),
            symbol: normalizeSymbol(x.symbol),
            side: String(x.side || '').toUpperCase(),
            price: Money.toYuan(x.price),
            qty: Number(x.qty || 0),
            amount: Money.toYuan(x.amount || 0),
            trade_time: x.trade_time
        })),
        order_history: (orderHistory || []).map((x) => ({
            id: Number(x.id),
            symbol: normalizeSymbol(x.symbol),
            side: String(x.side || '').toUpperCase(),
            status: String(x.status || '').toUpperCase(),
            price: Money.toYuan(x.price),
            qty: Number(x.qty || 0),
            filled_qty: Number(x.filled_qty || 0),
            freeze_amount: Money.toYuan(x.freeze_amount || 0),
            remark: String(x.remark || ''),
            strategy_tag: String(x.strategy_tag || ''),
            created_at: x.created_at_cst || x.created_at || '',
            updated_at: x.updated_at || ''
        })),
        holding_history: (holdingHistory || []).map((x) => ({
            id: Number(x.id),
            event_type: String(x.event_type || '').toUpperCase(),
            status: String(x.status || '').toUpperCase(),
            symbol: normalizeSymbol(x.symbol),
            side: String(x.side || '').toUpperCase(),
            qty: Number(x.qty || 0),
            price: Money.toYuan(x.price),
            amount: Money.toYuan(x.amount || 0),
            holdings_before: Number(x.holdings_before || 0),
            holdings_after: Number(x.holdings_after || 0),
            created_at: x.created_at_cst || ''
        })),
        trade_reports: (tradeReports || []).map((x) => ({
            id: Number(x.id || 0),
            period_type: String(x.period_type || ''),
            period_key: String(x.period_key || ''),
            title: String(x.title || ''),
            summary: String(x.summary || ''),
            experience: String(x.experience || ''),
            source: String(x.source || ''),
            created_at: String(x.created_at_cst || '')
        })),
        trade_experiences: (tradeExperiences || []).map((x) => ({
            id: Number(x.id || 0),
            content: String(x.content || ''),
            weight: Number(x.weight || 0),
            source: String(x.source || ''),
            created_at: String(x.created_at_cst || '')
        }))
    };
};

const computePerformance = async (env, accountContext, quoteMap) => {
    const holdings = accountContext.holdings || [];
    let marketCapCent = 0;
    for (const holding of holdings) {
        const quote = quoteMap[holding.symbol];
        const pxCent = quote ? Money.toCent(quote.price) : Money.toCent(holding.avg_cost || 0);
        marketCapCent += pxCent * Number(holding.quantity || 0);
    }

    const totalAssetsCent = Number(accountContext.account.balance_cent || 0) + marketCapCent;
    const today = Time.formatCSTDate();
    const prev = await env.DB.prepare(`
        SELECT total_assets
        FROM snapshots
        WHERE date < ?
        ORDER BY date DESC
        LIMIT 1
    `).bind(today).first();

    const prevAssetsCent = Number(prev?.total_assets || accountContext.account.initial_capital_cent || 0);
    const dayPnlCent = totalAssetsCent - prevAssetsCent;
    const dayPnlPct = prevAssetsCent > 0 ? Number(((dayPnlCent / prevAssetsCent) * 100).toFixed(2)) : 0;

    return {
        market_cap_cent: marketCapCent,
        total_assets_cent: totalAssetsCent,
        prev_assets_cent: prevAssetsCent,
        day_pnl_cent: dayPnlCent,
        day_pnl_pct: dayPnlPct
    };
};

const callGeminiJson = async (env, role, systemPrompt, payload, temperature = 0.35, runtimeLimits = {}) => {
    const cstDate = asTrimmed(runtimeLimits?.cst_date) || Time.formatCSTDate();
    const maxRequests = clampInt(
        parseIntSafe(runtimeLimits?.gemini_max_requests, DEFAULT_GEMINI_MAX_REQUESTS),
        MIN_GEMINI_MAX_REQUESTS,
        MAX_GEMINI_MAX_REQUESTS
    );

    if (runtimeLimits?.gemini_request_limit_exceeded === true) {
        const budgetErr = new Error(`gemini request budget exceeded for ${role}`);
        budgetErr.kind = 'gemini_request_budget_exceeded';
        throw budgetErr;
    }

    const usage = await recordGeminiRequestUsage(env, cstDate, maxRequests, runtimeLimits);
    if (usage.over_limit) {
        const err = new Error(`gemini request budget exceeded for ${role} (${usage.current}/${usage.limit})`);
        err.kind = 'gemini_request_budget_exceeded';
        throw err;
    }

    const schema = getRoleOutputSchema(role);
    const cooldownMap = await getGeminiModelCooldownMap(env, runtimeLimits);
    let cooldownDirty = false;
    const markModelCooldown = (model, cooldownMs) => {
        const ms = clampInt(parseIntSafe(cooldownMs, GEMINI_MODEL_ERROR_COOLDOWN_MS), 1000, GEMINI_MODEL_COOLDOWN_MAX_MS);
        cooldownMap[normalizeGeminiModel(model)] = Date.now() + ms;
        cooldownDirty = true;
    };
    const clearModelCooldown = (model) => {
        const key = normalizeGeminiModel(model);
        if (!cooldownMap[key]) return;
        delete cooldownMap[key];
        cooldownDirty = true;
    };

    const startedAt = Date.now();
    try {
        await applyGeminiPacing(runtimeLimits, GEMINI_MIN_REQUEST_INTERVAL_MS);
        const result = await callLLMJson(env, role, systemPrompt, payload, {
            temperature,
            schema,
            timeoutMs: 30000
        });

        const attemptSummary = (result.attempts || []).map((a, idx) => ({
            idx: idx + 1, provider: a.provider, model: a.model, ok: !!a.ok,
            duration_ms: a.duration_ms || 0,
            status: a.status || null,
            message: a.message || ''
        }));
        const last = attemptSummary[attemptSummary.length - 1];
        if (last && last.provider === 'gemini' && last.model) {
            clearModelCooldown(last.model);
        }
        if (cooldownDirty) await saveGeminiModelCooldownMap(env, runtimeLimits, cooldownMap);

        await logRoleCallAudit(env, {
            role,
            provider: result.provider,
            model: result.model,
            attempts: attemptSummary,
            ok: true,
            duration_ms: result.duration_ms,
            prompt_chars: systemPrompt.length,
            payload_chars: safeJsonStringify(payload || {}, '').length
        });
        return result.parsed;
    } catch (error) {
        const attempts = (error?.attempts || []).map((a, idx) => ({
            idx: idx + 1, provider: a.provider, model: a.model, ok: !!a.ok,
            duration_ms: a.duration_ms || 0,
            status: a.status || null,
            message: String(a.message || '').slice(0, 220)
        }));
        const last = attempts[attempts.length - 1];
        if (last && last.provider === 'gemini' && last.model && Number(last.status || 0) >= 500) {
            markModelCooldown(last.model, GEMINI_MODEL_ERROR_COOLDOWN_MS);
        }
        if (cooldownDirty) await saveGeminiModelCooldownMap(env, runtimeLimits, cooldownMap);

        const reason = String(error?.message || error || 'unknown').slice(0, 220);
        await logRoleCallAudit(env, {
            role,
            provider: last?.provider || '',
            model: last?.model || '',
            attempts,
            ok: false,
            duration_ms: Date.now() - startedAt,
            prompt_chars: systemPrompt.length,
            payload_chars: safeJsonStringify(payload || {}, '').length,
            error: reason
        });

        const err = new Error(reason);
        err.kind = error?.kind || 'llm_all_providers_failed';
        err.attempts = attempts;
        throw err;
    }
};

const logRoleCallAudit = async (env, info) => {
    try {
        await logBizError(env, {
            level: info.ok ? 'INFO' : 'WARN',
            status: info.ok ? 200 : Number(info.attempts?.[0]?.status || 502),
            scope: `ai.role.${info.role}.${info.provider || 'unknown'}`,
            category: 'ai',
            subcategory: 'role_call',
            message: info.ok
                ? `${info.role} role call OK via ${info.provider}/${info.model} (${info.duration_ms}ms, prompt=${info.prompt_chars}ch, payload=${info.payload_chars}ch)`
                : `${info.role} role call FAILED via ${info.provider || 'unknown'}: ${info.error || 'unknown'}`,
            meta: {
                role: info.role,
                provider: info.provider,
                model: info.model,
                ok: info.ok,
                duration_ms: info.duration_ms,
                prompt_chars: info.prompt_chars,
                payload_chars: info.payload_chars,
                attempts: info.attempts
            }
        });
    } catch { /* swallow logging errors to avoid masking the real error */ }
};

const safeRoleCall = async (env, role, prompt, payload, fallback, temperature = 0.35, runtimeLimits = {}) => {
    const buildFallbackWithReason = (reasonText = '') => (
        isObject(fallback)
            ? { ...fallback, risk_note: String(reasonText || 'llm failed').slice(0, 220) }
            : fallback
    );

    try {
        const data = await callGeminiJson(env, role, prompt, payload, temperature, runtimeLimits);
        return { ok: true, data, error: '' };
    } catch (error) {
        const attempts = Array.isArray(error?.attempts) ? error.attempts : [];
        const isRateLimited = attempts.some((x) => Number(x?.status || 0) === 429);
        const lastAttempt = attempts.length > 0 ? attempts[attempts.length - 1] : null;
        const rawReason = String(error?.message || error || 'llm failed').slice(0, 220);
        const normalizedReason = isRateLimited
            ? 'LLM API rate limited (HTTP 429)'
            : rawReason.replace(/quota[_\s-]*exhausted/gi, 'internal_budget_advisory_exceeded');
        const fallbackWithReason = buildFallbackWithReason(normalizedReason);

        if (isRateLimited && isObject(runtimeLimits)) {
            runtimeLimits.gemini_api_throttled = true;
            runtimeLimits.gemini_rate_limited = true;
        }

        await logBizError(env, {
            status: isRateLimited ? 429 : 502,
            scope: `ai.role.${role}`,
            category: 'ai',
            subcategory: 'llm',
            message: isRateLimited ? 'role call failed: API rate limited' : 'role call failed',
            meta: {
                role,
                error: normalizedReason,
                provider_chain: attempts.map((a) => a.provider).filter(Boolean),
                attempts
            }
        });

        return {
            ok: false,
            data: fallbackWithReason,
            error: normalizedReason,
            diagnostics: {
                error_kind: String(error?.kind || ''),
                throttle_count: attempts.filter((x) => Number(x?.status || 0) === 429).length,
                last_status: Number(lastAttempt?.status || 0),
                last_provider: String(lastAttempt?.provider || ''),
                last_model: String(lastAttempt?.model || ''),
                last_message: String(lastAttempt?.message || ''),
                last_raw: ''
            }
        };
    }
};const buildRiskLimits = (presidentData, config) => {
    const raw = isObject(presidentData?.risk_limits) ? presidentData.risk_limits : {};
    const penaltyTotal = Number(config.manager_penalty || 0) + Number(config.president_penalty || 0);
    const penaltyFactor = Math.max(0.4, 1 - penaltyTotal * 0.01);

    const maxNewOrders = clampInt(Math.floor(clampNumber(raw.max_new_orders, 1, 8) * penaltyFactor), 1, 8);
    const maxSingleOrderRatio = Number((clampNumber(raw.max_single_order_ratio, 0.05, 0.35) * penaltyFactor).toFixed(3));
    const forbidBuySymbols = unique((raw.forbid_buy_symbols || []).map(normalizeSymbol))
        .filter((x) => /^(sh|sz|bj)\d{6}$/.test(x));

    return {
        max_new_orders: maxNewOrders,
        max_single_order_ratio: maxSingleOrderRatio,
        forbid_buy_symbols: forbidBuySymbols
    };
};

const normalizeOrderRemark = (row = {}, fallbackAction = '') => {
    const action = String(row?.action || row?.side || fallbackAction || '').toUpperCase();
    const rawRemark = String(row?.remark || row?.note || '').trim().slice(0, 1200);
    if (/计划|止盈|止损/.test(rawRemark)) return rawRemark;

    const rationale = String(row?.rationale || row?.reason || '').trim().slice(0, 280);
    const priceHint = Number(row?.price_hint ?? row?.price ?? 0);
    const hasPriceHint = Number.isFinite(priceHint) && priceHint > 0;

    const planText = rawRemark || rationale || '按风险约束与市场信号执行';
    let stopLossText = '若价格走势与预期相反，触发风控阈值后立即减仓';
    let takeProfitText = '达到预期目标后分批止盈，保留跟踪仓位';
    if (hasPriceHint && action !== 'SELL') {
        stopLossText = `参考价位 ${Number((priceHint * 0.97).toFixed(2))} 附近`;
        takeProfitText = `参考价位 ${Number((priceHint * 1.05).toFixed(2))} 附近`;
    } else if (action === 'SELL') {
        stopLossText = '若卖出后继续走弱，不追单；若走势反转再评估回补';
        takeProfitText = '优先兑现风险，剩余仓位按趋势继续处理';
    }

    return `计划:${planText}；止损:${stopLossText}；止盈:${takeProfitText}`.slice(0, 1200);
};

const normalizeManagerOrders = (managerData) => {
    const source = Array.isArray(managerData?.orders) ? managerData.orders : [];
    const result = [];
    for (const order of source) {
        const action = String(order?.action || '').toUpperCase();
        if (!['BUY', 'SELL', 'HOLD', 'CANCEL_PENDING'].includes(action)) continue;
        const symbol = normalizeSymbol(order?.symbol);
        if (action !== 'HOLD' && !/^(sh|sz|bj)\d{6}$/.test(symbol)) continue;
        result.push({
            action,
            symbol,
            target_qty: Math.max(0, parseIntSafe(order?.target_qty, 0)),
            price_hint: Number(order?.price_hint || 0),
            rationale: String(order?.rationale || ''),
            confidence: clampNumber(order?.confidence, 0, 1),
            strategy_tag: String(order?.strategy_tag || '').trim().toUpperCase().slice(0, 40),
            remark: normalizeOrderRemark(order, action)
        });
        if (result.length >= MAX_ACTIONS_PER_ROUND) break;
    }
    return result;
};

const fallbackExecutionPlan = (managerOrders) => {
    return managerOrders.map((order) => {
        if (order.action === 'HOLD') {
            return { type: 'NOOP', symbol: order.symbol, reason: 'manager hold' };
        }
        if (order.action === 'CANCEL_PENDING') {
            return { type: 'CANCEL_PENDING_BY_SYMBOL', symbol: order.symbol, reason: order.rationale || 'manager cancel' };
        }
        return {
            type: 'PLACE_ORDER',
            symbol: order.symbol,
            side: order.action,
            qty: order.target_qty,
            price: order.price_hint,
            reason: order.rationale || 'manager order',
            strategy_tag: String(order?.strategy_tag || ''),
            remark: String(order?.remark || order?.note || '')
        };
    });
};

const normalizeExecutionPlan = (managerData, managerOrders) => {
    const managerPlan = Array.isArray(managerData?.execution_plan) ? managerData.execution_plan : [];
    const source = managerPlan.length > 0 ? managerPlan : fallbackExecutionPlan(managerOrders);

    const plan = [];
    for (const row of source) {
        const rawType = String(row?.type || '').toUpperCase();
        const rawAction = String(row?.action || '').toUpperCase();
        let type = rawType;
        if (!type) {
            if (rawAction === 'BUY' || rawAction === 'SELL') type = 'PLACE_ORDER';
            else if (rawAction === 'HOLD') type = 'NOOP';
            else if (rawAction === 'CANCEL_PENDING') type = 'CANCEL_PENDING_BY_SYMBOL';
        }
        if (!['PLACE_ORDER', 'CANCEL_ORDER', 'CANCEL_PENDING_BY_SYMBOL', 'NOOP'].includes(type)) continue;
        const side = type === 'PLACE_ORDER'
            ? String(row?.side || rawAction || '').toUpperCase()
            : String(row?.side || '').toUpperCase();
        plan.push({
            type,
            symbol: normalizeSymbol(row?.symbol),
            side,
            qty: Math.max(0, parseIntSafe(row?.qty ?? row?.target_qty, 0)),
            price: Number((row?.price ?? row?.price_hint) || 0),
            order_id: parseIntSafe(row?.order_id, 0),
            reason: String(row?.reason || row?.rationale || '').slice(0, 160),
            skip_reason: String(row?.skip_reason || '').slice(0, 160),
            strategy_tag: String(row?.strategy_tag || '').slice(0, 40),
            remark: normalizeOrderRemark(row, side)
        });
        if (plan.length >= MAX_ACTIONS_PER_ROUND) break;
    }
    return plan;
};

const normalizeReportPeriodType = (value) => {
    const raw = String(value || '').trim().toUpperCase();
    if (['DAILY', 'DAY', 'D'].includes(raw)) return 'DAILY';
    if (['WEEKLY', 'WEEK', 'W'].includes(raw)) return 'WEEKLY';
    if (['MONTHLY', 'MONTH', 'M'].includes(raw)) return 'MONTHLY';
    return '';
};

const normalizeReportDraft = (raw, fallbackType = '') => {
    const periodType = normalizeReportPeriodType(raw?.period_type || fallbackType);
    if (!periodType) return null;
    const summaryValue = typeof raw === 'string' ? raw : (raw?.summary || raw?.content || '');
    const experienceValue = typeof raw === 'string' ? '' : (raw?.experience || '');
    const summary = String(summaryValue || '').trim().slice(0, 12000);
    const experience = String(experienceValue || '').trim().slice(0, 4000);
    if (!summary && !experience) return null;
    return {
        period_type: periodType,
        period_key: String(raw?.period_key || '').trim().slice(0, 32),
        title: String(raw?.title || '').trim().slice(0, 120),
        summary,
        experience
    };
};

const collectManagerKnowledge = (managerData = {}) => {
    const reports = [];
    const reportSource = Array.isArray(managerData?.trade_reports) ? managerData.trade_reports : [];
    for (const row of reportSource) {
        const item = normalizeReportDraft(row, '');
        if (item) reports.push(item);
        if (reports.length >= 6) break;
    }

    const daily = normalizeReportDraft(managerData?.daily_report || {}, 'DAILY');
    if (daily) reports.push(daily);
    const weekly = normalizeReportDraft(managerData?.weekly_report || {}, 'WEEKLY');
    if (weekly) reports.push(weekly);
    const monthly = normalizeReportDraft(managerData?.monthly_report || {}, 'MONTHLY');
    if (monthly) reports.push(monthly);

    const expRows = Array.isArray(managerData?.experience_points)
        ? managerData.experience_points
        : (Array.isArray(managerData?.experiences) ? managerData.experiences : []);
    const experiences = [];
    for (const row of expRows) {
        const content = String(typeof row === 'string' ? row : (row?.content || row?.point || '')).trim().slice(0, 600);
        if (!content) continue;
        const weight = clampInt(parseIntSafe(typeof row === 'object' ? row?.weight : 0, 60), 0, 100);
        experiences.push({ content, weight });
        if (experiences.length >= 20) break;
    }

    const noteRows = Array.isArray(managerData?.order_note_updates) ? managerData.order_note_updates : [];
    const noteUpdates = [];
    for (const row of noteRows) {
        const orderId = parseIntSafe(row?.order_id, 0);
        const symbol = normalizeSymbol(row?.symbol);
        const remark = String(row?.remark || row?.note || '').trim().slice(0, 1200);
        const strategyTag = String(row?.strategy_tag || '').trim().slice(0, 40).toUpperCase();
        if (!remark) continue;
        if (orderId <= 0 && !/^(sh|sz|bj)\d{6}$/.test(symbol)) continue;
        noteUpdates.push({
            order_id: orderId > 0 ? orderId : 0,
            symbol,
            remark,
            strategy_tag: strategyTag
        });
        if (noteUpdates.length >= 20) break;
    }

    return {
        reports,
        experiences,
        note_updates: noteUpdates
    };
};

const buildPeriodKeyByType = (periodType, cst = Time.getCST()) => {
    const date = Time.formatCSTDate(cst);
    if (periodType === 'DAILY') return date;
    if (periodType === 'MONTHLY') return date.slice(0, 7);
    if (periodType === 'WEEKLY') {
        const target = new Date(cst.getTime());
        const day = target.getUTCDay() || 7;
        target.setUTCDate(target.getUTCDate() + 4 - day);
        const yearStart = new Date(Date.UTC(target.getUTCFullYear(), 0, 1));
        const weekNo = Math.ceil((((target - yearStart) / 86400000) + 1) / 7);
        return `${target.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
    }
    return date;
};

const shiftCstDays = (cst = Time.getCST(), deltaDays = 0) => {
    const date = new Date(cst.getTime());
    date.setDate(date.getDate() + Number(deltaDays || 0));
    return date;
};

const getPreviousTradingDateKey = (cst = Time.getCST()) => {
    let cursor = shiftCstDays(cst, -1);
    for (let i = 0; i < 10; i += 1) {
        const day = cursor.getDay();
        if (day !== 0 && day !== 6) {
            return Time.formatCSTDate(cursor);
        }
        cursor = shiftCstDays(cursor, -1);
    }
    return Time.formatCSTDate(shiftCstDays(cst, -1));
};

const buildTradeReportReferences = (tradeReports = [], cst = Time.getCST()) => {
    const rows = Array.isArray(tradeReports) ? tradeReports : [];
    const normalized = rows.map((x) => ({
        id: Number(x?.id || 0),
        period_type: normalizeReportPeriodType(x?.period_type),
        period_key: String(x?.period_key || ''),
        title: String(x?.title || ''),
        summary: String(x?.summary || ''),
        experience: String(x?.experience || ''),
        source: String(x?.source || ''),
        created_at: String(x?.created_at || '')
    })).filter((x) => !!x.period_type);

    const latestByType = (type) => normalized.find((x) => x.period_type === type) || null;
    const findByTypeKey = (type, key) => normalized.find((x) => x.period_type === type && x.period_key === key) || null;

    const prevTradingDateKey = getPreviousTradingDateKey(cst);
    const prevWeekKey = buildPeriodKeyByType('WEEKLY', shiftCstDays(cst, -7));

    return {
        prev_trading_date_key: prevTradingDateKey,
        prev_week_key: prevWeekKey,
        prev_trading_day_daily: findByTypeKey('DAILY', prevTradingDateKey) || latestByType('DAILY'),
        prev_week_weekly: findByTypeKey('WEEKLY', prevWeekKey) || latestByType('WEEKLY'),
        latest_monthly: latestByType('MONTHLY')
    };
};

const persistManagerKnowledge = async (env, managerData = {}, runId = '') => {
    const knowledge = collectManagerKnowledge(managerData);
    let reportsSaved = 0;
    let experiencesSaved = 0;
    let notesUpdated = 0;

    for (const report of knowledge.reports) {
        const periodType = normalizeReportPeriodType(report.period_type);
        if (!periodType) continue;
        const periodKey = String(report.period_key || '').trim() || buildPeriodKeyByType(periodType, Time.getCST());
        await env.DB.prepare(`
            INSERT INTO trade_reports (
                period_type, period_key, title, summary, experience, created_by, source, created_at_cst
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).bind(
            periodType,
            periodKey,
            String(report.title || '').slice(0, 120),
            String(report.summary || '').slice(0, 12000),
            String(report.experience || '').slice(0, 4000),
            'manager_ai',
            runId ? `ai:${runId}` : 'ai',
            formatCstTimestamp()
        ).run();
        reportsSaved += 1;
    }

    for (const row of knowledge.experiences) {
        const content = String(row.content || '').trim();
        if (!content) continue;
        const existing = await env.DB.prepare(
            'SELECT id, weight FROM trade_experiences WHERE content=? ORDER BY id DESC LIMIT 1'
        ).bind(content).first();
        if (existing?.id) {
            const nextWeight = Math.max(Number(existing.weight || 0), Number(row.weight || 0));
            await env.DB.prepare(`
                UPDATE trade_experiences
                SET weight=?, source=?, updated_at=CURRENT_TIMESTAMP
                WHERE id=?
            `).bind(nextWeight, runId ? `ai:${runId}` : 'ai', Number(existing.id)).run();
            experiencesSaved += 1;
            continue;
        }
        await env.DB.prepare(`
            INSERT INTO trade_experiences (content, weight, source, created_at_cst)
            VALUES (?, ?, ?, ?)
        `).bind(
            content.slice(0, 600),
            clampInt(parseIntSafe(row.weight, 60), 0, 100),
            runId ? `ai:${runId}` : 'ai',
            formatCstTimestamp()
        ).run();
        experiencesSaved += 1;
    }

    for (const row of knowledge.note_updates) {
        if (row.order_id > 0) {
            const upd = await env.DB.prepare(`
                UPDATE orders
                SET remark=?, strategy_tag=?, updated_at=CURRENT_TIMESTAMP
                WHERE id=?
            `).bind(
                String(row.remark || '').slice(0, 1200),
                String(row.strategy_tag || '').slice(0, 40),
                Number(row.order_id)
            ).run();
            if (Number(upd?.meta?.changes || 0) > 0) notesUpdated += 1;
            continue;
        }

        const symbol = normalizeSymbol(row.symbol);
        if (!/^(sh|sz|bj)\d{6}$/.test(symbol)) continue;
        const target = await env.DB.prepare(`
            SELECT id
            FROM orders
            WHERE symbol=?
            ORDER BY id DESC
            LIMIT 1
        `).bind(symbol).first();
        const orderId = Number(target?.id || 0);
        if (orderId <= 0) continue;

        const upd = await env.DB.prepare(`
            UPDATE orders
            SET remark=?, strategy_tag=?, updated_at=CURRENT_TIMESTAMP
            WHERE id=?
        `).bind(
            String(row.remark || '').slice(0, 1200),
            String(row.strategy_tag || '').slice(0, 40),
            orderId
        ).run();
        if (Number(upd?.meta?.changes || 0) > 0) notesUpdated += 1;
    }

    return {
        reports_saved: reportsSaved,
        experiences_saved: experiencesSaved,
        notes_updated: notesUpdated
    };
};

const buildManualFallbackExecutionPlan = (accountContext, quoteMap, riskLimits = {}) => {
    const plan = [];
    const holdings = Array.isArray(accountContext?.holdings) ? accountContext.holdings : [];
    const pendingOrders = Array.isArray(accountContext?.pending_orders) ? accountContext.pending_orders : [];
    const quoteSymbols = Object.keys(quoteMap || {});

    const firstPending = pendingOrders.find((x) => /^(sh|sz|bj)\d{6}$/.test(normalizeSymbol(x?.symbol)));
    if (firstPending) {
        plan.push({
            type: 'CANCEL_PENDING_BY_SYMBOL',
            symbol: normalizeSymbol(firstPending.symbol),
            side: '',
            qty: 0,
            price: 0,
            order_id: 0,
            reason: 'manual fallback: cancel one pending order',
            skip_reason: ''
        });
    }

    const firstHolding = holdings.find((x) => Number(x?.available_qty || 0) >= 100 && quoteSymbols.includes(normalizeSymbol(x?.symbol)));
    if (firstHolding) {
        plan.push({
            type: 'PLACE_ORDER',
            symbol: normalizeSymbol(firstHolding.symbol),
            side: 'SELL',
            qty: MIN_AI_ORDER_LOTS * 100,
            price: 0,
            order_id: 0,
            reason: 'manual fallback: sell baseline lots for execution path verification',
            skip_reason: ''
        });
    }

    const maxActions = clampInt(parseIntSafe(riskLimits?.max_new_orders, 2), 1, MAX_ACTIONS_PER_ROUND);
    return plan.slice(0, Math.max(1, maxActions));
};

const parseWorkerResponse = async (resp) => {
    if (!(resp instanceof Response)) {
        return { ok: false, status: 500, payload: { code: 5000, msg: 'invalid response object' } };
    }
    let payload = null;
    try {
        payload = await resp.clone().json();
    } catch {
        const raw = await resp.text().catch(() => '');
        payload = { code: resp.status, msg: raw.slice(0, 400) };
    }
    const ok = resp.ok && Number(payload?.code) === 0;
    return { ok, status: resp.status, payload };
};

const resolvePriceYuan = (symbol, side, requestedPrice, quoteMap) => {
    const quote = quoteMap[symbol];
    const quotePx = Number(quote?.price || 0);
    if (Number.isFinite(requestedPrice) && requestedPrice > 0) return Number(requestedPrice.toFixed(2));
    if (quotePx <= 0) return 0;

    if (side === 'BUY') {
        const suggested = Number(quote?.suggest?.buy || quotePx);
        return Number(suggested.toFixed(2));
    }
    const suggested = Number(quote?.suggest?.sell || quotePx);
    return Number(suggested.toFixed(2));
};

const resolveActionSymbol = (rawSymbol, quoteMap, holdingsMap, side = '') => {
    const symbol = normalizeSymbol(rawSymbol);
    if (/^(sh|sz|bj)\d{6}$/.test(symbol)) return symbol;
    const short = symbol.replace(/^(sh|sz|bj)/, '');
    if (!short) return '';

    const holdingKey = Object.keys(holdingsMap || {}).find((x) => x.endsWith(short));
    const quoteKey = Object.keys(quoteMap || {}).find((x) => x.endsWith(short));
    if (String(side || '').toUpperCase() === 'SELL') return holdingKey || quoteKey || '';
    if (quoteKey) return quoteKey;
    if (holdingKey) return holdingKey;
    return '';
};

const executeActions = async (env, executionPlan, quoteMap, riskLimits, dryRun = false, runMeta = {}) => {
    const results = [];
    let placed = 0;
    let cancelled = 0;
    let attempted = 0;
    let succeeded = 0;
    let failed = 0;

    const holdingsMap = {};
    const { results: rawHoldings } = await env.DB.prepare(
        'SELECT symbol, quantity, available_qty FROM holdings'
    ).all();
    for (const row of rawHoldings || []) {
        holdingsMap[normalizeSymbol(row.symbol)] = {
            quantity: Number(row.quantity || 0),
            available: Number(row.available_qty || 0)
        };
    }

    for (const action of executionPlan) {
        if (action.type === 'NOOP') {
            results.push({ action, skipped: true, reason: action.skip_reason || action.reason || 'noop' });
            continue;
        }

        if (attempted >= MAX_ACTIONS_PER_ROUND) {
            results.push({ action, skipped: true, reason: 'action limit reached' });
            continue;
        }

        if (action.type === 'CANCEL_ORDER') {
            if (action.order_id <= 0) {
                results.push({ action, skipped: true, reason: 'invalid order_id' });
                continue;
            }
            attempted += 1;
            if (dryRun) {
                succeeded += 1;
                cancelled += 1;
                results.push({ action, ok: true, dry_run: true });
                continue;
            }
            const resp = await cancelOrder(env, action.order_id);
            const parsed = await parseWorkerResponse(resp);
            if (parsed.ok) {
                succeeded += 1;
                cancelled += 1;
            } else {
                failed += 1;
            }
            results.push({ action, ...parsed });
            continue;
        }

        if (action.type === 'CANCEL_PENDING_BY_SYMBOL') {
            const symbol = resolveActionSymbol(action.symbol, quoteMap, holdingsMap);
            if (!symbol) {
                results.push({ action, skipped: true, reason: 'invalid symbol for cancel pending' });
                continue;
            }
            const { results: pending } = await env.DB.prepare(`
                SELECT id
                FROM orders
                WHERE status='PENDING' AND symbol=?
                ORDER BY id ASC
                LIMIT 20
            `).bind(symbol).all();
            if (!(pending || []).length) {
                results.push({ action, skipped: true, reason: 'no pending order found' });
                continue;
            }

            for (const row of pending || []) {
                if (attempted >= MAX_ACTIONS_PER_ROUND) break;
                attempted += 1;
                if (dryRun) {
                    succeeded += 1;
                    cancelled += 1;
                    results.push({ action: { ...action, order_id: row.id }, ok: true, dry_run: true });
                    continue;
                }
                const resp = await cancelOrder(env, row.id);
                const parsed = await parseWorkerResponse(resp);
                if (parsed.ok) {
                    succeeded += 1;
                    cancelled += 1;
                } else {
                    failed += 1;
                }
                results.push({ action: { ...action, order_id: row.id }, ...parsed });
            }
            continue;
        }

        if (action.type !== 'PLACE_ORDER') {
            results.push({ action, skipped: true, reason: 'unknown action type' });
            continue;
        }

        const side = String(action.side || '').toUpperCase();
        if (!['BUY', 'SELL'].includes(side)) {
            results.push({ action, skipped: true, reason: 'invalid side' });
            continue;
        }

        const symbol = resolveActionSymbol(action.symbol, quoteMap, holdingsMap, side);
        if (!symbol) {
            results.push({ action, skipped: true, reason: 'invalid symbol' });
            continue;
        }
        if (side === 'BUY' && riskLimits.forbid_buy_symbols.includes(symbol)) {
            results.push({ action, skipped: true, reason: 'symbol forbidden by president risk limit' });
            continue;
        }

        if (placed >= riskLimits.max_new_orders) {
            results.push({ action, skipped: true, reason: 'max_new_orders reached' });
            continue;
        }

        const priceYuan = resolvePriceYuan(symbol, side, action.price, quoteMap);
        const priceCent = Money.toCent(priceYuan);
        if (!Number.isInteger(priceCent) || priceCent <= 0) {
            results.push({ action, skipped: true, reason: 'invalid price' });
            continue;
        }

        let qty = Math.max(0, parseIntSafe(action.qty, 0));
        const minPreferredQty = MIN_AI_ORDER_LOTS * 100;
        const defaultQty = DEFAULT_AI_ORDER_LOTS * 100;
        if (qty <= 0) qty = defaultQty;
        if (qty > 0 && qty < minPreferredQty) qty = minPreferredQty;
        qty = Math.floor(qty / 100) * 100;
        if (qty < 100) {
            results.push({ action, skipped: true, reason: 'qty less than one lot' });
            continue;
        }

        if (side === 'BUY') {
            const acc = await env.DB.prepare('SELECT balance, frozen_balance FROM account WHERE id=1').first();
            const availableCent = Number(acc?.balance || 0) - Number(acc?.frozen_balance || 0);
            const budgetCent = Math.floor(availableCent * riskLimits.max_single_order_ratio);
            const lotCost = (priceCent * 100) + Money.calcCommission(priceCent * 100);
            const maxLots = lotCost > 0 ? Math.floor(budgetCent / lotCost) : 0;
            const maxQty = Math.max(0, maxLots * 100);
            if (maxQty >= minPreferredQty) {
                qty = Math.max(minPreferredQty, Math.min(qty, maxQty));
            } else {
                qty = Math.min(qty, maxQty);
            }
            qty = Math.floor(qty / 100) * 100;
            if (qty < 100) {
                results.push({ action, skipped: true, reason: 'buy budget/risk limit not enough for one lot' });
                continue;
            }
        } else {
            const holdingState = holdingsMap[symbol] || { quantity: 0, available: 0 };
            if (Number(holdingState.quantity || 0) < 100) {
                results.push({ action, skipped: true, reason: 'no holdings for sell symbol' });
                continue;
            }
            const availableQty = Number(holdingState.available || 0);
            if (availableQty >= minPreferredQty) {
                qty = Math.max(minPreferredQty, qty);
            }
            qty = Math.min(qty, Number(holdingState.available || 0));
            qty = Math.floor(qty / 100) * 100;
            if (qty < 100) {
                const tPlusOneBlocked = Number(holdingState.quantity || 0) >= 100
                    && Number(holdingState.available || 0) < 100;
                results.push({
                    action,
                    skipped: true,
                    reason: tPlusOneBlocked
                        ? 't+1 restriction: no sellable quantity today'
                        : 'insufficient available holdings'
                });
                continue;
            }
        }

        attempted += 1;
        const normalizedAction = {
            ...action,
            symbol,
            side,
            qty,
            price: priceYuan,
            strategy_tag: String(action?.strategy_tag || (side === 'BUY' ? 'LONG_STABLE' : 'SHORT_AGGRESSIVE')).slice(0, 40),
            remark: String(action?.remark || action?.reason || '').slice(0, 1200)
        };
        if (dryRun) {
            succeeded += 1;
            placed += 1;
            results.push({ action: normalizedAction, ok: true, dry_run: true });
            continue;
        }

        const resp = await placeOrder(env, {
            symbol,
            side,
            qty,
            price: Number(priceYuan.toFixed(2)),
            strategy_tag: normalizedAction.strategy_tag,
            remark: normalizedAction.remark
        });
        const parsed = await parseWorkerResponse(resp);
        if (parsed.ok) {
            succeeded += 1;
            placed += 1;
            if (side === 'SELL') {
                const current = holdingsMap[symbol] || { quantity: 0, available: 0 };
                holdingsMap[symbol] = {
                    quantity: Number(current.quantity || 0),
                    available: Math.max(0, Number(current.available || 0) - qty)
                };
            }
        } else {
            failed += 1;
        }
        results.push({ action: normalizedAction, ...parsed });
    }

    if (dryRun) {
        return {
            attempted,
            succeeded,
            failed,
            placed,
            cancelled,
            results
        };
    }

    for (const row of results) {
        const isFailed = row?.ok === false;
        const isSkipped = !!row?.skipped;
        const isSuccess = row?.ok === true && !isSkipped;
        if (!(isFailed || isSkipped || isSuccess)) continue;

        const orderId = Number(row?.payload?.data?.order_id || row?.action?.order_id || 0) || null;
        await logTechnicalAudit(env, {
            level: isFailed ? 'ERROR' : (isSkipped ? 'WARN' : 'INFO'),
            scope: 'ai.execution.action',
            category: 'ai',
            subcategory: isFailed ? 'failed' : (isSkipped ? 'skipped' : 'success'),
            status: isFailed ? 'FAILED' : (isSkipped ? 'SKIPPED' : 'SUCCESS'),
            request_id: runMeta?.run_id || '',
            order_id: orderId || undefined,
            symbol: row?.action?.symbol || '',
            message: isSuccess
                ? 'ai action executed'
                : String(row?.reason || row?.payload?.msg || row?.action?.reason || 'ai action not executed'),
            meta: {
                run_id: runMeta?.run_id || '',
                action: row?.action || {},
                status: row?.status || null,
                payload: row?.payload || {},
                order_id: orderId
            }
        });
    }

    return {
        attempted,
        succeeded,
        failed,
        placed,
        cancelled,
        results
    };
};

const normalizePrecheckReason = (value) => String(value || '').trim().toLowerCase();

const isNonBlockingPrecheckRow = (row) => {
    if (row?.ok === true) return false;
    if (row?.skipped !== true) return false;
    return NON_BLOCKING_PRECHECK_REASONS.has(normalizePrecheckReason(row?.reason));
};

const evaluateAtomicPrecheck = (executionSummary = {}) => {
    const results = Array.isArray(executionSummary?.results) ? executionSummary.results : [];
    const actionable = results.filter((row) => {
        const type = String(row?.action?.type || '').toUpperCase();
        return ['PLACE_ORDER', 'CANCEL_ORDER', 'CANCEL_PENDING_BY_SYMBOL'].includes(type);
    });
    const blocked = actionable.filter((row) => row?.ok !== true && !isNonBlockingPrecheckRow(row));
    const nonBlocking = actionable.filter((row) => row?.ok !== true && isNonBlockingPrecheckRow(row));
    return {
        ok: blocked.length === 0,
        blocked_count: blocked.length,
        blocked_reasons: blocked
            .slice(0, 3)
            .map((row) => String(row?.reason || row?.payload?.msg || 'precheck failed').slice(0, 160)),
        non_blocking_count: nonBlocking.length,
        non_blocking_reasons: nonBlocking
            .slice(0, 3)
            .map((row) => String(row?.reason || 'precheck non-blocking skip').slice(0, 160))
    };
};

const applyPenalty = async (env, config, performance, executionSummary) => {
    const attempted = Number(executionSummary?.attempted || 0);
    const failed = Number(executionSummary?.failed || 0);
    const failRate = attempted > 0 ? (failed / attempted) : 0;

    let delta = 0;
    if (attempted <= 0) {
        delta = 0;
    } else if (failed > 0 && failRate >= 0.6) {
        delta = 1;
    } else if (performance.day_pnl_pct <= -0.8) {
        delta = 1;
    } else if (performance.day_pnl_pct >= 0.8 && failed === 0) {
        delta = -1;
    }

    const managerPenalty = clampInt(Number(config.manager_penalty || 0) + delta, 0, 100);
    const presidentPenalty = clampInt(Number(config.president_penalty || 0) + delta, 0, 100);

    if (delta !== 0) {
        await Promise.all([
            setMetaValue(env, META_KEYS.PENALTY_MANAGER, String(managerPenalty)),
            setMetaValue(env, META_KEYS.PENALTY_PRESIDENT, String(presidentPenalty))
        ]);
    }

    return {
        delta,
        manager_penalty: managerPenalty,
        president_penalty: presidentPenalty
    };
};

const persistRunRecord = async (env, run) => {
    const detail = safeJsonStringify(run.detail || {});
    await env.DB.prepare(`
        INSERT INTO ai_committee_runs (
            run_id, trigger, status, phase, symbols,
            actions_total, executed_total,
            manager_penalty, president_penalty,
            pnl_day, detail, created_at_cst
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
        run.run_id,
        run.trigger,
        run.status,
        run.phase || '',
        (run.symbols || []).join(',').slice(0, 500),
        Number(run.actions_total || 0),
        Number(run.executed_total || 0),
        Number(run.manager_penalty || 0),
        Number(run.president_penalty || 0),
        Number(run.pnl_day || 0),
        detail,
        formatCstTimestamp()
    ).run();
};

export const updateAiConfig = async (env, body = {}) => {
    await ensureDefaults(env);
    const updates = [];

    if (body.enabled !== undefined) {
        const enabled = parseBool(body.enabled) ? '1' : '0';
        updates.push(setMetaValue(env, META_KEYS.ENABLED, enabled));
    }

    if (body.interval_min !== undefined) {
        const intervalMin = clampInt(parseIntSafe(body.interval_min, 3), MIN_INTERVAL_MINUTES, MAX_INTERVAL_MINUTES);
        updates.push(setMetaValue(env, META_KEYS.INTERVAL_MIN, String(intervalMin)));
    }

    if (body.daily_run_target !== undefined) {
        const dailyRunTarget = clampInt(
            parseIntSafe(body.daily_run_target, DEFAULT_DAILY_RUN_TARGET),
            MIN_DAILY_RUN_TARGET,
            MAX_DAILY_RUN_TARGET
        );
        updates.push(setMetaValue(env, META_KEYS.DAILY_RUN_TARGET, String(dailyRunTarget)));
    }

    if (body.gemini_max_requests !== undefined) {
        const geminiMaxRequests = clampInt(
            parseIntSafe(body.gemini_max_requests, DEFAULT_GEMINI_MAX_REQUESTS),
            MIN_GEMINI_MAX_REQUESTS,
            MAX_GEMINI_MAX_REQUESTS
        );
        updates.push(setMetaValue(env, META_KEYS.GEMINI_MAX_REQUESTS, String(geminiMaxRequests)));
    }

    if (body.watchlist !== undefined) {
        const watchlist = unique(parseListInput(body.watchlist).map(normalizeSymbol))
            .filter((x) => /^(sh|sz|bj)\d{6}$/.test(x))
            .slice(0, 40);
        updates.push(setMetaValue(env, META_KEYS.WATCHLIST, watchlist.join(',')));
    }

    if (body.rss_feeds !== undefined) {
        const feeds = resolveEastmoneyChannelKeys(body.rss_feeds);
        updates.push(setMetaValue(env, META_KEYS.RSS_FEEDS, feeds.join('\n')));
    }

    if (body.reset_penalty === true) {
        updates.push(setMetaValue(env, META_KEYS.PENALTY_MANAGER, '0'));
        updates.push(setMetaValue(env, META_KEYS.PENALTY_PRESIDENT, '0'));
    } else {
        if (body.manager_penalty !== undefined) {
            const managerPenalty = clampInt(parseIntSafe(body.manager_penalty, 0), 0, 100);
            updates.push(setMetaValue(env, META_KEYS.PENALTY_MANAGER, String(managerPenalty)));
        }
        if (body.president_penalty !== undefined) {
            const presidentPenalty = clampInt(parseIntSafe(body.president_penalty, 0), 0, 100);
            updates.push(setMetaValue(env, META_KEYS.PENALTY_PRESIDENT, String(presidentPenalty)));
        }
    }

    if (body.clear_rss_cache === true || body.clear_ai_cache === true) {
        updates.push(setMetaValue(env, META_KEYS.RSS_CACHE, ''));
    }
    if (body.clear_stock_cache === true || body.clear_ai_cache === true) {
        updates.push(setMetaValue(env, META_KEYS.STOCK_CANDIDATE_CACHE, ''));
    }

    await Promise.all(updates);
    return await getAiState(env);
};

const normalizeTaskRow = (row, includeResult = false) => {
    const payload = normalizeTaskPayload(safeJsonParse(row?.payload, {}));
    const data = {
        id: Number(row?.id || 0),
        task_id: String(row?.task_id || ''),
        status: String(row?.status || ''),
        payload,
        error_message: String(row?.error_message || ''),
        created_at_cst: row?.created_at_cst || row?.created_at || '',
        claimed_at: row?.claimed_at || '',
        finished_at: row?.finished_at || '',
        updated_at: row?.updated_at || ''
    };
    if (includeResult) {
        data.result = safeJsonParse(row?.result, null);
    }
    return data;
};

const getAiTaskSummary = async (env) => {
    const summary = await env.DB.prepare(`
        SELECT
            SUM(CASE WHEN status='PENDING' THEN 1 ELSE 0 END) AS pending,
            SUM(CASE WHEN status='RUNNING' THEN 1 ELSE 0 END) AS running,
            SUM(CASE WHEN status='DONE' THEN 1 ELSE 0 END) AS done,
            SUM(CASE WHEN status='FAILED' THEN 1 ELSE 0 END) AS failed,
            COUNT(1) AS total
        FROM ai_committee_tasks
    `).first();
    const oldestPending = await env.DB.prepare(`
        SELECT task_id, created_at_cst
        FROM ai_committee_tasks
        WHERE status=?
        ORDER BY id ASC
        LIMIT 1
    `).bind(AI_TASK_STATUS.PENDING).first();

    return {
        total: Number(summary?.total || 0),
        pending: Number(summary?.pending || 0),
        running: Number(summary?.running || 0),
        done: Number(summary?.done || 0),
        failed: Number(summary?.failed || 0),
        oldest_pending_task_id: String(oldestPending?.task_id || ''),
        oldest_pending_created_at_cst: String(oldestPending?.created_at_cst || '')
    };
};

export const getAiState = async (env) => {
    const cstDate = Time.formatCSTDate();
    const dailyKeys = buildDailyQuotaKeys(cstDate);
    const [config, lastRun, runRows, taskSummary, taskRows, dailyRunCount, dailyGeminiRequests, slotProgress] = await Promise.all([
        getConfig(env),
        getMetaValue(env, META_KEYS.LAST_RUN),
        env.DB.prepare(`
            SELECT id, run_id, trigger, status, phase, symbols,
                   actions_total, executed_total, manager_penalty, president_penalty,
                   pnl_day, created_at_cst
            FROM ai_committee_runs
            ORDER BY id DESC
            LIMIT 20
        `).all(),
        getAiTaskSummary(env),
        env.DB.prepare(`
            SELECT id, task_id, status, payload, result, error_message,
                   created_at, created_at_cst, claimed_at, finished_at, updated_at
            FROM ai_committee_tasks
            ORDER BY id DESC
            LIMIT 10
        `).all(),
        getDailyCounter(env, dailyKeys.run_count),
        getDailyCounter(env, dailyKeys.gemini_requests),
        getSlotProgress(env, cstDate)
    ]);

    return {
        enabled: config.enabled,
        interval_min: config.interval_min,
        daily_run_target: config.daily_run_target,
        gemini_max_requests: config.gemini_max_requests,
        watchlist: config.watchlist,
        market_etfs: [...MARKET_ETF_SYMBOLS, ...SECTOR_ETF_SYMBOLS],
        market_etfs_broad: [...MARKET_ETF_SYMBOLS],
        market_etfs_sector: [...SECTOR_ETF_SYMBOLS],
        rss_feeds: config.rss_feeds,
        manager_penalty: config.manager_penalty,
        president_penalty: config.president_penalty,
        ai_provider: {
            provider: 'gemini',
            api_key_present: !!resolveGeminiApiKey(env),
            model_candidates: resolveGeminiModelCandidates(env)
        },
        daily_quota: {
            cst_date: cstDate,
            run_count: dailyRunCount,
            run_limit: AUTO_DAILY_DISCUSSION_LIMIT,
            gemini_requests: dailyGeminiRequests,
            gemini_request_limit: config.gemini_max_requests
        },
        schedule: {
            cst_date: cstDate,
            run_limit: AUTO_DAILY_DISCUSSION_LIMIT,
            slots: slotProgress
        },
        last_run: safeJsonParse(lastRun, null),
        recent_runs: runRows?.results || [],
        tasks: {
            summary: taskSummary,
            latest: (taskRows?.results || []).map((row) => normalizeTaskRow(row, false))
        }
    };
};

const parseRunDetailAndSummary = (row) => {
    const detail = safeJsonParse(row?.detail, null);
    const summary = (detail && typeof detail === 'object' && detail.summary && typeof detail.summary === 'object')
        ? detail.summary
        : null;
    return { detail, summary };
};

const normalizeRunRow = (row, includeDetail = false) => {
    const { detail, summary } = parseRunDetailAndSummary(row);
    const status = String(row?.status || '').toUpperCase();
    const atomicPrecheck = (summary?.atomic_precheck && typeof summary.atomic_precheck === 'object')
        ? summary.atomic_precheck
        : null;
    const blockedReasons = Array.isArray(atomicPrecheck?.blocked_reasons)
        ? atomicPrecheck.blocked_reasons.map((x) => String(x || '').trim()).filter(Boolean).slice(0, 3)
        : [];
    const nonBlockingReasons = Array.isArray(atomicPrecheck?.non_blocking_reasons)
        ? atomicPrecheck.non_blocking_reasons.map((x) => String(x || '').trim()).filter(Boolean).slice(0, 3)
        : [];
    const data = {
        id: Number(row?.id || 0),
        run_id: String(row?.run_id || ''),
        trigger: String(row?.trigger || ''),
        status: String(row?.status || ''),
        phase: String(row?.phase || ''),
        symbols: String(row?.symbols || '').split(',').map((x) => x.trim()).filter(Boolean),
        actions_total: Number(row?.actions_total || 0),
        executed_total: Number(row?.executed_total || 0),
        manager_penalty: Number(row?.manager_penalty || 0),
        president_penalty: Number(row?.president_penalty || 0),
        pnl_day: Number(row?.pnl_day || 0),
        created_at_cst: row?.created_at_cst || row?.created_at || '',
        skipped: summary?.skipped === true || status === 'SKIPPED',
        reason: String(summary?.reason || ''),
        blocked_count: Number(atomicPrecheck?.blocked_count || blockedReasons.length || 0),
        blocked_reasons: blockedReasons,
        non_blocking_count: Number(atomicPrecheck?.non_blocking_count || nonBlockingReasons.length || 0),
        non_blocking_reasons: nonBlockingReasons
    };
    if (includeDetail) {
        data.detail = detail;
    }
    return data;
};

export const getAiRuns = async (env, options = {}) => {
    const runId = asTrimmed(options.run_id);
    const includeDetail = options.include_detail === true;
    const page = clampInt(parseIntSafe(options.page, 1), 1, 1000000);
    const pageSize = clampInt(parseIntSafe(options.page_size, 20), 1, 100);

    if (runId) {
        const row = await env.DB.prepare(`
            SELECT id, run_id, trigger, status, phase, symbols,
                   actions_total, executed_total, manager_penalty, president_penalty,
                   pnl_day, detail, created_at, created_at_cst
            FROM ai_committee_runs
            WHERE run_id=?
            LIMIT 1
        `).bind(runId).first();
        return {
            page: 1,
            page_size: 1,
            total: row ? 1 : 0,
            total_pages: 1,
            items: row ? [normalizeRunRow(row, true)] : []
        };
    }

    const offset = (page - 1) * pageSize;
    const countRow = await env.DB.prepare('SELECT COUNT(1) AS total FROM ai_committee_runs').first();
    const total = Number(countRow?.total || 0);
    const { results } = await env.DB.prepare(`
        SELECT id, run_id, trigger, status, phase, symbols,
               actions_total, executed_total, manager_penalty, president_penalty,
               pnl_day, detail, created_at, created_at_cst
        FROM ai_committee_runs
        ORDER BY id DESC
        LIMIT ? OFFSET ?
    `).bind(pageSize, offset).all();

    return {
        page,
        page_size: pageSize,
        total,
        total_pages: Math.max(1, Math.ceil(total / pageSize)),
        items: (results || []).map((row) => normalizeRunRow(row, includeDetail))
    };
};

export const getAiTasks = async (env, options = {}) => {
    const statusRaw = String(options.status || '').trim().toUpperCase();
    const statusFilter = Object.values(AI_TASK_STATUS).includes(statusRaw) ? statusRaw : '';
    const includeResult = options.include_result === true;
    const page = clampInt(parseIntSafe(options.page, 1), 1, 1000000);
    const pageSize = clampInt(parseIntSafe(options.page_size, 20), 1, 100);
    const offset = (page - 1) * pageSize;
    const where = statusFilter ? 'WHERE status=?' : '';
    const bind = statusFilter ? [statusFilter] : [];

    const countStmt = env.DB.prepare(`SELECT COUNT(1) AS total FROM ai_committee_tasks ${where}`);
    const rowsStmt = env.DB.prepare(`
            SELECT id, task_id, status, payload, result, error_message,
                   created_at, created_at_cst, claimed_at, finished_at, updated_at
            FROM ai_committee_tasks
            ${where}
            ORDER BY id DESC
            LIMIT ? OFFSET ?
        `);

    const [summary, countRow, rows] = await Promise.all([
        getAiTaskSummary(env),
        bind.length > 0 ? countStmt.bind(...bind).first() : countStmt.first(),
        bind.length > 0 ? rowsStmt.bind(...bind, pageSize, offset).all() : rowsStmt.bind(pageSize, offset).all()
    ]);

    const total = Number(countRow?.total || 0);
    return {
        page,
        page_size: pageSize,
        total,
        total_pages: Math.max(1, Math.ceil(total / pageSize)),
        status: statusFilter || 'ALL',
        summary,
        items: (rows?.results || []).map((row) => normalizeTaskRow(row, includeResult))
    };
};

const normalizePendingActionRow = (row) => ({
    id: Number(row?.id || 0),
    run_id: String(row?.run_id || ''),
    status: String(row?.status || ''),
    action: safeJsonParse(row?.action_payload, {}),
    result: safeJsonParse(row?.result_payload, null),
    reason: String(row?.reason || ''),
    created_at_cst: String(row?.created_at_cst || ''),
    decided_at: String(row?.decided_at || ''),
    run_trigger: String(row?.run_trigger || ''),
    run_created_at_cst: String(row?.run_created_at_cst || '')
});

const parsePendingIds = (value) => {
    const source = Array.isArray(value) ? value : [value];
    const ids = source
        .map((x) => Number.parseInt(String(x || ''), 10))
        .filter((x) => Number.isInteger(x) && x > 0);
    return unique(ids).slice(0, 80);
};

const toExecutionMode = (value) => {
    const raw = String(value || '').trim().toUpperCase();
    return raw === AI_EXECUTION_MODE.USER_CONFIRM
        ? AI_EXECUTION_MODE.USER_CONFIRM
        : AI_EXECUTION_MODE.AUTO_EXECUTE;
};

const createPendingActionBatch = async (env, runId, executionPlan = [], reason = '') => {
    const rows = (executionPlan || []).filter((action) => {
        const type = String(action?.type || '').toUpperCase();
        return ['PLACE_ORDER', 'CANCEL_ORDER', 'CANCEL_PENDING_BY_SYMBOL'].includes(type);
    });
    if (!rows.length) return { created: 0 };

    const statements = rows.map((action) => env.DB.prepare(`
        INSERT INTO ai_pending_actions (
            run_id, status, action_payload, reason, created_at_cst
        ) VALUES (?, ?, ?, ?, ?)
    `).bind(
        runId,
        AI_PENDING_ACTION_STATUS.PENDING,
        safeJsonStringify(action || {}),
        String(reason || '').slice(0, 200),
        formatCstTimestamp()
    ));
    await env.DB.batch(statements);
    return { created: rows.length };
};

export const getAiPendingActions = async (env, options = {}) => {
    const statusRaw = String(options.status || '').trim().toUpperCase();
    const statusFilter = Object.values(AI_PENDING_ACTION_STATUS).includes(statusRaw) ? statusRaw : '';
    const page = clampInt(parseIntSafe(options.page, 1), 1, 1000000);
    const pageSize = clampInt(parseIntSafe(options.page_size, 20), 1, 100);
    const offset = (page - 1) * pageSize;
    const where = statusFilter ? 'WHERE p.status=?' : '';
    const bind = statusFilter ? [statusFilter] : [];

    const countStmt = env.DB.prepare(`SELECT COUNT(1) AS total FROM ai_pending_actions p ${where}`);
    const rowsStmt = env.DB.prepare(`
        SELECT p.id, p.run_id, p.status, p.action_payload, p.result_payload, p.reason,
               p.created_at, p.created_at_cst, p.decided_at,
               r.trigger AS run_trigger, r.created_at_cst AS run_created_at_cst
        FROM ai_pending_actions p
        LEFT JOIN ai_committee_runs r ON r.run_id = p.run_id
        ${where}
        ORDER BY p.id DESC
        LIMIT ? OFFSET ?
    `);

    const [countRow, rows] = await Promise.all([
        bind.length ? countStmt.bind(...bind).first() : countStmt.first(),
        bind.length ? rowsStmt.bind(...bind, pageSize, offset).all() : rowsStmt.bind(pageSize, offset).all()
    ]);

    const total = Number(countRow?.total || 0);
    return {
        page,
        page_size: pageSize,
        total,
        total_pages: Math.max(1, Math.ceil(total / pageSize)),
        status: statusFilter || 'ALL',
        items: (rows?.results || []).map(normalizePendingActionRow)
    };
};

const runPendingSingleAction = async (env, row) => {
    const action = safeJsonParse(row?.action_payload, {});
    const type = String(action?.type || '').toUpperCase();
    if (!['PLACE_ORDER', 'CANCEL_ORDER', 'CANCEL_PENDING_BY_SYMBOL'].includes(type)) {
        return {
            ok: false,
            status: AI_PENDING_ACTION_STATUS.FAILED,
            reason: 'invalid action type',
            result_payload: { action, reason: 'invalid action type' }
        };
    }

    const symbol = normalizeSymbol(action?.symbol);
    const needQuote = type === 'PLACE_ORDER';
    const quoteMap = needQuote && /^(sh|sz|bj)\d{6}$/.test(symbol)
        ? await loadQuotes(env, [symbol], { run_id: `pending-${row?.run_id || ''}` })
        : {};
    const executionSummary = await executeActions(
        env,
        [action],
        quoteMap,
        { max_new_orders: 8, max_single_order_ratio: 0.35, forbid_buy_symbols: [] },
        false,
        { run_id: row?.run_id || '' }
    );

    const resultRows = Array.isArray(executionSummary?.results) ? executionSummary.results : [];
    const hardFailed = resultRows.find((x) => x?.ok === false);
    const successful = resultRows.find((x) => x?.ok === true && !x?.skipped);
    const skippedOnly = resultRows.length > 0 && resultRows.every((x) => x?.skipped);
    if (hardFailed || skippedOnly || !successful) {
        const reason = String(
            hardFailed?.reason
            || hardFailed?.payload?.msg
            || resultRows?.[0]?.reason
            || 'pending action not executed'
        ).slice(0, 220);
        return {
            ok: false,
            status: AI_PENDING_ACTION_STATUS.FAILED,
            reason,
            result_payload: { summary: executionSummary, action }
        };
    }

    return {
        ok: true,
        status: AI_PENDING_ACTION_STATUS.EXECUTED,
        reason: '',
        result_payload: { summary: executionSummary, action }
    };
};

export const confirmAiPendingActions = async (env, body = {}) => {
    const ids = parsePendingIds(body.ids);
    if (!ids.length) throw new Error('ids cannot be empty');

    const placeholders = ids.map(() => '?').join(',');
    const { results } = await env.DB.prepare(`
        SELECT id, run_id, status, action_payload
        FROM ai_pending_actions
        WHERE id IN (${placeholders}) AND status=?
        ORDER BY id ASC
    `).bind(...ids, AI_PENDING_ACTION_STATUS.PENDING).all();

    let executed = 0;
    let failed = 0;
    const details = [];
    for (const row of results || []) {
        const outcome = await runPendingSingleAction(env, row);
        if (outcome.ok) executed += 1;
        else failed += 1;
        await env.DB.prepare(`
            UPDATE ai_pending_actions
            SET status=?, result_payload=?, reason=?, decided_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP
            WHERE id=?
        `).bind(
            outcome.status,
            safeJsonStringify(outcome.result_payload || {}),
            String(outcome.reason || '').slice(0, 400),
            row.id
        ).run();
        details.push({
            id: Number(row.id || 0),
            run_id: String(row.run_id || ''),
            ok: outcome.ok,
            status: outcome.status,
            reason: outcome.reason || ''
        });
    }

    if (executed > 0) {
        await matchOrders(env, { force: true });
    }

    return {
        requested: ids.length,
        found: (results || []).length,
        executed,
        failed,
        details
    };
};

export const rejectAiPendingActions = async (env, body = {}) => {
    const ids = parsePendingIds(body.ids);
    if (!ids.length) throw new Error('ids cannot be empty');
    const reason = String(body.reason || 'rejected by user').trim().slice(0, 220) || 'rejected by user';
    const placeholders = ids.map(() => '?').join(',');
    const upd = await env.DB.prepare(`
        UPDATE ai_pending_actions
        SET status=?, reason=?, decided_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP
        WHERE id IN (${placeholders}) AND status=?
    `).bind(
        AI_PENDING_ACTION_STATUS.REJECTED,
        reason,
        ...ids,
        AI_PENDING_ACTION_STATUS.PENDING
    ).run();
    return {
        requested: ids.length,
        rejected: Number(upd?.meta?.changes || 0),
        reason
    };
};

const normalizeTaskPayload = (payload = {}) => {
    const reason = String(payload.reason || 'manual').trim().slice(0, 80) || 'manual';
    const requestedBy = String(payload.requested_by || 'admin').trim().slice(0, 40) || 'admin';
    const executionMode = toExecutionMode(payload.execution_mode);
    const retryCount = clampInt(parseIntSafe(payload.retry_count, 0), 0, AI_MAX_AUTO_RETRY + 2);
    const deferUntilTs = Number(payload.defer_until_ts || 0);
    return {
        force: payload.force === true,
        dry_run: payload.dry_run === true,
        reason,
        requested_by: requestedBy,
        manual_request: payload.manual_request === true,
        execution_mode: executionMode,
        retry_count: retryCount,
        defer_until_ts: Number.isFinite(deferUntilTs) ? Math.max(0, Math.trunc(deferUntilTs)) : 0,
        retry_origin_run_id: String(payload.retry_origin_run_id || '').trim().slice(0, 80)
    };
};

export const queueAiTask = async (env, payload = {}) => {
    const taskId = crypto.randomUUID();
    const normalized = normalizeTaskPayload(payload);
    await env.DB.prepare(`
        INSERT INTO ai_committee_tasks (
            task_id, status, payload, created_at_cst
        ) VALUES (?, ?, ?, ?)
    `).bind(
        taskId,
        AI_TASK_STATUS.PENDING,
        safeJsonStringify(normalized),
        formatCstTimestamp()
    ).run();

    await logTechnicalAudit(env, {
        level: 'INFO',
        scope: 'ai.task.enqueue',
        category: 'ai',
        subcategory: 'task',
        status: 'SUCCESS',
        request_id: taskId,
        message: 'ai task queued',
        meta: normalized
    });

    return {
        accepted: true,
        task_id: taskId,
        status: AI_TASK_STATUS.PENDING,
        payload: normalized
    };
};

const resolveRetryDelayMinutes = (retryCount = 0, throttled = false) => {
    const idx = clampInt(parseIntSafe(retryCount, 0), 0, AI_RETRY_BACKOFF_MINUTES.length - 1);
    const base = Number(AI_RETRY_BACKOFF_MINUTES[idx] || 3);
    return throttled ? Math.max(base, base + 2) : base;
};

const queueDeferredAiRetry = async (env, payload = {}, options = {}) => {
    const normalized = normalizeTaskPayload(payload);
    const currentRetry = clampInt(parseIntSafe(normalized.retry_count, 0), 0, AI_MAX_AUTO_RETRY + 2);
    if (currentRetry >= AI_MAX_AUTO_RETRY) {
        return {
            queued: false,
            reason: 'retry limit reached',
            retry_count: currentRetry
        };
    }

    const throttled = options.throttled === true;
    const delayMinutes = resolveRetryDelayMinutes(currentRetry, throttled);
    const jitterMs = Math.floor(Math.random() * 20000);
    const deferUntilTs = Date.now() + (delayMinutes * 60 * 1000) + jitterMs;
    const retryPayload = {
        ...normalized,
        force: true,
        manual_request: false,
        retry_count: currentRetry + 1,
        defer_until_ts: deferUntilTs,
        retry_origin_run_id: String(options.run_id || normalized.retry_origin_run_id || '').slice(0, 80),
        reason: String(options.reason || 'auto-retry').slice(0, 80)
    };

    const queued = await queueAiTask(env, retryPayload);
    return {
        queued: true,
        task_id: queued.task_id,
        retry_count: retryPayload.retry_count,
        defer_until_ts: deferUntilTs,
        delay_minutes: delayMinutes
    };
};

const claimPendingAiTasks = async (env, maxTasks = MAX_TASKS_PER_CRON) => {
    const { results } = await env.DB.prepare(`
        SELECT id, task_id, payload, created_at_cst
        FROM ai_committee_tasks
        WHERE status=?
        ORDER BY id ASC
        LIMIT ?
    `).bind(AI_TASK_STATUS.PENDING, maxTasks * 8).all();

    const claimed = [];
    const now = Date.now();
    for (const row of results || []) {
        if (claimed.length >= maxTasks) break;
        const payload = normalizeTaskPayload(safeJsonParse(row.payload, {}));
        const deferUntilTs = Number(payload.defer_until_ts || 0);
        if (deferUntilTs > now) continue;

        const upd = await env.DB.prepare(`
            UPDATE ai_committee_tasks
            SET status=?, claimed_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP
            WHERE id=? AND status=?
        `).bind(
            AI_TASK_STATUS.RUNNING,
            row.id,
            AI_TASK_STATUS.PENDING
        ).run();
        if ((upd?.meta?.changes || 0) > 0) {
            claimed.push({
                id: Number(row.id || 0),
                task_id: String(row.task_id || ''),
                created_at_cst: row.created_at_cst || '',
                payload
            });
        }
    }
    return claimed;
};

const claimTaskById = async (env, taskId) => {
    const row = await env.DB.prepare(`
        SELECT id, task_id, payload, created_at_cst
        FROM ai_committee_tasks
        WHERE task_id=?
        LIMIT 1
    `).bind(taskId).first();
    if (!row) return null;
    const payload = normalizeTaskPayload(safeJsonParse(row.payload, {}));
    if (Number(payload.defer_until_ts || 0) > Date.now()) return null;

    const upd = await env.DB.prepare(`
        UPDATE ai_committee_tasks
        SET status=?, claimed_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP
        WHERE id=? AND status=?
    `).bind(
        AI_TASK_STATUS.RUNNING,
        row.id,
        AI_TASK_STATUS.PENDING
    ).run();
    if ((upd?.meta?.changes || 0) === 0) return null;

    return {
        id: Number(row.id || 0),
        task_id: String(row.task_id || ''),
        created_at_cst: row.created_at_cst || '',
        payload
    };
};

const getTaskById = async (env, taskId, includeResult = true) => {
    const row = await env.DB.prepare(`
        SELECT id, task_id, status, payload, result, error_message,
               created_at, created_at_cst, claimed_at, finished_at, updated_at
        FROM ai_committee_tasks
        WHERE task_id=?
        LIMIT 1
    `).bind(taskId).first();
    return row ? normalizeTaskRow(row, includeResult) : null;
};

const finalizeTask = async (env, task, status, result = null, errorMessage = '') => {
    await env.DB.prepare(`
        UPDATE ai_committee_tasks
        SET status=?, result=?, error_message=?, finished_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP
        WHERE id=?
    `).bind(
        status,
        safeJsonStringify(result || {}),
        String(errorMessage || '').slice(0, 1000),
        task.id
    ).run();
};

const executeClaimedTask = async (env, task) => {
    const payload = normalizeTaskPayload(task.payload || {});
    const trigger = `queue:${payload.reason}`;
    try {
        const result = await runAiCommittee(env, {
            force: payload.force,
            dry_run: payload.dry_run,
            trigger,
            manual_request: payload.manual_request === true,
            execution_mode: payload.execution_mode || AI_EXECUTION_MODE.AUTO_EXECUTE,
            requested_by: payload.requested_by || 'admin',
            retry_count: payload.retry_count || 0,
            retry_origin_run_id: payload.retry_origin_run_id || ''
        });
        const isFailed = result?.failed === true;
        if (isFailed) {
            let deferredRetry = null;
            const msg = String(result?.message || '');
            const retryable = /429|rate limit|cloudflare|cooldown|throttled|request budget/i.test(msg);
            if (retryable) {
                deferredRetry = await queueDeferredAiRetry(env, payload, {
                    run_id: result?.run_id || '',
                    reason: 'auto-retry-gemini',
                    throttled: /429|rate limit|throttled/i.test(msg)
                });
            }
            await finalizeTask(env, task, AI_TASK_STATUS.FAILED, result, String(result?.message || 'run failed'));
            await logTechnicalAudit(env, {
                level: 'ERROR',
                scope: 'ai.task.execute',
                category: 'ai',
                subcategory: 'task',
                status: 'FAILED',
                request_id: task.task_id,
                message: 'ai queued task failed',
                meta: { trigger, result, deferred_retry: deferredRetry }
            });
            return { ok: false, result };
        }

        await finalizeTask(env, task, AI_TASK_STATUS.DONE, result, '');
        await logTechnicalAudit(env, {
            level: 'INFO',
            scope: 'ai.task.execute',
            category: 'ai',
            subcategory: 'task',
            status: 'SUCCESS',
            request_id: task.task_id,
            message: 'ai queued task done',
            meta: { trigger, run_id: result?.run_id || '' }
        });
        return { ok: true, result };
    } catch (e) {
        await finalizeTask(env, task, AI_TASK_STATUS.FAILED, {}, String(e?.message || e || 'unknown'));
        await logError(env, e, { task_id: task.task_id, trigger }, 'ai.task.execute');
        return {
            ok: false,
            result: {
                failed: true,
                message: String(e?.message || e || 'unknown')
            }
        };
    }
};

const cleanupFinishedTasks = async (env) => {
    await env.DB.prepare(`
        DELETE FROM ai_committee_tasks
        WHERE status IN (?, ?)
          AND finished_at <= datetime('now', '-2 days')
    `).bind(AI_TASK_STATUS.DONE, AI_TASK_STATUS.FAILED).run();
};

const recoverStaleRunningAiTasks = async (env, staleMinutes = 10) => {
    const minutes = clampInt(parseIntSafe(staleMinutes, 10), 3, 180);
    const cutoffExpr = `-${minutes} minutes`;
    const { results } = await env.DB.prepare(`
        SELECT id, task_id
        FROM ai_committee_tasks
        WHERE status=?
          AND claimed_at IS NOT NULL
          AND claimed_at <= datetime('now', ?)
        ORDER BY id ASC
        LIMIT 50
    `).bind(AI_TASK_STATUS.RUNNING, cutoffExpr).all();

    let recovered = 0;
    for (const row of results || []) {
        const upd = await env.DB.prepare(`
            UPDATE ai_committee_tasks
            SET status=?,
                claimed_at=NULL,
                updated_at=CURRENT_TIMESTAMP,
                error_message=?
            WHERE id=? AND status=?
        `).bind(
            AI_TASK_STATUS.PENDING,
            'stale RUNNING task recovered and re-queued by scheduler',
            row.id,
            AI_TASK_STATUS.RUNNING
        ).run();
        if ((upd?.meta?.changes || 0) > 0) {
            recovered += 1;
            await logTechnicalAudit(env, {
                level: 'WARN',
                scope: 'ai.task.recover',
                category: 'ai',
                subcategory: 'task',
                status: 'RECOVERED',
                request_id: String(row?.task_id || ''),
                message: 'stale RUNNING task recovered to PENDING',
                meta: { task_id: String(row?.task_id || ''), stale_minutes: minutes }
            });
        }
    }
    return recovered;
};

export const runQueuedAiTasks = async (env, options = {}) => {
    const recovered = await recoverStaleRunningAiTasks(env, options.stale_minutes);
    const maxTasks = clampInt(parseIntSafe(options.max_tasks, MAX_TASKS_PER_CRON), 1, 10);
    const tasks = await claimPendingAiTasks(env, maxTasks);
    if (!tasks.length) return { processed: 0, success: 0, failed: 0, recovered };

    let processed = 0;
    let success = 0;
    let failed = 0;

    for (const task of tasks) {
        processed += 1;
        const outcome = await executeClaimedTask(env, task);
        if (outcome.ok) success += 1;
        else failed += 1;
    }

    await cleanupFinishedTasks(env);

    return { processed, success, failed, recovered };
};

export const runAiTaskImmediate = async (env, payload = {}) => {
    const queued = await queueAiTask(env, payload);
    const execution = await runQueuedTaskById(env, queued.task_id);
    return {
        ...queued,
        immediate: true,
        ...execution
    };
};

export const runQueuedTaskById = async (env, taskId) => {
    const claimed = await claimTaskById(env, taskId);
    if (!claimed) {
        return {
            executed: false,
            message: 'task already claimed by scheduler',
            task: await getTaskById(env, taskId, true)
        };
    }

    const outcome = await executeClaimedTask(env, claimed);
    await cleanupFinishedTasks(env);

    return {
        executed: true,
        task: await getTaskById(env, taskId, true),
        run: outcome.result || null
    };
};

const maybePatchManagerPrompt = async (env, presidentData) => {
    const patch = String(presidentData?.manager_prompt_patch || '').trim();
    if (!patch) return { patched: false };
    if (patch.length < 30 || patch.length > 3000) {
        return { patched: false, reason: 'manager_prompt_patch ignored due to length limits' };
    }
    await setAiPrompt(env, ROLE_KEYS.MANAGER, patch, 'president');
    return { patched: true };
};

const createRoleFallback = (role) => {
    if (role === ROLE_KEYS.PRESIDENT) {
        return {
            market_regime: 'neutral',
            strategy_thesis: 'model unavailable, keep risk-neutral baseline',
            strategy_horizons: {
                long_term: 'preserve core quality holdings and rebalance slowly',
                mid_term: 'rotate by regime with strict risk budget',
                short_term: 'only execute high-confidence signals',
                intraday_t: 'do T only on existing base positions with sellable available_qty'
            },
            t_plus_one_note: 'A-share T+1: only available_qty can be sold today.',
            manager_prompt_patch: '',
            risk_limits: { max_new_orders: 2, max_single_order_ratio: 0.12, forbid_buy_symbols: [] },
            focus_symbols: [],
            confidence: 0.2,
            risk_note: 'gemini failed'
        };
    }
    if (role === ROLE_KEYS.MANAGER) {
        return {
            winner: 'mixed',
            decision_reason: 'model unavailable, no decision generated',
            orders: [],
            confidence: 0.2,
            risk_note: 'gemini failed'
        };
    }
    return {
        stance: role === ROLE_KEYS.ECONOMIST_1 ? 'offensive' : 'defensive',
        core_view: 'model unavailable, no view generated',
        plan: [],
        attack_points: [],
        confidence: 0.2,
        risk_note: 'gemini failed'
    };
};

const shortText = (value, max = 180) => String(value || '').trim().slice(0, max);

const summarizePlanRows = (rows, maxRows = 4) => {
    const items = Array.isArray(rows) ? rows : [];
    return items.slice(0, maxRows).map((row) => ({
        symbol: normalizeSymbol(row?.symbol),
        action: String(row?.action || '').toUpperCase(),
        qty_hint: parseIntSafe(row?.qty_hint ?? row?.target_qty, 0),
        price_hint: Number(row?.price_hint || row?.price || 0),
        reason: shortText(row?.reason || row?.rationale || '', 140),
        strategy_tag: shortText(row?.strategy_tag || '', 30),
        remark: shortText(row?.remark || row?.note || '', 120)
    }));
};

const buildNewsReferences = (rssItems = [], maxItems = 8) => {
    const items = Array.isArray(rssItems) ? rssItems : [];
    return items.slice(0, maxItems).map((item, idx) => ({
        index: idx + 1,
        title: shortText(item?.title || '', 200),
        source: shortText(item?.source || '', 80),
        pub_date: shortText(item?.pub_date || '', 80),
        link: shortText(item?.link || '', 300),
        symbols: extractSymbolsFromNewsItems([item]).slice(0, 5)
    }));
};

const buildDiscussionDigest = (debate = {}) => ({
    president: {
        market_regime: shortText(debate?.president?.market_regime || '--', 40),
        strategy_thesis: shortText(debate?.president?.strategy_thesis || '', 220),
        strategy_horizons: {
            long_term: shortText(debate?.president?.strategy_horizons?.long_term || '', 220),
            mid_term: shortText(debate?.president?.strategy_horizons?.mid_term || '', 220),
            short_term: shortText(debate?.president?.strategy_horizons?.short_term || '', 220),
            intraday_t: shortText(debate?.president?.strategy_horizons?.intraday_t || '', 220)
        },
        t_plus_one_note: shortText(debate?.president?.t_plus_one_note || '', 180),
        risk_note: shortText(debate?.president?.risk_note || '', 220),
        focus_symbols: Array.isArray(debate?.president?.focus_symbols)
            ? debate.president.focus_symbols.map((x) => normalizeSymbol(x)).filter(Boolean).slice(0, 10)
            : [],
        evidence_news: Array.isArray(debate?.president?.evidence_news)
            ? debate.president.evidence_news.map((x) => shortText(x, 120)).filter(Boolean).slice(0, 8)
            : []
    },
    economist_1: {
        stance: shortText(debate?.economist_1?.stance || '', 40),
        core_view: shortText(debate?.economist_1?.core_view || '', 220),
        risk_note: shortText(debate?.economist_1?.risk_note || '', 220),
        key_plan: summarizePlanRows(debate?.economist_1?.plan, 4),
        rebuttal: shortText(debate?.economist_1_rebuttal?.core_view || '', 180),
        evidence_news: Array.isArray(debate?.economist_1?.evidence_news)
            ? debate.economist_1.evidence_news.map((x) => shortText(x, 120)).filter(Boolean).slice(0, 8)
            : []
    },
    economist_2: {
        stance: shortText(debate?.economist_2?.stance || '', 40),
        core_view: shortText(debate?.economist_2?.core_view || '', 220),
        risk_note: shortText(debate?.economist_2?.risk_note || '', 220),
        key_plan: summarizePlanRows(debate?.economist_2?.plan, 4),
        rebuttal: shortText(debate?.economist_2_rebuttal?.core_view || '', 180),
        evidence_news: Array.isArray(debate?.economist_2?.evidence_news)
            ? debate.economist_2.evidence_news.map((x) => shortText(x, 120)).filter(Boolean).slice(0, 8)
            : []
    },
    manager: {
        winner: shortText(debate?.manager?.winner || 'mixed', 40),
        decision_reason: shortText(debate?.manager?.decision_reason || '', 260),
        risk_note: shortText(debate?.manager?.risk_note || '', 220),
        selected_orders: summarizePlanRows(debate?.normalized_manager_orders, 6),
        report_drafts: Array.isArray(debate?.manager?.trade_reports)
            ? debate.manager.trade_reports.slice(0, 3).map((x) => ({
                period_type: shortText(x?.period_type || '', 16),
                summary: shortText(x?.summary || '', 120),
                experience: shortText(x?.experience || '', 120)
            }))
            : [],
        experience_points: Array.isArray(debate?.manager?.experience_points)
            ? debate.manager.experience_points.slice(0, 5).map((x) => shortText(x?.content || x, 100))
            : [],
        evidence_news: Array.isArray(debate?.manager?.evidence_news)
            ? debate.manager.evidence_news.map((x) => shortText(x, 120)).filter(Boolean).slice(0, 8)
            : []
    }
});

const shouldRunRebuttalPhase = (config, runtimeLimits = {}) => {
    if (!ENABLE_REBUTTAL_DISCUSSION) {
        return { run: false, reason: 'rebuttal disabled by config' };
    }
    if (runtimeLimits?.gemini_api_throttled || runtimeLimits?.gemini_rate_limited) {
        return { run: false, reason: 'gemini throttled, skip rebuttal to reduce 429 risk' };
    }

    const limit = clampInt(
        parseIntSafe(runtimeLimits?.gemini_request_limit, config?.gemini_max_requests || DEFAULT_GEMINI_MAX_REQUESTS),
        MIN_GEMINI_MAX_REQUESTS,
        MAX_GEMINI_MAX_REQUESTS
    );
    const used = Math.max(0, parseIntSafe(runtimeLimits?.gemini_request_used, 0));
    const remaining = Math.max(0, limit - used);
    if (remaining < REBUTTAL_RESERVED_REQUESTS) {
        return {
            run: false,
            reason: `request budget low (${remaining}/${limit}), skip rebuttal for main decision`
        };
    }

    return { run: true, reason: 'quality mode' };
};

const debateAndDecision = async (env, prompts, inputContext, config, runtimeLimits = {}) => {
    const president = await safeRoleCall(
        env,
        ROLE_KEYS.PRESIDENT,
        prompts[ROLE_KEYS.PRESIDENT],
        {
            phase: 'president_strategy',
            context: inputContext
        },
        createRoleFallback(ROLE_KEYS.PRESIDENT),
        0.25,
        runtimeLimits
    );
    const patchResult = await maybePatchManagerPrompt(env, president.data);
    if (patchResult.patched) {
        prompts[ROLE_KEYS.MANAGER] = asTrimmed(await getMetaValue(env, getPromptMetaKey(ROLE_KEYS.MANAGER)))
            || prompts[ROLE_KEYS.MANAGER];
    }

    const economist1 = await safeRoleCall(
        env,
        ROLE_KEYS.ECONOMIST_1,
        prompts[ROLE_KEYS.ECONOMIST_1],
        {
            phase: 'proposal',
            context: inputContext,
            president_strategy: president.data,
            requirement: 'Provide a more offensive proposal and clearly label potential alpha sources.'
        },
        createRoleFallback(ROLE_KEYS.ECONOMIST_1),
        0.4,
        runtimeLimits
    );

    const economist2 = await safeRoleCall(
        env,
        ROLE_KEYS.ECONOMIST_2,
        prompts[ROLE_KEYS.ECONOMIST_2],
        {
            phase: 'proposal',
            context: inputContext,
            president_strategy: president.data,
            economist_1_plan: economist1.data,
            requirement: 'Must be materially different from economist_1 and identify key weaknesses.'
        },
        createRoleFallback(ROLE_KEYS.ECONOMIST_2),
        0.4,
        runtimeLimits
    );

    const rebuttalPolicy = shouldRunRebuttalPhase(config, runtimeLimits);
    let economist1Rebut = {
        ok: true,
        data: {
            stance: 'offensive',
            core_view: rebuttalPolicy.run ? 'rebuttal pending' : 'rebuttal skipped by adaptive budget guard',
            plan: [],
            attack_points: [],
            confidence: 0.5,
            risk_note: rebuttalPolicy.reason
        },
        error: '',
        diagnostics: { skipped_by_policy: !rebuttalPolicy.run, policy_reason: rebuttalPolicy.reason }
    };
    let economist2Rebut = {
        ok: true,
        data: {
            stance: 'defensive',
            core_view: rebuttalPolicy.run ? 'rebuttal pending' : 'rebuttal skipped by adaptive budget guard',
            plan: [],
            attack_points: [],
            confidence: 0.5,
            risk_note: rebuttalPolicy.reason
        },
        error: '',
        diagnostics: { skipped_by_policy: !rebuttalPolicy.run, policy_reason: rebuttalPolicy.reason }
    };

    if (rebuttalPolicy.run) {
        economist1Rebut = await safeRoleCall(
            env,
            ROLE_KEYS.ECONOMIST_1,
            prompts[ROLE_KEYS.ECONOMIST_1],
            {
                phase: 'rebuttal',
                context: inputContext,
                my_previous_plan: economist1.data,
                opponent_plan: economist2.data,
                requirement: 'Rebut opponent points one by one and refine your own plan.'
            },
            createRoleFallback(ROLE_KEYS.ECONOMIST_1),
            0.35,
            runtimeLimits
        );

        economist2Rebut = await safeRoleCall(
            env,
            ROLE_KEYS.ECONOMIST_2,
            prompts[ROLE_KEYS.ECONOMIST_2],
            {
                phase: 'rebuttal',
                context: inputContext,
                my_previous_plan: economist2.data,
                opponent_plan: economist1.data,
                opponent_rebuttal: economist1Rebut.data,
                requirement: 'Respond to opponent rebuttal while keeping defensive priority.'
            },
            createRoleFallback(ROLE_KEYS.ECONOMIST_2),
            0.35,
            runtimeLimits
        );
    }

    const manager = await safeRoleCall(
        env,
        ROLE_KEYS.MANAGER,
        prompts[ROLE_KEYS.MANAGER],
        {
            phase: 'manager_decision',
            context: inputContext,
            president_strategy: president.data,
            economist_1: economist1.data,
            economist_2: economist2.data,
            economist_1_rebuttal: economist1Rebut.data,
            economist_2_rebuttal: economist2Rebut.data,
            risk_penalty: {
                manager_penalty: config.manager_penalty,
                president_penalty: config.president_penalty
            }
        },
        createRoleFallback(ROLE_KEYS.MANAGER),
        0.25,
        runtimeLimits
    );

    const normalizedManagerOrders = normalizeManagerOrders(manager.data);
    const riskLimits = buildRiskLimits(president.data, config);
    const executionPlan = normalizeExecutionPlan(manager.data, normalizedManagerOrders);
    const roleDiagnostics = {
        president: { ok: president.ok, error: president.error || '', ...(president.diagnostics || {}) },
        economist_1: { ok: economist1.ok, error: economist1.error || '', ...(economist1.diagnostics || {}) },
        economist_2: { ok: economist2.ok, error: economist2.error || '', ...(economist2.diagnostics || {}) },
        economist_1_rebuttal: { ok: economist1Rebut.ok, error: economist1Rebut.error || '', ...(economist1Rebut.diagnostics || {}) },
        economist_2_rebuttal: { ok: economist2Rebut.ok, error: economist2Rebut.error || '', ...(economist2Rebut.diagnostics || {}) },
        manager: { ok: manager.ok, error: manager.error || '', ...(manager.diagnostics || {}) }
    };

    return {
        patch_result: patchResult,
        president: president.data,
        economist_1: economist1.data,
        economist_2: economist2.data,
        economist_1_rebuttal: economist1Rebut.data,
        economist_2_rebuttal: economist2Rebut.data,
        manager: manager.data,
        normalized_manager_orders: normalizedManagerOrders,
        role_diagnostics: roleDiagnostics,
        risk_limits: riskLimits,
        execution_plan: executionPlan
    };
};

export const runAiCommittee = async (env, options = {}) => {
    const force = options.force === true;
    const dryRun = options.dry_run === true;
    const trigger = asTrimmed(options.trigger) || 'cron';
    const manualRequest = options.manual_request === true;
    const executionMode = toExecutionMode(options.execution_mode);
    const requestedBy = asTrimmed(options.requested_by) || (manualRequest ? 'user' : 'scheduler');
    const retryCount = clampInt(parseIntSafe(options.retry_count, 0), 0, AI_MAX_AUTO_RETRY + 2);
    const retryOriginRunId = asTrimmed(options.retry_origin_run_id || '');
    const cst = Time.getCST();
    const runId = crypto.randomUUID();
    const cstDate = Time.formatCSTDate(cst);
    const scheduleDeferredRetry = async (reason = 'auto-retry', throttled = false) => {
        return await queueDeferredAiRetry(env, {
            force: true,
            dry_run: false,
            reason: 'auto-retry',
            requested_by: requestedBy || 'scheduler',
            manual_request: false,
            execution_mode: AI_EXECUTION_MODE.AUTO_EXECUTE,
            retry_count: retryCount,
            retry_origin_run_id: retryOriginRunId || runId
        }, {
            run_id: runId,
            reason,
            throttled
        });
    };

    try {
        const config = await getConfig(env);
        const persistSkipped = async (reason, extra = {}) => {
            const dailyKeys = buildDailyQuotaKeys(cstDate);
            const [dailyGeminiRequests, dailyRunCount] = await Promise.all([
                getDailyCounter(env, dailyKeys.gemini_requests),
                getDailyCounter(env, dailyKeys.run_count)
            ]);
            const summary = {
                run_id: runId,
                trigger,
                skipped: true,
                reason,
                dry_run: dryRun,
                manual_request: manualRequest,
                execution_mode: executionMode,
                requested_by: requestedBy,
                retry_count: retryCount,
                retry_origin_run_id: retryOriginRunId,
                quota: {
                    cst_date: cstDate,
                    run_count: dailyRunCount,
                    run_limit: AUTO_DAILY_DISCUSSION_LIMIT,
                    gemini_requests: dailyGeminiRequests,
                    gemini_request_limit: config.gemini_max_requests
                },
                ...extra
            };
            await setMetaValue(env, META_KEYS.LAST_RUN, safeJsonStringify({
                ...summary,
                at: formatCstTimestamp()
            }));
            await persistRunRecord(env, {
                run_id: runId,
                trigger,
                status: 'SKIPPED',
                phase: 'skip',
                symbols: [],
                actions_total: 0,
                executed_total: 0,
                manager_penalty: config.manager_penalty,
                president_penalty: config.president_penalty,
                pnl_day: 0,
                detail: { summary }
            });
            return summary;
        };
        if (!config.enabled && !force) {
            await logTechnicalAudit(env, {
                level: 'INFO',
                scope: 'ai.committee',
                category: 'ai',
                subcategory: 'skip',
                status: 'SKIPPED',
                request_id: runId,
                message: 'ai disabled, skip cycle',
                meta: { trigger, manual_request: manualRequest }
            });
            return await persistSkipped('ai disabled');
        }

        let dailyPermit = await acquireDailyRunPermit(env, cst, config, {
            manual_request: manualRequest
        });
        if (!dailyPermit.ok) {
            if (force) {
                const dailyKeys = buildDailyQuotaKeys(cstDate);
                dailyPermit = {
                    ok: true,
                    counted: false,
                    quota: {
                        cst_date: cstDate,
                        run_count: await getDailyCounter(env, dailyKeys.run_count),
                        run_limit: AUTO_DAILY_DISCUSSION_LIMIT
                    },
                    bypass_reason: dailyPermit.reason
                };
            } else {
                await logTechnicalAudit(env, {
                    level: 'INFO',
                    scope: 'ai.committee',
                    category: 'ai',
                    subcategory: 'skip',
                    status: 'SKIPPED',
                    request_id: runId,
                    message: 'daily ai gate blocked run',
                    meta: { trigger, reason: dailyPermit.reason, quota: dailyPermit.quota, manual_request: manualRequest }
                });
                return await persistSkipped(dailyPermit.reason, { quota_gate: dailyPermit.quota || {} });
            }
        }

        if (dailyPermit?.bypass_reason) {
            await logTechnicalAudit(env, {
                level: 'INFO',
                scope: 'ai.committee',
                category: 'ai',
                subcategory: 'run',
                status: 'SUCCESS',
                request_id: runId,
                message: 'daily gate bypassed by force run',
                meta: { trigger, bypass_reason: dailyPermit.bypass_reason, manual_request: manualRequest }
            });
        }

        const rolePrompts = await loadRolePrompts(env);
        const accountContext = await getAccountContext(env);
        const rssItems = await loadRssItems(env, config, cst, force);
        const newsSymbols = extractSymbolsFromNewsItems(rssItems);
        const stockCandidates = await loadStockCandidates(env, force);
        const symbolUniverse = buildSymbolUniverse(
            config,
            accountContext.holdings,
            accountContext.pending_orders,
            newsSymbols,
            stockCandidates
        );
        const quoteMap = await loadQuotes(env, symbolUniverse, { run_id: runId });
        const performance = await computePerformance(env, accountContext, quoteMap);
        const reportRefs = buildTradeReportReferences(accountContext.trade_reports, cst);
        const broadMarketEtfs = MARKET_ETF_SYMBOLS.map((symbol) => quoteMap[symbol]).filter(Boolean);
        const sectorMarketEtfs = SECTOR_ETF_SYMBOLS.map((symbol) => quoteMap[symbol]).filter(Boolean);

        const inputContext = {
            run_id: runId,
            time_cst: formatCstTimestamp(),
            penalties: {
                manager: config.manager_penalty,
                president: config.president_penalty
            },
            account: {
                balance: Money.toYuan(accountContext.account.balance_cent),
                frozen: Money.toYuan(accountContext.account.frozen_cent),
                available: Money.toYuan(accountContext.account.available_cent),
                initial_capital: Money.toYuan(accountContext.account.initial_capital_cent),
                sellable_symbols: accountContext.holdings
                    .filter((x) => Number(x?.available_qty || 0) >= 100)
                    .map((x) => normalizeSymbol(x?.symbol))
                    .filter((x) => /^(sh|sz|bj)\d{6}$/.test(x))
                    .slice(0, 30),
                t1_locked_symbols: accountContext.holdings
                    .filter((x) => Number(x?.quantity || 0) >= 100 && Number(x?.available_qty || 0) < 100)
                    .map((x) => normalizeSymbol(x?.symbol))
                    .filter((x) => /^(sh|sz|bj)\d{6}$/.test(x))
                    .slice(0, 30)
            },
            holdings: accountContext.holdings.slice(0, 20),
            pending_orders: accountContext.pending_orders.slice(0, 30),
            recent_trades: accountContext.recent_trades.slice(0, 20),
            order_history: accountContext.order_history.slice(0, 50),
            holding_history: accountContext.holding_history.slice(0, 50),
            trade_reports: accountContext.trade_reports.slice(0, 20),
            trade_report_refs: reportRefs,
            trade_experiences: accountContext.trade_experiences.slice(0, 40),
            market_etfs: [...broadMarketEtfs, ...sectorMarketEtfs],
            market_etfs_broad: broadMarketEtfs,
            market_etfs_sector: sectorMarketEtfs,
            quotes: Object.values(quoteMap).slice(0, 20),
            news: rssItems.slice(0, 12),
            candidate_pool: {
                market_etfs: [...MARKET_ETF_SYMBOLS, ...SECTOR_ETF_SYMBOLS],
                market_etfs_broad: MARKET_ETF_SYMBOLS,
                market_etfs_sector: SECTOR_ETF_SYMBOLS,
                from_news: newsSymbols.slice(0, 20),
                from_stock_interface: stockCandidates.slice(0, 30),
                merged: symbolUniverse.slice(0, 40)
            },
            performance: {
                total_assets: Money.toYuan(performance.total_assets_cent),
                market_cap: Money.toYuan(performance.market_cap_cent),
                day_pnl: Money.toYuan(performance.day_pnl_cent),
                day_pnl_pct: performance.day_pnl_pct
            }
        };

        const roleRuntimeLimits = {
            cst_date: cstDate,
            gemini_max_requests: config.gemini_max_requests
        };

        let debate = await debateAndDecision(
            env,
            rolePrompts,
            inputContext,
            config,
            roleRuntimeLimits
        );
        const roleFallbackCount = Object.values(debate.role_diagnostics || {}).filter((x) => x?.ok === false).length;
        const geminiBudgetAdvisoryExceeded = roleRuntimeLimits?.gemini_request_limit_exceeded === true;
        const manualFallbackPlanApplied = false;

        const geminiApiThrottled = Object.values(debate.role_diagnostics || {})
            .some((x) => Number(x?.last_status || 0) === 429);

        if (roleFallbackCount > 0) {
            const deferredRetry = await scheduleDeferredRetry('atomic-role-guard', geminiApiThrottled);
            await logTechnicalAudit(env, {
                level: 'WARN',
                scope: 'ai.committee',
                category: 'ai',
                subcategory: 'atomic_guard',
                status: 'SKIPPED',
                request_id: runId,
                message: 'atomic guard blocked execution because some roles failed',
                meta: {
                    trigger,
                    role_fallback_count: roleFallbackCount,
                    role_diagnostics: debate.role_diagnostics || {},
                    deferred_retry: deferredRetry || null
                }
            });
            return await persistSkipped('atomic guard blocked run: role failure', {
                role_fallback_count: roleFallbackCount,
                role_diagnostics: debate.role_diagnostics || {},
                deferred_retry: deferredRetry || null
            });
        }

        let executionSummary = null;
        let pendingBatch = { created: 0 };
        const plannedActionCount = Array.isArray(debate.execution_plan) ? debate.execution_plan.length : 0;
        const precheckSummary = await executeActions(
            env,
            debate.execution_plan,
            quoteMap,
            debate.risk_limits,
            true,
            { run_id: runId, phase: 'atomic_precheck' }
        );
        const atomicPrecheck = evaluateAtomicPrecheck(precheckSummary);
        if (!atomicPrecheck.ok) {
            await logTechnicalAudit(env, {
                level: 'WARN',
                scope: 'ai.committee',
                category: 'ai',
                subcategory: 'atomic_precheck',
                status: 'SKIPPED',
                request_id: runId,
                message: 'atomic precheck failed, skip all actions',
                meta: { atomic_precheck: atomicPrecheck, trigger }
            });
            return await persistSkipped('atomic precheck failed', {
                atomic_precheck: atomicPrecheck,
                execution_plan_size: plannedActionCount
            });
        }
        const executableActions = (precheckSummary?.results || [])
            .filter((x) => x?.ok === true && x?.dry_run === true)
            .map((x) => x.action)
            .filter((action) => ['PLACE_ORDER', 'CANCEL_ORDER', 'CANCEL_PENDING_BY_SYMBOL'].includes(String(action?.type || '').toUpperCase()));

        if (executableActions.length <= 0) {
            await logTechnicalAudit(env, {
                level: 'INFO',
                scope: 'ai.committee',
                category: 'ai',
                subcategory: 'atomic_precheck',
                status: 'SKIPPED',
                request_id: runId,
                message: 'precheck found no executable actions',
                meta: { atomic_precheck: atomicPrecheck, trigger, planned_action_count: plannedActionCount }
            });
            return await persistSkipped('no executable action after precheck', {
                atomic_precheck: atomicPrecheck,
                execution_plan_size: plannedActionCount
            });
        }

        if (executionMode === AI_EXECUTION_MODE.USER_CONFIRM && !dryRun) {
            pendingBatch = await createPendingActionBatch(
                env,
                runId,
                executableActions,
                'pending user confirmation'
            );
            executionSummary = {
                attempted: 0,
                succeeded: 0,
                failed: 0,
                placed: 0,
                cancelled: 0,
                results: (precheckSummary?.results || []).map((row) => {
                    if (row?.ok === true && row?.dry_run === true) {
                        return {
                            action: row.action,
                            pending: true,
                            reason: 'pending user confirmation'
                        };
                    }
                    return {
                        action: row?.action || {},
                        skipped: true,
                        reason: String(row?.reason || 'not eligible for pending confirmation')
                    };
                })
            };
        } else {
            executionSummary = dryRun
                ? precheckSummary
                : await executeActions(
                    env,
                    executableActions,
                    quoteMap,
                    debate.risk_limits,
                    false,
                    { run_id: runId }
                );
            if (!dryRun && executionSummary.placed > 0) {
                await matchOrders(env, { force: true });
            }
        }

        const managerKnowledge = dryRun
            ? { reports_saved: 0, experiences_saved: 0, notes_updated: 0 }
            : await persistManagerKnowledge(env, debate.manager, runId);
        const penalty = await applyPenalty(env, config, performance, executionSummary);
        const dailyKeys = buildDailyQuotaKeys(cstDate);
        const dailyGeminiRequests = await getDailyCounter(env, dailyKeys.gemini_requests);
        const dailyRunCount = await getDailyCounter(env, dailyKeys.run_count);
        const newsReferences = buildNewsReferences(rssItems, 10);
        const discussionDigest = buildDiscussionDigest(debate);

        const summary = {
            run_id: runId,
            trigger,
            skipped: false,
            dry_run: dryRun,
            manual_request: manualRequest,
            execution_mode: executionMode,
            requested_by: requestedBy,
            retry_count: retryCount,
            retry_origin_run_id: retryOriginRunId,
            pending_actions: pendingBatch.created,
            role_fallback_count: roleFallbackCount,
            gemini_api_throttled: geminiApiThrottled,
            gemini_budget_advisory_exceeded: geminiBudgetAdvisoryExceeded,
            manual_fallback_plan_applied: manualFallbackPlanApplied,
            manager_patch_applied: !!debate.patch_result?.patched,
            risk_limits: debate.risk_limits,
            manager_winner: String(debate.manager?.winner || 'mixed'),
            actions_total: executableActions.length,
            planned_actions_total: plannedActionCount,
            atomic_precheck: atomicPrecheck,
            execution: {
                attempted: executionSummary.attempted,
                succeeded: executionSummary.succeeded,
                failed: executionSummary.failed,
                placed: executionSummary.placed,
                cancelled: executionSummary.cancelled
            },
            manager_knowledge: managerKnowledge,
            penalty,
            performance: {
                day_pnl: Money.toYuan(performance.day_pnl_cent),
                day_pnl_pct: performance.day_pnl_pct
            },
            symbols: symbolUniverse.slice(0, 40),
            discovery: {
                news_symbol_count: newsSymbols.length,
                news_source_count: unique((rssItems || []).map((x) => String(x?.source || '').trim()).filter(Boolean)).length,
                stock_candidate_count: stockCandidates.length
            },
            news_references: newsReferences,
            discussion_digest: discussionDigest,
            quota: {
                cst_date: cstDate,
                run_count: dailyRunCount,
                run_limit: AUTO_DAILY_DISCUSSION_LIMIT,
                gemini_requests: dailyGeminiRequests,
                gemini_request_limit: config.gemini_max_requests,
                slot_key: String(dailyPermit?.quota?.slot_key || ''),
                slot_label: String(dailyPermit?.quota?.slot_label || ''),
                counted: dailyPermit?.counted === true
            }
        };

        await setMetaValue(env, META_KEYS.LAST_RUN, safeJsonStringify({
            ...summary,
            at: formatCstTimestamp()
        }));

        await persistRunRecord(env, {
            run_id: runId,
            trigger,
            status: 'SUCCESS',
            phase: dryRun
                ? 'dry_run'
                : (executionMode === AI_EXECUTION_MODE.USER_CONFIRM ? 'pending_confirm' : 'execute'),
            symbols: symbolUniverse,
            actions_total: executableActions.length,
            executed_total: executionSummary.succeeded,
            manager_penalty: penalty.manager_penalty,
            president_penalty: penalty.president_penalty,
            pnl_day: performance.day_pnl_cent,
            detail: {
                summary,
                execution_plan: executableActions,
                execution_plan_planned: debate.execution_plan,
                execution_results: executionSummary.results.slice(0, 20),
                manager_orders: debate.normalized_manager_orders,
                manager_knowledge: managerKnowledge,
                role_diagnostics: debate.role_diagnostics,
                dialogue: {
                    president: debate.president,
                    economist_1: debate.economist_1,
                    economist_2: debate.economist_2,
                    economist_1_rebuttal: debate.economist_1_rebuttal,
                    economist_2_rebuttal: debate.economist_2_rebuttal,
                    manager: debate.manager
                },
                input_excerpt: {
                    account: {
                        available: inputContext.account.available,
                        sellable_symbols: inputContext.account.sellable_symbols,
                        t1_locked_symbols: inputContext.account.t1_locked_symbols
                    },
                    holdings: accountContext.holdings.slice(0, 12),
                    pending_orders: accountContext.pending_orders.slice(0, 20),
                    order_history: accountContext.order_history.slice(0, 20),
                    holding_history: accountContext.holding_history.slice(0, 20),
                    trade_reports: accountContext.trade_reports.slice(0, 12),
                    trade_report_refs: reportRefs,
                    trade_experiences: accountContext.trade_experiences.slice(0, 20),
                    market_etfs: [...broadMarketEtfs, ...sectorMarketEtfs],
                    market_etfs_broad: broadMarketEtfs,
                    market_etfs_sector: sectorMarketEtfs,
                    quotes: Object.values(quoteMap).slice(0, 8),
                    news: rssItems.slice(0, 8),
                    candidate_pool: {
                        market_etfs: [...MARKET_ETF_SYMBOLS, ...SECTOR_ETF_SYMBOLS],
                        market_etfs_broad: MARKET_ETF_SYMBOLS,
                        market_etfs_sector: SECTOR_ETF_SYMBOLS,
                        from_news: newsSymbols.slice(0, 10),
                        from_stock_interface: stockCandidates.slice(0, 12),
                        merged: symbolUniverse.slice(0, 16)
                    }
                },
                news_references: newsReferences,
                discussion_digest: discussionDigest
            }
        });

        await logFinancialAudit(env, {
            event_type: 'AI_COMMITTEE',
            scope: 'ai.committee',
            category: 'ai',
            subcategory: 'run',
            tags: [
                'ai',
                'committee',
                trigger,
                dryRun ? 'dry_run' : 'execute',
                executionMode === AI_EXECUTION_MODE.USER_CONFIRM ? 'pending_confirm' : 'auto_execute'
            ],
            status: 'SUCCESS',
            amount: Number(performance.day_pnl_cent || 0),
            qty: Number(executionSummary.attempted || 0),
            message: 'ai committee run finished',
            meta: summary
        });

        return summary;
    } catch (error) {
        const errorText = String(error?.message || error || 'unknown error');
        const retryable = /429|rate limit|cloudflare|cooldown|temporar|timeout|throttled/i.test(errorText);
        let deferredRetry = null;
        if (retryable) {
            deferredRetry = await scheduleDeferredRetry(
                /cloudflare/i.test(errorText) ? 'auto-retry-cloudflare' : 'auto-retry-gemini',
                /429|rate limit|throttled/i.test(errorText)
            );
        }
        await logError(env, error, { run_id: runId, trigger }, 'ai.committee');
        try {
            await persistRunRecord(env, {
                run_id: runId,
                trigger,
                status: 'FAILED',
                phase: 'error',
                symbols: [],
                actions_total: 0,
                executed_total: 0,
                manager_penalty: parseIntSafe(await getMetaValue(env, META_KEYS.PENALTY_MANAGER), 0),
                president_penalty: parseIntSafe(await getMetaValue(env, META_KEYS.PENALTY_PRESIDENT), 0),
                pnl_day: 0,
                detail: {
                    error: errorText,
                    stack: String(error?.stack || '').slice(0, 3000),
                    deferred_retry: deferredRetry || null
                }
            });
        } catch {
            // ignore record failure
        }
        return {
            skipped: false,
            failed: true,
            run_id: runId,
            message: errorText,
            deferred_retry: deferredRetry || null
        };
    }
};


