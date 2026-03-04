import { defineStore } from 'pinia';
import api from '../api';
import { notifyInfo } from '../utils/notify';

interface Dashboard {
    total: number;
    market_cap: number;
    available: number;
    frozen: number;
    withdrawable?: number;
}

interface HoldingsItem {
    symbol: string;
    name: string;
    quantity: number;
    available_qty: number;
    avg_cost: number;
    current_price: number;
    total_cost: number;
}

interface OrderItem {
    id: number;
    symbol: string;
    name: string;
    side: 'BUY' | 'SELL';
    price: number;
    qty: number;
    filled_qty: number;
    status: string;
    time: string;
    created_at: string;
    remark?: string;
    strategy_tag?: string;
}

export const useMarketStore = defineStore('market', {
    state: () => ({
        token: localStorage.getItem('token') || '',
        dashboard: {
            total: 0,
            market_cap: 0,
            available: 0,
            frozen: 0,
            withdrawable: 0
        } as Dashboard,
        holdings: [] as HoldingsItem[],
        orders: [] as OrderItem[],
        currentTradeSymbol: '',
        loadingAdmin: false,
        lastUpdated: ''
    }),
    getters: {
        isLoggedIn: (state) => !!state.token,
        pendingOrders: (state) => state.orders.filter((o) => o.status === 'PENDING' || o.status === 'MATCHING')
    },
    actions: {
        setToken(t: string) {
            this.token = t;
            localStorage.setItem('token', t);
        },
        logout() {
            this.token = '';
            localStorage.removeItem('token');
            this.dashboard = { total: 0, market_cap: 0, available: 0, frozen: 0, withdrawable: 0 };
            this.holdings = [];
            this.orders = [];
            this.currentTradeSymbol = '';
        },
        async fetchAdminData(showNotify = false) {
            if (!this.token) return;

            this.loadingAdmin = true;
            try {
                const [dash, holds, ords] = await Promise.all([
                    api.getDashboard(),
                    api.getHoldings(),
                    api.getOrders()
                ]);
                this.dashboard = dash;
                this.holdings = holds;
                this.orders = ords;
                this.lastUpdated = new Date().toISOString();
                if (showNotify) notifyInfo('数据已刷新', '最新账户、持仓与委托数据已同步。');
            } catch (error: any) {
                if (error?.code === 401 || error?.code === 4010) {
                    this.logout();
                }
                throw error;
            } finally {
                this.loadingAdmin = false;
            }
        }
    }
});
