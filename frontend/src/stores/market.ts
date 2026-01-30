import { defineStore } from 'pinia';
import api from '../api';

export const useMarketStore = defineStore('market', {
    state: () => ({
        token: localStorage.getItem('token') || '',
        dashboard: { balance: 0, frozen: 0, available: 0, market_cap: 0, total: 0 } as any,
        holdings: [] as any[],
        orders: [] as any[],
        // 新增：用于页面间传递选中的股票代码
        currentTradeSymbol: '' 
    }),
    actions: {
        setToken(t: string) {
            this.token = t;
            localStorage.setItem('token', t);
        },
        async fetchAdminData() {
            if(!this.token) return;
            const [dash, holds, ords] = await Promise.all([
                api.getDashboard(),
                api.getHoldings(),
                api.getOrders()
            ]);
            this.dashboard = dash;
            this.holdings = holds;
            this.orders = ords;
        },
        logout() {
            this.token = '';
            localStorage.removeItem('token');
            this.dashboard = { balance: 0, frozen: 0, available: 0, total_market_cap: 0 };
        }
    }
});