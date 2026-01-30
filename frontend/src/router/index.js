import { createRouter, createWebHistory } from 'vue-router'
import Login from '../views/Login.vue'
import VisitorDashboard from '../views/visitor/Dashboard.vue'
import AdminLayout from '../views/admin/Layout.vue'

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    { path: '/', component: VisitorDashboard },
    { path: '/login', component: Login },
    { 
      path: '/admin', 
      component: AdminLayout,
      meta: { requiresAuth: true },
      children: [
        { path: 'buy', component: () => import('../views/admin/Trade.vue') },
        { path: 'sell', component: () => import('../views/admin/Trade.vue') },
        { path: 'holdings', component: () => import('../views/admin/Holdings.vue') },
        { path: 'cancel', component: () => import('../views/admin/Cancel.vue') },
      ]
    }
  ]
})

router.beforeEach((to, from, next) => {
    const token = localStorage.getItem('token');
    if (to.meta.requiresAuth && !token) next('/login');
    else next();
});

export default router