export const formatMoney = (val: number | string | undefined | null) => {
  const num = Number(val ?? 0);
  if (!Number.isFinite(num)) return '0.00';
  return new Intl.NumberFormat('zh-CN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(num);
};

export const formatQty = (val: number | string | undefined | null) => {
  const num = Number(val ?? 0);
  if (!Number.isFinite(num)) return '0';
  return new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 0 }).format(num);
};

export const formatPct = (val: number | string | undefined | null, digits = 2) => {
  const num = Number(val ?? 0);
  if (!Number.isFinite(num)) return '0.00%';
  const fixed = num.toFixed(digits);
  return `${num > 0 ? '+' : ''}${fixed}%`;
};

export const getColor = (val: number | string | undefined | null) => {
  const num = Number(val ?? 0);
  if (num > 0) return 'text-[var(--pos)]';
  if (num < 0) return 'text-[var(--neg)]';
  return 'text-slate-600';
};

export const orderStatusText = (status: string) => {
  const map: Record<string, string> = {
    PENDING: '挂单中',
    MATCHING: '撮合中',
    FILLED: '已成交',
    PARTIAL: '部分成交',
    CANCELLED: '已撤单',
    EXPIRED: '已过期',
    ERROR: '异常'
  };
  return map[status] || status;
};

export const orderStatusClass = (status: string) => {
  if (status === 'FILLED') return 'tag tag-pos';
  if (status === 'PENDING' || status === 'MATCHING') return 'tag tag-neutral';
  if (status === 'ERROR') return 'tag bg-rose-100 text-rose-700';
  return 'tag tag-neg';
};

export const shanghaiNowText = () => {
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    hour12: false,
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  }).format(new Date());
};

export const isTradingSession = () => {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Shanghai',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).formatToParts(new Date());

  const wd = parts.find((x) => x.type === 'weekday')?.value || '';
  if (wd === 'Sat' || wd === 'Sun') return false;

  const hh = Number(parts.find((x) => x.type === 'hour')?.value || '0');
  const mm = Number(parts.find((x) => x.type === 'minute')?.value || '0');
  const t = hh * 100 + mm;
  return (t >= 930 && t <= 1130) || (t >= 1300 && t <= 1500);
};
