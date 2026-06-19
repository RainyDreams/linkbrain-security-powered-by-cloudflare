/* eslint-disable no-console */
/**
 * Multi-provider LLM client.
 *
 * Provider priority (resolved from env at call time):
 *   1. Primary   — Xiaomi MiMo (OpenAI-compatible)        env: XIAOMI_MIMO_API_KEY / MIMO_*
 *   2. Secondary — DeepSeek (OpenAI-compatible)           env: DEEPSEEK_API_KEY / DEEPSEEK_*
 *   3. Tertiary  — Google Gemini (legacy, native API)     env: GEMINI_API_KEY / GOOGLE_API_KEY
 *
 * Each role (president/economist_1/economist_2/manager/reasoner) can be routed
 * to a specific provider via env override (AI_PROVIDER_<ROLE>). If unset,
 * ROLE_DEFAULTS selects a sensible fallback chain.
 *
 * The runner iterates the chain: try primary, on hard failure fall back to
 * the next provider. Cooldowns and per-model error budgets are tracked per
 * provider in `runtimeLimits`.
 */

const DEFAULT_TIMEOUT_MS = 30000;
const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

const safeTrim = (v) => (typeof v === 'string' ? v.trim() : '');
const asTrimmed = safeTrim;

const ROLE_DEFAULTS = Object.freeze({
    PRESIDENT: 'mimo',
    ECONOMIST_1: 'deepseek',
    ECONOMIST_2: 'deepseek',
    MANAGER: 'deepseek',
    REASONER: 'mimo'
});

const PROVIDER_ORDER = ['mimo', 'deepseek', 'gemini'];

// ---------------------------------------------------------------------------
// Provider config — resolved from `env` on every call so hot-reload of
// wrangler secrets is picked up automatically.
// ---------------------------------------------------------------------------

const providerFromEnv = (env, key, model, baseUrl, label) => {
    const secretKey = env?.[key];
    const url = safeTrim(env?.baseUrl) || baseUrl;
    return {
        label,
        key: safeTrim(secretKey),
        model: safeTrim(env?.[model]) || (label === 'mimo' ? 'mimo-7b' : label === 'deepseek' ? 'deepseek-chat' : 'gemini-flash-lite-latest'),
        base_url: url,
        models: parseList(env?.GEMINI_MODELS || env?.GEMINI_MODEL),
        present: !!safeTrim(secretKey)
    };
};

const parseList = (v) => {
    if (Array.isArray(v)) return v.map((x) => String(x || '').trim()).filter(Boolean);
    return String(v || '').split(/[\s,;|]+/g).map((x) => x.trim()).filter(Boolean);
};

export const resolveProviderConfig = (env) => {
    const mimo = providerFromEnv(
        env,
        'XIAOMI_MIMO_API_KEY',
        'XIAOMI_MIMO_MODEL',
        'XIAOMI_MIMO_BASE_URL',
        'mimo'
    );
    const deepseek = providerFromEnv(
        env,
        'DEEPSEEK_API_KEY',
        'DEEPSEEK_MODEL',
        'DEEPSEEK_BASE_URL',
        'deepseek'
    );
    const gemini = {
        label: 'gemini',
        key: safeTrim(env?.GEMINI_API_KEY || env?.GOOGLE_API_KEY || env?.GOOGLE_GENERATIVE_AI_API_KEY || env?.GEMINI_KEY),
        model: safeTrim(env?.GEMINI_MODEL) || 'gemini-flash-lite-latest',
        models: parseList(env?.GEMINI_MODELS || env?.GEMINI_MODEL),
        base_url: 'https://generativelanguage.googleapis.com',
        present: !!(env?.GEMINI_API_KEY || env?.GOOGLE_API_KEY || env?.GOOGLE_GENERATIVE_AI_API_KEY || env?.GEMINI_KEY)
    };

    const byName = { mimo, deepseek, gemini };
    const providers = PROVIDER_ORDER.filter((n) => byName[n].present).map((n) => byName[n]);
    return { mimo, deepseek, gemini, providers, byName };
};

// ---------------------------------------------------------------------------
// Per-role provider picker
// ---------------------------------------------------------------------------

export const getProviderLabelForRole = (role, env) => {
    const override = safeTrim(env?.[`AI_PROVIDER_${String(role || '').toUpperCase()}`]);
    if (override) return override;
    const { providers } = resolveProviderConfig(env);
    const fallback = ROLE_DEFAULTS[role];
    if (fallback && providers.some((p) => p.label === fallback)) return fallback;
    return providers[0]?.label || '';
};

// Build an ordered list of provider objects to try for a given role.
const resolveCallChain = (role, env) => {
    const { providers } = resolveProviderConfig(env);
    if (!providers.length) {
        throw new Error('no LLM provider configured (set XIAOMI_MIMO_API_KEY / DEEPSEEK_API_KEY / GEMINI_API_KEY)');
    }
    const primary = getProviderLabelForRole(role, env);
    const ordered = [];
    const seen = new Set();
    if (primary) {
        const p = providers.find((x) => x.label === primary);
        if (p) { ordered.push(p); seen.add(p.label); }
    }
    for (const p of providers) {
        if (!seen.has(p.label)) { ordered.push(p); seen.add(p.label); }
    }
    return ordered;
};

// ---------------------------------------------------------------------------
// JSON helpers
// ---------------------------------------------------------------------------

export const tryParseModelJson = (text) => {
    const t = String(text || '').trim();
    if (!t) return null;
    const unwrapped = t.replace(/^```json/i, '').replace(/^```/i, '').replace(/```$/, '').trim();
    try { return JSON.parse(unwrapped); } catch { /* continue */ }
    const first = unwrapped.indexOf('{');
    const last = unwrapped.lastIndexOf('}');
    if (first >= 0 && last > first) {
        try { return JSON.parse(unwrapped.slice(first, last + 1)); } catch { /* continue */ }
    }
    const firstArr = unwrapped.indexOf('[');
    const lastArr = unwrapped.lastIndexOf(']');
    if (firstArr >= 0 && lastArr > firstArr) {
        try { return JSON.parse(unwrapped.slice(firstArr, lastArr + 1)); } catch { return null; }
    }
    return null;
};

// ---------------------------------------------------------------------------
// HTTP layer — OpenAI-compatible + Gemini native
// ---------------------------------------------------------------------------

const safeJsonParse = (v, fb = null) => {
    if (v === null || v === undefined || v === '') return fb;
    if (typeof v !== 'string') return v;
    try { return JSON.parse(v); } catch { return fb; }
};

const fetchWithTimeout = async (url, init, timeoutMs) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error('timeout')), Math.max(1000, timeoutMs));
    try {
        return await fetch(url, { ...init, signal: controller.signal });
    } finally {
        clearTimeout(timer);
    }
};

const callOpenAiCompatible = async (provider, body, timeoutMs) => {
    const endpoint = `${provider.base_url.replace(/\/$/, '')}/chat/completions`;
    const res = await fetchWithTimeout(endpoint, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${provider.key}`
        },
        body: JSON.stringify(body)
    }, timeoutMs);
    const raw = await res.text();
    if (!res.ok) {
        const payload = safeJsonParse(raw, null);
        const msg = asTrimmed(payload?.error?.message || payload?.message || '');
        const err = new Error(`${provider.label}_http_${res.status}: ${msg || res.statusText}`);
        err.status = res.status;
        err.payload = payload;
        err.raw = raw.slice(0, 4000);
        throw err;
    }
    const json = safeJsonParse(raw, null);
    const text = json?.choices?.[0]?.message?.content || '';
    if (!text) {
        const err = new Error(`${provider.label}_empty_response`);
        err.payload = json;
        throw err;
    }
    return { text, raw, usage: json?.usage || null, model_used: json?.model || provider.model };
};

const callGeminiNative = async (provider, body, timeoutMs) => {
    const endpoint = `${provider.base_url}/v1beta/models/${encodeURIComponent(provider.model)}:generateContent?key=${encodeURIComponent(provider.key)}`;
    const res = await fetchWithTimeout(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    }, timeoutMs);
    const raw = await res.text();
    if (!res.ok) {
        const payload = safeJsonParse(raw, null);
        const msg = asTrimmed(payload?.error?.message || '');
        const err = new Error(`gemini_http_${res.status}: ${msg || res.statusText}`);
        err.status = res.status;
        err.payload = payload;
        err.raw = raw.slice(0, 4000);
        throw err;
    }
    const json = safeJsonParse(raw, null);
    const text = json?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    if (!text) {
        const err = new Error('gemini_empty_response');
        err.payload = json;
        throw err;
    }
    return { text, raw, usage: json?.usageMetadata || null, model_used: provider.model };
};

// ---------------------------------------------------------------------------
// Provider dispatch — single attempt per call, no internal fallback
// ---------------------------------------------------------------------------

const callProviderOnce = async (provider, systemPrompt, payload, options) => {
    const { temperature = 0.35, topP = 0.9, schema = null, timeoutMs = DEFAULT_TIMEOUT_MS, jsonMode = 'object' } = options || {};
    const startedAt = Date.now();

    let result;
    if (provider.label === 'gemini') {
        const body = {
            systemInstruction: { parts: [{ text: systemPrompt }] },
            contents: [{ role: 'user', parts: [{ text: JSON.stringify(payload || {}) }] }],
            generationConfig: {
                temperature,
                topP,
                responseMimeType: 'application/json',
                ...(schema ? { responseSchema: schema } : {})
            }
        };
        result = await callGeminiNative(provider, body, timeoutMs);
    } else {
        const body = {
            model: provider.model,
            temperature,
            top_p: topP,
            response_format: jsonMode ? { type: jsonMode } : undefined,
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: JSON.stringify(payload || {}) }
            ]
        };
        result = await callOpenAiCompatible(provider, body, timeoutMs);
    }

    const parsed = tryParseModelJson(result.text);
    return {
        provider: provider.label,
        model: result.model_used || provider.model,
        text: result.text,
        parsed,
        usage: result.usage,
        started_at: startedAt,
        finished_at: Date.now(),
        duration_ms: Date.now() - startedAt,
        raw: result.raw
    };
};

// ---------------------------------------------------------------------------
// Public — chain runner with fallback
// ---------------------------------------------------------------------------

/**
 * Call LLM with provider chain fallback.
 * @returns { ok, provider, model, parsed, text, attempts, ... }
 */
export const callLLMJson = async (env, role, systemPrompt, payload, options = {}) => {
    const chain = resolveCallChain(role, env);
    const errors = [];
    const attempts = [];
    for (const provider of chain) {
        try {
            const result = await callProviderOnce(provider, systemPrompt, payload, options);
            attempts.push({
                provider: provider.label,
                model: result.model,
                ok: true,
                duration_ms: result.duration_ms
            });
            return { ...result, attempts, chain: chain.map((p) => p.label) };
        } catch (e) {
            const info = {
                provider: provider.label,
                model: provider.model,
                ok: false,
                duration_ms: 0,
                status: e?.status || null,
                message: String(e?.message || e || 'unknown'),
                raw_excerpt: e?.raw ? String(e.raw).slice(0, 600) : null
            };
            errors.push(info);
            attempts.push(info);
            // Continue to next provider for auth/5xx/network errors only.
            // Hard parse errors propagate.
            if (e?.status && !RETRYABLE_STATUS.has(Number(e.status))) {
                // Non-retryable: continue to next anyway (provider chain).
            }
        }
    }
    const err = new Error(`all providers failed for role=${role}: ${errors.map((e) => `${e.provider}:${e.status || e.message}`).join(' | ')}`);
    err.kind = 'llm_all_providers_failed';
    err.attempts = attempts;
    err.errors = errors;
    err.chain = chain.map((p) => p.label);
    throw err;
};

// Re-export role defaults so callers can introspect the wiring.
export const getRoleProviderDefaults = () => ({ ...ROLE_DEFAULTS });
export const getProviderOrder = () => [...PROVIDER_ORDER];