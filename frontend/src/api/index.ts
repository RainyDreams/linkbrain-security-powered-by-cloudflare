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
    trade: (data: { symbol: string; side: 'BUY' | 'SELL'; price: number; qty: number }) => api.post('/admin/trade', data),
    cancel: (order_id: number) => api.post('/admin/cancel', { order_id }),
    getOrders: () => api.get('/admin/orders'),
    getHoldings: () => api.get('/admin/holdings'),
    transfer: (data: { amount: number; type: 'IN' | 'OUT'; request_id?: string }) => api.post('/admin/transfer', data)
};
