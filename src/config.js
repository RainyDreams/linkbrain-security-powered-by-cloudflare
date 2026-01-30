export const CONFIG = {
  // 交易费率
  FEES: {
      MIN_COMMISSION: 500, // 最低佣金 500分 (5元)
      COMMISSION_RATE: 0.00025, // 万2.5
      TAX_RATE: 0.0005 // 印花税 万5 (仅卖方)
  },
  // 交易时间 (UTC小时)
  TRADE_HOURS: {
      MORNING_START: 1,  // 09:00 CST
      MORNING_END: 3.5,  // 11:30 CST
      AFTERNOON_START: 5, // 13:00 CST
      AFTERNOON_END: 7    // 15:00 CST
  }
};