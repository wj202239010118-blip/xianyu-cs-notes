# 商品 AI 配置 · 机制研究（代码实证）

> 结论先行：**它不做模型训练/微调，而是用「人工问答沉淀 + 本地 FAQ 检索」的知识闭环来变聪明。**
> 这套闭环在代码里是完整现成的，只是当前一条数据都还没录（`profiles=0`、`faqs=0`、`question_tasks=0`）。

## 1. 配置结构（每商品一套）

`product_ai_profiles`（`ai/management.js:292` `saveProductAiProfile`）：

| 分组 | 字段 | 说明 |
|---|---|---|
| 商品事实 | `product_summary` / `target_users` / `delivery_description` / `usage_requirements` / `unsupported_features` / `important_notices` | AI 回答的**事实边界**，越具体越不会瞎编 |
| 回复风格 | `reply_style`（CONCISE/FRIENDLY/PROFESSIONAL）、`style_mode`（GLOBAL/INDEPENDENT）、`style_text`、`max_reply_length`（60/120/200） | 全局风格可被单品覆盖 |
| 行为 | `insufficient_mode`（HANDOFF 转人工 / UNCERTAIN_REPLY 谨慎回复）、`minimum_confidence`（0.60–1）、`context_enabled` | 拿不准时怎么办 |
| 开关 | `enabled` | 未上架商品不能开（`PRODUCT_NOT_ON_SALE`） |

`product_ai_faqs`（每 profile 最多 100 条，`ai/quality.js` 的 `equivalent`/`replySimilarity` 做去重）：

| 字段 | 作用 |
|---|---|
| `question` / `answer` | 问答对 |
| `conditions_json` | 生效条件（可按规格/场景限定） |
| **`source`** | **`AI` / `MANUAL` / `LEGACY`** —— 区分「AI 生成」「人工沉淀」「历史迁移」 |
| `enabled` / `sort_order` | 启停与优先级 |

## 2. 学习闭环（这是核心）

```
买家提问
   ↓
AI 有把握 → 生成回复（走 provider）
AI 没把握/低置信 → recordQuestionIssue()  →  ai_question_tasks(knowledge_state=MISSING)
                                                    ↓
                                              转人工（waitForHuman）
                                                    ↓
                                       人工在「异常处理」里回答 + 点「沉淀」
                                                    ↓
                    saveIssueFaq()  →  product_ai_faqs(source='MANUAL')，issue 绑定 faq_id
                                                    ↓
                               下次同类问题 → buildLocalKnowledgeReply() 直接命中 FAQ
                                             （不走 AI，不花钱，回答 100% 一致）
```

关键实现：

| 环节 | 位置 | 行为 |
|---|---|---|
| 记问题 | `ai/knowledge-work.js:16` `recordQuestionIssue` | 写 `ai_question_tasks` + `reception_issues`，进「异常处理」 |
| 转人工 | `ai/knowledge-work.js:48` `waitForHuman` | 会话标记人工接管 |
| 沉淀 | `ai/knowledge-work.js:62` `saveIssueFaq` | 写 FAQ，`source='MANUAL'`；带三重保护（见下） |
| 命中 | `ai/local-knowledge.js:109` `buildLocalKnowledgeReply` | 关键词/别名匹配 FAQ，返回本地回复 |
| 参与决策 | `ai/service.js:615 / 721 / 985` | 生成前、生成失败兜底、最终决策三处都会先查本地知识 |

**沉淀时的三道保护**（防止知识库被污染）：
1. `equivalent()` 或 `replySimilarity >= 0.55` 判定相似 → 要求 `confirmConflict` 后才允许新增
2. `factsConflict({answer}, profile)` 与商品资料矛盾 → 同样要求确认
3. `ai_knowledge_submissions` + `request_id` 幂等 → 重复提交返回 `reused`

**知识边界校验**（防止 AI 吹牛）：`contradictsUnsupportedFeature()`（不承诺 `unsupported_features` 里的能力）、`contradictsKnowledgeBoundary()`（超出资料范围就转人工）。

## 3. 现在缺什么

| 项 | 状态 |
|---|---|
| 商品 AI 配置 | **0 条**（`product_ai_profiles`） |
| FAQ（知识） | **0 条** |
| 问题池（待补充） | **0 条** |
| AI 生成 FAQ（`source='AI'`） | 表结构支持，但**没有写入路径** —— 即「AI 自动出 FAQ 草稿」这个环节实际不存在，只能人工写 |
| 检索方式 | **关键词/别名匹配**，不是向量检索 |
| 从历史对话自动学习 | **没有**（不会自动聚类生成 FAQ） |

## 4. 怎么用起来（三步）

1. **建配置**：Automation → 商品 AI 配置 → 选商品，填 6 个事实字段（越具体越好），风格选 CONCISE/FRIENDLY，`insufficient_mode` 先设 `HANDOFF`（拿不准就转人工），`minimum_confidence` 保持 0.85
2. **开开关**：先只给 1 个商品开（`enabled`），跑一段时间
3. **喂知识**：每遇到一次「转人工」，人工回答完顺手点「沉淀」→ FAQ 自动积累。**用一周，FAQ 会覆盖 80% 常见问题**，之后大部分回复走本地、不烧 token

## 5. 如果要"更智能"（可选增强）

| 增强 | 工作量 | 收益 |
|---|---|---|
| 从历史对话批量抽取候选 FAQ（人工审核后入库） | 中 | 冷启动不用一条条手写 |
| FAQ 向量检索（本地 embedding + 近似匹配） | 中 | 解决「换个说法就匹配不到」 |
| 商品资料自动填充（从 `product_catalog` 已有字段生成草稿） | 小 | 省手填 6 个字段 |
| AI 生成 FAQ 草稿（补上缺失的 `source='AI'` 写入路径） | 中 | 半自动扩知识库 |

> 注意：以上都不需要训练模型。真正的「越用越准」来自 FAQ 沉淀 + `minimum_confidence` + 转人工三道配合。
