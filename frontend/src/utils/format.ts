export const formatMoney = (val: number | string | undefined) => {
  if (val === undefined || val === null) return '0.00';
  const num = Number(val);
  return new Intl.NumberFormat('zh-CN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(num);
}

// // 涨跌颜色：红涨绿跌
// export const getColor = (val: number) => {
//   if (val > 0) return 'text-ths-red';
//   if (val < 0) return 'text-ths-green';
//   return 'text-gray-400';
// }

export const getBgColor = (val: number) => {
    if (val > 0) return 'bg-ths-red';
    if (val < 0) return 'bg-ths-green';
    return 'bg-gray-500';
}
export const getColor = (val: number | string) => {
  const n = Number(val);
  if (n > 0) return 'text-[#E2233E]'; // THS Red
  if (n < 0) return 'text-[#00AA3B]'; // THS Green
  return 'text-slate-500';
};

// ... 其他保持不变