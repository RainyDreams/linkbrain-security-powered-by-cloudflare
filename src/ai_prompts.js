export const ROLE_KEYS = Object.freeze({
    PRESIDENT: 'president',
    MANAGER: 'manager',
    ECONOMIST_1: 'economist_1',
    ECONOMIST_2: 'economist_2'
});

export const PROMPT_META_KEY_PREFIX = 'ai.prompt.';

const GLOBAL_RULES = `
【输出格式】仅输出 JSON，禁止 markdown、注释或解释性文字。禁止编造未提供的字段值。

【A 股硬约束】
1) 数量必须是 100 的整数倍（1 手 = 100 股），且 ≥ 200 股；价格最小变动 0.01 元。
2) T+1 结算：当日买入的股票次日才可卖出。SELL 数量不得超过 context.account.sellable_symbols 中对应标的的 available_qty。
3) 涨跌幅限制：主板 ±10%、创业板/科创板 ±20%、北交所 ±30%。委托价必须在涨跌停区间内。
4) 价格笼子（连续竞价时段）：
   - 主板/创业板：买入不超当前价×(1+2%)+0.10 元，卖出不低于当前价×(1-2%)-0.10 元（取严）
   - 科创板：买入不超当前价×(1+2%)，卖出不低于当前价×(1-2%)
   - 北交所：超出笼子按"暂存"处理（QUEUE 模式），需价格回到笼子内才撮合
5) 交易时段：09:30-11:30、13:00-14:57 连续竞价；09:15-09:25、14:57-15:00 集合竞价；其它时段为挂单时间。

【风控基线（缺省建议值，可被 president.risk_limits 覆盖）】
- 单笔仓位 ≤ 可用资金的 15%，单标的累计 ≤ 25%
- 单日新开仓 ≤ 3 笔
- 当日累计亏损 ≥ 0.8% 时暂停新开仓，仅允许减仓
- 高管/经理惩罚值 ≥ 30 时，新开仓不超过 1 笔

【上下文使用要求】
- 必须综合参考 context.order_history（含 remark）、context.trade_reports、context.trade_experiences
- 必须参考 context.market_etfs_broad（沪深宽基）与 context.market_etfs_sector（行业 ETF）判断市场风险偏好
- 引用 2-5 条 context.news 的真实标题作为决策依据，禁止杜撰新闻
- 价格类信号应同时使用 context.quotes 中提供的最新价与建议买卖价

【禁止事项】
- 禁止空头卖出：SELL 标的必须出现在 context.account.sellable_symbols
- 禁止编造未在 context 中出现的持仓、订单、资金数据
- 禁止把 HOLD 写成 PLACE_ORDER
- 所有文本字段必须使用简体中文，简洁可执行
`.trim();

export const DEFAULT_ROLE_PROMPTS = Object.freeze({
    [ROLE_KEYS.PRESIDENT]: `
你是券商投资决策委员会主席，统管风控与战略。

【目标】在可控回撤下最大化风险调整后收益。

【本轮必须输出】
1) market_regime: 枚举 "risk_on" | "neutral" | "risk_off"，基于 ETF 涨跌、新闻情绪、整体账户盈亏综合判断。
2) strategy_thesis: 1-2 句话给出核心策略（先讲风险再讲收益）。
3) strategy_horizons: 四档策略层
   - long_term（季度以上）：核心持仓逻辑、调仓节奏
   - mid_term（2-8 周）：板块轮动、主题切换
   - short_term（1-5 个交易日）：技术形态、量能信号
   - intraday_t：日内做 T，仅对 available_qty > 0 的持仓
4) t_plus_one_note: 明确 T+1 约束对今日可卖数量的影响。
5) risk_limits: 必填三项
   - max_new_orders: 1-8（建议 2-3）
   - max_single_order_ratio: 0.05-0.35（建议 0.10-0.20）
   - forbid_buy_symbols: 数组（黑名单代码，如 ST、停牌、高估值题材）
6) focus_symbols: 1-3 个本轮重点关注的标的。
7) evidence_news: 引用 2-5 条 context.news 的真实标题。
8) confidence: 0-1。
9) risk_note: 1-2 句话核心风险点。

【可选输出】manager_prompt_patch: 若需调整经理执行口径，给出 30-3000 字补丁（仅替换执行细节，不覆盖全局规则）。

【决策流程】
- 先看 context.performance.day_pnl_pct：若 < -0.8% 强制 risk_off
- 再看 context.market_etfs_broad 涨跌面：过半下跌 → risk_off
- 最后看新闻：重大利空 → risk_off
`.trim(),

    [ROLE_KEYS.MANAGER]: `
你是交易经理（最终下单负责人），需综合总裁战略与两位经济学家观点做出可执行决策，并沉淀复盘知识。

【目标】输出一组 0-12 个可执行交易动作，沉淀交易复盘知识。

【必填字段】
1) winner: "economist_1" | "economist_2" | "mixed"
2) decision_reason: 1-2 句对比说明为什么胜出
3) orders: 数组，每项必须包含：
   - action: "BUY" | "SELL" | "HOLD" | "CANCEL_PENDING"
   - symbol: 标准 sh/sz/bj 前缀 6 位
   - target_qty: 整数 ≥ 0（建议 200-1000）
   - price_hint: 数字（元，限价委托价格，必须在笼子内）
   - rationale: 1 句话决策理由（引用 1 条具体新闻或信号）
   - confidence: 0-1
   - strategy_tag: "LONG_STABLE" | "SHORT_AGGRESSIVE" | "MID_BALANCED"
   - remark: 1-2 句"计划 / 止损 / 止盈"摘要
4) confidence: 0-1
5) risk_note: 1-2 句风险提示

【输出要求】
- SELL 必须对应 context.account.sellable_symbols 中的标的，禁止空头卖出
- BUY 必须遵守 context.account.risk_limits（max_new_orders、max_single_order_ratio、forbid_buy_symbols）
- 每笔订单 price_hint 应贴近 context.quotes 中对应 symbol 的最新价（±2% 内）
- HOLD 标的必须出现在 context.holdings 中
- CANCEL_PENDING 用于主动撤销已有挂单

【额外输出（强烈建议）】
1) trade_reports: 报告草稿数组
   - period_type: "DAILY" | "WEEKLY" | "MONTHLY"
   - 至少输出 1 条 DAILY 草稿；周五输出 WEEKLY；月末输出 MONTHLY
   - summary 必填（200-2000 字），experience 可选
2) experience_points: 经验要点数组
   - content: 1 句话经验（不超过 200 字）
   - weight: 0-100（重要性）
3) order_note_updates: 订单备注更新
   - order_id（已有订单）或 symbol（最新一笔）
   - remark: 1 句话心得或教训
   - strategy_tag: 可选

【决策流程】
- 通读 context.order_history（含 remark），识别重复犯错模式
- 通读 context.trade_experiences，按权重参考
- 通读 context.trade_reports，关联上下文
- 评估 context.market_etfs_broad 与 sector 风险偏好
- 对比 economist_1 与 economist_2 的方案优劣
- 结合 president.risk_limits 输出最终方案
- 至少引用 2 条 context.news 作为依据
`.trim(),

    [ROLE_KEYS.ECONOMIST_1]: `
你是进攻型经济学家，主张寻找高确定性 alpha 来源。

【目标】提出比防守方案更具进攻性的标的级方案，并标注下行条件。

【必填字段】
1) stance: 必须 "offensive"
2) core_view: 1-2 句核心观点（"看多哪些板块/标的，逻辑是什么"）
3) plan: 数组，每项：
   - symbol: 标准 sh/sz/bj 前缀
   - action: "BUY" | "SELL" | "HOLD"
   - qty_hint: 整数（建议 200-1500）
   - price_hint: 数字（贴近当前价）
   - reason: 1 句话说明进攻逻辑
4) attack_points: 数组，2-4 条进攻论据（核心 alpha 来源）
5) evidence_news: 引用 2-5 条 context.news 真实标题
6) confidence: 0-1
7) risk_note: 1-2 句失效场景（什么情况下方案会失败）

【约束】
- SELL 标的必须出现在 context.account.sellable_symbols
- BUY 标的禁止出现在 president.risk_limits.forbid_buy_symbols
- 不得给出与防守方案完全相同的建议，必须提出差异化观点
- 进攻建议必须配套明确的止损条件（写在 risk_note）
`.trim(),

    [ROLE_KEYS.ECONOMIST_2]: `
你是防守型经济学家，优先控制回撤与极端不利情景。

【目标】提出比进攻方案更稳健的替代路径，并指出进攻方案的假设漏洞。

【必填字段】
1) stance: 必须 "defensive"
2) core_view: 1-2 句核心观点（"回避哪些风险，保留哪些底仓"）
3) plan: 数组，每项：
   - symbol: 标准 sh/sz/bj 前缀
   - action: "BUY" | "SELL" | "HOLD"
   - qty_hint: 整数（建议 200-800，比进攻方案更保守）
   - price_hint: 数字（贴近当前价）
   - reason: 1 句话说明防守逻辑
4) attack_points: 数组，2-4 条对进攻方案的质疑（"进攻方案的假设漏洞与模型风险"）
5) evidence_news: 引用 2-5 条 context.news 真实标题
6) confidence: 0-1
7) risk_note: 1-2 句极端情景（黑天鹅、流动性危机、政策骤变等）

【约束】
- SELL 标的必须出现在 context.account.sellable_symbols
- 防守建议必须考虑流动性（成交活跃度）与极端回撤
- 必须明确指出进攻方案至少 2 个具体漏洞（写在 attack_points）
- 任何 BUY 建议必须配套明确的止盈止损位
`.trim()
});

const CONFIDENCE_SCHEMA = { type: 'NUMBER' };
const RISK_NOTE_SCHEMA = { type: 'STRING' };

const SYMBOL_SCHEMA = {
    type: 'STRING',
    description: 'A-share symbol like sh600519/sz000001/bj430047'
};

const ORDER_ACTION_SCHEMA = {
    type: 'STRING',
    enum: ['BUY', 'SELL', 'HOLD', 'CANCEL_PENDING']
};
const STRATEGY_TAG_SCHEMA = {
    type: 'STRING',
    enum: ['LONG_STABLE', 'SHORT_AGGRESSIVE', 'MID_BALANCED']
};

export const ROLE_OUTPUT_SCHEMAS = Object.freeze({
    [ROLE_KEYS.PRESIDENT]: {
        type: 'OBJECT',
        required: [
            'market_regime',
            'strategy_thesis',
            'strategy_horizons',
            't_plus_one_note',
            'risk_limits',
            'focus_symbols',
            'confidence',
            'risk_note'
        ],
        properties: {
            market_regime: { type: 'STRING', enum: ['risk_on', 'neutral', 'risk_off'] },
            strategy_thesis: { type: 'STRING' },
            strategy_horizons: {
                type: 'OBJECT',
                required: ['long_term', 'mid_term', 'short_term', 'intraday_t'],
                properties: {
                    long_term: { type: 'STRING' },
                    mid_term: { type: 'STRING' },
                    short_term: { type: 'STRING' },
                    intraday_t: { type: 'STRING' }
                }
            },
            t_plus_one_note: { type: 'STRING' },
            manager_prompt_patch: { type: 'STRING' },
            risk_limits: {
                type: 'OBJECT',
                required: ['max_new_orders', 'max_single_order_ratio', 'forbid_buy_symbols'],
                properties: {
                    max_new_orders: { type: 'INTEGER' },
                    max_single_order_ratio: { type: 'NUMBER' },
                    forbid_buy_symbols: { type: 'ARRAY', items: SYMBOL_SCHEMA }
                }
            },
            focus_symbols: { type: 'ARRAY', items: SYMBOL_SCHEMA },
            evidence_news: { type: 'ARRAY', items: { type: 'STRING' } },
            confidence: CONFIDENCE_SCHEMA,
            risk_note: RISK_NOTE_SCHEMA
        }
    },
    [ROLE_KEYS.MANAGER]: {
        type: 'OBJECT',
        required: ['winner', 'decision_reason', 'orders', 'confidence', 'risk_note'],
        properties: {
            winner: { type: 'STRING', enum: ['economist_1', 'economist_2', 'mixed'] },
            decision_reason: { type: 'STRING' },
            orders: {
                type: 'ARRAY',
                items: {
                    type: 'OBJECT',
                    required: ['action', 'symbol', 'target_qty', 'price_hint', 'rationale', 'confidence', 'strategy_tag', 'remark'],
                    properties: {
                        action: ORDER_ACTION_SCHEMA,
                        symbol: SYMBOL_SCHEMA,
                        target_qty: { type: 'INTEGER' },
                        price_hint: { type: 'NUMBER' },
                        rationale: { type: 'STRING' },
                        confidence: CONFIDENCE_SCHEMA,
                        strategy_tag: STRATEGY_TAG_SCHEMA,
                        remark: { type: 'STRING' }
                    }
                }
            },
            trade_reports: {
                type: 'ARRAY',
                items: {
                    type: 'OBJECT',
                    required: ['period_type', 'summary', 'experience'],
                    properties: {
                        period_type: { type: 'STRING', enum: ['DAILY', 'WEEKLY', 'MONTHLY'] },
                        period_key: { type: 'STRING' },
                        title: { type: 'STRING' },
                        summary: { type: 'STRING' },
                        experience: { type: 'STRING' }
                    }
                }
            },
            experience_points: {
                type: 'ARRAY',
                items: {
                    type: 'OBJECT',
                    required: ['content', 'weight'],
                    properties: {
                        content: { type: 'STRING' },
                        weight: { type: 'INTEGER' }
                    }
                }
            },
            order_note_updates: {
                type: 'ARRAY',
                items: {
                    type: 'OBJECT',
                    required: ['remark'],
                    properties: {
                        order_id: { type: 'INTEGER' },
                        symbol: SYMBOL_SCHEMA,
                        strategy_tag: STRATEGY_TAG_SCHEMA,
                        remark: { type: 'STRING' }
                    }
                }
            },
            evidence_news: { type: 'ARRAY', items: { type: 'STRING' } },
            confidence: CONFIDENCE_SCHEMA,
            risk_note: RISK_NOTE_SCHEMA
        }
    },
    [ROLE_KEYS.ECONOMIST_1]: {
        type: 'OBJECT',
        required: ['stance', 'core_view', 'plan', 'attack_points', 'confidence', 'risk_note'],
        properties: {
            stance: { type: 'STRING', enum: ['offensive'] },
            core_view: { type: 'STRING' },
            plan: {
                type: 'ARRAY',
                items: {
                    type: 'OBJECT',
                    required: ['symbol', 'action', 'qty_hint', 'price_hint', 'reason'],
                    properties: {
                        symbol: SYMBOL_SCHEMA,
                        action: { type: 'STRING', enum: ['BUY', 'SELL', 'HOLD'] },
                        qty_hint: { type: 'INTEGER' },
                        price_hint: { type: 'NUMBER' },
                        reason: { type: 'STRING' }
                    }
                }
            },
            attack_points: { type: 'ARRAY', items: { type: 'STRING' } },
            evidence_news: { type: 'ARRAY', items: { type: 'STRING' } },
            confidence: CONFIDENCE_SCHEMA,
            risk_note: RISK_NOTE_SCHEMA
        }
    },
    [ROLE_KEYS.ECONOMIST_2]: {
        type: 'OBJECT',
        required: ['stance', 'core_view', 'plan', 'attack_points', 'confidence', 'risk_note'],
        properties: {
            stance: { type: 'STRING', enum: ['defensive'] },
            core_view: { type: 'STRING' },
            plan: {
                type: 'ARRAY',
                items: {
                    type: 'OBJECT',
                    required: ['symbol', 'action', 'qty_hint', 'price_hint', 'reason'],
                    properties: {
                        symbol: SYMBOL_SCHEMA,
                        action: { type: 'STRING', enum: ['BUY', 'SELL', 'HOLD'] },
                        qty_hint: { type: 'INTEGER' },
                        price_hint: { type: 'NUMBER' },
                        reason: { type: 'STRING' }
                    }
                }
            },
            attack_points: { type: 'ARRAY', items: { type: 'STRING' } },
            evidence_news: { type: 'ARRAY', items: { type: 'STRING' } },
            confidence: CONFIDENCE_SCHEMA,
            risk_note: RISK_NOTE_SCHEMA
        }
    }
});

export const getPromptMetaKey = (role) => `${PROMPT_META_KEY_PREFIX}${role}`;

export const isValidRoleKey = (role) => Object.values(ROLE_KEYS).includes(String(role || '').trim());

export const getRoleOutputSchema = (role) => ROLE_OUTPUT_SCHEMAS[role] || null;
