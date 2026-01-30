import axios from 'axios';

const api = axios.create({
    baseURL: '/api',
    timeout: 10000
});

api.interceptors.request.use(config => {
    const token = localStorage.getItem('token');
    if (token) config.headers.Authorization = `Bearer ${token}`;
    return config;
});

api.interceptors.response.use(
    res => {
        const { code, msg, data } = res.data;
        if (code === 0) return data;
        // 统一错误处理
        if(code === 4001) alert("资金不足");
        else if(code === 4002) alert("持仓不足(T+1限制)");
        else alert(msg || '系统错误');
        return Promise.reject(msg);
    },
    err => Promise.reject(err)
);

export default {
    login: (password: string) => api.post('/auth/login', { password }),
    getPublicOverview: () => api.get('/public/overview'),
    comment: (data: any) => api.post('/public/comment', data),
    
    // Admin
    getDashboard: () => api.get('/admin/dashboard'),
    trade: (data: {symbol: string, side: string, price: number, qty: number}) => api.post('/admin/trade', data),
    cancel: (order_id: number) => api.post('/admin/cancel', { order_id }),
    getOrders: () => api.get('/admin/orders'),
    getHoldings: () => api.get('/admin/holdings'),
    transfer: (data: { amount: number, type: 'IN' | 'OUT' }) => api.post('/admin/transfer', data),
};