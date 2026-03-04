import { reactive } from 'vue';

type LoaderPhase = 'idle' | 'loading' | 'finishing';

export const routeLoader = reactive({
  visible: false,
  phase: 'idle' as LoaderPhase,
  progress: 0,
  label: '加载中'
});

let activeCount = 0;
let progressTimer: ReturnType<typeof setInterval> | null = null;
let hideTimer: ReturnType<typeof setTimeout> | null = null;

const stopProgressTimer = () => {
  if (!progressTimer) return;
  clearInterval(progressTimer);
  progressTimer = null;
};

const clearHideTimer = () => {
  if (!hideTimer) return;
  clearTimeout(hideTimer);
  hideTimer = null;
};

const startProgressTimer = () => {
  stopProgressTimer();
  progressTimer = setInterval(() => {
    if (routeLoader.phase !== 'loading') return;
    routeLoader.progress = Math.min(92, routeLoader.progress + Math.max(0.4, (100 - routeLoader.progress) * 0.06));
  }, 90);
};

export const beginRouteLoading = (label = '加载中') => {
  activeCount += 1;
  clearHideTimer();

  routeLoader.label = label;
  routeLoader.phase = 'loading';
  routeLoader.visible = true;
  routeLoader.progress = Math.max(routeLoader.progress, 8);

  startProgressTimer();
};

export const finishRouteLoading = () => {
  activeCount = Math.max(0, activeCount - 1);
  if (activeCount > 0) return;

  routeLoader.phase = 'finishing';
  routeLoader.progress = 100;
  stopProgressTimer();
  clearHideTimer();

  hideTimer = setTimeout(() => {
    routeLoader.visible = false;
    routeLoader.phase = 'idle';
    routeLoader.progress = 0;
  }, 280);
};

export const failRouteLoading = () => {
  activeCount = 0;
  routeLoader.phase = 'finishing';
  routeLoader.progress = 100;
  stopProgressTimer();
  clearHideTimer();
  hideTimer = setTimeout(() => {
    routeLoader.visible = false;
    routeLoader.phase = 'idle';
    routeLoader.progress = 0;
  }, 180);
};

