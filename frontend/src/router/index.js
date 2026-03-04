import { createRouter, createWebHistory } from 'vue-router';
import { beginRouteLoading, failRouteLoading, finishRouteLoading } from '../stores/routeLoader';

const Login = () => import('../views/Login.vue');
const VisitorDashboard = () => import('../views/visitor/Dashboard.vue');
const AdminLayout = () => import('../views/admin/Layout.vue');

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    { path: '/', component: VisitorDashboard, meta: { loadingLabel: '加载公开看板' } },
    { path: '/login', component: Login, meta: { loadingLabel: '加载登录页' } },
    {
      path: '/admin',
      component: AdminLayout,
      meta: { requiresAuth: true, loadingLabel: '加载管理台' },
      children: [
        { path: '', redirect: '/admin/trade' },
        { path: 'trade', component: () => import('../views/admin/Trade.vue'), meta: { loadingLabel: '加载交易执行' } },
        { path: 'buy', redirect: '/admin/trade?side=BUY' },
        { path: 'sell', redirect: '/admin/trade?side=SELL' },
        { path: 'reports', component: () => import('../views/admin/Reports.vue'), meta: { loadingLabel: '加载交易报告' } },
        { path: 'orders', component: () => import('../views/admin/Cancel.vue'), meta: { loadingLabel: '加载订单中心' } },
        { path: 'holdings', component: () => import('../views/admin/Holdings.vue'), meta: { loadingLabel: '加载持仓资金' } },
        { path: 'ai', component: () => import('../views/admin/Ai.vue'), meta: { loadingLabel: '加载AI决策室' } },
        { path: 'risk', redirect: '/admin/audit' },
        { path: 'audit', component: () => import('../views/admin/Audit.vue'), meta: { loadingLabel: '加载审计风控' } }
      ]
    },
    { path: '/:pathMatch(.*)*', redirect: '/' }
  ]
});

router.beforeEach((to, from, next) => {
  beginRouteLoading(String(to.meta?.loadingLabel || '加载页面'));
  const token = localStorage.getItem('token');
  if (to.meta.requiresAuth && !token) {
    finishRouteLoading();
    next('/login');
    return;
  }
  next();
});

router.afterEach(() => {
  finishRouteLoading();
});

router.onError(() => {
  failRouteLoading();
});

export default router;
