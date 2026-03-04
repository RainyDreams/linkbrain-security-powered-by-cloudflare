<template>
  <div class="reports-page">
    <section class="glass-card report-editor">
      <div class="head-row">
        <div>
          <h2 class="panel-title">交易报告</h2>
          <p class="panel-sub">支持日报/周报/月报；经验会进入后续交易决策上下文。</p>
        </div>
        <button class="btn-solid btn-ghost" :disabled="loading" @click="refreshAll">
          {{ loading ? '刷新中...' : '刷新' }}
        </button>
      </div>

      <div class="editor-grid">
        <label class="field-block">
          <span class="field-label">报告类型</span>
          <select v-model="reportForm.period_type" class="field-input">
            <option value="DAILY">日报</option>
            <option value="WEEKLY">周报</option>
            <option value="MONTHLY">月报</option>
          </select>
        </label>
        <label class="field-block">
          <span class="field-label">周期键（可选）</span>
          <input v-model="reportForm.period_key" class="field-input" placeholder="自动生成，如 2026-03-04 / 2026-W10 / 2026-03" />
        </label>
        <label class="field-block">
          <span class="field-label">标题（可选）</span>
          <input v-model="reportForm.title" class="field-input" placeholder="今日复盘 / 第10周总结 / 三月月报" />
        </label>
      </div>

      <label class="field-block">
        <span class="field-label">总结</span>
        <textarea
          v-model="reportForm.summary"
          rows="4"
          maxlength="12000"
          class="field-input field-textarea"
          placeholder="记录交易动作、得失、风控执行、偏差原因..."
        ></textarea>
      </label>

      <label class="field-block">
        <span class="field-label">经验（言简意赅，一语道破）</span>
        <textarea
          v-model="reportForm.experience"
          rows="3"
          maxlength="4000"
          class="field-input field-textarea"
          placeholder="例如：顺势加仓可以慢，逆势减仓必须快。"
        ></textarea>
      </label>

      <div class="action-row">
        <button class="btn-solid btn-primary" :disabled="savingReport" @click="saveReport">
          {{ savingReport ? '保存中...' : (reportForm.id ? '更新报告' : '保存报告') }}
        </button>
        <button class="btn-solid btn-ghost" @click="resetReportForm">清空</button>
      </div>
    </section>

    <section class="glass-card experience-panel">
      <div class="head-row">
        <h3 class="panel-title">经验库</h3>
        <span class="status-chip">{{ experiences.length }} 条</span>
      </div>
      <div class="experience-editor">
        <input
          v-model="experienceForm.content"
          maxlength="600"
          class="field-input"
          placeholder="写一句经验：简短、可执行、可复用"
        />
        <input
          v-model.number="experienceForm.weight"
          type="number"
          min="0"
          max="100"
          class="field-input weight-input"
          placeholder="权重"
        />
        <button class="btn-solid btn-primary" :disabled="savingExperience" @click="saveExperience">
          {{ savingExperience ? '保存中...' : '加入经验库' }}
        </button>
      </div>
      <div v-if="experiences.length === 0" class="empty-line">暂无经验</div>
      <div v-else class="experience-grid">
        <article v-for="item in experiences" :key="item.id" class="experience-item">
          <div class="experience-top">
            <span class="weight-chip">权重 {{ item.weight }}</span>
            <button class="mini-delete" @click="removeExperience(item.id)">删除</button>
          </div>
          <p>{{ item.content }}</p>
        </article>
      </div>
    </section>

    <section class="glass-card report-list">
      <div class="head-row">
        <h3 class="panel-title">历史报告</h3>
        <span class="status-chip">{{ reports.length }} 条</span>
      </div>
      <div v-if="reports.length === 0" class="empty-line">暂无报告</div>
      <div v-else class="report-grid">
        <article v-for="item in reports" :key="item.id" class="report-card">
          <div class="report-head">
            <span class="report-type">{{ typeLabel(item.period_type) }}</span>
            <strong>{{ item.period_key || '--' }}</strong>
          </div>
          <h4>{{ item.title || '(未命名报告)' }}</h4>
          <p class="report-summary">{{ item.summary || '--' }}</p>
          <p class="report-exp"><strong>经验：</strong>{{ item.experience || '--' }}</p>
          <div class="report-foot">
            <span>{{ item.created_at_cst || '--' }}</span>
            <button class="btn-solid btn-ghost compact" @click="editReport(item)">编辑</button>
          </div>
        </article>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { reactive, ref } from 'vue';
import api from '../../api';
import { notifyError, notifySuccess } from '../../utils/notify';

const loading = ref(false);
const savingReport = ref(false);
const savingExperience = ref(false);

const reports = ref<any[]>([]);
const experiences = ref<any[]>([]);

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

const typeLabel = (type: string) => {
  const raw = String(type || '').toUpperCase();
  if (raw === 'DAILY') return '日报';
  if (raw === 'WEEKLY') return '周报';
  if (raw === 'MONTHLY') return '月报';
  return raw || '--';
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

const refreshAll = async () => {
  loading.value = true;
  try {
    await Promise.all([loadReports(), loadExperiences()]);
  } catch {
    notifyError('交易报告加载失败', '请稍后重试。');
  } finally {
    loading.value = false;
  }
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
  } finally {
    savingReport.value = false;
  }
};

const editReport = (item: any) => {
  reportForm.id = Number(item?.id || 0);
  reportForm.period_type = (String(item?.period_type || 'DAILY').toUpperCase() as any);
  reportForm.period_key = String(item?.period_key || '');
  reportForm.title = String(item?.title || '');
  reportForm.summary = String(item?.summary || '');
  reportForm.experience = String(item?.experience || '');
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
    notifySuccess('经验已加入', '后续交易会自动参考这些经验。');
    await loadExperiences();
  } finally {
    savingExperience.value = false;
  }
};

const removeExperience = async (id: number) => {
  if (!window.confirm('确认删除该经验？')) return;
  await api.saveTradeExperience({ id, delete: true });
  await loadExperiences();
  notifySuccess('已删除经验');
};

refreshAll();
</script>

<style scoped>
.reports-page {
  display: grid;
  gap: 12px;
}

.report-editor,
.experience-panel,
.report-list {
  padding: 12px;
}

.head-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 10px;
}

.panel-sub {
  margin: 4px 0 0;
  font-size: 12px;
  color: var(--text-muted);
}

.editor-grid {
  margin-top: 10px;
  display: grid;
  gap: 8px;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
}

.field-block {
  display: grid;
  gap: 6px;
}

.field-label {
  font-size: 12px;
  color: var(--text-soft);
}

.field-input {
  width: 100%;
  border: 1px solid var(--line-strong);
  border-radius: var(--radius-sm);
  padding: 10px 11px;
  font-size: 13px;
  background: #fff;
  outline: none;
}

.field-input:focus {
  border-color: var(--brand);
  box-shadow: 0 0 0 2px rgba(16, 163, 127, 0.12);
}

.field-textarea {
  resize: vertical;
  min-height: 92px;
}

.action-row {
  margin-top: 10px;
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.experience-editor {
  margin-top: 10px;
  display: grid;
  grid-template-columns: minmax(0, 1fr) 110px auto;
  gap: 8px;
}

.weight-input {
  text-align: center;
}

.experience-grid {
  margin-top: 10px;
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  gap: 8px;
}

.experience-item {
  border: 1px solid var(--line);
  border-radius: var(--radius-sm);
  background: var(--surface-soft);
  padding: 8px;
  display: grid;
  gap: 6px;
}

.experience-top {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.weight-chip {
  border: 1px solid #a7f3d0;
  background: #f0fdf4;
  color: #065f46;
  border-radius: 999px;
  padding: 2px 8px;
  font-size: 11px;
  font-weight: 700;
}

.mini-delete {
  border: 1px solid var(--line);
  border-radius: var(--radius-sm);
  padding: 2px 7px;
  font-size: 11px;
  color: #9f1239;
  background: #fff1f2;
}

.experience-item p {
  margin: 0;
  font-size: 12px;
  color: var(--text-soft);
  line-height: 1.5;
}

.report-grid {
  margin-top: 10px;
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  gap: 10px;
  align-items: start;
}

.report-card {
  border: 1px solid var(--line);
  border-radius: var(--radius-sm);
  background:
    radial-gradient(500px 120px at 0% 0%, rgba(16, 163, 127, 0.08), transparent 60%),
    #fff;
  padding: 10px;
  display: grid;
  gap: 8px;
}

.report-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
}

.report-type {
  border-radius: 999px;
  border: 1px solid #d1fae5;
  background: #ecfdf5;
  color: #065f46;
  font-size: 10px;
  font-weight: 800;
  padding: 2px 8px;
}

.report-head strong {
  font-size: 12px;
  color: var(--text-soft);
  font-family: 'JetBrains Mono', monospace;
}

.report-card h4 {
  margin: 0;
  font-size: 14px;
}

.report-summary,
.report-exp {
  margin: 0;
  font-size: 12px;
  color: var(--text-soft);
  line-height: 1.55;
  white-space: pre-wrap;
}

.report-foot {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  font-size: 11px;
  color: var(--text-muted);
}

.compact {
  padding: 4px 8px;
  font-size: 11px;
}

.empty-line {
  padding: 14px 4px;
  color: var(--text-muted);
  font-size: 12px;
}

@media (max-width: 820px) {
  .experience-editor {
    grid-template-columns: 1fr;
  }
}
</style>
