interface ErrorGuideItem {
  title: string;
  message: string;
  hint: string;
}

const errorGuide: Record<number, ErrorGuideItem> = {
  4001: {
    title: '可用资金不足',
    message: '当前可用资金无法覆盖委托金额及交易费用。',
    hint: '建议降低委托数量，或先进行银证转入后再下单。'
  },
  4002: {
    title: '可卖持仓不足',
    message: '卖出数量超过可用持仓，或触发 T+1 可卖限制。',
    hint: '请核对持仓页的“可卖数量”，并按 100 股整数倍委托。'
  },
  4003: {
    title: '订单不可撤销',
    message: '订单状态已变化，无法执行撤单。',
    hint: '请刷新委托列表后确认订单状态。'
  },
  4005: {
    title: '行情不可用',
    message: '暂时无法获取实时行情，系统拒绝当前委托。',
    hint: '请稍后重试，或确认证券代码是否正确。'
  },
  4006: {
    title: '交易时段限制',
    message: '当前策略限制仅允许交易时段下单。',
    hint: '若系统支持非交易时段挂单，请联系管理员核对后端版本。'
  },
  4007: {
    title: '证券代码缺失',
    message: '下单请求未提供有效证券代码。',
    hint: '请输入 6 位证券代码，例如 600519。'
  },
  4008: {
    title: '委托参数不合法',
    message: '下单参数触发风控校验失败。',
    hint: '请检查方向、价格、数量是否满足交易规则。'
  },
  4009: {
    title: '委托金额异常',
    message: '订单金额计算结果异常或超出可接受范围。',
    hint: '请重新输入价格与数量，避免极值或非法字符。'
  },
  4010: {
    title: '认证失效',
    message: '当前登录状态无效或会话已过期。',
    hint: '请重新登录管理端。'
  },
  4011: {
    title: '登录失败',
    message: '用户名或密码校验未通过。',
    hint: '请确认密码输入后重试。'
  },
  4050: {
    title: '请求方法不支持',
    message: '当前接口不支持该 HTTP 方法。',
    hint: '请刷新页面后重试。'
  },
  4101: {
    title: '不在银证转账时段',
    message: '银证转账仅支持工作日 09:00-16:00。',
    hint: '请在可办理时段提交，避免重复点击。'
  },
  4102: {
    title: '转账方向非法',
    message: '转账类型仅允许 IN（转入）或 OUT（转出）。',
    hint: '请重新选择转账方向。'
  },
  4103: {
    title: '转账金额格式错误',
    message: '金额仅支持最多两位小数。',
    hint: '示例：1000 或 1000.50。'
  },
  4104: {
    title: '转账金额无效',
    message: '转账金额必须大于 0。',
    hint: '请填写正数金额后重试。'
  },
  4105: {
    title: '超过单笔限额',
    message: '本次转账金额超过单笔风控限制。',
    hint: '请拆分为多笔或降低金额。'
  },
  4107: {
    title: 'request_id 过长',
    message: '请求流水号长度超出系统限制。',
    hint: '请缩短 request_id 后重试。'
  },
  4106: {
    title: '当日转账限额触发',
    message: '当日累计转账金额已达到风控限制。',
    hint: '请次日再操作，或拆分交易计划。'
  },
  4291: {
    title: '登录尝试过多',
    message: '短时间内登录失败次数过多，已临时锁定。',
    hint: '请等待锁定时间结束后再尝试。'
  },
  5000: {
    title: '服务端异常',
    message: '系统出现内部错误，未完成本次操作。',
    hint: '请稍后重试；若持续出现请联系运维排查。'
  }
};

export const resolveErrorGuide = (code: number, fallbackMsg?: string): ErrorGuideItem => {
  const hit = errorGuide[code];
  if (hit) return hit;

  return {
    title: '请求失败',
    message: fallbackMsg || '接口返回异常。',
    hint: '请检查网络状态或稍后重试。'
  };
};
