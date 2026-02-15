// src/utils.js

export const jsonResponse = (data, status = 200, code = 0, msg = "success") => {
  return new Response(JSON.stringify({ code, msg, data }), {
      status,
      headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type, Authorization"
      }
  });
};

export const errorResponse = (msg, status = 400, code = 4000) => jsonResponse(null, status, code, msg);

// src/utils.js

export const Money = {
  // 元转分：四舍五入处理浮点数，防止 19.9 变成 1989
  toCent: (yuan) => {
    if (yuan === null || yuan === undefined || yuan === '') return 0;
    const value = Number.parseFloat(yuan);
    if (!Number.isFinite(value)) return NaN;
    return Math.round((value + Number.EPSILON) * 100);
  },
  
  // 分转元：保留两位小数
  toYuan: (cent) => {
    if (!cent) return 0;
    return parseFloat((cent / 100).toFixed(2));
  },
  
  // 计算佣金：万2.5，最低5元 (单位均为分)
  calcCommission: (amountCent) => {
    return Math.max(500, Math.round(amountCent * 0.00025));
  },
  
  // 计算印花税：卖出时千分之0.5 (单位均为分)
  calcTax: (amountCent) => {
    return Math.round(amountCent * 0.0005);
  },

  hasAtMostTwoDecimals: (yuan) => {
    if (yuan === null || yuan === undefined || yuan === '') return false;
    const str = String(yuan).trim();
    if (!/^\d+(\.\d{1,2})?$/.test(str)) return false;
    return Number.isFinite(Number.parseFloat(str));
  }
};

export const TradeRules = {
  MIN_LOT_SIZE: 100,
  MAX_ORDER_QTY: 1000000,
  MAX_SINGLE_TRANSFER_CENT: 500000000,
  MAX_DAILY_TRANSFER_CENT: 1000000000
};

export const Time = {
  // 获取东八区当前时间对象
  getCST: () => {
      const now = new Date();
      const utc = now.getTime() + (now.getTimezoneOffset() * 60000);
      return new Date(utc + (3600000 * 8));
  },
  
  // 格式化输出
  formatTime: (date) => {
      return date.toISOString().replace('T', ' ').substring(0, 19);
  },

  // 严格判断是否为交易时间
  isMarketOpen: () => {
      const cst = Time.getCST();
      const day = cst.getDay();
      if (day === 0 || day === 6) return false; // 周末

      const h = cst.getHours();
      const m = cst.getMinutes();
      const t = h * 100 + m;

      // 09:30 - 11:30
      const isMorning = t >= 930 && t <= 1130;
      // 13:00 - 15:00
      const isAfternoon = t >= 1300 && t <= 1500;

      return isMorning || isAfternoon;
  },

  formatCSTDate: (date = null) => {
      const cst = date || Time.getCST();
      const y = cst.getFullYear();
      const m = String(cst.getMonth() + 1).padStart(2, '0');
      const d = String(cst.getDate()).padStart(2, '0');
      return `${y}-${m}-${d}`;
  },

  isBankTransferOpen: () => {
      const cst = Time.getCST();
      const day = cst.getDay();
      if (day === 0 || day === 6) return false;

      const h = cst.getHours();
      const m = cst.getMinutes();
      const t = h * 100 + m;
      return t >= 900 && t <= 1600;
  }
};
