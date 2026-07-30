/* Helios Support Mailbox — client */

const state = {
  me: null,
  scenarios: [],
  byId: {},
  threads: [],
  scope: 'mine',
  filter: null,
  openId: null,
  picked: null,
  sending: false,
  bodyTouched: false,
  view: 'mail',
  policySel: null,      // { kind: 'scenario', scenario } | { kind: 'thread', thread }
  policyThread: null,   // thread pinned into the policy nav, if opened from a mail
  policyMeta: null,     // rulebook constants from /api/policy
  tagScope: 'all',      // the analytics view counts every mailbox by default
  tagStats: null,
};

const $ = (sel) => document.querySelector(sel);
const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
};

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* --------------------------------------------------------------- i18n --- */

const LANGS = ['en', 'zh', 'es'];

const I18N = {
  en: {
    lang_group: 'Interface language',
    brand_sub: 'Support mailbox',
    write_support: 'Write to support',
    whoami_ident: 'identifying…',
    whoami_title: 'Your mail is grouped by the IP address you connect from',
    intro_replies: 'Replies are written by <strong>Mira Castellanos</strong>, an AI agent working from the order record and the Helios policy set.',
    intro_ai_addr: 'AI reply address: <strong>care@helios.example</strong>',
    model_prefix: 'model: ',
    no_api_suffix: ' · no API key loaded',
    mailboxes: 'Mailboxes',
    my_mail: 'My mail',
    everyone: 'Everyone',
    filter_scenario: 'Filter by scenario',
    list_note_mine: 'grouped by your IP address',
    list_note_all: (n) => `${n} emails from all visitors`,
    empty_mine: 'You have not written to support yet. Pick an order, write your email, and the reply lands here.',
    empty_all: 'Nobody has written to support yet.',
    you_suffix: (id) => `${id} (you)`,
    tag_replied: 'replied',
    tag_not_delivered: 'not delivered',
    tag_sending: 'sending',
    back_to_list: '← Back to list',
    written_es: 'written in Spanish',
    written_en: 'written in English',
    lang_es: 'Spanish',
    lang_en: 'English',
    reply_writing: 'Mira is writing a reply',
    reply_failed: (err) => `The reply could not be generated. ${err}`,
    order_context_attached: 'Order context attached',
    view_details: 'View details',
    no_order_line: (price) => `no order placed · listed at ${price}`,
    order_record: 'Order record',
    policy_eval: 'Policy evaluation given to the agent',
    policy_note: 'The policy evaluation is calculated in code before the model is called. The agent is instructed to treat it as authoritative and may not offer more than it allows.',
    reviews_line: (r, rc, sv, stock) => `★ ${r} · ${rc} reviews · ${sv} sold · ${stock}`,
    rail_workspace: 'Workspace',
    view_mailbox: 'Mailbox',
    view_policy: 'Policy evaluation',
    policy_eval_short: 'Policy evaluation',
    open_policy: 'Open policy evaluation',
    policy_moved_note: 'The policy evaluation has its own console now — order details stay about the order.',
    policy_view_title: 'Policy evaluation console',
    policy_view_desc: 'What the policy engine computes before the model is called. These facts are injected into the prompt as authoritative: the agent may not contradict them, and may not offer more than they allow.',
    policy_evaluated_for: (d) => `evaluated for ${d}`,
    policy_pick: 'Pick an order on the left to see exactly what the engine hands the agent.',
    policy_from_thread: 'From this email',
    policy_snapshot_tag: 'snapshot',
    policy_no_order: 'no order',
    policy_source_live: 'live evaluation · recalculated for today',
    policy_source_snapshot: (d) => `snapshot recorded when this email was sent · ${d}`,
    policy_verdict_allow: 'Entitlement — what the agent may offer',
    policy_verdict_deny: 'Hard limit — what the agent may not offer',
    policy_verdict_ask: 'Needed from the customer',
    policy_clocks: 'Clocks the engine computed',
    policy_flags: 'Flags',
    policy_context: 'Everything else in the facts block',
    rule_return_window: 'Change-of-mind return',
    rule_damage_window: 'Damage report window',
    rule_warranty: 'Warranty',
    rule_restocking: 'Restocking fee',
    rule_refund_sla: 'Refund release SLA',
    rule_lost_claim: 'Parcel treated as lost',
    rule_cancel_window: 'Free cancel / address change',
    unit_days: ' days',
    unit_months: ' months',
    unit_hours: ' hours',
    unit_business_days: ' business days',
    unit_pct: '%',
    yes: 'yes',
    no: 'no',
    analysis_title: 'Message analysis',
    analysis_failed: (err) => `The message could not be classified, so the reply was written without tags. ${err}`,
    analysis_ms: (n) => `analysed in ${n} ms`,
    tag_intent: 'Intent',
    tag_sentiment: 'Sentiment',
    tag_urgency: 'Urgency',
    tag_language: 'Detected language',
    tag_entities: 'Key entities',
    tag_ambiguity: 'Ambiguity',
    tag_evidence: 'Evidence',
    tag_alternatives: 'Alternative intents',
    tag_review_reasons: 'Review reasons',
    needs_review_flag: 'Flagged for human review',
    tag_review_breakdown: 'Review verdict',
    verdict_model: 'AI model',
    verdict_rules: 'Rule engine',
    verdict_yes: 'Needs review',
    verdict_no: 'No review needed',
    no_reasons_recorded: '(no specific reason recorded)',
    confidence: (v) => `confidence ${v}`,
    entity_product_mentioned: 'Product mentioned',
    entity_issue_mentioned: 'Issue mentioned',
    entity_deadline_mentioned: 'Deadline mentioned',
    view_tags: 'Tag analytics',
    tags_view_title: 'Tag analytics',
    tags_view_desc: 'What the step-1 analyser made of the mail. Counts cover every stored email, not just the page loaded below.',
    tags_scope: 'Which mailboxes to count',
    tags_empty: 'No mail has been analysed yet. Write to support and the tags land here.',
    kpi_analysed: 'Emails classified',
    kpi_analysed_sub: (t) => `of ${t} received`,
    kpi_pressure: 'High or critical',
    kpi_pressure_sub: 'share of classified mail',
    kpi_unsure: 'Low confidence',
    kpi_unsure_sub: 'analyser below 0.70',
    kpi_speed: 'Median step-1 cost',
    kpi_speed_sub: (v) => `avg intent confidence ${v}`,
    kpi_failed: 'Not classified',
    kpi_failed_sub: 'analyser failed or errored',
    chart_intent: 'What people write about',
    chart_intent_sub: 'emails per intent',
    chart_urgency: 'Urgency mix',
    chart_urgency_sub: 'low to critical, share of classified mail',
    chart_sentiment: 'Sentiment, centred on neutral',
    chart_sentiment_sub: 'satisfied to the left, negative to the right',
    chart_language: 'Language detected',
    n_emails: (n) => `${n} emails`,
    of_total: (pct) => `${pct}% of total`,
    table_section: 'Data tables',
    table_cross: 'Intent × urgency',
    table_cross_sub: 'which topics carry the pressure — counts of classified emails',
    th_tag: 'Tag',
    th_emails: 'Emails',
    th_share: 'Share',
    th_total: 'Total',
    compose_title: 'Write to support',
    compose_desc: 'Pick the order you are writing about, then write your email. English or Spanish — the reply follows your language.',
    step1_text: 'Choose the order this email is about',
    required: '(required)',
    step2_text: 'Write your email',
    label_to: 'To',
    label_subject: 'Subject',
    ph_subject: 'What is this about?',
    ph_body: "Select an order above and we'll drop in a sample email you can edit.",
    reset_sample: 'Reset to sample text',
    send_email: 'Send email',
    sending: 'Sending…',
    chip_es: 'Detected: Spanish → reply in Spanish',
    chip_en: 'Detected: English → reply in English',
    err_choose_order: 'Choose the order this email is about first.',
    err_write_email: 'Write your email before sending.',
    err_not_delivered: (msg) => `Not delivered. ${msg}`,
    toast_reply_received: 'Reply received.',
    toast_choose_first: 'Choose an order first.',
    toast_open_fail: (msg) => `Could not open that message: ${msg}`,
    toast_load_fail: (msg) => `Could not load the mailbox: ${msg}`,
    toast_no_api: 'No API key loaded. Add MODEL_OPENAI_API_KEY to .env and restart.',
    cancel: 'Cancel',
    manual_reply_btn: 'Reply manually',
    manual_reply_send: 'Send manual reply',
    manual_reply_sent: 'Manual reply sent.',
    manual_reply_tag: 'Manual reply',
    err_write_reply: 'Write a reply before sending.',
    toast_manual_fail: (msg) => `Could not send the manual reply: ${msg}`,
    status_pre_order_inquiry: 'no order yet',
    status_paid_unshipped: 'awaiting shipment',
    status_in_transit: 'in transit',
    status_arrived_unsigned: 'awaiting pickup',
    status_received_unconfirmed: 'received, unconfirmed',
    status_delivered: 'delivered',
    status_returning: 'return in progress',
    status_return_completed: 'return completed',
    stock_in_stock: 'in stock',
    stock_low_stock: 'low stock',
    stock_out_of_stock: 'out of stock',
  },
  zh: {
    lang_group: '界面语言',
    brand_sub: '客服邮箱',
    write_support: '写信给客服',
    whoami_ident: '识别中…',
    whoami_title: '你的邮件按你连接使用的 IP 地址分组',
    intro_replies: '回复由 <strong>Mira Castellanos</strong> 撰写，这是一个基于订单记录和 Helios 政策集工作的 AI 客服。',
    intro_ai_addr: 'AI 回复邮箱：<strong>care@helios.example</strong>',
    model_prefix: '模型：',
    no_api_suffix: ' · 未加载 API 密钥',
    mailboxes: '邮箱',
    my_mail: '我的邮件',
    everyone: '所有人',
    filter_scenario: '按场景筛选',
    list_note_mine: '按你的 IP 地址分组',
    list_note_all: (n) => `来自所有访客的 ${n} 封邮件`,
    empty_mine: '你还没有写信给客服。选择一个订单，写下你的邮件，回复会显示在这里。',
    empty_all: '还没有人写信给客服。',
    you_suffix: (id) => `${id}（你）`,
    tag_replied: '已回复',
    tag_not_delivered: '未送达',
    tag_sending: '发送中',
    back_to_list: '← 返回列表',
    written_es: '以西班牙语写作',
    written_en: '以英语写作',
    lang_es: '西班牙语',
    lang_en: '英语',
    reply_writing: 'Mira 正在撰写回复',
    reply_failed: (err) => `无法生成回复。${err}`,
    order_context_attached: '已附上订单信息',
    view_details: '查看详情',
    no_order_line: (price) => `未下单 · 标价 ${price}`,
    order_record: '订单记录',
    policy_eval: '提供给客服的政策评估',
    policy_note: '政策评估在调用模型之前由代码计算。客服被要求将其视为权威依据，不得提供超出其允许范围的内容。',
    reviews_line: (r, rc, sv, stock) => `★ ${r} · ${rc} 条评价 · 已售 ${sv} · ${stock}`,
    rail_workspace: '工作区',
    view_mailbox: '邮箱',
    view_policy: '政策评估',
    policy_eval_short: '政策评估',
    open_policy: '打开政策评估',
    policy_moved_note: '政策评估已经移到独立的界面，订单详情只讲订单本身。',
    policy_view_title: '政策评估台',
    policy_view_desc: '调用模型之前，政策引擎算出的结论。这些事实会作为权威依据注入提示词：客服不得与之矛盾，也不得给出超出允许范围的方案。',
    policy_evaluated_for: (d) => `评估基准日 ${d}`,
    policy_pick: '在左侧选择一个订单，查看引擎交给客服的完整判定。',
    policy_from_thread: '来自这封邮件',
    policy_snapshot_tag: '快照',
    policy_no_order: '无订单',
    policy_source_live: '实时判定 · 按今天重新计算',
    policy_source_snapshot: (d) => `发信时记录的快照 · ${d}`,
    policy_verdict_allow: '可给方案 —— 客服能提供什么',
    policy_verdict_deny: '硬性限制 —— 客服不得提供什么',
    policy_verdict_ask: '需要客户提供',
    policy_clocks: '引擎算出的时间',
    policy_flags: '判定开关',
    policy_context: '事实块中的其余字段',
    rule_return_window: '无理由退货窗口',
    rule_damage_window: '报损窗口',
    rule_warranty: '保修期',
    rule_restocking: '重新上架费',
    rule_refund_sla: '退款放行 SLA',
    rule_lost_claim: '判定丢件',
    rule_cancel_window: '免费取消 / 改地址',
    unit_days: ' 天',
    unit_months: ' 个月',
    unit_hours: ' 小时',
    unit_business_days: ' 个工作日',
    unit_pct: '%',
    yes: '是',
    no: '否',
    analysis_title: '邮件分析',
    analysis_failed: (err) => `邮件分类失败，这封回复是在没有标签的情况下写的。${err}`,
    analysis_ms: (n) => `分析耗时 ${n} 毫秒`,
    tag_intent: '意图',
    tag_sentiment: '情绪',
    tag_urgency: '紧急度',
    tag_language: '识别语言',
    tag_entities: '关键信息',
    tag_ambiguity: '歧义程度',
    tag_evidence: '判断依据',
    tag_alternatives: '备选意图',
    tag_review_reasons: '复核原因',
    needs_review_flag: '已标记为需要人工复核',
    tag_review_breakdown: '复核判定',
    verdict_model: 'AI 模型',
    verdict_rules: '规则引擎',
    verdict_yes: '需要复核',
    verdict_no: '无需复核',
    no_reasons_recorded: '（未记录具体原因）',
    confidence: (v) => `置信度 ${v}`,
    entity_product_mentioned: '提到的商品',
    entity_issue_mentioned: '提到的问题',
    entity_deadline_mentioned: '提到的期限',
    view_tags: '标签分析',
    tags_view_title: '标签分析',
    tags_view_desc: '第一步分析器对邮件的判读汇总。统计口径是库里全部邮件，不只是下方加载的那一页。',
    tags_scope: '统计范围',
    tags_empty: '还没有邮件被分析过。写信给客服，标签会出现在这里。',
    kpi_analysed: '已分类邮件',
    kpi_analysed_sub: (t) => `共收到 ${t} 封`,
    kpi_pressure: '高 / 紧急占比',
    kpi_pressure_sub: '占已分类邮件',
    kpi_unsure: '低置信度',
    kpi_unsure_sub: '分析器低于 0.70',
    kpi_speed: '第一步平均耗时',
    kpi_speed_sub: (v) => `平均意图置信度 ${v}`,
    kpi_failed: '未能分类',
    kpi_failed_sub: '分析器失败或报错',
    chart_intent: '客户都在问什么',
    chart_intent_sub: '各意图的邮件数',
    chart_urgency: '紧急度分布',
    chart_urgency_sub: '从低到紧急，占已分类邮件的比例',
    chart_sentiment: '情绪分布，以中性为轴',
    chart_sentiment_sub: '满意在左，负面在右',
    chart_language: '识别到的语言',
    n_emails: (n) => `${n} 封`,
    of_total: (pct) => `占总量 ${pct}%`,
    table_section: '数据表',
    table_cross: '意图 × 紧急度',
    table_cross_sub: '哪些话题最急——已分类邮件的计数',
    th_tag: '标签',
    th_emails: '邮件数',
    th_share: '占比',
    th_total: '合计',
    compose_title: '写信给客服',
    compose_desc: '选择你要咨询的订单，然后写下你的邮件。英语或西班牙语——回复会跟随你的语言。',
    step1_text: '选择这封邮件涉及的订单',
    required: '（必填）',
    step2_text: '写下你的邮件',
    label_to: '收件人',
    label_subject: '主题',
    ph_subject: '关于什么？',
    ph_body: '在上方选择一个订单，我们会填入一封可编辑的示例邮件。',
    reset_sample: '重置为示例文本',
    send_email: '发送邮件',
    sending: '发送中…',
    chip_es: '检测到：西班牙语 → 用西班牙语回复',
    chip_en: '检测到：英语 → 用英语回复',
    err_choose_order: '请先选择这封邮件涉及的订单。',
    err_write_email: '发送前请先写下你的邮件。',
    err_not_delivered: (msg) => `未送达。${msg}`,
    toast_reply_received: '已收到回复。',
    toast_choose_first: '请先选择一个订单。',
    toast_open_fail: (msg) => `无法打开该邮件：${msg}`,
    toast_load_fail: (msg) => `无法加载邮箱：${msg}`,
    toast_no_api: '未加载 API 密钥。请在 .env 中添加 MODEL_OPENAI_API_KEY 后重启。',
    cancel: '取消',
    manual_reply_btn: '人工回复',
    manual_reply_send: '发送人工回复',
    manual_reply_sent: '人工回复已发送。',
    manual_reply_tag: '人工回复',
    err_write_reply: '发送前请先写下回复内容。',
    toast_manual_fail: (msg) => `人工回复发送失败：${msg}`,
    status_pre_order_inquiry: '下单前咨询',
    status_paid_unshipped: '已付款未发货',
    status_in_transit: '运输中',
    status_arrived_unsigned: '到达未签收',
    status_received_unconfirmed: '收货未确认',
    status_delivered: '已签收',
    status_returning: '退货中',
    status_return_completed: '退货完成',
    stock_in_stock: '有货',
    stock_low_stock: '库存紧张',
    stock_out_of_stock: '缺货',
  },
  es: {
    lang_group: 'Idioma de la interfaz',
    brand_sub: 'Buzón de soporte',
    write_support: 'Escribir a soporte',
    whoami_ident: 'identificando…',
    whoami_title: 'Su correo se agrupa según la dirección IP desde la que se conecta',
    intro_replies: 'Las respuestas las escribe <strong>Mira Castellanos</strong>, un agente de IA que trabaja a partir del registro del pedido y las políticas de Helios.',
    intro_ai_addr: 'Dirección de respuesta de la IA: <strong>care@helios.example</strong>',
    model_prefix: 'modelo: ',
    no_api_suffix: ' · sin clave de API cargada',
    mailboxes: 'Buzones',
    my_mail: 'Mi correo',
    everyone: 'Todos',
    filter_scenario: 'Filtrar por escenario',
    list_note_mine: 'agrupado por su dirección IP',
    list_note_all: (n) => `${n} correos de todos los visitantes`,
    empty_mine: 'Todavía no ha escrito a soporte. Elija un pedido, escriba su correo y la respuesta aparecerá aquí.',
    empty_all: 'Nadie ha escrito a soporte todavía.',
    you_suffix: (id) => `${id} (usted)`,
    tag_replied: 'respondido',
    tag_not_delivered: 'no entregado',
    tag_sending: 'enviando',
    back_to_list: '← Volver a la lista',
    written_es: 'escrito en español',
    written_en: 'escrito en inglés',
    lang_es: 'Español',
    lang_en: 'Inglés',
    reply_writing: 'Mira está escribiendo una respuesta',
    reply_failed: (err) => `No se pudo generar la respuesta. ${err}`,
    order_context_attached: 'Datos del pedido adjuntos',
    view_details: 'Ver detalles',
    no_order_line: (price) => `sin pedido · precio de venta ${price}`,
    order_record: 'Registro del pedido',
    policy_eval: 'Evaluación de políticas entregada al agente',
    policy_note: 'La evaluación de políticas se calcula en código antes de llamar al modelo. El agente debe tratarla como autoritativa y no puede ofrecer más de lo que ella permite.',
    reviews_line: (r, rc, sv, stock) => `★ ${r} · ${rc} reseñas · ${sv} vendidos · ${stock}`,
    rail_workspace: 'Área de trabajo',
    view_mailbox: 'Buzón',
    view_policy: 'Evaluación de políticas',
    policy_eval_short: 'Evaluación de políticas',
    open_policy: 'Abrir la evaluación de políticas',
    policy_moved_note: 'La evaluación de políticas tiene ahora su propia consola; los detalles del pedido hablan solo del pedido.',
    policy_view_title: 'Consola de evaluación de políticas',
    policy_view_desc: 'Lo que el motor de políticas calcula antes de llamar al modelo. Estos datos se inyectan en el prompt como autoritativos: el agente no puede contradecirlos ni ofrecer más de lo que permiten.',
    policy_evaluated_for: (d) => `evaluado para el ${d}`,
    policy_pick: 'Elija un pedido a la izquierda para ver exactamente lo que el motor entrega al agente.',
    policy_from_thread: 'De este correo',
    policy_snapshot_tag: 'instantánea',
    policy_no_order: 'sin pedido',
    policy_source_live: 'evaluación en vivo · recalculada para hoy',
    policy_source_snapshot: (d) => `instantánea registrada al enviarse este correo · ${d}`,
    policy_verdict_allow: 'Derecho — lo que el agente sí puede ofrecer',
    policy_verdict_deny: 'Límite estricto — lo que el agente no puede ofrecer',
    policy_verdict_ask: 'Se necesita del cliente',
    policy_clocks: 'Plazos calculados por el motor',
    policy_flags: 'Indicadores',
    policy_context: 'El resto del bloque de datos',
    rule_return_window: 'Devolución por arrepentimiento',
    rule_damage_window: 'Plazo para reportar daños',
    rule_warranty: 'Garantía',
    rule_restocking: 'Cargo por reposición',
    rule_refund_sla: 'SLA de emisión del reembolso',
    rule_lost_claim: 'Paquete dado por perdido',
    rule_cancel_window: 'Cancelación o cambio de dirección gratis',
    unit_days: ' días',
    unit_months: ' meses',
    unit_hours: ' horas',
    unit_business_days: ' días hábiles',
    unit_pct: '%',
    yes: 'sí',
    no: 'no',
    analysis_title: 'Análisis del mensaje',
    analysis_failed: (err) => `No se pudo clasificar el mensaje, así que la respuesta se escribió sin etiquetas. ${err}`,
    analysis_ms: (n) => `analizado en ${n} ms`,
    tag_intent: 'Intención',
    tag_sentiment: 'Sentimiento',
    tag_urgency: 'Urgencia',
    tag_language: 'Idioma detectado',
    tag_entities: 'Entidades clave',
    tag_ambiguity: 'Ambigüedad',
    tag_evidence: 'Evidencia',
    tag_alternatives: 'Intenciones alternativas',
    tag_review_reasons: 'Motivos de revisión',
    needs_review_flag: 'Marcado para revisión humana',
    tag_review_breakdown: 'Veredicto de revisión',
    verdict_model: 'Modelo IA',
    verdict_rules: 'Motor de reglas',
    verdict_yes: 'Requiere revisión',
    verdict_no: 'No requiere revisión',
    no_reasons_recorded: '(sin motivo específico registrado)',
    confidence: (v) => `confianza ${v}`,
    entity_product_mentioned: 'Producto mencionado',
    entity_issue_mentioned: 'Problema mencionado',
    entity_deadline_mentioned: 'Plazo mencionado',
    view_tags: 'Análisis de etiquetas',
    tags_view_title: 'Análisis de etiquetas',
    tags_view_desc: 'Lo que el analizador del paso 1 entendió del correo. Las cifras cubren todos los correos guardados, no solo la página cargada abajo.',
    tags_scope: 'Buzones que se cuentan',
    tags_empty: 'Todavía no se ha analizado ningún correo. Escriba a soporte y las etiquetas aparecerán aquí.',
    kpi_analysed: 'Correos clasificados',
    kpi_analysed_sub: (t) => `de ${t} recibidos`,
    kpi_pressure: 'Alta o crítica',
    kpi_pressure_sub: 'del correo clasificado',
    kpi_unsure: 'Confianza baja',
    kpi_unsure_sub: 'analizador por debajo de 0,70',
    kpi_speed: 'Coste medio del paso 1',
    kpi_speed_sub: (v) => `confianza media de intención ${v}`,
    kpi_failed: 'Sin clasificar',
    kpi_failed_sub: 'el analizador falló o dio error',
    chart_intent: 'Sobre qué escribe la gente',
    chart_intent_sub: 'correos por intención',
    chart_urgency: 'Reparto de urgencia',
    chart_urgency_sub: 'de baja a crítica, sobre el correo clasificado',
    chart_sentiment: 'Sentimiento, centrado en neutral',
    chart_sentiment_sub: 'satisfecho a la izquierda, negativo a la derecha',
    chart_language: 'Idioma detectado',
    n_emails: (n) => `${n} correos`,
    of_total: (pct) => `${pct}% del total`,
    table_section: 'Tablas de datos',
    table_cross: 'Intención × urgencia',
    table_cross_sub: 'qué temas concentran la presión — recuento de correos clasificados',
    th_tag: 'Etiqueta',
    th_emails: 'Correos',
    th_share: 'Proporción',
    th_total: 'Total',
    compose_title: 'Escribir a soporte',
    compose_desc: 'Elija el pedido sobre el que escribe y redacte su correo. Inglés o español: la respuesta sigue su idioma.',
    step1_text: 'Elija el pedido al que se refiere este correo',
    required: '(obligatorio)',
    step2_text: 'Escriba su correo',
    label_to: 'Para',
    label_subject: 'Asunto',
    ph_subject: '¿De qué se trata?',
    ph_body: 'Seleccione un pedido arriba y le insertaremos un correo de ejemplo que puede editar.',
    reset_sample: 'Restaurar el texto de ejemplo',
    send_email: 'Enviar correo',
    sending: 'Enviando…',
    chip_es: 'Detectado: español → respuesta en español',
    chip_en: 'Detectado: inglés → respuesta en inglés',
    err_choose_order: 'Elija primero el pedido al que se refiere este correo.',
    err_write_email: 'Escriba su correo antes de enviarlo.',
    err_not_delivered: (msg) => `No entregado. ${msg}`,
    toast_reply_received: 'Respuesta recibida.',
    toast_choose_first: 'Elija primero un pedido.',
    toast_open_fail: (msg) => `No se pudo abrir ese mensaje: ${msg}`,
    toast_load_fail: (msg) => `No se pudo cargar el buzón: ${msg}`,
    toast_no_api: 'No hay clave de API cargada. Añada MODEL_OPENAI_API_KEY a .env y reinicie.',
    cancel: 'Cancelar',
    manual_reply_btn: 'Responder manualmente',
    manual_reply_send: 'Enviar respuesta manual',
    manual_reply_sent: 'Respuesta manual enviada.',
    manual_reply_tag: 'Respuesta manual',
    err_write_reply: 'Escriba una respuesta antes de enviarla.',
    toast_manual_fail: (msg) => `No se pudo enviar la respuesta manual: ${msg}`,
    status_pre_order_inquiry: 'sin pedido',
    status_paid_unshipped: 'pendiente de envío',
    status_in_transit: 'en tránsito',
    status_arrived_unsigned: 'en punto de recogida',
    status_received_unconfirmed: 'recibido, sin confirmar',
    status_delivered: 'entregado',
    status_returning: 'devolución en curso',
    status_return_completed: 'devolución completada',
    stock_in_stock: 'en stock',
    stock_low_stock: 'pocas unidades',
    stock_out_of_stock: 'agotado',
  },
};

/* Labels for the keys policy.evaluate() emits. Values stay verbatim on purpose:
   they are the literal strings handed to the model, so translating them would
   misrepresent what the agent actually received. */
const FACT_LABELS = {
  today:                                { en: 'Evaluated for', zh: '评估基准日', es: 'Evaluado para' },
  customer_tier:                        { en: 'Customer tier', zh: '客户等级', es: 'Nivel del cliente' },
  order_state:                          { en: 'Order state', zh: '订单状态', es: 'Estado del pedido' },
  reported_condition:                   { en: 'Reported condition', zh: '客户报告的问题', es: 'Problema reportado' },
  days_since_delivery:                  { en: 'Days since delivery', zh: '签收后天数', es: 'Días desde la entrega' },
  days_since_delivery_note:             { en: 'Return window note', zh: '退货窗口说明', es: 'Nota sobre el plazo' },
  return_window_days_remaining:         { en: 'Return window left', zh: '退货窗口剩余', es: 'Plazo de devolución restante' },
  inside_return_window:                 { en: 'Inside return window', zh: '在退货窗口内', es: 'Dentro del plazo' },
  warranty_active:                      { en: 'Warranty active', zh: '保修有效', es: 'Garantía vigente' },
  warranty_days_remaining:              { en: 'Warranty days left', zh: '保修剩余天数', es: 'Días de garantía' },
  damage_report_window_met:             { en: 'Damage reported in time', zh: '报损在窗口内', es: 'Daño reportado a tiempo' },
  entitlement:                          { en: 'Entitlement', zh: '可给方案', es: 'Derecho' },
  may_not_offer:                        { en: 'May not offer', zh: '不得提供', es: 'No puede ofrecer' },
  required_from_customer:               { en: 'Required from customer', zh: '需要客户提供', es: 'Se requiere del cliente' },
  return_shipping:                      { en: 'Return shipping', zh: '退货运费', es: 'Envío de devolución' },
  resolution_sla:                       { en: 'Resolution SLA', zh: '处理时限', es: 'SLA de resolución' },
  tier_benefit:                         { en: 'Tier benefit', zh: '会员权益', es: 'Beneficio del nivel' },
  received_instead:                     { en: 'Received instead', zh: '实际收到的商品', es: 'Recibido en su lugar' },
  days_past_estimated_delivery:         { en: 'Days past the estimate', zh: '超预计送达天数', es: 'Días tras la fecha estimada' },
  days_since_last_tracking_scan:        { en: 'Days since last scan', zh: '距上次物流扫描', es: 'Días desde el último escaneo' },
  last_tracking_event:                  { en: 'Last tracking event', zh: '最后物流节点', es: 'Último evento de seguimiento' },
  carrier_trace_required:               { en: 'Carrier trace required', zh: '需开查件', es: 'Requiere investigación' },
  treated_as_lost:                      { en: 'Treated as lost', zh: '判定为丢件', es: 'Considerado perdido' },
  days_since_warehouse_received_return: { en: 'Days since return received', zh: '仓库签收退货后天数', es: 'Días desde la recepción' },
  refund_amount:                        { en: 'Refund amount', zh: '退款金额', es: 'Importe del reembolso' },
  refund_method:                        { en: 'Refund method', zh: '退款方式', es: 'Método de reembolso' },
  refund_sla_breached:                  { en: 'Refund SLA breached', zh: '退款 SLA 已违约', es: 'SLA de reembolso incumplido' },
  stock_note:                           { en: 'Stock note', zh: '库存说明', es: 'Nota de stock' },
  price_note:                           { en: 'Price note', zh: '价格说明', es: 'Nota de precio' },
  if_they_buy:                          { en: 'If they buy', zh: '若下单后', es: 'Si compra' },
};

const factLabel = (key) => (FACT_LABELS[key] && FACT_LABELS[key][LANG]) || FACT_LABELS[key]?.en || key;

const FACT_CALLOUTS = [
  ['entitlement', 'allow', 'policy_verdict_allow'],
  ['may_not_offer', 'deny', 'policy_verdict_deny'],
  ['required_from_customer', 'ask', 'policy_verdict_ask'],
];
const FACT_SIDE_NOTES = ['return_shipping', 'tier_benefit', 'resolution_sla'];
const FACT_CLOCKS = [
  'days_since_delivery', 'return_window_days_remaining', 'warranty_days_remaining',
  'days_past_estimated_delivery', 'days_since_last_tracking_scan',
  'days_since_warehouse_received_return',
];
const FACT_FLAGS = [
  'inside_return_window', 'warranty_active', 'damage_report_window_met',
  'carrier_trace_required', 'treated_as_lost', 'refund_sla_breached',
];

/* The step-1 taxonomy, mirrored from email_automatic_reply_en_US.jinjia2.
   Unlike the policy facts, these are closed enums rather than model prose, so
   they can be translated safely. */
const TAG_LABELS = {
  intent: {
    order_issue:          { en: 'Order issue', zh: '订单问题', es: 'Problema del pedido' },
    shipping_issue:       { en: 'Shipping issue', zh: '物流问题', es: 'Problema de envío' },
    return_refund:        { en: 'Return or refund', zh: '退货退款', es: 'Devolución o reembolso' },
    product_quality:      { en: 'Product quality', zh: '商品质量', es: 'Calidad del producto' },
    product_inquiry:      { en: 'Product question', zh: '商品咨询', es: 'Consulta de producto' },
    wrong_missing_item:   { en: 'Wrong or missing item', zh: '错发漏发', es: 'Artículo erróneo o faltante' },
    payment_issue:        { en: 'Payment issue', zh: '支付问题', es: 'Problema de pago' },
    seller_complaint:     { en: 'Seller complaint', zh: '投诉卖家', es: 'Queja sobre el vendedor' },
    review_feedback:      { en: 'Review feedback', zh: '评价相关', es: 'Reseñas' },
    account_security:     { en: 'Account security', zh: '账号安全', es: 'Seguridad de la cuenta' },
    warranty_replacement: { en: 'Warranty or replacement', zh: '保修换货', es: 'Garantía o reemplazo' },
    other:                { en: 'Other', zh: '其他', es: 'Otro' },
  },
  sentiment: {
    satisfied:    { en: 'Satisfied', zh: '满意', es: 'Satisfecho' },
    neutral:      { en: 'Neutral', zh: '中性', es: 'Neutral' },
    confused:     { en: 'Confused', zh: '困惑', es: 'Confundido' },
    disappointed: { en: 'Disappointed', zh: '失望', es: 'Decepcionado' },
    frustrated:   { en: 'Frustrated', zh: '不满', es: 'Frustrado' },
    angry:        { en: 'Angry', zh: '愤怒', es: 'Enfadado' },
  },
  urgency: {
    low:      { en: 'Low', zh: '低', es: 'Baja' },
    medium:   { en: 'Medium', zh: '中', es: 'Media' },
    high:     { en: 'High', zh: '高', es: 'Alta' },
    critical: { en: 'Critical', zh: '紧急', es: 'Crítica' },
  },
  language: {
    en:    { en: 'English', zh: '英语', es: 'Inglés' },
    es:    { en: 'Spanish', zh: '西班牙语', es: 'Español' },
    other: { en: 'Other', zh: '其他', es: 'Otro' },
  },
  ambiguity: {
    clear:    { en: 'Clear', zh: '明确', es: 'Clara' },
    moderate: { en: 'Moderate', zh: '轻度', es: 'Moderada' },
    high:     { en: 'High', zh: '较高', es: 'Alta' },
    critical: { en: 'Critical', zh: '严重', es: 'Crítica' },
  },
};

/* Scenario titles/blurbs ship from the API with an `i18n` block; English lives on
   the scenario itself and is the fallback. */
const scenarioText = (scenario, field) => {
  if (!scenario) return '';
  const tr18 = scenario.i18n && scenario.i18n[LANG];
  return (tr18 && tr18[field]) || scenario[field] || '';
};

/* For a stored thread: prefer the live scenario's translation, fall back to the
   title snapshotted at send time so history still reads if a scenario is removed. */
const threadScenarioTitle = (thread) =>
  scenarioText(state.byId[thread.scenario_id], 'title') || thread.scenario_title || '';

const tagLabel = (group, value) => {
  const entry = TAG_LABELS[group] && TAG_LABELS[group][value];
  return (entry && (entry[LANG] || entry.en)) || value || '—';
};

/* Chart palette. Every value below was re-validated against the Sheikah Slate
   card surface (--paper #11202e) — see the notes per role. On a dark surface the
   ordinal ramps run dim -> bright, the reverse of a light theme. Do not eyeball
   replacements. */
const VIZ = {
  // Intent is nominal (12 unordered categories), so it is ONE series: every bar
  // takes the same hue. Colouring bars by their own value would re-encode length.
  intentBar: '#4aa3d8',                                     // Champion's blue, 5.93:1 on #11202e
  // Urgency is ordinal (low < medium < high < critical) -> one hue, monotone
  // lightness. Guardian amber ramp: monotone L, adjacent ΔL >= 0.09, dim end
  // 3.33:1 against the card.
  urgency: ['#a35f33', '#c47a3c', '#e09a4c', '#f7c26a'],
  // Sentiment is an ordered scale with a neutral middle -> diverging. Warm/cool
  // poles, neutral grey midpoint; the negative arm reuses the validated ramp.
  sentimentPos: '#7ac74f',                                  // hero tunic green, 8.04:1 on #11202e
  sentimentMid: '#7d8f9e',                                  // 4.97:1
  sentimentNeg: ['#a35f33', '#c47a3c', '#e09a4c', '#f7c26a'],
};

// Reading order for the diverging sentiment bar: positive, neutral, then
// increasingly negative. Swapping these would change the meaning.
const SENTIMENT_ORDER = ['satisfied', 'neutral', 'confused', 'disappointed', 'frustrated', 'angry'];
const URGENCY_ORDER = ['low', 'medium', 'high', 'critical'];

const sentimentColor = (value) => {
  if (value === 'satisfied') return VIZ.sentimentPos;
  if (value === 'neutral') return VIZ.sentimentMid;
  const i = SENTIMENT_ORDER.indexOf(value) - 2;
  return VIZ.sentimentNeg[Math.max(0, Math.min(i, VIZ.sentimentNeg.length - 1))];
};

const RULE_CHIPS = [
  ['return_window_days', 'rule_return_window', 'unit_days'],
  ['damage_report_window_days', 'rule_damage_window', 'unit_days'],
  ['warranty_months', 'rule_warranty', 'unit_months'],
  ['restocking_fee_pct', 'rule_restocking', 'unit_pct'],
  ['refund_sla_days', 'rule_refund_sla', 'unit_business_days'],
  ['lost_package_claim_days', 'rule_lost_claim', 'unit_days'],
  ['cancel_window_hours', 'rule_cancel_window', 'unit_hours'],
];

let LANG = LANGS.includes(localStorage.getItem('helios_lang')) ? localStorage.getItem('helios_lang') : 'en';

function tr(key, ...args) {
  const dict = I18N[LANG] || I18N.en;
  let v = dict[key];
  if (v === undefined) v = I18N.en[key];
  if (typeof v === 'function') return v(...args);
  return v === undefined ? key : v;
}

function applyModelLine() {
  const line = $('#model-line');
  if (!line) return;
  const h = state.health;
  line.textContent = h
    ? `${tr('model_prefix')}${h.model}${h.api_key_loaded ? '' : tr('no_api_suffix')}`
    : `${tr('model_prefix')}—`;
}

function applyStaticI18n() {
  document.documentElement.lang = LANG;
  document.querySelectorAll('[data-i18n]').forEach((n) => { n.textContent = tr(n.dataset.i18n); });
  document.querySelectorAll('[data-i18n-html]').forEach((n) => { n.innerHTML = tr(n.dataset.i18nHtml); });
  document.querySelectorAll('[data-i18n-ph]').forEach((n) => { n.placeholder = tr(n.dataset.i18nPh); });
  document.querySelectorAll('[data-i18n-title]').forEach((n) => { n.title = tr(n.dataset.i18nTitle); });
  document.querySelectorAll('[data-i18n-label]').forEach((n) => { n.setAttribute('aria-label', tr(n.dataset.i18nLabel)); });
  document.querySelectorAll('#lang-select button').forEach((b) => {
    b.classList.toggle('is-on', b.dataset.lang === LANG);
    b.setAttribute('aria-pressed', String(b.dataset.lang === LANG));
  });
  const handle = $('#whoami-handle');
  if (handle && !state.me) handle.textContent = tr('whoami_ident');
  applyModelLine();
}

function setLang(lang) {
  if (!LANGS.includes(lang)) return;
  LANG = lang;
  localStorage.setItem('helios_lang', lang);
  applyStaticI18n();
  if (state.scenarios.length) { renderScenarioFilters(); renderScenarioGrid(); }
  renderList();
  if (state.openThread) renderThread(state.openThread);
  if (state.picked) updateLangChip();
  if (state.view === 'policy') renderPolicy();
  if (state.view === 'tags') renderTagView();
}

/* ------------------------------------------------------------ helpers --- */

const STATUS_KEYS = {
  pre_order_inquiry: 'status_pre_order_inquiry',
  paid_unshipped: 'status_paid_unshipped',
  in_transit: 'status_in_transit',
  arrived_unsigned: 'status_arrived_unsigned',
  received_unconfirmed: 'status_received_unconfirmed',
  delivered: 'status_delivered',
  returning: 'status_returning',
  return_completed: 'status_return_completed',
};

const IN_TRANSIT_STATUSES = ['in_transit', 'arrived_unsigned', 'received_unconfirmed'];

function stampClass(order) {
  if (order.order_status === 'delivered' && !order.condition_reported) return 'stamp stamp--settled';
  if (order.payment_status === 'refund_processing') return 'stamp stamp--pending';
  if (order.order_status === 'return_completed') return 'stamp stamp--settled';
  if (order.order_status === 'pre_order_inquiry') return 'stamp stamp--settled';
  if (order.condition_reported || IN_TRANSIT_STATUSES.includes(order.order_status)) return 'stamp';
  return 'stamp stamp--pending';
}

function stampText(order) {
  const key = STATUS_KEYS[order.order_status];
  return key ? tr(key) : (order.order_status || 'unknown').replace(/_/g, ' ');
}

function stockText(status) {
  return I18N.en[`stock_${status}`] !== undefined ? tr(`stock_${status}`) : (status || '').replace(/_/g, ' ');
}

function money(v, cur) {
  if (v === null || v === undefined) return null;
  return `${Number(v).toFixed(2)} ${cur || 'USD'}`;
}

function when(ts) {
  const d = new Date(ts * 1000);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  return sameDay
    ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ' ' +
      d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function detectLang(text) {
  if (!text || !text.trim()) return 'en';
  let es = (text.match(/\b(hola|buenas|gracias|pedido|envío|envio|devolución|devolucion|reembolso|producto|compra|entrega|paquete|garantía|garantia|necesito|quiero|por favor|cuándo|dónde|pero|porque|también|todavía)\b/gi) || []).length;
  const en = (text.match(/\b(the|and|order|shipping|return|refund|please|thanks|hello|hi|delivery|package|warranty|need|want|when|where|but|because|still|would|could)\b/gi) || []).length;
  if (/[áéíóúñ¿¡]/i.test(text)) es += 3;
  return es > en ? 'es' : 'en';
}

function toast(message, ms = 3200) {
  const t = $('#toast');
  t.textContent = message;
  t.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { t.hidden = true; }, ms);
}

async function api(path, options) {
  const res = await fetch(path, options);
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { detail: text }; }
  if (!res.ok) throw Object.assign(new Error((data && (data.detail || data.error)) || res.statusText), { data, status: res.status });
  return data;
}

/* --------------------------------------------------------------- boot --- */

async function boot() {
  try {
    const [me, sc, health, pol] = await Promise.all([
      api('/api/me'), api('/api/scenarios'), api('/api/health').catch(() => null),
      api('/api/policy').catch(() => null),
    ]);
    state.me = me;
    state.scenarios = sc.scenarios;
    sc.scenarios.forEach((s) => { state.byId[s.scenario_id] = s; });
    state.policyMeta = pol;

    $('#whoami-handle').textContent = `${me.user_id} · ${me.ip}`;
    state.health = health || null;
    $('#count-policy').textContent = sc.scenarios.length;
    applyStaticI18n();
    if (health && !health.api_key_loaded) toast(tr('toast_no_api'), 8000);

    renderScenarioFilters();
    renderScenarioGrid();
    await refreshThreads();
  } catch (err) {
    toast(tr('toast_load_fail', err.message), 8000);
  }
}

/* ----------------------------------------------------------- threads ---- */

async function refreshThreads() {
  const [mine, all] = await Promise.all([
    api('/api/threads?scope=mine&limit=200'),
    api('/api/threads?scope=all&limit=200'),
  ]);
  state.mine = mine.threads;
  state.all = all.threads;
  $('#count-mine').textContent = mine.threads.length;
  $('#count-all').textContent = all.threads.length;
  renderList();
  loadTagStats();  // keeps the rail count and the analytics view in step with sends
}

function visibleThreads() {
  const rows = state.scope === 'mine' ? (state.mine || []) : (state.all || []);
  return state.filter ? rows.filter((r) => r.scenario_id === state.filter) : rows;
}

function renderList() {
  const box = $('#thread-list');
  box.innerHTML = '';
  const rows = visibleThreads();

  $('#list-title').textContent = state.scope === 'mine' ? tr('my_mail') : tr('everyone');
  $('#list-note').textContent = state.scope === 'mine'
    ? tr('list_note_mine')
    : tr('list_note_all', (state.all || []).length);

  if (!rows.length) {
    const empty = el('div', 'list__empty');
    empty.textContent = state.scope === 'mine' ? tr('empty_mine') : tr('empty_all');
    box.append(empty);
    return;
  }

  for (const t of rows) {
    const row = el('button', 'mailrow' + (t.id === state.openId ? ' is-open' : ''));
    row.type = 'button';
    row.dataset.id = t.id;

    const top = el('div', 'mailrow__top');
    const mine = state.me && t.user_id === state.me.user_id;
    const who = el('span', 'mailrow__who' + (mine ? ' is-me' : ''), mine ? tr('you_suffix', t.user_id) : t.user_id);
    top.append(who, el('span', 'mailrow__time', when(t.created_at)));

    const subject = el('p', 'mailrow__subject', t.subject || '(no subject)');
    const preview = el('p', 'mailrow__preview', t.preview || '');

    const tags = el('div', 'mailrow__tags');
    tags.append(el('span', 'tag', threadScenarioTitle(t)));
    tags.append(el('span', 'tag tag--lang', t.in_language === 'es' ? 'ES' : 'EN'));
    if (t.tags && t.tags.intent) {
      tags.append(el('span', 'tag tag--intent', tagLabel('intent', t.tags.intent)));
    }
    // `low` is the common case; showing it on every row would be noise.
    if (t.tags && t.tags.urgency && t.tags.urgency !== 'low') {
      tags.append(el('span', `tag tag--urg is-${t.tags.urgency}`, tagLabel('urgency', t.tags.urgency)));
    }
    if (t.status === 'replied') tags.append(el('span', 'tag tag--ok', tr('tag_replied')));
    else if (t.status === 'failed') tags.append(el('span', 'tag tag--fail', tr('tag_not_delivered')));
    else tags.append(el('span', 'tag tag--wait', tr('tag_sending')));

    row.append(top, subject, preview, tags);
    row.addEventListener('click', () => openThread(t.id));
    box.append(row);
  }
}

async function openThread(id) {
  state.openId = id;
  renderList();
  $('#reader').classList.add('is-open');
  try {
    const t = await api(`/api/threads/${id}`);
    renderThread(t);
  } catch (err) {
    toast(tr('toast_open_fail', err.message));
  }
}

function renderThread(t) {
  state.openThread = t;
  const box = $('#reader-thread');
  box.hidden = false;
  box.innerHTML = '';

  const wrap = el('div', 'thread');

  const back = el('button', 'btn back-btn', tr('back_to_list'));
  back.addEventListener('click', () => {
    $('#reader').classList.remove('is-open');
  });
  wrap.append(back);

  const head = el('div', 'thread__head');
  head.append(el('h2', 'thread__subject', t.subject || '(no subject)'));
  const meta = el('div', 'thread__meta');
  meta.append(el('span', null, `${t.user_id}${t.is_mine ? ' (you)' : ''}`));
  meta.append(el('span', null, '·'));
  meta.append(el('span', null, new Date(t.created_at * 1000).toLocaleString()));
  meta.append(el('span', null, '·'));
  meta.append(el('span', null, t.in_language === 'es' ? tr('written_es') : tr('written_en')));
  if (t.latency_ms) { meta.append(el('span', null, '·'), el('span', null, `${(t.latency_ms / 1000).toFixed(1)}s`)); }
  head.append(meta);
  wrap.append(head);

  /* outbound */
  const out = el('div', 'msg');
  const outHead = el('div', 'msg__head');
  outHead.append(el('div', 'avatar', (t.context.customer.name || 'C').slice(0, 1)));
  const outFrom = el('div', 'msg__from', t.context.customer.name);
  outFrom.append(el('span', null, `${t.context.customer.email} → support@helios.example`));
  outHead.append(outFrom, el('div', 'msg__when', when(t.created_at)));
  out.append(outHead, el('div', 'msg__body', t.body));
  wrap.append(out);

  /* step 1: what the analyser made of that email */
  wrap.append(analysisCard(t.tags));

  /* order context attachment */
  wrap.append(attachmentCard(t));

  /* reply */
  const reply = el('div', 'msg msg--reply');
  const rHead = el('div', 'msg__head');
  rHead.append(el('div', 'avatar', 'M'));
  const rFrom = el('div', 'msg__from', 'Mira Castellanos');
  rFrom.append(el('span', null, 'Helios Customer Care · care@helios.example'));
  rHead.append(rFrom);
  if (t.reply_language) rHead.append(el('div', 'msg__when', t.reply_language === 'es' ? tr('lang_es') : tr('lang_en')));
  // A human agent's override is marked distinctly from the AI's own draft
  if (t.reply_source === 'manual') rHead.append(el('span', 'tag tag--manual', tr('manual_reply_tag')));
  reply.append(rHead);

  if (t.status === 'replied') {
    if (t.reply_subject) {
      const sub = el('div', 'msg__body');
      sub.style.paddingBottom = '0';
      sub.style.fontWeight = '600';
      sub.textContent = t.reply_subject;
      reply.append(sub);
    }
    reply.append(el('div', 'msg__body', t.reply_body || ''));
  } else if (t.status === 'failed') {
    reply.append(el('div', 'msg__fail', tr('reply_failed', t.error || '')));
  } else {
    const pending = el('div', 'msg__body msg__body--pending');
    pending.innerHTML = `${esc(tr('reply_writing'))}<span class="dots"></span>`;
    reply.append(pending);
  }
  wrap.append(reply);

  /* human-in-the-loop escape hatch: available regardless of status, so an
     agent can override a bad AI draft or supply the reply Step 2 never
     managed to write. Always visible — not gated on needs_review — since
     the analyser's flag is only a hint, not a hard gate. */
  wrap.append(manualReplyPanel(t));

  box.append(wrap);
  $('#reader').scrollTop = 0;
}

function manualReplyPanel(t) {
  const wrap = el('div', 'manual-reply');
  const needsReview = !!(t.tags && t.tags.needs_review);

  const toggle = el('button', 'btn' + (needsReview ? ' btn--flagged' : ''), tr('manual_reply_btn'));
  toggle.type = 'button';
  wrap.append(toggle);

  const form = el('div', 'compose-fields manual-reply__form');
  form.hidden = true;

  const subjectField = el('div', 'field field--inline');
  subjectField.append(el('label', null, tr('label_subject')));
  const subjectInput = document.createElement('input');
  subjectInput.value = t.reply_subject || '';
  subjectField.append(subjectInput);
  form.append(subjectField);

  // Pre-filled with whatever reply already exists (AI draft, or nothing if
  // Step 2 failed) so the agent edits rather than starts from a blank page.
  const textarea = document.createElement('textarea');
  textarea.rows = 8;
  textarea.value = t.reply_body || '';
  form.append(textarea);

  const foot = el('div', 'compose-foot');
  const cancelBtn = el('button', 'btn', tr('cancel'));
  cancelBtn.type = 'button';
  const sendBtn = el('button', 'btn btn--primary', tr('manual_reply_send'));
  sendBtn.type = 'button';
  foot.append(el('div', 'compose-foot__left'), sendBtn);
  foot.firstChild.append(cancelBtn);
  form.append(foot);

  const errBox = el('p', 'compose-error');
  errBox.hidden = true;
  form.append(errBox);

  wrap.append(form);

  toggle.addEventListener('click', () => {
    form.hidden = !form.hidden;
    if (!form.hidden) textarea.focus();
  });
  cancelBtn.addEventListener('click', () => { form.hidden = true; });

  sendBtn.addEventListener('click', async () => {
    const body = textarea.value.trim();
    errBox.hidden = true;
    if (!body) { errBox.textContent = tr('err_write_reply'); errBox.hidden = false; return; }

    sendBtn.disabled = true;
    sendBtn.textContent = tr('sending');
    try {
      const updated = await api(`/api/threads/${t.id}/manual-reply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subject: subjectInput.value, body }),
      });
      renderThread(updated);
      refreshThreads();
      toast(tr('manual_reply_sent'));
    } catch (err) {
      errBox.textContent = tr('toast_manual_fail', err.message);
      errBox.hidden = false;
      sendBtn.disabled = false;
      sendBtn.textContent = tr('manual_reply_send');
    }
  });

  return wrap;
}

function tagChip(group, value, confidence) {
  const chip = el('span', `tagchip is-${group}-${value}`);
  chip.append(el('span', 'tagchip__k', tr(`tag_${group}`)));
  chip.append(el('span', 'tagchip__v', tagLabel(group, value)));
  if (confidence !== null && confidence !== undefined) {
    chip.append(el('span', 'tagchip__c', tr('confidence', confidence)));
  }
  return chip;
}

function analysisCard(tags) {
  const card = el('div', 'analysis');

  const head = el('div', 'analysis__head');
  head.append(el('span', 'analysis__title', tr('analysis_title')));
  if (tags && tags.analysis_ms !== null && tags.analysis_ms !== undefined) {
    head.append(el('span', 'analysis__ms', tr('analysis_ms', tags.analysis_ms)));
  }
  card.append(head);

  /* Step 1 can fail without taking the reply down with it — say so plainly
     rather than rendering an empty shell. */
  if (!tags || !tags.intent) {
    card.append(el('p', 'analysis__fail', tr('analysis_failed', (tags && tags.error) || '')));
    return card;
  }

  const chips = el('div', 'analysis__chips');
  chips.append(tagChip('intent', tags.intent, tags.intent_confidence));
  chips.append(tagChip('sentiment', tags.sentiment, tags.sentiment_confidence));
  chips.append(tagChip('urgency', tags.urgency));
  chips.append(tagChip('language', tags.language));
  // 歧义程度是新增的诊断字段，作为第五个 chip 展示
  if (tags.ambiguity_level) chips.append(tagChip('ambiguity', tags.ambiguity_level));
  card.append(chips);

  // needs_review 为 true 时给一条醒目提示，让复核人员一眼看到这封邮件被模型标记为需要人工介入
  if (tags.needs_review) card.append(el('p', 'analysis__flag', tr('needs_review_flag')));

  if (tags.summary) card.append(el('p', 'analysis__summary', tags.summary));

  const entities = Object.entries(tags.key_entities || {}).filter(([, v]) => v);
  if (entities.length) {
    const panel = el('div', 'panel');
    panel.append(el('div', 'panel__head', tr('tag_entities')));
    const dl = el('dl', 'kv kv--fact');
    for (const [k, v] of entities) kvRow(dl, tr(`entity_${k}`), v);
    panel.append(dl);
    card.append(panel);
  }

  // evidence：模型引用的原文片段，用来说明它为什么判定为这个 intent
  if (Array.isArray(tags.evidence) && tags.evidence.length) {
    const panel = el('div', 'panel');
    panel.append(el('div', 'panel__head', tr('tag_evidence')));
    const ul = el('ul', 'features');
    tags.evidence.forEach((line) => ul.append(el('li', null, line)));
    panel.append(ul);
    card.append(panel);
  }

  // alternative_intents：模型认为也有可能成立的备选意图，附带各自的置信度和理由
  if (Array.isArray(tags.alternative_intents) && tags.alternative_intents.length) {
    const panel = el('div', 'panel');
    panel.append(el('div', 'panel__head', tr('tag_alternatives')));
    const dl = el('dl', 'kv kv--fact');
    tags.alternative_intents.forEach((alt) => {
      const label = tagLabel('intent', alt.intent)
        + (alt.confidence !== null && alt.confidence !== undefined ? ` · ${tr('confidence', alt.confidence)}` : '');
      kvRow(dl, label, alt.reason || null);
    });
    panel.append(dl);
    card.append(panel);
  }

  // 复核判定：模型自评 和 规则引擎 是两路独立判断，分别展示，方便审计到底是
  // "模型自己觉得该复核" 还是 "命中了确定性规则"。旧数据没有 model_/rule_ 前缀
  // 字段（这次改动之前存的邮件），退化成展示合并后的 review_reasons 列表。
  if (tags.model_needs_review !== undefined || tags.rule_needs_review !== undefined) {
    const panel = el('div', 'panel');
    panel.append(el('div', 'panel__head', tr('tag_review_breakdown')));
    const body = el('div', 'review-breakdown');
    body.append(reviewVerdictRow(tr('verdict_model'), tags.model_needs_review, tags.model_review_reasons));
    body.append(reviewVerdictRow(tr('verdict_rules'), tags.rule_needs_review, tags.rule_review_reasons));
    panel.append(body);
    card.append(panel);
  } else if (Array.isArray(tags.review_reasons) && tags.review_reasons.length) {
    const panel = el('div', 'panel');
    panel.append(el('div', 'panel__head', tr('tag_review_reasons')));
    const ul = el('ul', 'features');
    tags.review_reasons.forEach((line) => ul.append(el('li', null, line)));
    panel.append(ul);
    card.append(panel);
  }

  return card;
}

// 复核判定面板里的一行：谁做的判断（模型/规则引擎）+ 判断结果 + 具体理由列表
function reviewVerdictRow(sourceLabel, needsReview, reasons) {
  const row = el('div', 'review-breakdown__row');
  const head = el('div', 'review-breakdown__head');
  head.append(el('span', 'review-breakdown__src', sourceLabel));
  head.append(el('span', `tag ${needsReview ? 'tag--fail' : 'tag--ok'}`, needsReview ? tr('verdict_yes') : tr('verdict_no')));
  row.append(head);

  const list = Array.isArray(reasons) ? reasons.filter(Boolean) : [];
  if (list.length) {
    const ul = el('ul', 'features');
    list.forEach((line) => ul.append(el('li', null, line)));
    row.append(ul);
  } else {
    row.append(el('p', 'review-breakdown__empty', tr('no_reasons_recorded')));
  }
  return row;
}

function attachmentCard(thread) {
  const ctx = thread.context;
  const card = el('div', 'attach');
  const img = el('img', 'attach__thumb');
  img.src = ctx.product.image_url;
  img.alt = ctx.product.product_name;
  card.append(img);

  const meta = el('div', 'attach__meta');
  meta.append(el('div', 'attach__label', tr('order_context_attached')));
  meta.append(el('div', 'attach__title', ctx.product.product_name));
  const order = ctx.order;
  const line = order.order_id
    ? `${order.order_id} · ${stampText(order)} · ${money(order.amount_paid, ctx.product.currency) || '—'}`
    : tr('no_order_line', money(ctx.product.price, ctx.product.currency));
  meta.append(el('p', 'attach__line', line));
  card.append(meta);

  const actions = el('div', 'attach__actions');
  const details = el('button', 'btn', tr('view_details'));
  details.addEventListener('click', () => showDetails(ctx.scenario_id));
  actions.append(details);

  /* The thread carries the evaluation recorded at send time, which is what the
     agent actually saw. Show that snapshot rather than a fresh calculation. */
  const pol = el('button', 'btn', tr('policy_eval_short'));
  pol.addEventListener('click', () => openPolicyForThread(thread));
  actions.append(pol);

  card.append(actions);
  return card;
}

/* ---------------------------------------------------------- scenarios --- */

function renderScenarioFilters() {
  const box = $('#scenario-filters');
  box.innerHTML = '';
  for (const s of state.scenarios) {
    const chip = el('button', 'chip', scenarioText(s, 'title'));
    chip.type = 'button';
    chip.addEventListener('click', () => {
      state.filter = state.filter === s.scenario_id ? null : s.scenario_id;
      [...box.children].forEach((c) => c.classList.remove('is-on'));
      if (state.filter) chip.classList.add('is-on');
      renderList();
    });
    box.append(chip);
  }
}

function renderScenarioGrid() {
  const grid = $('#scenario-grid');
  grid.innerHTML = '';
  for (const s of state.scenarios) {
    const card = el('div', 'scard');
    card.tabIndex = 0;
    card.setAttribute('role', 'button');
    card.dataset.id = s.scenario_id;

    const row = el('div', 'scard__row');
    const img = el('img', 'scard__thumb');
    img.src = s.product.image_url;
    img.alt = s.product.product_name;
    const text = el('div');
    text.append(el('p', 'scard__title', scenarioText(s, 'title')));
    text.append(el('p', 'scard__product', s.product.product_name));
    row.append(img, text);

    const foot = el('div', 'scard__foot');
    foot.append(el('span', stampClass(s.order), stampText(s.order)));
    const details = el('button', 'linkbtn', tr('view_details'));
    details.type = 'button';
    details.addEventListener('click', (ev) => { ev.stopPropagation(); showDetails(s.scenario_id); });
    foot.append(details);

    card.append(row, el('p', 'scard__blurb', scenarioText(s, 'blurb')), foot);

    const pick = () => pickScenario(s.scenario_id);
    card.addEventListener('click', pick);
    card.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); pick(); }
    });
    grid.append(card);
  }
}

function pickScenario(id) {
  state.picked = id;
  const s = state.byId[id];
  [...$('#scenario-grid').children].forEach((c) => c.classList.toggle('is-picked', c.dataset.id === id));

  const subject = $('#c-subject');
  const body = $('#c-body');
  if (!state.bodyTouched || !body.value.trim()) {
    subject.value = s.suggested_subject;
    body.value = s.suggested_body;
    state.bodyTouched = false;
  }
  $('#send-mail').disabled = false;
  updateLangChip();
  $('#step-write').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function updateLangChip() {
  const lang = detectLang(`${$('#c-subject').value}\n${$('#c-body').value}`);
  $('#lang-chip').textContent = lang === 'es' ? tr('chip_es') : tr('chip_en');
}

/* ------------------------------------------------------------ details --- */

const isBlank = (v) => v === null || v === undefined || v === '';

function kvRow(dl, label, value, rawKey) {
  const row = el('div');
  const dt = el('dt', null, label);
  if (rawKey && rawKey !== label) dt.append(el('i', null, rawKey));
  row.append(dt);
  row.append(el('dd', isBlank(value) ? 'is-null' : null, isBlank(value) ? 'null' : String(value)));
  dl.append(row);
}

function kvPanel(title, obj, opts = {}) {
  const panel = el('div', 'panel' + (opts.policy ? ' panel--policy' : ''));
  panel.append(el('div', 'panel__head', title));
  const dl = el('dl', 'kv' + (opts.labelled ? ' kv--fact' : ''));
  for (const [k, v] of Object.entries(obj)) {
    if (Array.isArray(v)) continue;
    kvRow(dl, opts.labelled ? factLabel(k) : k, v, opts.labelled ? k : null);
  }
  panel.append(dl);
  return panel;
}

function showDetails(scenarioId) {
  const s = state.byId[scenarioId];
  if (!s) return;
  const box = $('#details-body');
  box.innerHTML = '';

  const hero = el('div', 'detail-hero');
  const img = el('img');
  img.src = s.product.image_url;
  img.alt = s.product.product_name;
  const info = el('div');
  info.append(el('h2', null, s.product.product_name));
  info.append(el('p', null, s.product.description));
  const price = el('div', 'price', money(s.product.price, s.product.currency));
  if (s.product.original_price && s.product.original_price !== s.product.price) {
    price.append(el('s', null, money(s.product.original_price, s.product.currency)));
  }
  info.append(price);
  const rating = el('p', 'attach__line',
    tr('reviews_line', s.product.rating, s.product.review_count.toLocaleString(),
      s.product.sales_volume.toLocaleString(), stockText(s.product.stock_status)));
  rating.style.marginTop = '8px';
  info.append(rating);
  const feats = el('ul', 'features');
  (s.product.key_features || []).forEach((f) => feats.append(el('li', null, f)));
  info.append(feats);
  hero.append(img, info);
  box.append(hero);

  box.append(kvPanel(tr('order_record'), s.order));

  /* The policy evaluation lives in its own console; link across instead of
     duplicating it here. */
  const foot = el('div', 'detail-foot');
  const open = el('button', 'btn btn--primary', tr('open_policy'));
  open.addEventListener('click', () => { $('#details').close(); openPolicyFor(s.scenario_id); });
  foot.append(open, el('p', 'detail-foot__note', tr('policy_moved_note')));
  box.append(foot);

  $('#details').showModal();
}

/* ------------------------------------------------------ policy console --- */

function setView(view) {
  state.view = view;
  const ws = document.querySelector('.workspace');
  ws.classList.toggle('is-policy', view === 'policy');
  ws.classList.toggle('is-tags', view === 'tags');
  document.querySelectorAll('.rail__item[data-view]').forEach((b) => {
    b.classList.toggle('is-active', b.dataset.view === view);
  });
  if (view === 'policy') {
    if (!state.policySel && state.scenarios.length) {
      state.policySel = { kind: 'scenario', scenario: state.scenarios[0] };
    }
    renderPolicy();
  } else if (view === 'tags') {
    renderTagView();
  }
}

function openPolicyFor(scenarioId) {
  const s = state.byId[scenarioId];
  if (s) state.policySel = { kind: 'scenario', scenario: s };
  setView('policy');
}

function openPolicyForThread(thread) {
  state.policyThread = thread;
  state.policySel = { kind: 'thread', thread };
  setView('policy');
}

function renderPolicy() {
  renderPolicyRules();
  renderPolicyNav();
  renderPolicyDetail();
}

function renderPolicyRules() {
  const box = $('#policy-rules');
  box.innerHTML = '';
  const meta = state.policyMeta;
  $('#policy-today').textContent = meta ? tr('policy_evaluated_for', meta.today) : '';
  if (!meta) return;
  for (const [key, labelKey, unitKey] of RULE_CHIPS) {
    const v = meta.constants[key];
    if (v === undefined) continue;
    const chip = el('div', 'rulechip');
    chip.append(el('b', null, `${v}${tr(unitKey)}`));
    chip.append(el('span', null, tr(labelKey)));
    box.append(chip);
  }
}

function navButton(title, meta, on, onClick) {
  const b = el('button', 'pnav__item' + (on ? ' is-on' : ''));
  b.type = 'button';
  b.append(el('span', 'pnav__title', title));
  b.append(el('span', 'pnav__meta', meta));
  b.addEventListener('click', onClick);
  return b;
}

function renderPolicyNav() {
  const nav = $('#policy-nav');
  nav.innerHTML = '';
  const sel = state.policySel;

  if (state.policyThread) {
    const t = state.policyThread;
    nav.append(el('p', 'pnav__group', tr('policy_from_thread')));
    nav.append(navButton(
      t.subject || '(no subject)',
      `#${t.id} · ${new Date(t.created_at * 1000).toLocaleDateString()} · ${tr('policy_snapshot_tag')}`,
      sel && sel.kind === 'thread',
      () => { state.policySel = { kind: 'thread', thread: t }; renderPolicyNav(); renderPolicyDetail(); },
    ));
  }

  const groups = new Map();
  for (const s of state.scenarios) {
    const cat = s.product.category;
    if (!groups.has(cat)) groups.set(cat, []);
    groups.get(cat).push(s);
  }
  for (const [cat, items] of groups) {
    nav.append(el('p', 'pnav__group', cat));
    for (const s of items) {
      nav.append(navButton(
        scenarioText(s, 'title'),
        `${s.order.order_id || tr('policy_no_order')} · ${stampText(s.order)}`,
        sel && sel.kind === 'scenario' && sel.scenario.scenario_id === s.scenario_id,
        () => { state.policySel = { kind: 'scenario', scenario: s }; renderPolicyNav(); renderPolicyDetail(); },
      ));
    }
  }
}

function renderPolicyDetail() {
  const box = $('#policy-detail');
  box.innerHTML = '';
  const sel = state.policySel;
  if (!sel) { box.append(el('p', 'list__empty', tr('policy_pick'))); return; }

  let facts, product, order, title, source;
  if (sel.kind === 'thread') {
    const t = sel.thread;
    facts = t.policy || {};
    product = t.context.product;
    order = t.context.order;
    title = threadScenarioTitle(t);
    source = tr('policy_source_snapshot', new Date(t.created_at * 1000).toLocaleString());
  } else {
    const s = sel.scenario;
    facts = s.policy || {};
    product = s.product;
    order = s.order;
    title = scenarioText(s, 'title');
    source = tr('policy_source_live');
  }

  /* header */
  const head = el('div', 'pdetail__head');
  const img = el('img', 'attach__thumb');
  img.src = product.image_url;
  img.alt = product.product_name;
  const hmeta = el('div', 'attach__meta');
  hmeta.append(el('div', 'attach__label', source));
  hmeta.append(el('div', 'attach__title', title));
  hmeta.append(el('p', 'attach__line',
    `${order.order_id || tr('policy_no_order')} · ${product.product_name}`));
  head.append(img, hmeta, el('span', stampClass(order), stampText(order)));
  box.append(head);

  /* verdicts */
  box.append(el('p', 'pdetail__section', tr('policy_eval')));
  let anyCallout = false;
  for (const [key, kind, labelKey] of FACT_CALLOUTS) {
    if (isBlank(facts[key])) continue;
    anyCallout = true;
    const c = el('div', `callout callout--${kind}`);
    c.append(el('div', 'callout__label', tr(labelKey)));
    c.append(el('div', 'callout__text', String(facts[key])));
    box.append(c);
  }
  const sideNotes = FACT_SIDE_NOTES.filter((k) => !isBlank(facts[k]));
  if (sideNotes.length) {
    anyCallout = true;
    const c = el('div', 'callout callout--info');
    for (const k of sideNotes) {
      c.append(el('div', 'callout__label', factLabel(k)));
      c.append(el('div', 'callout__text', String(facts[k])));
    }
    box.append(c);
  }
  if (!anyCallout) box.append(el('div', 'callout callout--info', tr('policy_pick')));

  /* clocks */
  const clocks = FACT_CLOCKS.filter((k) => facts[k] !== undefined && facts[k] !== null);
  if (clocks.length) {
    box.append(el('p', 'pdetail__section', tr('policy_clocks')));
    const grid = el('div', 'metrics');
    for (const k of clocks) {
      const m = el('div', 'metric');
      m.append(el('b', null, String(facts[k])));
      m.append(el('span', null, factLabel(k)));
      grid.append(m);
    }
    box.append(grid);
  }

  /* flags */
  const flags = FACT_FLAGS.filter((k) => typeof facts[k] === 'boolean');
  if (flags.length) {
    box.append(el('p', 'pdetail__section', tr('policy_flags')));
    const row = el('div', 'flags');
    for (const k of flags) {
      const f = el('span', `flag ${facts[k] ? 'is-true' : 'is-false'}`);
      f.append(el('i', null, facts[k] ? '✓' : '✗'));
      f.append(el('span', null, `${factLabel(k)} · ${facts[k] ? tr('yes') : tr('no')}`));
      row.append(f);
    }
    box.append(row);
  }

  /* everything the groups above did not claim */
  const claimed = new Set([
    ...FACT_CALLOUTS.map((c) => c[0]), ...FACT_SIDE_NOTES, ...clocks, ...flags,
  ]);
  const rest = Object.fromEntries(Object.entries(facts).filter(([k]) => !claimed.has(k)));
  if (Object.keys(rest).length) {
    box.append(el('p', 'pdetail__section', tr('policy_context')));
    box.append(kvPanel(tr('policy_eval'), rest, { policy: true, labelled: true }));
  }

  box.append(el('p', 'policy__note', tr('policy_note')));
}

/* ----------------------------------------------------- tag analytics ---- */

async function loadTagStats() {
  try {
    state.tagStats = await api(`/api/tags/stats?scope=${state.tagScope}`);
    $('#count-tags').textContent = state.tagStats.classified;
  } catch (err) {
    state.tagStats = null;
    toast(tr('toast_load_fail', err.message));
  }
  if (state.view === 'tags') renderTagView();
}

function statTile(label, value, sub) {
  const tile = el('div', 'stat');
  tile.append(el('div', 'stat__label', label));
  tile.append(el('div', 'stat__value', value));
  if (sub) tile.append(el('div', 'stat__sub', sub));
  return tile;
}

function chartCard(title, sub) {
  const card = el('section', 'vizcard');
  const head = el('header', 'vizcard__head');
  head.append(el('h2', null, title));
  if (sub) head.append(el('p', null, sub));
  card.append(head);
  return card;
}

const pct = (n, total) => (total ? Math.round((n / total) * 1000) / 10 : 0);

/* Horizontal bars, one hue, sorted by magnitude. Every row carries its own
   value, so no reader depends on the tooltip to get a number. */
function intentChart(dist, classified) {
  const card = chartCard(tr('chart_intent'), tr('chart_intent_sub'));
  const rows = Object.entries(dist).sort((a, b) => b[1] - a[1]);
  if (!rows.length) return null;
  const max = rows[0][1];

  const plot = el('div', 'barlist');
  for (const [value, count] of rows) {
    const row = el('div', 'barlist__row');
    row.title = `${tagLabel('intent', value)} · ${tr('n_emails', count)} · ${tr('of_total', pct(count, classified))}`;
    row.append(el('span', 'barlist__name', tagLabel('intent', value)));

    const track = el('span', 'barlist__track');
    const fill = el('span', 'barlist__fill');
    fill.style.width = `${(count / max) * 100}%`;
    fill.style.background = VIZ.intentBar;
    track.append(fill);
    row.append(track);

    row.append(el('span', 'barlist__val', String(count)));
    plot.append(row);
  }
  card.append(plot);
  return card;
}

/* A 100%-wide stacked bar plus a labelled legend. The legend carries the count
   and share for every segment, which is the table view for this chart. */
function stackedChart(titleKey, subKey, group, order, colorFor, dist, classified) {
  const present = order.filter((v) => dist[v]);
  if (!present.length) return null;
  const card = chartCard(tr(titleKey), tr(subKey));

  const bar = el('div', 'stackbar');
  for (const value of present) {
    const seg = el('span', 'stackbar__seg');
    /* flex-grow proportional to the count, basis 0: the 2px gaps come out of the
       track instead of pushing the total past 100% and letting flex-shrink
       distort the shares. */
    seg.style.flexGrow = String(dist[value]);
    seg.style.flexBasis = '0%';
    seg.style.background = colorFor(value);
    seg.title = `${tagLabel(group, value)} · ${tr('n_emails', dist[value])} · ${pct(dist[value], classified)}%`;
    bar.append(seg);
  }
  card.append(bar);

  const legend = el('div', 'vizlegend');
  for (const value of present) {
    const item = el('span', 'vizlegend__item');
    const sw = el('span', 'vizlegend__swatch');
    sw.style.background = colorFor(value);
    item.append(sw);
    item.append(el('span', 'vizlegend__name', tagLabel(group, value)));
    item.append(el('span', 'vizlegend__val', `${dist[value]} · ${pct(dist[value], classified)}%`));
    legend.append(item);
  }
  card.append(legend);
  return card;
}

/* The table twin of a distribution chart: same numbers, no colour needed. */
function breakdownTable(titleKey, group, order, dist, classified) {
  const rows = order.filter((v) => dist[v]);
  if (!rows.length) return null;

  const card = chartCard(tr(titleKey), null);
  const table = el('table', 'dtable');
  const thead = el('thead');
  const hr = el('tr');
  hr.append(el('th', null, tr('th_tag')));
  hr.append(el('th', 'dtable__num', tr('th_emails')));
  hr.append(el('th', 'dtable__num', tr('th_share')));
  thead.append(hr);
  table.append(thead);

  const tbody = el('tbody');
  for (const value of rows) {
    const tr_ = el('tr');
    tr_.append(el('td', null, tagLabel(group, value)));
    tr_.append(el('td', 'dtable__num', String(dist[value])));
    tr_.append(el('td', 'dtable__num', `${pct(dist[value], classified)}%`));
    tbody.append(tr_);
  }
  table.append(tbody);

  const tfoot = el('tfoot');
  const fr = el('tr');
  fr.append(el('td', null, tr('th_total')));
  fr.append(el('td', 'dtable__num', String(rows.reduce((n, v) => n + dist[v], 0))));
  fr.append(el('td', 'dtable__num', '100%'));
  tfoot.append(fr);
  table.append(tfoot);

  card.append(table);
  return card;
}

/* Intent x urgency. The counts carry the value; the cell tint is only a scan
   aid, kept faint enough that the text stays readable at every level. */
function crossTable(cross, classified) {
  const intents = Object.entries(cross)
    .map(([intent, byUrg]) => [intent, Object.values(byUrg).reduce((a, b) => a + b, 0), byUrg])
    .sort((a, b) => b[1] - a[1]);
  if (!intents.length) return null;

  const peak = Math.max(...intents.flatMap(([, , byUrg]) => Object.values(byUrg)));
  const card = chartCard(tr('table_cross'), tr('table_cross_sub'));
  const table = el('table', 'dtable dtable--cross');

  const thead = el('thead');
  const hr = el('tr');
  hr.append(el('th', null, tr('tag_intent')));
  for (const u of URGENCY_ORDER) hr.append(el('th', 'dtable__num', tagLabel('urgency', u)));
  hr.append(el('th', 'dtable__num', tr('th_total')));
  thead.append(hr);
  table.append(thead);

  const tbody = el('tbody');
  for (const [intent, total, byUrg] of intents) {
    const row = el('tr');
    row.append(el('td', null, tagLabel('intent', intent)));
    for (const u of URGENCY_ORDER) {
      const n = byUrg[u] || 0;
      const cell = el('td', 'dtable__num' + (n ? '' : ' is-zero'), n ? String(n) : '·');
      if (n) cell.style.background = `rgba(29, 78, 137, ${(n / peak) * 0.16})`;
      row.append(cell);
    }
    row.append(el('td', 'dtable__num dtable__rowtotal', String(total)));
    tbody.append(row);
  }
  table.append(tbody);

  const tfoot = el('tfoot');
  const fr = el('tr');
  fr.append(el('td', null, tr('th_total')));
  for (const u of URGENCY_ORDER) {
    fr.append(el('td', 'dtable__num',
      String(intents.reduce((n, [, , byUrg]) => n + (byUrg[u] || 0), 0))));
  }
  fr.append(el('td', 'dtable__num', String(classified)));
  tfoot.append(fr);
  table.append(tfoot);

  card.append(table);
  return card;
}

function renderTagView() {
  const box = $('#tag-body');
  box.innerHTML = '';
  document.querySelectorAll('#tag-scope button').forEach((b) => {
    b.classList.toggle('is-on', b.dataset.tagscope === state.tagScope);
  });

  const s = state.tagStats;
  if (!s || !s.total) {
    box.append(el('p', 'list__empty', tr('tags_empty')));
    return;
  }

  /* Headline numbers are stat tiles, not one-bar charts. */
  const kpis = el('div', 'statrow');
  const urg = s.distributions.urgency || {};
  const pressure = (urg.high || 0) + (urg.critical || 0);
  kpis.append(statTile(tr('kpi_analysed'), String(s.classified), tr('kpi_analysed_sub', s.total)));
  kpis.append(statTile(tr('kpi_pressure'), `${pct(pressure, s.classified)}%`, tr('kpi_pressure_sub')));
  kpis.append(statTile(tr('kpi_unsure'), `${pct(s.low_confidence, s.classified)}%`, tr('kpi_unsure_sub')));
  kpis.append(statTile(
    tr('kpi_speed'),
    s.avg_analysis_ms === null ? '—' : `${s.avg_analysis_ms} ms`,
    tr('kpi_speed_sub', s.avg_intent_confidence === null ? '—' : s.avg_intent_confidence),
  ));
  if (s.failed || s.unanalysed) {
    kpis.append(statTile(tr('kpi_failed'), String(s.failed + s.unanalysed), tr('kpi_failed_sub')));
  }
  box.append(kpis);

  if (!s.classified) return;

  const charts = el('div', 'vizgrid');
  const intent = intentChart(s.distributions.intent || {}, s.classified);
  if (intent) charts.append(intent);

  const stacks = el('div', 'vizgrid__col');
  const urgency = stackedChart('chart_urgency', 'chart_urgency_sub', 'urgency',
    URGENCY_ORDER, (v) => VIZ.urgency[URGENCY_ORDER.indexOf(v)], urg, s.classified);
  if (urgency) stacks.append(urgency);

  const sentiment = stackedChart('chart_sentiment', 'chart_sentiment_sub', 'sentiment',
    SENTIMENT_ORDER, sentimentColor, s.distributions.sentiment || {}, s.classified);
  if (sentiment) stacks.append(sentiment);

  /* Three nominal values with no order — a chart would add nothing a labelled
     count row does not already say. */
  const langs = Object.entries(s.distributions.language || {}).sort((a, b) => b[1] - a[1]);
  if (langs.length) {
    const card = chartCard(tr('chart_language'), null);
    const legend = el('div', 'vizlegend');
    for (const [value, count] of langs) {
      const item = el('span', 'vizlegend__item');
      item.append(el('span', 'vizlegend__name', tagLabel('language', value)));
      item.append(el('span', 'vizlegend__val', `${count} · ${pct(count, s.classified)}%`));
      legend.append(item);
    }
    card.append(legend);
    stacks.append(card);
  }

  charts.append(stacks);
  box.append(charts);

  /* Tables: the same numbers without relying on colour, plus the cross-tab,
     which is information no single chart above carries. */
  box.append(el('p', 'tagview__section', tr('table_section')));
  const cross = crossTable(s.intent_by_urgency || {}, s.classified);
  if (cross) box.append(cross);

  const tables = el('div', 'tablegrid');
  const intentOrder = Object.entries(s.distributions.intent || {})
    .sort((a, b) => b[1] - a[1]).map(([v]) => v);
  const langOrder = Object.entries(s.distributions.language || {})
    .sort((a, b) => b[1] - a[1]).map(([v]) => v);
  const specs = [
    ['tag_intent', 'intent', intentOrder, s.distributions.intent],
    ['tag_urgency', 'urgency', URGENCY_ORDER, urg],
    ['tag_sentiment', 'sentiment', SENTIMENT_ORDER, s.distributions.sentiment],
    ['tag_language', 'language', langOrder, s.distributions.language],
  ];
  for (const [titleKey, group, order, dist] of specs) {
    const t = breakdownTable(titleKey, group, order, dist || {}, s.classified);
    if (t) tables.append(t);
  }
  box.append(tables);
}

/* -------------------------------------------------------------- send ---- */

async function sendMail() {
  if (state.sending) return;
  const body = $('#c-body').value.trim();
  const errBox = $('#compose-error');
  errBox.hidden = true;

  if (!state.picked) { errBox.textContent = tr('err_choose_order'); errBox.hidden = false; return; }
  if (!body) { errBox.textContent = tr('err_write_email'); errBox.hidden = false; return; }

  state.sending = true;
  const btn = $('#send-mail');
  btn.disabled = true;
  btn.textContent = tr('sending');

  try {
    const thread = await api('/api/mail', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scenario_id: state.picked, subject: $('#c-subject').value, body }),
    });
    $('#compose').close();
    await refreshThreads();
    state.scope = 'mine';
    document.querySelectorAll('.rail__item').forEach((b) => b.classList.toggle('is-active', b.dataset.scope === 'mine'));
    renderList();
    openThread(thread.id);
    toast(tr('toast_reply_received'));
    state.bodyTouched = false;
  } catch (err) {
    const id = err.data && err.data.thread_id;
    errBox.textContent = tr('err_not_delivered', err.message);
    errBox.hidden = false;
    await refreshThreads();
    if (id) openThread(id);
  } finally {
    state.sending = false;
    btn.disabled = false;
    btn.textContent = tr('send_email');
  }
}

/* ------------------------------------------------------------- events --- */

document.querySelectorAll('.rail__item[data-scope]').forEach((btn) => {
  btn.addEventListener('click', () => {
    state.scope = btn.dataset.scope;
    document.querySelectorAll('.rail__item[data-scope]').forEach((b) => b.classList.toggle('is-active', b === btn));
    if (state.view !== 'mail') setView('mail');
    renderList();
  });
});

document.querySelectorAll('.rail__item[data-view]').forEach((btn) => {
  btn.addEventListener('click', () => setView(btn.dataset.view));
});

document.querySelectorAll('#tag-scope button').forEach((btn) => {
  btn.addEventListener('click', () => {
    state.tagScope = btn.dataset.tagscope;
    loadTagStats();
  });
});

$('#open-compose').addEventListener('click', () => $('#compose').showModal());
$('#send-mail').addEventListener('click', sendMail);
$('#c-body').addEventListener('input', () => { state.bodyTouched = true; updateLangChip(); });
$('#c-subject').addEventListener('input', updateLangChip);
$('#reset-sample').addEventListener('click', () => {
  if (!state.picked) { toast(tr('toast_choose_first')); return; }
  const s = state.byId[state.picked];
  $('#c-subject').value = s.suggested_subject;
  $('#c-body').value = s.suggested_body;
  state.bodyTouched = false;
  updateLangChip();
});

document.querySelectorAll('#lang-select button').forEach((b) => {
  b.addEventListener('click', () => setLang(b.dataset.lang));
});

applyStaticI18n();
boot();
