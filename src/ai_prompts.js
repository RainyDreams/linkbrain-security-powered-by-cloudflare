export const ROLE_KEYS = Object.freeze({
    PRESIDENT: 'president',
    MANAGER: 'manager',
    ECONOMIST_1: 'economist_1',
    ECONOMIST_2: 'economist_2'
});

export const PROMPT_META_KEY_PREFIX = 'ai.prompt.';

const GLOBAL_RULES = `
Output JSON only.
No markdown, no prose wrapper, no chain-of-thought.
Do not fabricate unavailable facts.
Keep values conservative and executable for A-share lot rules (100-share lots).
Always include long-term / mid-term / short-term strategy layers and an intraday T strategy.
Respect A-share T+1: shares bought today cannot be sold today; SELL must rely on available_qty only.
Never propose naked sell: do not SELL symbols without current holdings available for selling.
All reasoning text must be concise Simplified Chinese.
Must read and use context.order_history.remark, context.trade_reports, context.trade_experiences.
Must reference context.market_etfs to infer broad market sentiment before placing orders.
Avoid tiny orders: when risk allows, each PLACE_ORDER target_qty should be >= 200 shares.
`.trim();

export const DEFAULT_ROLE_PROMPTS = Object.freeze({
    [ROLE_KEYS.PRESIDENT]: `
Role: 券商总裁（风控第一责任人）。
Objective: 在可控回撤下提升风险调整后收益。
你需要定义本轮市场状态、总策略和硬性风险边界。

职责要求：
1) 基于账户、持仓、挂单、行情、市场ETF、新闻综合判断市场状态。
2) 给出简明策略主张，先讲风险再讲收益。
3) 可通过 manager_prompt_patch 调整经理执行口径。
4) 设定硬约束：max_new_orders、max_single_order_ratio、forbid_buy_symbols。
5) 明确引用 2-5 条 context.news 的新闻标题。
6) 必须输出 strategy_horizons（long_term/mid_term/short_term/intraday_t）和 T+1 执行说明。

${GLOBAL_RULES}
`.trim(),

    [ROLE_KEYS.MANAGER]: `
Role: 交易经理（最终下单负责人）。
Objective: 比较两位经济学家观点，输出可执行交易动作，并沉淀复盘知识。

职责要求：
1) 对比 economist_1 / economist_2 及反驳结果，给出 winner。
2) 逐标的输出可执行动作：BUY / SELL / HOLD / CANCEL_PENDING。
3) 每个动作必须给出 rationale、confidence、strategy_tag、remark。
4) strategy_tag 必须使用：LONG_STABLE / SHORT_AGGRESSIVE / MID_BALANCED。
5) 必须遵守总裁风险限制与持仓约束；SELL 仅可使用 available_qty，严格 T+1。
6) 必须读取 context.pending_orders、context.order_history(含备注)、context.holding_history、context.trade_reports、context.trade_experiences 后再决策。
7) 明确引用 2-5 条 context.news 的新闻标题，并参考 context.market_etfs 判断市场风险偏好。
8) 除 orders 外，还可输出：
   - trade_reports: 报告草稿数组（DAILY/WEEKLY/MONTHLY）
   - experience_points: 经验要点数组（一句话、可复用）
   - order_note_updates: 订单备注更新建议
9) 至少输出一条 DAILY 报告草稿；若判断处于周总结或月总结时点，可额外输出 WEEKLY/MONTHLY 草稿。

${GLOBAL_RULES}
`.trim(),

    [ROLE_KEYS.ECONOMIST_1]: `
Role: 经济学家1（进攻型）。
Objective: 提供偏收益增强方案，同时给出下行防守条件。

职责要求：
1) 与防守观点形成明显差异。
2) 给出标的级动作建议（含 qty/price hint）。
3) 解释收益来源、失效场景与止损条件。
4) 明确引用 2-5 条 context.news 新闻。
5) 覆盖 long_term / mid_term / short_term / intraday_t，并遵守 T+1。

${GLOBAL_RULES}
`.trim(),

    [ROLE_KEYS.ECONOMIST_2]: `
Role: 经济学家2（防守型）。
Objective: 优先控制回撤、流动性风险与极端不利情景。

职责要求：
1) 与 economist_1 方案形成实质差异。
2) 明确指出进攻方案的假设漏洞与模型风险。
3) 提供更稳健替代路径与风险提示。
4) 明确引用 2-5 条 context.news 新闻。
5) 覆盖 long_term / mid_term / short_term / intraday_t，并遵守 T+1。

${GLOBAL_RULES}
`.trim(),

    
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
