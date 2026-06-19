import axios from 'axios';
import { resolveErrorGuide } from '../utils/errorGuide';
import { notifyError } from '../utils/notify';

interface ApiEnvelope<T = any> {
    code: number;
    msg: string;
    data: T;
}

export interface ApiError {
    code: number;
    msg: string;
}

const toApiError = (code: number, msg: string): ApiError => ({ code, msg });

const api = axios.create({
    baseURL: '/api',
    timeout: 15000
});

api.interceptors.request.use((config) => {
    const token = localStorage.getItem('token');
    if (token) config.headers.Authorization = `Bearer ${token}`;
    return config;
});

api.interceptors.response.use(
    (res) => {
        const payload: ApiEnvelope = res.data;
        if (payload && payload.code === 0) return payload.data;

        const code = payload?.code ?? 5000;
        const msg = payload?.msg || '请求失败';
        const guide = resolveErrorGuide(code, msg);
        notifyError(guide.title, guide.message, guide.hint, code);
        return Promise.reject(toApiError(code, msg));
    },
    (err) => {
        const code = err?.response?.data?.code || err?.response?.status || 5000;
        const msg = err?.response?.data?.msg || err?.message || '网络异常';
        const guide = resolveErrorGuide(code, msg);
        notifyError(guide.title, guide.message, guide.hint, code);
        return Promise.reject(toApiError(code, msg));
    }
);

export default {
    login: (password: string) => api.post('/auth/login', { password }),
    getQuote: (symbol: string) => api.get('/public/quote', { params: { symbol } }),
    getPublicOverview: () => api.get('/public/overview'),
    getComments: () => api.get('/public/comments'),
    comment: (data: { nickname?: string; content: string }) => api.post('/public/comments', data),

    getDashboard: () => api.get('/admin/dashboard'),
    trade: (data: {
        symbol: string;
        side: 'BUY' | 'SELL';
        price: number;
        qty: number;
        remark?: string;
        strategy_tag?: string;
    }) => api.post('/admin/trade', data),
    updateOrderNote: (data: { order_id: number; remark?: string; strategy_tag?: string }) => api.post('/admin/order-note', data),
    getMarketEtfs: (admin = false) => api.get(admin ? '/admin/market-etfs' : '/public/market-etfs'),
    cancel: (order_id: number) => api.post('/admin/cancel', { order_id }),
    match: (data?: { reason?: string }) => api.post('/admin/match', data || {}),
    initSystem: (confirm: 'RESET' | 'SYNC' = 'RESET') => api.post('/admin/init', { confirm }),
    getIntegrity: () => api.get('/admin/integrity'),
    getOrders: (params?: { debug?: 0 | 1 }) => api.get('/admin/orders', { params: params || {} }),
    getHoldings: () => api.get('/admin/holdings'),
    transfer: (data: { amount: number; type: 'IN' | 'OUT'; request_id?: string }) => api.post('/admin/transfer', data),
    getAiState: () => api.get('/admin/ai/state'),
    getAiPrompts: () => api.get('/admin/ai/prompts'),
    updateAiPrompt: (data: { role: string; prompt: string }) => api.post('/admin/ai/prompts', data),
    getAiConfig: () => api.get('/admin/ai/config'),
    updateAiConfig: (data: {
        enabled?: boolean;
        interval_min?: number;
        daily_run_target?: number;
        gemini_max_requests?: number;
        manager_penalty?: number;
        president_penalty?: number;
        reset_penalty?: boolean;
        watchlist?: string | string[];
        rss_feeds?: string | string[];
        clear_rss_cache?: boolean;
        clear_stock_cache?: boolean;
        clear_ai_cache?: boolean;
    }) => api.post('/admin/ai/config', data),
    runAi: (data?: {
        force?: boolean;
        dry_run?: boolean;
        reason?: string;
        immediate?: boolean;
        manual_request?: boolean;
        review_only?: boolean;
        execution_mode?: 'AUTO_EXECUTE' | 'USER_CONFIRM';
    }) => api.post('/admin/ai/run', data || {}),
    getAiRuns: (params?: {
        run_id?: string;
        page?: number;
        page_size?: number;
        include_detail?: 0 | 1;
    }) => api.get('/admin/ai/runs', { params }),
    getAiTasks: (params?: {
        status?: 'PENDING' | 'RUNNING' | 'DONE' | 'FAILED';
        page?: number;
        page_size?: number;
        include_result?: 0 | 1;
    }) => api.get('/admin/ai/tasks', { params }),
    getAiPendingActions: (params?: {
        status?: 'PENDING' | 'EXECUTED' | 'REJECTED' | 'FAILED';
        page?: number;
        page_size?: number;
    }) => api.get('/admin/ai/pending', { params }),
    confirmAiPendingActions: (data: { ids: number[] }) => api.post('/admin/ai/pending/confirm', data),
    rejectAiPendingActions: (data: { ids: number[]; reason?: string }) => api.post('/admin/ai/pending/reject', data),
    getAuditLogs: (params?: {
        type?: 'technical' | 'financial' | 'all';
        page?: number;
        page_size?: number;
        keyword?: string;
        exact?: 0 | 1;
        order_id?: number;
        symbol?: string;
        request_id?: string;
        scope?: string;
        status?: string;
        category?: string;
        subcategory?: string;
        tag?: string;
        amount_min?: number;
        amount_max?: number;
        time_from?: string;
        time_to?: string;
    }) => api.get('/admin/audit', { params }),
    getTradeReports: (params?: {
        period_type?: 'DAILY' | 'WEEKLY' | 'MONTHLY';
        page?: number;
        page_size?: number;
    }) => api.get('/admin/trade-reports', { params }),
    saveTradeReport: (data: {
        id?: number;
        period_type: 'DAILY' | 'WEEKLY' | 'MONTHLY';
        period_key?: string;
        title?: string;
        summary?: string;
        experience?: string;
        source?: string;
    }) => api.post('/admin/trade-reports', data),
    getTradeExperiences: (params?: {
        keyword?: string;
        page?: number;
        page_size?: number;
    }) => api.get('/admin/trade-experiences', { params }),
    saveTradeExperience: (data: {
        id?: number;
        content?: string;
        weight?: number;
        source?: string;
        delete?: boolean;
    }) => api.post('/admin/trade-experiences', data)
};
