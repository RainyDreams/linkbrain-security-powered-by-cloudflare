<template>
  <div class="reports-page">
    <!-- Editor -->
    <section class="surface editor-card">
      <header class="card-head">
        <div>
          <h3 class="t-title">写新报告</h3>
          <p class="t-sub">日报 / 周报 / 月报 · 经验会进入后续交易决策上下文</p>
        </div>
        <div class="head-actions">
          <button class="btn btn-ghost" @click="resetReportForm">清空</button>
          <button class="btn btn-primary" :disabled="savingReport" @click="saveReport">
            <span v-if="savingReport" class="spinner"></span>
            <span>{{ savingReport ? '保存中...' : (reportForm.id ? '更新报告' : '保存报告') }}</span>
          </button>
        </div>
      </header>

      <div class="editor-grid">
        <div class="field">
          <label class="field-label">报告类型</label>
          <div class="seg">
            <button v-for="opt in periodOptions" :key="opt.value"
              :class="['seg-btn', reportForm.period_type === opt.value ? 'is-active' : '']"
              @click="reportForm.period_type = opt.value">
              {{ opt.label }}
            </button>
          </div>
        </div>
        <div class="field">
          <label class="field-label">周期键 (可选)</label>
          <input v-model="reportForm.period_key" class="input" placeholder="自动生成, 如 2026-03-04 / 2026-W10 / 2026-03" />
        </div>
        <div class="field">
          <label class="field-label">标题 (可选)</label>
          <input v-model="reportForm.title" class="input" placeholder="今日复盘 / 第 10 周总结 / 三月月报" />
        </div>
      </div>

      <div class="field">
        <label class="field-label">总结</label>
        <textarea
          v-model="reportForm.summary"
          class="textarea"
          rows="5"
          maxlength="12000"
          placeholder="记录交易动作、得失、风控执行、偏差原因..."
        ></textarea>
      </div>

      <div class="field">
        <label class="field-label">经验</label>
        <textarea
          v-model="reportForm.experience"
          class="textarea"
          rows="3"
          maxlength="4000"
          placeholder="一句可复用的话, 例: 顺势加仓可慢, 逆势减仓必须快。"
        ></textarea>
      </div>
    </section>

    <!-- Experience library -->
    <section class="surface exp-card">
      <header class="card-head">
        <div>
          <h3 class="t-title">经验库</h3>
          <p class="t-sub">高权重经验会被 AI 决策优先参考</p>
        </div>
      </header>

      <div class="exp-input">
        <input
          v-model="experienceForm.content"
          class="input"
          maxlength="600"
          placeholder="写一句可复用的经验..."
        />
        <input
          v-model.number="experienceForm.weight"
          type="number"
          min="0"
          max="100"
          class="input input-mono weight-input"
          placeholder="权重"
        />
        <button class="btn btn-primary" :disabled="savingExperience" @click="saveExperience">
          {{ savingExperience ? '保存中...' : '加入' }}
        </button>
      </div>

      <div v-if="experiences.length === 0" class="empty">
        <span class="empty-title">暂无经验</span>
        <span class="text-faint">写入的每条经验都会影响后续 AI 决策</span>
      </div>
      <div v-else class="exp-grid">
        <article v-for="item in experiences" :key="item.id" class="exp-item">
          <div class="exp-top">
            <span class="tag tag-brand">权重 {{ item.weight }}</span>
            <button class="btn btn-ghost btn-sm" @click="removeExperience(item.id)">删除</button>
          </div>
          <p>{{ item.content }}</p>
        </article>
      </div>
    </section>

    <!-- Historical reports -->
    <section class="surface history-card">
      <header class="card-head">
        <div>
          <h3 class="t-title">历史报告</h3>
          <p class="t-sub">{{ reports.length }} 条</p>
        </div>
      </header>

      <div v-if="reports.length === 0" class="empty">
        <span class="empty-title">暂无报告</span>
      </div>
      <div v-else class="report-grid">
        <article v-for="item in reports" :key="item.id" class="report-item">
          <header class="report-top">
            <span :class="['tag', typeTagClass(item.period_type)]">{{ typeLabel(item.period_type) }}</span>
            <span class="mono text-faint">{{ item.period_key || '--' }}</span>
            <button class="btn btn-ghost btn-sm" @click="editReport(item)">编辑</button>
          </header>
          <h4>{{ item.title || '(未命名报告)' }}</h4>
          <p class="report-summary">{{ item.summary || '--' }}</p>
          <p v-if="item.experience" class="report-exp"><strong>经验：</strong>{{ item.experience }}</p>
          <footer class="report-foot">
            <span class="mono text-faint">{{ item.created_at_cst || '--' }}</span>
          </footer>
        </article>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import api from '../../api';
import { notifyError, notifySuccess } from '../../utils/notify';

const reports = ref<any[]>([]);
const experiences = ref<any[]>([]);
const savingReport = ref(false);
const savingExperience = ref(false);

const reportForm = reactive({
  id: 0,
  period_type: 'DAILY' as 'DAILY' | 'WEEKLY' | 'MONTHLY',
  period_key: '',
  title: '',
  summary: '',
  experience: ''
});

const experienceForm = reactive({
  content: '',
  weight: 70
});

const periodOptions = [
  { value: 'DAILY', label: '日报' },
  { value: 'WEEKLY', label: '周报' },
  { value: 'MONTHLY', label: '月报' }
] as const;

const typeLabel = (type: string) => {
  const raw = String(type || '').toUpperCase();
  if (raw === 'DAILY') return '日报';
  if (raw === 'WEEKLY') return '周报';
  if (raw === 'MONTHLY') return '月报';
  return raw || '--';
};
const typeTagClass = (type: string) => {
  const raw = String(type || '').toUpperCase();
  if (raw === 'DAILY') return 'tag-info';
  if (raw === 'WEEKLY') return 'tag-warn';
  if (raw === 'MONTHLY') return 'tag-brand';
  return 'tag-neutral';
};

const resetReportForm = () => {
  reportForm.id = 0;
  reportForm.period_type = 'DAILY';
  reportForm.period_key = '';
  reportForm.title = '';
  reportForm.summary = '';
  reportForm.experience = '';
};

const loadReports = async () => {
  const res: any = await api.getTradeReports({ page: 1, page_size: 60 });
  reports.value = Array.isArray(res?.items) ? res.items : [];
};
const loadExperiences = async () => {
  const res: any = await api.getTradeExperiences({ page: 1, page_size: 120 });
  experiences.value = Array.isArray(res?.items) ? res.items : [];
};
const refresh = async () => {
  await Promise.all([loadReports(), loadExperiences()]);
};
const saveReport = async () => {
  if (!reportForm.summary.trim() && !reportForm.experience.trim()) {
    notifyError('内容为空', '总结和经验至少填写一项。');
    return;
  }
  savingReport.value = true;
  try {
    await api.saveTradeReport({
      id: reportForm.id || undefined,
      period_type: reportForm.period_type,
      period_key: reportForm.period_key.trim() || undefined,
      title: reportForm.title.trim() || undefined,
      summary: reportForm.summary.trim(),
      experience: reportForm.experience.trim()
    });
    notifySuccess('报告已保存', reportForm.id ? '报告已更新。' : '报告已创建。');
    resetReportForm();
    await loadReports();
  } finally { savingReport.value = false; }
};
const editReport = (item: any) => {
  reportForm.id = Number(item?.id || 0);
  reportForm.period_type = (String(item?.period_type || 'DAILY').toUpperCase() as any);
  reportForm.period_key = String(item?.period_key || '');
  reportForm.title = String(item?.title || '');
  reportForm.summary = String(item?.summary || '');
  reportForm.experience = String(item?.experience || '');
  window.scrollTo({ top: 0, behavior: 'smooth' });
};
const saveExperience = async () => {
  const content = experienceForm.content.trim();
  if (!content) {
    notifyError('经验为空', '请输入至少一句经验。');
    return;
  }
  savingExperience.value = true;
  try {
    await api.saveTradeExperience({
      content,
      weight: Math.max(0, Math.min(100, Number(experienceForm.weight || 0)))
    });
    experienceForm.content = '';
    experienceForm.weight = 70;
    notifySuccess('经验已加入', '后续交易会自动参考。');
    await loadExperiences();
  } finally { savingExperience.value = false; }
};
const removeExperience = async (id: number) => {
  if (!window.confirm('确认删除该经验？')) return;
  await api.saveTradeExperience({ id, delete: true });
  await loadExperiences();
  notifySuccess('已删除经验');
};

onMounted(refresh);
</script>

<style scoped>
.reports-page { display: flex; flex-direction: column; gap: 14px; max-width: 1280px; }

.editor-card, .exp-card, .history-card { padding: 0; }
.card-head { padding: 14px 18px; border-bottom: 1px solid var(--line); display: flex; justify-content: space-between; align-items: center; gap: 10px; }
.t-title { font-size: 14px; font-weight: 700; color: var(--text-strong); }
.t-sub { font-size: 12px; color: var(--text-muted); margin-top: 2px; }
.head-actions { display: flex; gap: 6px; }

.editor-grid { padding: 14px 18px; display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 10px; border-bottom: 1px solid var(--line-soft); }
.editor-card .field:not(.editor-grid .field) { padding: 0 18px 14px; }
.editor-card .field:last-of-type { padding-bottom: 18px; border-bottom: 1px solid var(--line-soft); }

.seg { display: inline-flex; padding: 2px; background: var(--bg-inset); border-radius: var(--r-sm); gap: 2px; }
.seg-btn {
  height: 30px; padding: 0 14px; border: 0; background: transparent;
  font-size: 12.5px; font-weight: 600; color: var(--text-soft); border-radius: var(--r-xs);
  cursor: pointer;
}
.seg-btn.is-active { background: var(--bg-elev); color: var(--text-strong); box-shadow: var(--shadow-1); }

@media (max-width: 780px) { .editor-grid { grid-template-columns: 1fr; } }

.exp-input { padding: 14px 18px; display: grid; grid-template-columns: 1fr 110px auto; gap: 8px; border-bottom: 1px solid var(--line-soft); }
.weight-input { text-align: center; }
@media (max-width: 720px) { .exp-input { grid-template-columns: 1fr; } }

.exp-grid { padding: 14px 18px; display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 8px; }
.exp-item { padding: 10px 12px; border: 1px solid var(--line); border-radius: var(--r-sm); background: var(--bg-subtle); display: flex; flex-direction: column; gap: 6px; }
.exp-top { display: flex; justify-content: space-between; align-items: center; }
.exp-item p { font-size: 12.5px; color: var(--text); line-height: 1.55; }

.history-card { padding: 0; }
.report-grid { padding: 14px 18px; display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 10px; }
.report-item { padding: 12px 14px; border: 1px solid var(--line); border-radius: var(--r-md); background: var(--bg-elev); display: flex; flex-direction: column; gap: 6px; }
.report-top { display: flex; justify-content: space-between; align-items: center; gap: 6px; }
.report-item h4 { font-size: 13.5px; font-weight: 700; color: var(--text-strong); }
.report-summary { font-size: 12.5px; color: var(--text-soft); line-height: 1.55; white-space: pre-wrap; max-height: 4.6em; overflow: hidden; }
.report-exp { font-size: 12px; color: var(--text-muted); line-height: 1.5; padding-top: 4px; border-top: 1px dashed var(--line-soft); }
.report-foot { display: flex; justify-content: space-between; align-items: center; font-size: 11px; color: var(--text-faint); }
</style>
