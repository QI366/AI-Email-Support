# Helios Support Mailbox

邮件形态的 AI 客服回信 Demo。用户选一个订单场景 → 写邮件 → 收到 AI 客服的回信邮件。

## 运行

```bash
pip install -r requirements.txt
# .env 与 server.py 同级目录，内容至少包含 MODEL_OPENAI_API_KEY=sk-...
# 情绪识别走本地模型服务：EMOTION_API_URL=http://<host>:<port>/emotion_recognition
# 不配这一项服务照常跑，情绪标签自动退回大模型自评（sentiment_source=llm_fallback）
python server.py
```

服务监听 `0.0.0.0:1222`（`PORT` 可覆盖）。数据库自动建在 `./data/mailbox.db`。

## 关键实现点

**身份识别（按 IP 分用户）**
`server.client_ip()` 依次取 `X-Forwarded-For` → `X-Real-IP` → `request.client.host`；
`store.user_id_for_ip()` 用 `sha256("helios::" + ip)` 前 8 位生成 `user-xxxxxxxx` 的稳定假名。
原始 IP 单独入库不对外展示，列表里只暴露假名。
`GET /api/threads?scope=mine` 按 user_id 过滤，`scope=all` 返回全部——所有人都能看全站历史，但"我的"能被区分出来。

**历史记录**
一行 = 一个 thread：用户邮件 + AI 回信 + **当时的订单上下文快照**（`context_json`）+ **当时的政策判定**（`policy_json`）+ **当时的邮件标签**（`tags_json`）。
快照入库而不是存 scenario_id 引用，保证历史记录不会因为场景数据改动而变形。
`store._ADDED_COLUMNS` 负责给已存在的库补列（`CREATE TABLE IF NOT EXISTS` 不会改动已有表），老数据的 `tags_json` 为 NULL，界面按"未分类"处理。

第二张表 `emotion_tests` 是情绪模型测试台的记录，和 `threads` 完全分开：那里测的是模型本身，不是某封客户来信的回复流程。清空测试台：`DELETE FROM emotion_tests;`

**生成回复分两步**（`tags.py` → `prompts.py`）
```
收到邮件 → ① tags.analyse()  读懂这封信：意图 / 情绪 / 紧急度 / 语言 / 关键实体
         → ② prompts + llm  把标签连同订单事实和政策判定一起交给写信的模型
```
第一步的提示词放在 `email_automatic_reply_en_US.jinjia2` 而不是 Python 里，按 `# User Prompt` 这行切成 system / user 两半，用 jinja2 渲染 `buyer_message` + 可选的 `product_context` / `order_context`。改分类体系只动模板，不动代码。

**第一步里的情绪不由大模型判**（`emotion_recognition.py`）——意图 / 紧急度 / 实体 / 摘要交给大模型，情绪交给本地情绪模型服务，两路在 `analyse()` 里 `asyncio.gather` 并发，耗时取两者的较大值而不是相加。理由是情绪是"语气"不是"事实"：大模型给的 `sentiment_confidence` 和它给的 `sentiment` 一样是自评，既不可复现也无法校准；本地模型给的是 28 个 GoEmotions 标签聚合成 9 个情绪簇（`HOSTILE` / `FRUSTRATED` / `ANXIOUS` / `CONFUSED` / `DEMANDING` / `NEUTRAL` / `SELF_BLAME` / `GRATEFUL` / `SATISFIED`）的模型概率，同一封邮件永远得到同一个分数，能对着阈值做回归测试。取分最高的簇写进 `sentiment`，**最高分下方 `TIE_BAND`（默认 0.05）之内的都算并列，并列里取极性最负的那个**——`l2` 是多标签打分不是 softmax，又急又气的邮件常常在两三个簇上拿到几乎一样的分数（实测一封三次催发货的邮件 `CONFUSED` 0.5772、`FRUSTRATED` 0.5720，差 0.005），纯 argmax 的胜负落在噪声里，而判成 `confused` 就不会触发"情绪 + 紧急度双高"的人工复核。这个不对称是故意的：判成负面顶多多走一次人工，判成正面会把一个愤怒客户放进全自动流程。`EMOTION_TIE_BAND=0` 可退回纯 argmax。

两条硬约束：
- **`analyse()` 永不抛异常。** 打标签是增强项，分类器挂了不能连累客户拿不到回信。失败时返回只含 `error` 的记录——不编意图，不编置信度，`to_prompt_block()` 返回空串，写信的模型根本看不到 MESSAGE ANALYSIS 这一节。情绪服务单独挂掉不影响其余标签：`sentiment` 保留大模型的兜底判断，`sentiment_source` 写明 `llm_fallback`，失败原因记在 `emotion.error`。
- **模型给的值要过白名单。** `INTENTS` / `URGENCIES` / `LANGUAGES` 照抄模板里的表，`SENTIMENTS` 引用情绪模型的 9 个簇，模型编出来的意图会被压成 `other`，越界的置信度直接丢弃，不进数据库。

提示词里明确了标签的地位：**只影响语气和优先级，不影响客户能拿到什么**——`critical` 只改变"多快处理、要不要升级"，不改变退货窗口。愤怒的客户过了 30 天，依然是过了 30 天。标签与邮件正文冲突时以正文为准，且不许把标签念给客户听。

**不支持连续对话**
每次 `POST /api/mail` 都是独立的两次 completion（分析 + 写信），不传历史 messages。

**订单场景**（`scenarios.py`）

电子 / 家居品类：

| id | 场景 | 政策考点 |
|---|---|---|
| `pre_order_inquiry` | 购前咨询（题目给的 Anker 737） | 无订单可查、库存不锁定、退货规则预告 |
| `shipment_delayed` | 物流卡住 6 天、已过预计送达 | 5 天开查件 / 7 天判丢件 |
| `damaged_on_arrival` | 到货破损 2 天内 | 48 小时报损窗口，直接补发不先退货 |
| `wrong_item_shipped` | 发错货（西班牙语） | 平台责任，全免费 |
| `return_window_expired` | 送达 41 天后想退（无质量问题） | 超 30 天窗口，只能给 store credit |
| `refund_pending` | 退货已签收 9 天仍未退款（西班牙语） | SLA 已违约，必须升级不许再等 |
| `warranty_claim` | 用 5 个月电池坏 | 出退货期、在 12 个月保修内，换不退 |
| `address_change_unshipped` | 刚下单 1 小时想改地址 | 未发货可改地址 / 升级时效 / 全额取消 |
| `arrived_awaiting_pickup` | 到驿站柜但没收到取件码 | 已到站不可改地址，引导取件或重投 |
| `received_not_confirmed` | 已放门口但 App 仍显示在途 | 引导确认收货，有问题再转售后 |
| `return_completed_repurchase` | 退款到账后想按原价重买 | 订单已归档，促销价不回溯 |

宠物品类（`Pet Supplies`）：

| id | 场景 | 政策考点 |
|---|---|---|
| `pet_food_pre_order` | 购前问狗粮成分 + 拆封能不能退 | 无订单、低库存不锁定、拆封后退货成本预告 |
| `pet_fountain_damaged` | 猫饮水机到货 1 天开裂漏水 | 48 小时报损窗口内，先补发不先退货 |
| `pet_harness_wrong_size` | 买 L 号胸背带发来 XS | 平台责任，加急重发 + 免费退货标签 |
| `pet_litter_box_lost` | 649 美元猫砂盆超 8 天未达、9 天无扫描（西班牙语） | 已达判丢件线，立即二选一：重发或全退 |
| `pet_tracker_warranty` | GPS 项圈用 7 个月续航从 5 天掉到 3 小时 | 出退货期、保修内换不退，需序列号 |
| `pet_bed_return_expired` | 狗窝送达 38 天想退，无质量问题（西班牙语） | 超 30 天窗口，最多 20% store credit |

日期用**相对偏移**（`order_date_offset: -11`）存储，请求时才 materialise 成真实日期，所以"送达 41 天前"永远是 41 天，不会随时间腐烂。

**政策引擎在代码层，不在提示词层**（`policy.py`）
`policy.evaluate()` 先算好：距送达天数、退货窗口剩余、保修是否有效、报损窗口是否满足、是否触发查件/判丢、退款 SLA 是否违约、本单具体 entitlement 和 `may_not_offer`。
结果作为 `POLICY EVALUATION` 注入提示词，并在系统提示词里声明**它的优先级高于模型自己读原始 JSON 的结论**。
模型不做日期算术，也不自行决定给多少钱——这是"语气亲和"和"别乱承诺退款"能同时成立的原因。

**提示词设计**（`prompts.py`）
- 人格：Helios 客服 Mira Castellanos，行为化定义"亲和"（先叫名字并用自己的话复述处境、只道歉一次、短段落、结尾说清下一步由谁做），而不是给一个 "be friendly" 形容词——否则模型会写一堆共情废话。
- 接地规则按优先级排序：政策判定 > 订单事实 > 不许编（单号/运单号/退款日期/序列号一律不许造）> 拒绝要早说别埋在结尾 > goodwill 必须标注为一次性例外 > store credit 不许说成 refund > SLA 违约时不许再让客户等 > 最多问两个问题。
- 语言：`prompts.detect_language()` 做 en/es 轻量判别给 hint，同时允许模型以邮件正文为准覆盖 hint；非 en/es 一律回英语；要求写地道母语而非英译西。
- 输出 `{"language","subject","body"}` JSON，`llm.parse_reply()` 容忍 ``` 包裹和前后废话，实在解析不出就把原文当正文兜底。

**模型调用**（`llm.py`）
`MODEL_OPENAI_API_KEY` / `MODEL_NAME=gpt-5.4-mini`，OpenAI 兼容端点，可用 `MODEL_OPENAI_BASE_URL` 换网关。
新模型族对 `temperature` / `max_tokens` / `response_format` 的支持不一致，400 且报 unsupported parameter 时自动剔除该参数并重试（`max_completion_tokens` 降级为 `max_tokens`）。
调用失败不丢数据：thread 以 `status=failed` 落库，界面显示"未送达"和错误原因。

**情绪模型调用**（`emotion_recognition.py`）
`EMOTION_API_URL` 指向本地情绪服务，`EMOTION_TIMEOUT` 默认 10 秒，`EMOTION_TIE_BAND` 默认 0.05。`POST {"text": ...}` 返回 `l1`（`P0_ESCALATE` / `P1_RISK` / `P2_STANDARD` / `P3_LOW` 四级升级判定）、`escalation_score`、`negativity`、`l2`（9 个簇的多标签打分，不归一）、`l3_raw`（28 个原始标签）、`rule_hits`、`sarcasm_override` 等。
除了 `sentiment` 本身，`l1 = P0_ESCALATE` 和 `sarcasm_override` 各自单独触发人工复核——前者是服务端按语气强度给的升级判定，跟"情绪 + 紧急度双高"是两个独立信号（`urgency=low` 的邮件照样可能被判 P0）；后者是反讽（字面礼貌、实际负面），自动回复最容易在这种邮件上翻车。
`l3_raw` 不入库：28 个浮点数存进每条 thread 的 `tags_json` 性价比太低，排查时看服务端日志。不做输入截断——引用历史和签名档由服务端的 `preprocessing` 剥离，在客户端切一刀反而可能把正文末尾真正生气的那两句切掉。

**非英文一律不给结果，而不是给个中性值。** 服务遇到读不了的输入会返回 `l1="AMBIGUOUS"` + `ambiguous_reason`（西班牙语是 `unsupported_language`，中文是 `insufficient_content`），此时 9 个簇**全是 0.0**。这种响应必须当成"没有判断"抛出去：全 0 并列会撞上"并列取最负"的规则，把每一封西语来信都判成 `hostile`——而这个信箱本来就收西语来信。抛出后 tags 层退回大模型的情绪判断，大模型是多语言的，这正是它该顶上的场景。

**情绪模型测试台**（`GET /?view=emotion`）
一块公开的模型体检板：左边 rail 的第四项。四段结构——
- **可识别标签**：9 个簇各自由哪些 GoEmotions 原始标签组成、极性多少、算不算负面，外加 `caring` 为什么不归簇、并列带宽是多少。这份定义只写在 `emotion_recognition.taxonomy()` 里，前端不复写。
- **试一段**：任意文本直接喂模型（上限 2000 字），或点 12 条内置示例之一。示例带的 `expect` 是**人读下来应该是什么**，不是模型实际输出什么——已知不一致的三条（并列带翻转的 `demanding_refund`、没识别出反讽的 `sarcasm_great_job`、非英文的 `spanish_broken`）是故意留着的，把示例改成模型稳过的句子等于把体温计调到 36.5 度。
- **反馈**：判对 / 判错，判错必须选出你认为正确的簇（可多选）——"判错"但不给标签是一句没有数据的抱怨，所以保存按钮在选之前是禁用的。谁都能评价谁的测试，后写的覆盖先写的，`feedback_by` 记下最后动手的人。
- **统计与记录**：测试次数 / 已评价 / 一致率 / 平均耗时 / 无结果数，预测分布与人工标注分布两条堆叠条，预测 × 人工标注的混淆表（对角线是一致，只有落在对角线之外的格子上色），各簇一致率表，以及所有人的测试记录。

一致率的分母是**已评价条数**而不是测试总数——没人评价的记录既不算对也不算错，混进分母只会让准确率随着"测了没评"的数量凭空下降。识别失败的记录**也落库**（`error` 列写原因），"模型对这句话给不出结果"本身就是测试结果，丢掉它等于让测试台只展示模型顺利的那一面。

视图和单条测试都进 URL（`?view=emotion&test=12`）——"你看模型把我这句话读成什么了"是要发给别人看的。

## API

| method | path | 说明 |
|---|---|---|
| GET | `/api/me` | 当前 IP、假名、全站统计 |
| GET | `/api/scenarios` | 17 个场景 + 实时政策判定 |
| GET | `/api/policy` | 政策引擎的常量（退货窗口 / 报损窗口 / 保修 / SLA…）+ 评估基准日 |
| GET | `/api/tags/stats?scope=all\|mine` | 标签聚合：意图 / 情绪 / 紧急度 / 语言分布 + 分类成功率、低置信度率、平均耗时 |
| GET | `/api/threads?scope=mine\|all` | 列表（带精简标签：意图 / 情绪 / 紧急度） |
| GET | `/api/threads/{id}` | 详情（含上下文快照、政策判定与完整标签） |
| POST | `/api/mail` | `{scenario_id, subject, body}` → 完整 thread |
| GET | `/api/emotion/meta` | 情绪模型能识别的 9 个簇 / 28 个原始标签 + 12 条示例语料 + 端点是否配置 |
| POST | `/api/emotion/test` | `{text, sample_id?}` → 跑一次情绪识别并落库（识别失败也落库） |
| GET | `/api/emotion/tests?scope=all\|mine` | 所有人的测试记录（含完整 `l2` 打分） |
| GET | `/api/emotion/tests/{id}` | 单条测试，给 `?test=` 分享链接用 |
| POST | `/api/emotion/tests/{id}/feedback` | `{verdict, true_labels[], note}` → 人工评价，判错必须带标签 |
| GET | `/api/emotion/stats?scope=all\|mine` | 一致率、预测/人工标注分布、混淆矩阵、各簇一致率 |
| GET | `/api/health` | 模型名、base_url、key 是否加载成功 |

## 前端

无构建，原生 JS。左侧 rail 顶部切换三个工作区：**邮箱**、**政策评估**、**标签分析**。

**邮箱**是三栏邮件客户端：信箱（我的 / 所有人 + 场景筛选）、列表、阅读窗格。
写信弹层里的场景卡必须选一张才能发送，卡片上有产品图和邮戳状态章。
"View details" 只讲产品和订单记录——**政策判定不在这里**。

**邮件标签的展示**分两层：列表行上是意图 + 紧急度的小标签（`low` 不显示，否则每行都挂一个等于没信息，`critical` 标红）；阅读窗格里在用户来信下方插一张分析卡，展示意图 / 情绪 / 紧急度 / 识别语言四枚 chip（带置信度）、一句话摘要和抽取到的关键实体。分类失败时这张卡明确写"未能分类，这封回复是在没有标签的情况下写的"并给出原因，而不是显示一张空卡。

**政策评估台**是独立界面（`#policy-view`），结构是"规则条 + 场景导航 + 判定详情"：
- 顶部规则条从 `GET /api/policy` 取政策引擎的常量（30 天退货窗口、48 小时报损、12 个月保修、15% 重新上架费、5 个工作日退款 SLA、7 天判丢件、2 小时免费取消），不在前端复写数字。
- 左侧按商品品类分组列出全部场景；右侧把 `policy.evaluate()` 的输出拆成四层：结论卡片（可给 / 禁止 / 需客户提供，绿 / 红 / 琥珀三色）、时间计算方块、布尔判定开关、其余字段表格。四层是穷尽的——没有被前三组认领的字段一律落进最后那张表，不会有字段被悄悄吞掉。
- 从邮件的订单卡片点"政策评估"进来时，展示的是**发信时落库的 `policy_json` 快照**而不是实时重算，并在标题上标明快照时间——这样历史邮件看到的判定就是当时客服真正拿到的那份。

**标签分析台**（`#tag-view`）把 `GET /api/tags/stats` 的聚合结果画出来，统计口径是**库里全部邮件**而不是前端已加载的那一页，右上角可在"所有人 / 我的"之间切。

图表形式按数据要做的事来选，不是按好看：
- **头部 KPI 用 stat tile 不用图**——已分类数、高/紧急占比、低置信度率（分析器自己低于 0.70 的比例，等于"多少邮件难判"）、第一步平均耗时、未能分类数。单个数字画成单柱条形图是反模式。
- **意图分布用横向条形，12 类同一个蓝色**。意图是无序的名义类别，所以它是**一个系列**，每根柱子同色；按值深浅上色会把柱长已经表达的信息再编码一遍，且必然过不了配色校验。每行自带数值，不靠 tooltip 才读得到数。
- **紧急度是有序量级**（低 < 中 < 高 < 紧急），用**单色阶**（浅→深），按刻度顺序排列而不是按数量排序。
- **情绪是带中点的有序刻度**，用**发散配色**：正面三档（松绿色阶：满意 / 感谢 / 自责）↔ 中性（灰）↔ 负面五档（琥珀色阶：困惑 / 强烈诉求 / 焦虑 / 不满 / 敌意），按 `POLARITY` 降序排列。
- **语言只有 3 个值，不画图**，直接列带标签的计数——三片的饼图不比数字更清楚。

图下面是**数据表**，同样的数字不依赖颜色也能读全：
- **意图 × 紧急度交叉表**——这是上面任何一张图都给不出的信息："哪些话题最急"。行按合计降序，列按紧急度刻度顺序，带行合计与列合计，空格标 `·` 而不是留白。格子有极淡的蓝色底纹（最深 0.16 alpha）只作扫读辅助，**数值由数字承担**，所以文字对比度在任何一格都不受影响。
- **四张分项表**（意图 / 紧急度 / 情绪 / 语言），每张给标签、邮件数、占比和合计行。有序维度按刻度排，无序维度按数量排。

配色不是手挑的，是用 dataviz 校验脚本跑出来的：紧急度色阶通过 `--ordinal` 全项校验（单色相、明度单调、相邻 ΔL ≥ 0.06、最浅端对白底 2.17:1）；意图蓝 8.39:1、情绪正极松绿 7.71:1。情绪扩到 9 档后两条臂各自重跑 `--ordinal` 全通过，绿臂与灰中点、灰中点与琥珀臂这两个交界按类别配色校验，红绿色盲下 ΔE 15.5 / 16.5、正常视觉 18.0 / 18.6，都在底线（8 / 15）之上；最暗那档 `confused` 对卡面 2.69:1 低于 3:1 的记号底线，之所以能用，是因为图例和下面的分项表把每个数都写成了文字。第一版试过"琥珀→橙→红"的三色警示配色，校验直接判死：琥珀和橙在红绿色盲下 ΔE 只有 0.2，正常视觉也只有 6.3（底线 15），所以换成了单色阶。
堆叠条的分段宽度用 `flex-grow = 计数`、`flex-basis: 0` 而不是百分比宽度——2px 的分段间隙会从轨道总宽里扣，用百分比会让总和超过 100% 再被 flex-shrink 悄悄压缩，比例就不准了。

**三语界面**（`I18N` 的 `en` / `zh` / `es`，右上角切换，`localStorage` 记忆）。
翻译边界按"这段文字是谁写的"来划：
- **界面文案 + 枚举值 + 场景名翻译**——UI 文案（`I18N`）、邮件标签（`TAG_LABELS`：12 意图 / 9 情绪簇 + 2 个已退役的旧情绪值 / 4 紧急度 / 3 语言）、场景标题与简介（`scenarios.TRANSLATIONS`，随 `/api/scenarios` 下发到 `i18n` 字段）都是三语。场景名出现在 rail 筛选、写信卡片、政策台导航和邮件列表四处，统一走 `scenarioText()`；历史邮件若对应场景已不存在，回退到发信时落库的标题。
- **字段名翻译、取值不译**——政策事实（`FACT_LABELS`）的取值是模型逐字读到的英文原文，翻译会失真。
- **原文照登**——邮件正文、产品名、订单记录、标签里的 `summary` 和关键实体都保持原文。西班牙语的客户来信是被测数据本身，不是待本地化的界面文案。

视觉走航空信封方向：冷灰纸、松绿主色、红蓝斜条边与邮戳章。≤860px 阅读窗格转为全屏浮层，政策台的场景导航转为横向滑动条。
