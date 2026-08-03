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
  emoTab: 'model',      // model | labels | bench | log — the four sub-pages
  emoScope: 'all',      // the bench is a shared board: everyone's tests by default
  emoMeta: null,        // model card + taxonomy + samples from /api/emotion/meta
  emoTests: [],
  emoStats: null,
  emoOpen: null,        // the test currently loaded into the result card
  emoDraft: '',         // textarea contents, kept across re-renders
  emoBusy: false,
  emoPick: [],          // true labels ticked in the feedback form
  emoVerdict: null,     // 'correct' | 'wrong' | null, before it is saved
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
    view_emotion: 'Emotion recognition',
    emo_view_title: 'Emotion recognition',
    emo_view_desc: 'The local emotion model: what it is, what it can label, and how it does on real text.',
    emo_scope: 'Whose tests to show',
    emo_tabs: 'Emotion pages',
    emo_tab_model: 'The model',
    emo_tab_labels: 'Labels',
    emo_tab_bench: 'Bench',
    emo_tab_log: 'Test log',
    emo_desc_model: 'The local model behind every sentiment tag — what it is, how it was trained, and what it scores.',
    emo_desc_labels: 'The nine clusters an email can be tagged with, the 28 raw labels behind them, and what the tag changes.',
    emo_desc_bench: 'Try the local model on any text, then say whether it read the feeling right. Every test and verdict is shared with everyone.',
    emo_desc_log: 'Every test anyone has run, and what they add up to.',
    emo_off: 'No EMOTION_API_URL is configured, so the bench cannot reach a model. Sentiment falls back to the language model until it is set.',

    emo_model_title: 'The model',
    emo_model_sub: 'a local classifier, not the language model that writes the replies',
    emo_model_lede: 'Sentiment is the one tag that does not come from the language model. It comes from a small RoBERTa classifier running on our own hardware, because tone is the tag that has to be reproducible: the same email must always get the same score, and a score we can regression-test against a threshold.',
    emo_spec_base: 'Base model',
    emo_spec_params: 'Size',
    emo_spec_head: 'Head',
    emo_spec_head_v: (n) => `${n} independent probabilities, one per label`,
    emo_spec_dataset: 'Fine-tuned on',
    emo_spec_language: 'Language',
    emo_spec_training: 'Training run',
    emo_spec_epochs: (n) => `${n} epochs`,
    emo_spec_threshold: 'Default threshold',
    emo_spec_serving: 'Serving',
    emo_spec_serving_on: (t) => `reachable over HTTP · ${t}s timeout`,
    emo_spec_serving_off: 'no endpoint configured',
    emo_model_why: 'Multi-label sigmoid, not softmax: one email can score high on several labels at once, and the scores do not sum to 1.',
    emo_metrics_title: 'What the model card reports',
    emo_metrics_sub: 'measured by its author on the GoEmotions test set — not on support email, and not on this deployment',
    emo_th_setting: 'Setting',
    emo_th_score: 'Score',
    emo_metric_05: 'Threshold 0.5',
    emo_metric_tuned: 'Per-label tuned thresholds',
    emo_metrics_spread: (best, f1, worst) =>
      `The averages hide a wide spread: ${best} reaches ${f1} F1, while ${worst} sit at 0.000 — too few training examples to learn from.`,
    emo_metrics_caveat: 'Accuracy here is exact match over all 28 labels at once, which is why tuning the thresholds raises F1 and lowers accuracy at the same time.',
    emo_step1_t: 'Strip the quoted thread and the signature',
    emo_step1_d: 'Done service-side. A quoted history would otherwise be scored as if the customer had just written it.',
    emo_step2_t: 'Score each sentence',
    emo_step2_d: '28 GoEmotions labels, one sigmoid probability each, per sentence.',
    emo_step3_t: 'Pool across sentences',
    emo_step3_d: 'Max, except NEUTRAL which is averaged — neutral is the absence of feeling, and any multi-sentence email contains at least one flat, factual sentence.',
    emo_step4_t: 'Fold 28 labels into 9 clusters',
    emo_step4_d: 'Grouped by the action they trigger, not by psychology: two labels that lead to the same reply strategy share a cluster.',
    emo_step5_t: 'Pick the cluster',
    emo_step5_d: (band) =>
      `Highest score wins, but anything within ${band} of it counts as tied and the most negative tied cluster takes it. The asymmetry is deliberate — a tie read as negative costs one human review; read as positive it puts an angry customer into full automation.`,
    emo_step6_t: 'Hand the rest to the review rules',
    emo_step6_d: 'The escalation level, the sarcasm flag and the keyword hits are separate signals; each can send an email to a human on its own.',
    emo_contract_title: 'What the service returns',
    emo_contract_sub: 'one POST per email — every field degrades to null rather than being guessed',
    emo_th_field: 'Field',
    emo_th_meaning: 'What it means',
    emo_field_l1: "The service's own escalation call, P0 (worst) through P3.",
    emo_field_escalation_score: '0–1, how strongly the text reads as an escalation.',
    emo_field_negativity: '−1 to 1. Negative values lean positive, positive values lean negative.',
    emo_field_l2: 'The nine cluster scores. This is the field the tag is read from.',
    emo_field_l3_raw: 'The 28 raw label scores. The service keeps its own copy for tuning; this mailbox uses them only to rebuild the clusters if l2 is missing and does not put them on the thread — 28 floats per email is not worth the row.',
    emo_field_rule_hits: 'Keyword rules the service matched, e.g. legal.',
    emo_field_sarcasm_override: 'Literally positive, actually negative. On its own it sends the email to a human.',
    emo_field_flags: 'allcaps, repetition, sarcasm — surface signals, not model output.',
    emo_field_n_sentences: 'How many sentences it scored.',
    emo_field_ambiguous_reason: 'Why it could not answer, when it could not.',
    emo_field_preprocessing: 'Whether a quoted thread or a signature was stripped before scoring.',
    emo_limits_title: 'Where it falls over',
    emo_limits_sub: 'known and kept visible — the bench examples that break it are still in the list',
    emo_limit_lang_t: 'English only',
    emo_limit_lang_d: 'Anything else comes back AMBIGUOUS with every cluster at 0. That is read as "no answer" rather than as neutral, and the tag falls back to the language model, which is multilingual.',
    emo_limit_sarcasm_t: 'Sarcasm often reads as praise',
    emo_limit_sarcasm_d: '"Great job losing my package again" scores SATISFIED 0.945. The service has a sarcasm override and it does not catch this one.',
    emo_limit_rare_t: 'Rare labels were never learned',
    emo_limit_rare_d: 'grief, pride and relief score 0.000 F1 on the model card. relief sits inside GRATEFUL, so that cluster leans on gratitude alone.',
    emo_limit_domain_t: 'Reddit, not a support inbox',
    emo_limit_domain_d: (points, n, method) => `The training data is Reddit comments. Customer email is more formal and more transactional, and zero-shot accuracy is expected to land ${points} points below the published figures — a round of ${method} on ${n} of our own annotated emails is the fix. None of the numbers above were measured on support email; that gap is what the bench exists to show.`,

    emo_map_title: 'Every raw label, and where it lands',
    emo_map_sub: (n) => `all ${n} GoEmotions labels in alphabetical order — the grid above, read backwards`,
    emo_th_rawlabel: 'GoEmotions label',
    emo_th_cluster: 'Cluster',
    emo_map_unmapped: 'no cluster',
    emo_use_title: 'What the label changes',
    emo_use_sub: 'the tag is not decoration — these rules read it and route the email',
    emo_use_1_t: 'Negative cluster + high urgency → human review',
    emo_use_1_d: 'hostile, frustrated or anxious together with high or critical urgency means the complaint is already escalating.',
    emo_use_2_t: 'P0_ESCALATE → human review',
    emo_use_2_d: "The service's own escalation call is an independent signal: a low-urgency email can still come back P0.",
    emo_use_3_t: 'Sarcasm → human review',
    emo_use_3_d: 'Automated replies fail hardest on emails that are polite on the surface.',
    emo_use_4_t: 'Helios Plus + negative → human review',
    emo_use_4_d: 'A high-value customer with a negative cluster or high urgency is worth a person.',
    emo_use_5_t: 'Otherwise it steers the reply',
    emo_use_5_d: 'The cluster goes into the prompt, so the reply that gets written matches the tone it is answering.',
    emo_use_source: 'When the service is unreachable the tag falls back to the language model and sentiment_source flips from local_model to llm_fallback — the confidence beside it stops being a real probability and becomes the model rating itself.',

    emo_tab_triage: 'Triage',
    emo_desc_triage: 'How the service turns 28 raw probabilities into an SLA and a decision about whether a person reads the email.',
    emo_chain_title: 'The whole chain',
    emo_chain_sub: 'the model is one stage of ten — everything around it is deterministic',
    emo_chain_1: 'raw email',
    emo_chain_2: 'preprocess',
    emo_chain_3: 'gate',
    emo_chain_4: 'split into sentences',
    emo_chain_5: 'batch inference',
    emo_chain_6: 'max within cluster',
    emo_chain_7: 'pool across sentences',
    emo_chain_8: 'sarcasm veto',
    emo_chain_9: 'escalation score',
    emo_chain_10: 'L1 band',
    emo_rule_sent_t: 'One forward pass per sentence, not per email',
    emo_rule_sent_d: 'GoEmotions was trained on short Reddit comments, and a whole email collapses onto its loudest feeling. "Thanks for your help last time, but the replacement arrived broken" scored FRUSTRATED 0.086 when it went in as one document. Splitting first keeps mixed feelings alive. Cap is 24 sentences; over that it keeps the first 12 and the last 12, because the ask and the anger sit at the ends.',
    emo_rule_max_t: 'Max within a cluster, never sum',
    emo_rule_max_d: 'annoyance and disappointment co-occur constantly; summing would push mild irritation to 1.4 and beat real anger. Max answers "how strongly is this cluster lit", not "how many of its labels fired".',
    emo_rule_norm_t: 'No normalisation across clusters',
    emo_rule_norm_d: 'GRATEFUL for last time and FRUSTRATED about this time are both true at once. Normalising would make them dilute each other and the mixed signal would be gone.',
    emo_rule_neutral_t: 'NEUTRAL is the one cluster not pooled by max',
    emo_rule_neutral_d: 'Neutral is the absence of feeling, so a max over sentences would turn every multi-sentence email neutral — all of them contain at least one flat, factual line. Measured against the live service: two factual sentences give NEUTRAL 0.935, and adding "I am furious that nobody has replied." drops it to 0.150 while HOSTILE takes the max at 0.780.',

    emo_layers_title: 'Three layers, three jobs',
    emo_layers_sub: 'the same forward pass, read at three different grains',
    emo_layer_l1: 'Decides the SLA and whether a person reads it. This mailbox reads it as a hard escalation signal.',
    emo_layer_l2: 'Decides the reply strategy. This is the layer that becomes the sentiment tag on an email.',
    emo_layer_l3: 'Stored for threshold tuning and label-drift monitoring. Never used for a decision on its own.',
    emo_layers_note: 'L3 is stored whole, including caring, which belongs to no cluster — filtering it by the cluster vocabulary on the way in would quietly delete the evidence you need to re-tune the clusters later.',
    emo_l1_title: 'L1 — what each band costs',
    emo_l1_sub: 'the band is the decision; the score behind it is only there so you can argue with it',
    emo_th_level: 'Band',
    emo_th_action: 'Action',
    emo_th_sla: 'SLA',
    emo_act_none: 'Human only',
    emo_act_draft: 'AI drafts, human approves',
    emo_act_auto: 'AI replies automatically',
    emo_act_template: 'Templated thanks, batchable',
    emo_act_bypass: 'No emotion routing — route by intent',
    emo_sla_h: (h) => `${h}h`,
    emo_l1_amb: 'AMBIGUOUS is not a failure state. On out-of-domain text the model goes uniformly low-confidence, and forcing an argmax out of that is more dangerous than declining to answer.',
    emo_score_title: 'The escalation score',
    emo_score_sub: 'negative clusters weighted, modifiers added, then cut into bands',
    emo_score_weights: 'Severity weights',
    emo_score_mods: 'Modifiers',
    emo_score_mod_demanding: (t) => `DEMANDING > ${t} — an explicit ask`,
    emo_score_mod_repetition: 'repetition — asked before, patience spent',
    emo_score_mod_allcaps: 'allcaps — shouting',
    emo_score_mod_sarcasm: 'sarcasm — passive aggression',
    emo_score_bands: 'Bands',
    emo_th_band: 'Band',
    emo_score_p3: (neg, pos) => `Below the lowest band, P3_LOW needs every negative cluster under ${neg} and a positive cluster at ${pos} or above. A positive cluster is an entry condition for P3, never a reason for it — any negative residue and it cannot land there.`,
    emo_score_fallback: 'Still nothing? One of these three clears P2_STANDARD; otherwise the answer is AMBIGUOUS.',
    emo_score_why: 'The earlier version cascaded if-else over single-cluster thresholds, which broke twice: two clusters that each fall just short would drag the whole email down a band ("third time asking, I want a refund"), and a positive cluster could decide the band on its own, so a politely hostile complaint landed in P3_LOW.',
    emo_rules_title: 'Threat rules — a hit is P0, whatever the model thinks',
    emo_rules_sub: 'marketplace threats are template language, and a regex beats the model on both precision and recall here',
    emo_th_rule: 'Rule',
    emo_th_covers: 'Covers',
    emo_rules_note: 'Checked against the live service: "If this is not resolved today I will file an A-to-Z claim." scores NEUTRAL 0.805 — there is no anger in it at all — and still comes back P0_ESCALATE on the a_to_z hit alone. The negative lookahead works too: "I don\'t want to dispute the charge" matches nothing.',
    emo_sarcasm_title: 'Sarcasm veto',
    emo_sarcasm_sub: 'praise plus a bad fact — not praise plus anger, which is what the first version looked for and never found',
    emo_th_kind: 'sarcasm_kind',
    emo_th_example: 'Example',
    emo_sarcasm_note: 'A hit zeroes GRATEFUL and SATISFIED together — "Thanks for nothing" runs through GRATEFUL, so zeroing only SATISFIED missed it — and pushes the email to P0_ESCALATE. Which rule fired is exposed as sarcasm_kind so a disputed escalation can be traced.',
    emo_sarcasm_miss: 'It is tuned to under-fire on purpose: misjudging a happy customer zeroes their satisfaction score and inflates the queue. The cost is real misses — "Great job losing my package again" still comes back SATISFIED 0.945 and P3_LOW, which you can reproduce on the bench.',
    emo_gate_title: 'Before the model ever runs',
    emo_gate_sub: 'the cheapest way to be right is to not answer',
    emo_pre_head: 'Preprocessing',
    emo_pre_quote: 'A forwarded thread carries the support agent\'s own apology in it. Score that and you attribute the seller\'s feelings to the buyer.',
    emo_pre_signature: 'Signature blocks and disclaimers are boilerplate; they add sentences that dilute the pooling.',
    emo_pre_noise: 'Order numbers, URLs and addresses carry no tone and only cost tokens.',
    emo_pre_allcaps: 'The tokenizer shatters ALL-CAPS into subwords and confidence collapses, so it is lowercased — but the shouting is kept as the allcaps flag and paid back into the escalation score.',
    emo_gate_head: 'Gates',
    emo_th_gate: 'Gate',
    emo_gate_content: 'Empty strings, bare emoji and a lone order number never reach the model.',
    emo_gate_language: 'A blunt placeholder today; production should be fasttext lid.176 at 0.75.',
    emo_gate_note: 'Both gates return AMBIGUOUS without a forward pass, so l2 is all zeros, l3_raw is empty and n_sentences is 0. That is not "the model could not decide" — tell them apart by ambiguous_reason.',

    emo_priors_title: 'How often each label actually shows up',
    emo_priors_sub: 'GoEmotions frequencies are Reddit frequencies; a support inbox is not shaped like Reddit',
    emo_prior_high: 'Frequent and useful',
    emo_prior_high_d: 'the working labels — they carry most of the signal',
    emo_prior_mid: 'Occasional',
    emo_prior_mid_d: 'only meaningful once folded into a cluster',
    emo_prior_low: 'Rare or noise',
    emo_prior_low_d: 'folded away or dropped',
    emo_priors_note: (labels) => `${labels} have low support in the GoEmotions paper and correspondingly weak F1. They may contribute to a cluster score; they may never decide anything on their own.`,
    emo_tax_lowsupport: 'thin data',
    emo_sem_hostile: 'Already angry — a bad review or a case is likely next',
    emo_sem_frustrated: 'Unhappy but still reasonable',
    emo_sem_anxious: 'Afraid of losing the money or the goods',
    emo_sem_confused: 'An information gap — a pure question',
    emo_sem_demanding: 'A stated remedy: refund, replacement',
    emo_sem_neutral: 'Transactional',
    emo_sem_grateful: 'The problem is closed',
    emo_sem_satisfied: 'A positive experience',
    emo_sem_self_blame: 'The buyer thinks the mistake was theirs',
    emo_sem_note: 'SELF_BLAME is rare and worth keeping anyway: it separates a buyer-fault return from a seller-fault one, which decides who pays the return shipping.',

    emo_limit_cost_t: 'Per-sentence inference costs more compute',
    emo_limit_cost_d: 'A 24-sentence email is a batch of 24 sequences, not one. On CPU that needs a measured P99, and MAX_SENTS comes down if it does not fit. The trade buys back mixed emotions that a single pass dilutes away, which is worth it.',
    emo_limit_split_t: 'Sentence splitting is a regex',
    emo_limit_split_d: '"Mr." and "No. 5" get split wrongly. The damage is bounded — a wrong split only makes a sentence shorter — but a real sentence splitter belongs here eventually.',
    emo_limit_single_t: 'One email at a time',
    emo_limit_single_d: 'The service never sees the thread history. A customer whose three emails escalate one by one has to be caught by cumulative logic further up, not here.',
    emo_tax_title: 'Labels it can recognise',
    emo_tax_sub: (raw, clusters) => `${raw} GoEmotions labels folded into ${clusters} clusters — the cluster is what lands on an email`,
    emo_tax_unmapped: (labels) => `Deliberately unmapped: ${labels} — it fits no cluster's action, so it is not counted.`,
    emo_tax_polarity: 'polarity',
    emo_tax_neg: 'negative',
    emo_tax_pos: 'positive',
    emo_tax_mean: 'not max-pooled across sentences',
    emo_tie_band: (band) => `Clusters within ${band} of the top score count as tied; the most negative one wins.`,
    emo_try_title: 'Try a message',
    emo_try_sub: 'English only — the model returns no result for other languages, which is itself worth seeing.',
    emo_ph: 'Paste or type what a customer might write…',
    emo_run: 'Analyse',
    emo_running: 'Analysing…',
    emo_samples: 'Examples',
    emo_sample_expect: (label) => `a human would read this as ${label}`,
    emo_chars: (n, max) => `${n} / ${max}`,
    emo_result_title: 'What the model returned',
    emo_result_fail: 'The model returned no usable emotion.',
    emo_scores_title: 'Score per cluster',
    emo_scores_sub: 'multi-label scores, ordered by polarity — they do not sum to 1',
    emo_l1: 'Escalation level',
    emo_escalation: 'Escalation score',
    emo_negativity: 'Negativity',
    emo_latency: 'Model latency',
    emo_sentences: 'Sentences',
    emo_flags: 'Flags',
    emo_rule_hits: 'Rule hits',
    emo_sarcasm: 'Sarcasm override',
    emo_tested_by: (who, when) => `tested by ${who} · ${when}`,
    emo_fb_title: 'Was this right?',
    emo_fb_sub: 'Your verdict is visible to everyone and feeds the accuracy numbers below.',
    emo_fb_correct: 'Correct',
    emo_fb_wrong: 'Wrong',
    emo_fb_pick: 'Which label is right? (pick one or more)',
    emo_fb_note: 'Note (optional)',
    emo_fb_note_ph: 'Why do you read it that way?',
    emo_fb_save: 'Save verdict',
    emo_fb_saving: 'Saving…',
    emo_fb_clear: 'Withdraw verdict',
    emo_fb_by: (who, when) => `${who} · ${when}`,
    emo_fb_need_label: 'Pick the label you think is right.',
    emo_fb_saved: 'Verdict saved.',
    emo_kpi_tests: 'Tests run',
    emo_kpi_tests_sub: (n) => `by ${n} ${n === 1 ? 'person' : 'people'}`,
    emo_kpi_reviewed: 'Judged',
    emo_kpi_reviewed_sub: 'tests with a verdict',
    emo_kpi_accuracy: 'Agreement',
    emo_kpi_accuracy_sub: 'judged correct, of judged',
    emo_kpi_speed: 'Average call',
    emo_kpi_speed_sub: 'local model, per test',
    emo_kpi_failed: 'No result',
    emo_kpi_failed_sub: 'unsupported language or service down',
    emo_chart_pred: 'What the model predicted',
    emo_chart_pred_sub: 'across every test run',
    emo_chart_truth: 'What people said it should be',
    emo_chart_truth_sub: 'from the verdicts — a confirmed label counts as itself',
    emo_table_confusion: 'Predicted × what people said',
    emo_table_confusion_sub: 'the diagonal is agreement; everything off it is a disagreement worth reading',
    emo_table_percluster: 'Agreement per cluster',
    emo_th_predicted: 'Predicted',
    emo_th_correct: 'Correct',
    emo_th_wrong: 'Wrong',
    emo_th_rate: 'Agreement',
    emo_records_title: 'Test log',
    emo_records_sub: 'newest first — click a row to open it in the bench and judge it',
    emo_records_empty: 'Nothing tested yet. Run a message above and it lands here for everyone to see.',
    emo_no_verdict: 'no verdict yet',
    emo_verdict_correct: 'Correct',
    emo_verdict_wrong: 'Wrong',
    emo_toast_test_fail: (msg) => `Could not run that test: ${msg}`,
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
    view_emotion: '情绪识别',
    emo_view_title: '情绪识别',
    emo_view_desc: '本地情绪模型：它是什么、能打出哪些标签、在真实文本上表现如何。',
    emo_scope: '显示谁的测试',
    emo_tabs: '情绪识别子页',
    emo_tab_model: '模型',
    emo_tab_labels: '标签',
    emo_tab_bench: '测试台',
    emo_tab_log: '测试记录',
    emo_desc_model: '每一个情绪标签背后的本地模型——它是什么、怎么训练出来的、跑出什么分数。',
    emo_desc_labels: '一封邮件可能被打上的 9 个情绪簇、它们背后的 28 个原始标签，以及这个标签会改变什么。',
    emo_desc_bench: '拿任意一段文本试本地模型，再告诉它判得对不对。每一次测试和评价所有人都看得见。',
    emo_desc_log: '所有人跑过的每一次测试，以及它们加起来说明了什么。',
    emo_off: '没有配置 EMOTION_API_URL，测试台连不上模型。在配好之前，情绪标签退回由大模型给出。',

    emo_model_title: '这是什么模型',
    emo_model_sub: '一个本地分类器，不是写回复的那个大模型',
    emo_model_lede: '情绪是唯一一个不由大模型给出的标签。它来自跑在自己机器上的一个小 RoBERTa 分类器——因为语气恰恰是那个必须可复现的标签：同一封邮件永远要得到同一个分数，而且这个分数要能对着阈值做回归测试。',
    emo_spec_base: '基座模型',
    emo_spec_params: '参数量',
    emo_spec_head: '输出头',
    emo_spec_head_v: (n) => `${n} 个互相独立的概率，每个标签一个`,
    emo_spec_dataset: '微调数据集',
    emo_spec_language: '语言',
    emo_spec_training: '训练配置',
    emo_spec_epochs: (n) => `${n} 轮`,
    emo_spec_threshold: '默认阈值',
    emo_spec_serving: '部署',
    emo_spec_serving_on: (t) => `HTTP 可达 · 超时 ${t} 秒`,
    emo_spec_serving_off: '未配置端点',
    emo_model_why: '多标签 sigmoid，不是 softmax：同一封邮件可以在好几个标签上同时得高分，加起来不等于 1。',
    emo_metrics_title: '模型卡上写的成绩',
    emo_metrics_sub: '作者在 GoEmotions 测试集上测的——不是在客服邮件上，也不是在这套部署上',
    emo_th_setting: '设置',
    emo_th_score: '分数',
    emo_metric_05: '阈值 0.5',
    emo_metric_tuned: '每个标签单独调阈值',
    emo_metrics_spread: (best, f1, worst) =>
      `平均分掩盖了极大的差距：${best} 的 F1 到 ${f1}，而 ${worst} 是 0.000——训练样本太少，模型根本没学到。`,
    emo_metrics_caveat: '这里的 accuracy 是 28 个标签一次全对才算对，所以调完阈值之后 F1 升了、accuracy 反而降了。',
    emo_step1_t: '剥掉引用历史和签名档',
    emo_step1_d: '在服务端做。否则引用的历史邮件会被当成客户刚写的话一起打分。',
    emo_step2_t: '逐句打分',
    emo_step2_d: '每句话给出 28 个 GoEmotions 标签，各自一个 sigmoid 概率。',
    emo_step3_t: '跨句池化',
    emo_step3_d: '取最大值，只有 NEUTRAL 取均值——中性是"情绪的缺席"，而任何多句邮件都必然含至少一句平铺直叙的事务性陈述。',
    emo_step4_t: '28 个标签聚合成 9 个簇',
    emo_step4_d: '分簇依据是"触发哪套客服动作"而不是心理学分类：两个标签只要走同一套回复策略就归进同一个簇。',
    emo_step5_t: '选出那个簇',
    emo_step5_d: (band) =>
      `取分最高的簇，但与最高分相差 ${band} 以内的都算并列，并列里取极性最负的那个。这个不对称是故意的——并列判成负面顶多多走一次人工复核；判成正面，就是把一个愤怒客户放进全自动回复流程。`,
    emo_step6_t: '剩下的信号交给复核规则',
    emo_step6_d: '升级级别、反讽标记、关键词命中是三个独立信号，其中任意一个单独成立就能把邮件转给人。',
    emo_contract_title: '服务返回什么',
    emo_contract_sub: '每封邮件一次 POST——字段缺失一律降级为 null，绝不猜测',
    emo_th_field: '字段',
    emo_th_meaning: '含义',
    emo_field_l1: '服务自己的升级判定，P0（最严重）到 P3。',
    emo_field_escalation_score: '0–1，这段文本读起来有多像一次升级。',
    emo_field_negativity: '−1 到 1。负值偏正面，正值偏负面。',
    emo_field_l2: '9 个簇的分数。标签就是从这个字段读出来的。',
    emo_field_l3_raw: '28 个原始标签的分数。服务端自己会完整留一份用于调优；这个邮箱只在服务没给 l2 时拿它兜底重建簇，不写进 thread——每封邮件存 28 个浮点数不值这一行。',
    emo_field_rule_hits: '服务端关键词规则命中了哪几条，例如 legal。',
    emo_field_sarcasm_override: '字面积极、实际负面。单独成立就能把邮件转给人。',
    emo_field_flags: 'allcaps / repetition / sarcasm——表层信号，不是模型输出。',
    emo_field_n_sentences: '它一共给几句话打了分。',
    emo_field_ambiguous_reason: '给不出结果时，说明为什么给不出。',
    emo_field_preprocessing: '打分前是否剥掉了引用历史或签名档。',
    emo_limits_title: '它在哪儿会翻车',
    emo_limits_sub: '已知的，而且故意摆在明面上——测试台里那几条会让它出丑的示例一直留着',
    emo_limit_lang_t: '只覆盖英文',
    emo_limit_lang_d: '其他语言一律返回 AMBIGUOUS，9 个簇全是 0。这被当作"没有判断"而不是"中性"，标签退回由多语言的大模型给出。',
    emo_limit_sarcasm_t: '反讽经常被读成夸奖',
    emo_limit_sarcasm_d: '"Great job losing my package again" 判成 SATISFIED 0.945。服务端有反讽覆盖逻辑，但这一条没兜住。',
    emo_limit_rare_t: '稀有标签压根没学会',
    emo_limit_rare_d: 'grief、pride、relief 在模型卡上的 F1 是 0.000。relief 归在 GRATEFUL 里，所以那个簇实际只靠 gratitude 一个标签撑着。',
    emo_limit_domain_t: '训练语料是 Reddit，不是客服收件箱',
    emo_limit_domain_d: (points, n, method) => `训练数据是 Reddit 评论，客服邮件更正式也更事务性，零样本准确率预计比公开数字低 ${points} 个点——解法是拿 ${n} 条自有标注邮件做一轮 ${method}。上面那些数字没有一个是在客服邮件上测的，测试台存在的意义就是把这个差距露出来。`,

    emo_map_title: '每个原始标签落到哪个簇',
    emo_map_sub: (n) => `全部 ${n} 个 GoEmotions 标签按字母排序——把上面那张网格反过来读`,
    emo_th_rawlabel: 'GoEmotions 标签',
    emo_th_cluster: '所属簇',
    emo_map_unmapped: '不归簇',
    emo_use_title: '这个标签会改变什么',
    emo_use_sub: '标签不是摆设——下面这些规则会读它，并据此决定邮件往哪走',
    emo_use_1_t: '负面簇 + 高紧急度 → 转人工',
    emo_use_1_d: 'hostile / frustrated / anxious 与 high / critical 紧急度同时成立，说明客诉已经在升级。',
    emo_use_2_t: 'P0_ESCALATE → 转人工',
    emo_use_2_d: '服务自己的升级判定是一个独立信号：一封 urgency=low 的邮件照样可能被判成 P0。',
    emo_use_3_t: '反讽 → 转人工',
    emo_use_3_d: '自动回复最容易在"表面客气"的邮件上翻车。',
    emo_use_4_t: 'Helios Plus 会员 + 负面 → 转人工',
    emo_use_4_d: '高价值客户碰上负面情绪或高紧急度，值得让一个人来处理。',
    emo_use_5_t: '其余情况下它左右回复本身',
    emo_use_5_d: '簇会进提示词，让写出来的回复对得上它在回应的那种语气。',
    emo_use_source: '服务不可达时标签退回大模型，sentiment_source 从 local_model 变成 llm_fallback——旁边那个置信度也就不再是真实概率，而退化成模型的自我评估。',

    emo_tab_triage: '分层路由',
    emo_desc_triage: '服务端怎么把 28 维原始概率变成一个 SLA，以及"这封邮件要不要人来看"这个决定。',
    emo_chain_title: '整条链路',
    emo_chain_sub: '模型只是十步里的一步——它周围的每一步都是确定的',
    emo_chain_1: '原文',
    emo_chain_2: '前置管线',
    emo_chain_3: '门控',
    emo_chain_4: '切句',
    emo_chain_5: '批量推理',
    emo_chain_6: '簇内 max',
    emo_chain_7: '跨句池化',
    emo_chain_8: '反讽否决',
    emo_chain_9: '升级分',
    emo_chain_10: 'L1 分档',
    emo_rule_sent_t: '一句一次前向，不是一封一次',
    emo_rule_sent_d: 'GoEmotions 在 Reddit 短评上训练，整封邮件进去会塌陷到最响的那种情绪。"感谢上次帮忙，但这次的替换件又坏了"按整篇送进去时 FRUSTRATED 只有 0.086。先切句，混合情绪才保得住。上限 24 句，超出时保留首 12 + 末 12——诉求和情绪都在两头，中段多是背景叙述。',
    emo_rule_max_t: '簇内取 max，绝不求和',
    emo_rule_max_d: 'annoyance 和 disappointment 高度共现，求和会让"轻微不满"冲到 1.4 分，压过真正的 anger。max 回答的是"这个簇被激活到什么程度"，不是"有多少个标签被激活"。',
    emo_rule_norm_t: '跨簇不做归一化',
    emo_rule_norm_d: '对上次帮助的 GRATEFUL 和对这次问题的 FRUSTRATED 可以同时成立。归一化会让两者互相稀释，混合情绪信号就没了。',
    emo_rule_neutral_t: 'NEUTRAL 是唯一不走 max 的簇',
    emo_rule_neutral_d: '中性是"情绪的缺席"，跨句取 max 意味着任何多句邮件都会变中性——它们必然含至少一句平铺直叙的事务性陈述。对着线上服务实测：两句事务性陈述给 NEUTRAL 0.935，再追加一句 "I am furious that nobody has replied." 之后掉到 0.150，而同一次调用里 HOSTILE 取到了那一句的 0.780。',

    emo_layers_title: '三层，三种用途',
    emo_layers_sub: '同一次前向，按三种颗粒度去读',
    emo_layer_l1: '决定 SLA 和要不要人来看。这个邮箱把它当确定性升级信号用。',
    emo_layer_l2: '决定回复策略。落到邮件上的那个情绪标签就是这一层。',
    emo_layer_l3: '存库，供阈值调优和标签漂移监控。永远不单独拿来做决策。',
    emo_layers_note: 'L3 完整落库，包括不属于任何簇的 caring——入库前用簇标签集去过滤它，等于把日后重新调簇所需要的证据悄悄删掉了。',
    emo_l1_title: 'L1——每一档意味着什么代价',
    emo_l1_sub: '档位才是决定；它背后那个分数存在的意义是让你能跟它争',
    emo_th_level: '档位',
    emo_th_action: '建议动作',
    emo_th_sla: 'SLA',
    emo_act_none: '转人工',
    emo_act_draft: 'AI 起草 + 人工过审',
    emo_act_auto: 'AI 自动回复',
    emo_act_template: '模板致谢，可批量',
    emo_act_bypass: '不做情绪路由——按意图分类走',
    emo_sla_h: (h) => `${h} 小时`,
    emo_l1_amb: 'AMBIGUOUS 不是失败态。模型在域外文本上会整体给出低置信度，这时强行 argmax 出一个情绪，比不判断更危险。',
    emo_score_title: '连续升级分',
    emo_score_sub: '负面簇加权取最大，叠加修饰项，再按档位切分',
    emo_score_weights: '严重度权重',
    emo_score_mods: '修饰项',
    emo_score_mod_demanding: (t) => `DEMANDING > ${t}——有明确诉求`,
    emo_score_mod_repetition: 'repetition——重复追问，耐心已耗尽',
    emo_score_mod_allcaps: 'allcaps——全大写喊话',
    emo_score_mod_sarcasm: 'sarcasm——被动攻击',
    emo_score_bands: '分档',
    emo_th_band: '档位',
    emo_score_p3: (neg, pos) => `低于最低档之后，落 P3_LOW 要求负面簇全部 < ${neg} 且有一个正向簇 ≥ ${pos}。正向簇是 P3 的准入条件，不是判据——只要还有负面残留就不许落 P3。`,
    emo_score_fallback: '还是没定？这三条里命中任意一条走 P2_STANDARD，否则就是 AMBIGUOUS。',
    emo_score_why: '上一版用 if-else 级联判单簇阈值，坏在两处：两个各差一点的簇会把整封邮件拖降一档（"第三次问了，我要退款"），以及正向簇能单独决定档位，于是带敌意的礼貌投诉落进了 P3_LOW。',
    emo_rules_title: '威胁规则——命中即 P0，不看模型怎么想',
    emo_rules_sub: '平台买家的威胁措辞高度模板化，这一层正则的 precision 和 recall 都优于模型',
    emo_th_rule: '规则',
    emo_th_covers: '覆盖措辞',
    emo_rules_note: '对着线上服务验过："If this is not resolved today I will file an A-to-Z claim." 的 NEUTRAL 是 0.805——情绪上完全读不出威胁——仍然只凭 a_to_z 一条命中判成 P0_ESCALATE。否定前瞻也生效："I don\'t want to dispute the charge" 一条都不命中。',
    emo_sarcasm_title: '反讽否决',
    emo_sarcasm_sub: '判据是「正向词 + 负面事实」，不是「正向情绪 + 负面情绪」——后者是上一版的判据，而反讽文本里根本不含负面情绪词',
    emo_th_kind: 'sarcasm_kind',
    emo_th_example: '示例',
    emo_sarcasm_note: '命中后 GRATEFUL 和 SATISFIED 同时清零——"Thanks for nothing" 走的是 GRATEFUL，只清 SATISFIED 会漏掉它——并把邮件推到 P0_ESCALATE。命中的是哪条判据由 sarcasm_kind 外露，便于事后追一条有争议的升级。',
    emo_sarcasm_miss: '它是故意调得偏保守的：误判一个满意买家会清零他的满意度分、还会推高工单等级。代价是真实漏检——"Great job losing my package again" 至今仍然判成 SATISFIED 0.945、P3_LOW，在测试台上可以复现。',
    emo_gate_title: '模型跑起来之前',
    emo_gate_sub: '判对最省的办法是别判',
    emo_pre_head: '前置管线',
    emo_pre_quote: '买家转发的邮件里带着客服自己写的道歉。拿去打分就是把卖家的情绪算到买家头上。',
    emo_pre_signature: '签名档和免责声明是套话，它们只会多出几句去稀释池化结果。',
    emo_pre_noise: '订单号、URL、邮箱不带语气，只占 token。',
    emo_pre_allcaps: 'tokenizer 对 ALL-CAPS 会碎成子词、置信度整体塌陷，所以转成小写——但"在喊"这个信号不丢，转成 allcaps 标志回到升级分里。',
    emo_gate_head: '门控',
    emo_th_gate: '门',
    emo_gate_content: '空串、纯 emoji、光一个订单号，都到不了模型。',
    emo_gate_language: '目前是无依赖的粗判占位，生产环境应换成 fasttext lid.176、阈值 0.75。',
    emo_gate_note: '两个门都不跑前向就返回 AMBIGUOUS，所以 l2 全零、l3_raw 为空、n_sentences 是 0。这不是"模型判不出来"——靠 ambiguous_reason 区分这两件事。',

    emo_priors_title: '每个标签实际上多久出现一次',
    emo_priors_sub: 'GoEmotions 的频次是 Reddit 的频次，而客服收件箱不长 Reddit 那个样子',
    emo_prior_high: '高频有效',
    emo_prior_high_d: '主力标签，信号大半在这里',
    emo_prior_mid: '中频有效',
    emo_prior_mid_d: '要聚合进簇之后才有意义',
    emo_prior_low: '低频/噪音',
    emo_prior_low_d: '折叠或丢弃',
    emo_priors_note: (labels) => `${labels} 在 GoEmotions 原论文里 support 少、F1 相应偏低。它们可以参与簇内聚合，但不允许单独用来决定任何事。`,
    emo_tax_lowsupport: '样本少',
    emo_sem_hostile: '已激怒，接下来很可能是差评或开 case',
    emo_sem_frustrated: '不满但仍讲道理',
    emo_sem_anxious: '担心钱或货的损失',
    emo_sem_confused: '信息缺口，纯咨询',
    emo_sem_demanding: '明确诉求：退款、换货',
    emo_sem_neutral: '事务性',
    emo_sem_grateful: '问题已解决',
    emo_sem_satisfied: '正向体验',
    emo_sem_self_blame: '买家自认过错',
    emo_sem_note: 'SELF_BLAME 频次低，但值得单独留着：它区分买家责任退货和卖家责任退货，直接决定运费由谁承担。',

    emo_limit_cost_t: '句级推理的算力代价',
    emo_limit_cost_d: '一封 24 句的邮件是 24 条序列的一次 batch，不是 1 条。CPU 部署需要实测 P99，扛不住就下调 MAX_SENTS。换来的是混合情绪不再被单次前向稀释掉，这个交换是值的。',
    emo_limit_split_t: '切句靠正则',
    emo_limit_split_d: '"Mr." 和 "No. 5" 会被误切。影响可控——切错只是让单句变短——但长期该换成正经的 sentence splitter。',
    emo_limit_single_t: '一次只看一封',
    emo_limit_single_d: '服务端不看会话历史。同一买家连续三封邮件情绪递增，只能靠上层做累积升级逻辑，这里兜不住。',
    emo_tax_title: '可识别的标签',
    emo_tax_sub: (raw, clusters) => `${raw} 个 GoEmotions 原始标签聚合成 ${clusters} 个情绪簇——落到邮件上的是簇，不是原始标签`,
    emo_tax_unmapped: (labels) => `故意不归簇：${labels}——它对不上任何一个簇的业务动作，硬塞进去只会污染那个簇的分数。`,
    emo_tax_polarity: '极性',
    emo_tax_neg: '负面',
    emo_tax_pos: '正面',
    emo_tax_mean: '跨句不取 max',
    emo_tie_band: (band) => `与最高分相差 ${band} 以内的簇算并列，并列取极性最负的那个。`,
    emo_try_title: '试一段',
    emo_try_sub: '模型只覆盖英文——换成别的语言它会直接给不出结果，这件事本身也值得看一眼。',
    emo_ph: '粘贴或输入一段客户可能会写的话…',
    emo_run: '识别',
    emo_running: '识别中…',
    emo_samples: '示例',
    emo_sample_expect: (label) => `人读下来应该是「${label}」`,
    emo_chars: (n, max) => `${n} / ${max}`,
    emo_result_title: '模型返回了什么',
    emo_result_fail: '模型没有给出可用的情绪结果。',
    emo_scores_title: '各簇得分',
    emo_scores_sub: '多标签打分，按极性排序——加起来不等于 1',
    emo_l1: '升级级别',
    emo_escalation: '升级分数',
    emo_negativity: '负面度',
    emo_latency: '模型耗时',
    emo_sentences: '句数',
    emo_flags: '标记',
    emo_rule_hits: '命中规则',
    emo_sarcasm: '反讽覆盖',
    emo_tested_by: (who, when) => `${who} 测试于 ${when}`,
    emo_fb_title: '判得对吗？',
    emo_fb_sub: '你的评价所有人可见，并计入下面的一致率。',
    emo_fb_correct: '判对了',
    emo_fb_wrong: '判错了',
    emo_fb_pick: '你认为正确的标签是？（可多选）',
    emo_fb_note: '备注（可选）',
    emo_fb_note_ph: '你为什么这么读？',
    emo_fb_save: '保存评价',
    emo_fb_saving: '保存中…',
    emo_fb_clear: '撤回评价',
    emo_fb_by: (who, when) => `${who} · ${when}`,
    emo_fb_need_label: '请先选出你认为正确的标签。',
    emo_fb_saved: '评价已保存。',
    emo_kpi_tests: '测试次数',
    emo_kpi_tests_sub: (n) => `来自 ${n} 个人`,
    emo_kpi_reviewed: '已评价',
    emo_kpi_reviewed_sub: '有人给过对错的条数',
    emo_kpi_accuracy: '一致率',
    emo_kpi_accuracy_sub: '判对数 ÷ 已评价数',
    emo_kpi_speed: '平均耗时',
    emo_kpi_speed_sub: '本地模型，每次调用',
    emo_kpi_failed: '无结果',
    emo_kpi_failed_sub: '不支持的语言或服务不可用',
    emo_chart_pred: '模型判成了什么',
    emo_chart_pred_sub: '覆盖全部测试',
    emo_chart_truth: '人认为应该是什么',
    emo_chart_truth_sub: '来自评价——判对的那条算它自己',
    emo_table_confusion: '预测 × 人工标注',
    emo_table_confusion_sub: '对角线是一致，落在对角线之外的每一格都值得点开看',
    emo_table_percluster: '各簇一致率',
    emo_th_predicted: '模型判定',
    emo_th_correct: '判对',
    emo_th_wrong: '判错',
    emo_th_rate: '一致率',
    emo_records_title: '测试记录',
    emo_records_sub: '最新在前——点一行会在测试台里打开它并给出评价',
    emo_records_empty: '还没有人测过。在上面跑一段，记录会出现在这里，所有人都看得见。',
    emo_no_verdict: '还没人评价',
    emo_verdict_correct: '判对',
    emo_verdict_wrong: '判错',
    emo_toast_test_fail: (msg) => `这次测试没能跑起来：${msg}`,
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
    view_emotion: 'Reconocimiento de emociones',
    emo_view_title: 'Reconocimiento de emociones',
    emo_view_desc: 'El modelo local de emoción: qué es, qué etiquetas reconoce y cómo se comporta con texto real.',
    emo_scope: 'Qué pruebas mostrar',
    emo_tabs: 'Páginas de emoción',
    emo_tab_model: 'El modelo',
    emo_tab_labels: 'Etiquetas',
    emo_tab_bench: 'Banco',
    emo_tab_log: 'Registro',
    emo_desc_model: 'El modelo local detrás de cada etiqueta de sentimiento: qué es, cómo se entrenó y qué puntúa.',
    emo_desc_labels: 'Los nueve grupos que puede recibir un correo, las 28 etiquetas originales detrás de ellos y qué cambia la etiqueta.',
    emo_desc_bench: 'Pruebe el modelo local con cualquier texto y diga si acertó el sentimiento. Cada prueba y veredicto es visible para todos.',
    emo_desc_log: 'Todas las pruebas que ha hecho cualquiera, y lo que suman.',
    emo_off: 'No hay EMOTION_API_URL configurada, así que el banco no alcanza ningún modelo. El sentimiento vuelve al modelo de lenguaje hasta que se configure.',

    emo_model_title: 'El modelo',
    emo_model_sub: 'un clasificador local, no el modelo de lenguaje que escribe las respuestas',
    emo_model_lede: 'El sentimiento es la única etiqueta que no viene del modelo de lenguaje. Viene de un pequeño clasificador RoBERTa que corre en nuestro propio hardware, porque el tono es justo la etiqueta que debe ser reproducible: el mismo correo tiene que recibir siempre la misma puntuación, y una puntuación que podamos verificar contra un umbral.',
    emo_spec_base: 'Modelo base',
    emo_spec_params: 'Tamaño',
    emo_spec_head: 'Capa de salida',
    emo_spec_head_v: (n) => `${n} probabilidades independientes, una por etiqueta`,
    emo_spec_dataset: 'Ajustado con',
    emo_spec_language: 'Idioma',
    emo_spec_training: 'Entrenamiento',
    emo_spec_epochs: (n) => `${n} épocas`,
    emo_spec_threshold: 'Umbral por defecto',
    emo_spec_serving: 'Despliegue',
    emo_spec_serving_on: (t) => `accesible por HTTP · ${t}s de espera`,
    emo_spec_serving_off: 'sin endpoint configurado',
    emo_model_why: 'Sigmoide multietiqueta, no softmax: un mismo correo puede puntuar alto en varias etiquetas a la vez, y las puntuaciones no suman 1.',
    emo_metrics_title: 'Lo que dice su ficha de modelo',
    emo_metrics_sub: 'medido por su autor sobre el conjunto de prueba de GoEmotions — no sobre correo de soporte ni sobre este despliegue',
    emo_th_setting: 'Configuración',
    emo_th_score: 'Puntuación',
    emo_metric_05: 'Umbral 0,5',
    emo_metric_tuned: 'Umbrales ajustados por etiqueta',
    emo_metrics_spread: (best, f1, worst) =>
      `Las medias esconden una dispersión enorme: ${best} llega a ${f1} de F1, mientras que ${worst} se quedan en 0,000 — con muy pocos ejemplos de entrenamiento no se aprende.`,
    emo_metrics_caveat: 'Aquí la exactitud exige acertar las 28 etiquetas a la vez; por eso ajustar los umbrales sube el F1 y baja la exactitud al mismo tiempo.',
    emo_step1_t: 'Quitar el hilo citado y la firma',
    emo_step1_d: 'Se hace en el servicio. Si no, el historial citado se puntuaría como si el cliente lo acabara de escribir.',
    emo_step2_t: 'Puntuar cada frase',
    emo_step2_d: '28 etiquetas GoEmotions, una probabilidad sigmoide cada una, por frase.',
    emo_step3_t: 'Agrupar entre frases',
    emo_step3_d: 'Máximo, salvo NEUTRAL que se promedia: lo neutro es la ausencia de emoción, y cualquier correo de varias frases contiene al menos una frase plana y factual.',
    emo_step4_t: 'Plegar 28 etiquetas en 9 grupos',
    emo_step4_d: 'Agrupadas por la acción que disparan, no por psicología: dos etiquetas que llevan a la misma estrategia de respuesta comparten grupo.',
    emo_step5_t: 'Elegir el grupo',
    emo_step5_d: (band) =>
      `Gana la puntuación más alta, pero todo lo que quede a menos de ${band} cuenta como empate y se lleva el grupo más negativo. La asimetría es intencionada: un empate leído como negativo cuesta una revisión humana; leído como positivo mete a un cliente enfadado en la automatización completa.`,
    emo_step6_t: 'Pasar el resto a las reglas de revisión',
    emo_step6_d: 'El nivel de escalado, la marca de sarcasmo y las reglas de palabras clave son señales independientes; cada una basta por sí sola para mandar el correo a una persona.',
    emo_contract_title: 'Qué devuelve el servicio',
    emo_contract_sub: 'un POST por correo — cada campo cae a null en vez de inventarse',
    emo_th_field: 'Campo',
    emo_th_meaning: 'Qué significa',
    emo_field_l1: 'El escalado que decide el propio servicio, de P0 (peor) a P3.',
    emo_field_escalation_score: '0–1, cuánto se lee el texto como un escalado.',
    emo_field_negativity: 'De −1 a 1. Los valores negativos tiran a positivo y los positivos a negativo.',
    emo_field_l2: 'Las nueve puntuaciones de grupo. De aquí sale la etiqueta.',
    emo_field_l3_raw: 'Las 28 puntuaciones originales. El servicio guarda su propia copia para calibrar; este buzón solo las usa para reconstruir los grupos si falta l2 y no las escribe en el hilo: 28 decimales por correo no compensan la fila.',
    emo_field_rule_hits: 'Reglas de palabras clave que activó el servicio, p. ej. legal.',
    emo_field_sarcasm_override: 'Literalmente positivo, realmente negativo. Por sí solo manda el correo a una persona.',
    emo_field_flags: 'allcaps, repetition, sarcasm — señales de superficie, no salida del modelo.',
    emo_field_n_sentences: 'Cuántas frases puntuó.',
    emo_field_ambiguous_reason: 'Por qué no pudo responder, cuando no pudo.',
    emo_field_preprocessing: 'Si se quitó un hilo citado o una firma antes de puntuar.',
    emo_limits_title: 'Dónde falla',
    emo_limits_sub: 'conocido y a la vista — los ejemplos del banco que lo rompen siguen en la lista',
    emo_limit_lang_t: 'Solo inglés',
    emo_limit_lang_d: 'Cualquier otro idioma vuelve como AMBIGUOUS con los nueve grupos a 0. Eso se lee como «sin respuesta», no como neutro, y la etiqueta vuelve al modelo de lenguaje, que sí es multilingüe.',
    emo_limit_sarcasm_t: 'El sarcasmo suele leerse como elogio',
    emo_limit_sarcasm_d: '«Great job losing my package again» puntúa SATISFIED 0,945. El servicio tiene una anulación por sarcasmo y esta no la caza.',
    emo_limit_rare_t: 'Las etiquetas raras nunca se aprendieron',
    emo_limit_rare_d: 'grief, pride y relief tienen 0,000 de F1 en la ficha del modelo. relief está dentro de GRATEFUL, así que ese grupo se apoya solo en gratitude.',
    emo_limit_domain_t: 'Reddit, no una bandeja de soporte',
    emo_limit_domain_d: (points, n, method) => `Los datos de entrenamiento son comentarios de Reddit. El correo de cliente es más formal y más transaccional, y se espera que la exactitud sin ajuste quede ${points} puntos por debajo de las cifras publicadas — la solución es una ronda de ${method} sobre ${n} correos anotados propios. Ninguna de las cifras de arriba se midió sobre correo de soporte; enseñar esa distancia es justo para lo que existe el banco.`,

    emo_map_title: 'Cada etiqueta original y dónde cae',
    emo_map_sub: (n) => `las ${n} etiquetas GoEmotions en orden alfabético — la cuadrícula de arriba, leída al revés`,
    emo_th_rawlabel: 'Etiqueta GoEmotions',
    emo_th_cluster: 'Grupo',
    emo_map_unmapped: 'sin grupo',
    emo_use_title: 'Qué cambia la etiqueta',
    emo_use_sub: 'la etiqueta no es decoración: estas reglas la leen y encaminan el correo',
    emo_use_1_t: 'Grupo negativo + urgencia alta → revisión humana',
    emo_use_1_d: 'hostile, frustrated o anxious junto con urgencia alta o crítica significa que la queja ya está escalando.',
    emo_use_2_t: 'P0_ESCALATE → revisión humana',
    emo_use_2_d: 'El escalado del propio servicio es una señal independiente: un correo de urgencia baja puede volver igualmente como P0.',
    emo_use_3_t: 'Sarcasmo → revisión humana',
    emo_use_3_d: 'Las respuestas automáticas fallan más que nunca con los correos amables en la superficie.',
    emo_use_4_t: 'Helios Plus + negativo → revisión humana',
    emo_use_4_d: 'Un cliente de alto valor con un grupo negativo o urgencia alta merece una persona.',
    emo_use_5_t: 'Si no, orienta la respuesta',
    emo_use_5_d: 'El grupo entra en el prompt, de modo que la respuesta escrita encaje con el tono al que contesta.',
    emo_use_source: 'Cuando el servicio no responde, la etiqueta vuelve al modelo de lenguaje y sentiment_source pasa de local_model a llm_fallback: la confianza que la acompaña deja de ser una probabilidad real y se convierte en la autoevaluación del modelo.',

    emo_tab_triage: 'Triaje',
    emo_desc_triage: 'Cómo el servicio convierte 28 probabilidades en un SLA y en la decisión de si una persona lee el correo.',
    emo_chain_title: 'La cadena completa',
    emo_chain_sub: 'el modelo es una etapa de diez — todo lo que lo rodea es determinista',
    emo_chain_1: 'correo original',
    emo_chain_2: 'preprocesado',
    emo_chain_3: 'compuertas',
    emo_chain_4: 'división en frases',
    emo_chain_5: 'inferencia por lotes',
    emo_chain_6: 'máx. dentro del grupo',
    emo_chain_7: 'agrupado entre frases',
    emo_chain_8: 'veto por sarcasmo',
    emo_chain_9: 'puntuación de escalado',
    emo_chain_10: 'franja L1',
    emo_rule_sent_t: 'Una pasada por frase, no por correo',
    emo_rule_sent_d: 'GoEmotions se entrenó con comentarios cortos de Reddit, y un correo entero colapsa sobre su emoción más fuerte. «Gracias por la ayuda de la otra vez, pero el recambio llegó roto» puntuaba FRUSTRATED 0,086 al entrar como un solo documento. Dividir primero mantiene vivas las emociones mezcladas. El tope son 24 frases; por encima se guardan las 12 primeras y las 12 últimas, porque la petición y el enfado están en los extremos.',
    emo_rule_max_t: 'Máximo dentro del grupo, nunca suma',
    emo_rule_max_d: 'annoyance y disappointment coocurren constantemente; sumarlas llevaría una molestia leve a 1,4 y superaría a la ira real. El máximo responde «cuánto se ha activado este grupo», no «cuántas de sus etiquetas se activaron».',
    emo_rule_norm_t: 'Sin normalizar entre grupos',
    emo_rule_norm_d: 'GRATEFUL por la vez anterior y FRUSTRATED por esta son ciertas a la vez. Normalizar las diluiría entre sí y la señal mezclada desaparecería.',
    emo_rule_neutral_t: 'NEUTRAL es el único grupo que no se agrupa por máximo',
    emo_rule_neutral_d: 'Lo neutro es la ausencia de emoción, así que un máximo entre frases volvería neutro cualquier correo de varias frases: todos contienen al menos una línea plana y factual. Medido contra el servicio en vivo: dos frases factuales dan NEUTRAL 0,935, y añadir «I am furious that nobody has replied.» lo baja a 0,150 mientras HOSTILE se lleva el máximo con 0,780.',

    emo_layers_title: 'Tres capas, tres funciones',
    emo_layers_sub: 'la misma pasada, leída con tres granularidades',
    emo_layer_l1: 'Decide el SLA y si lo lee una persona. Este buzón lo trata como señal dura de escalado.',
    emo_layer_l2: 'Decide la estrategia de respuesta. Esta es la capa que acaba siendo la etiqueta del correo.',
    emo_layer_l3: 'Se guarda para calibrar umbrales y vigilar la deriva de etiquetas. Nunca decide nada por sí sola.',
    emo_layers_note: 'L3 se guarda entera, incluida caring, que no pertenece a ningún grupo: filtrarla con el vocabulario de grupos al entrar borraría en silencio la evidencia que hace falta para recalibrar los grupos más adelante.',
    emo_l1_title: 'L1 — lo que cuesta cada franja',
    emo_l1_sub: 'la franja es la decisión; la puntuación detrás solo existe para que puedas discutirla',
    emo_th_level: 'Franja',
    emo_th_action: 'Acción',
    emo_th_sla: 'SLA',
    emo_act_none: 'Solo persona',
    emo_act_draft: 'La IA redacta, una persona aprueba',
    emo_act_auto: 'La IA responde automáticamente',
    emo_act_template: 'Agradecimiento con plantilla, por lotes',
    emo_act_bypass: 'Sin enrutado por emoción — se enruta por intención',
    emo_sla_h: (h) => `${h} h`,
    emo_l1_amb: 'AMBIGUOUS no es un fallo. Con texto fuera de dominio el modelo baja la confianza de forma uniforme, y forzar un argmax sobre eso es más peligroso que no responder.',
    emo_score_title: 'La puntuación de escalado',
    emo_score_sub: 'grupos negativos ponderados, modificadores sumados y luego cortado en franjas',
    emo_score_weights: 'Pesos de gravedad',
    emo_score_mods: 'Modificadores',
    emo_score_mod_demanding: (t) => `DEMANDING > ${t} — hay una petición explícita`,
    emo_score_mod_repetition: 'repetition — ya lo preguntó, se le acabó la paciencia',
    emo_score_mod_allcaps: 'allcaps — está gritando',
    emo_score_mod_sarcasm: 'sarcasm — agresión pasiva',
    emo_score_bands: 'Franjas',
    emo_th_band: 'Franja',
    emo_score_p3: (neg, pos) => `Por debajo de la franja más baja, P3_LOW exige que todos los grupos negativos estén por debajo de ${neg} y que haya un grupo positivo en ${pos} o más. Un grupo positivo es condición de acceso a P3, nunca su motivo: con cualquier residuo negativo no puede caer ahí.`,
    emo_score_fallback: '¿Sigue sin decidirse? Cualquiera de estas tres da P2_STANDARD; si no, la respuesta es AMBIGUOUS.',
    emo_score_why: 'La versión anterior encadenaba if-else sobre umbrales de un solo grupo, y se rompía dos veces: dos grupos que se quedan cortos por poco arrastraban el correo una franja hacia abajo («tercera vez que lo pido, quiero un reembolso»), y un grupo positivo podía decidir la franja por sí solo, con lo que una queja hostil pero educada caía en P3_LOW.',
    emo_rules_title: 'Reglas de amenaza — si hay coincidencia es P0, piense lo que piense el modelo',
    emo_rules_sub: 'las amenazas de marketplace son lenguaje de plantilla, y aquí una regex gana al modelo en precisión y en cobertura',
    emo_th_rule: 'Regla',
    emo_th_covers: 'Cubre',
    emo_rules_note: 'Verificado contra el servicio en vivo: «If this is not resolved today I will file an A-to-Z claim.» puntúa NEUTRAL 0,805 — no hay enfado ninguno — y aun así vuelve como P0_ESCALATE solo por la coincidencia de a_to_z. El lookahead negativo también funciona: «I don\'t want to dispute the charge» no coincide con nada.',
    emo_sarcasm_title: 'Veto por sarcasmo',
    emo_sarcasm_sub: 'elogio más un hecho negativo — no elogio más enfado, que es lo que buscaba la primera versión y nunca encontraba',
    emo_th_kind: 'sarcasm_kind',
    emo_th_example: 'Ejemplo',
    emo_sarcasm_note: 'Una coincidencia pone a cero GRATEFUL y SATISFIED a la vez — «Thanks for nothing» pasa por GRATEFUL, así que poner a cero solo SATISFIED lo dejaba escapar — y empuja el correo a P0_ESCALATE. Qué regla saltó se expone en sarcasm_kind, para poder rastrear un escalado discutido.',
    emo_sarcasm_miss: 'Está calibrado a propósito para saltar de menos: juzgar mal a un cliente contento pone a cero su satisfacción e infla la cola. El precio son fallos reales: «Great job losing my package again» sigue volviendo como SATISFIED 0,945 y P3_LOW, y se puede reproducir en el banco.',
    emo_gate_title: 'Antes de que el modelo llegue a correr',
    emo_gate_sub: 'la forma más barata de acertar es no responder',
    emo_pre_head: 'Preprocesado',
    emo_pre_quote: 'Un hilo reenviado lleva dentro la disculpa que escribió el propio agente. Puntuar eso es atribuir al comprador los sentimientos del vendedor.',
    emo_pre_signature: 'Las firmas y los descargos son texto de relleno; solo añaden frases que diluyen el agrupado.',
    emo_pre_noise: 'Números de pedido, URLs y direcciones no llevan tono y solo cuestan tokens.',
    emo_pre_allcaps: 'El tokenizador destroza las MAYÚSCULAS en subpalabras y la confianza se hunde, así que se pasa a minúsculas — pero el grito se conserva como la marca allcaps y se devuelve a la puntuación de escalado.',
    emo_gate_head: 'Compuertas',
    emo_th_gate: 'Compuerta',
    emo_gate_content: 'Cadenas vacías, emoji sueltos y un número de pedido solo nunca llegan al modelo.',
    emo_gate_language: 'Hoy es un sustituto tosco; en producción debería ser fasttext lid.176 con umbral 0,75.',
    emo_gate_note: 'Ambas compuertas devuelven AMBIGUOUS sin pasada, así que l2 es todo ceros, l3_raw está vacío y n_sentences es 0. Eso no es «el modelo no supo decidir»: se distinguen por ambiguous_reason.',

    emo_priors_title: 'Con qué frecuencia aparece de verdad cada etiqueta',
    emo_priors_sub: 'las frecuencias de GoEmotions son las de Reddit, y una bandeja de soporte no tiene esa forma',
    emo_prior_high: 'Frecuentes y útiles',
    emo_prior_high_d: 'las etiquetas de trabajo — llevan casi toda la señal',
    emo_prior_mid: 'Ocasionales',
    emo_prior_mid_d: 'solo tienen sentido una vez plegadas en un grupo',
    emo_prior_low: 'Raras o ruido',
    emo_prior_low_d: 'se pliegan o se descartan',
    emo_priors_note: (labels) => `${labels} tienen poco soporte en el artículo de GoEmotions y un F1 débil en consecuencia. Pueden contribuir a la puntuación de un grupo; nunca pueden decidir nada por sí solas.`,
    emo_tax_lowsupport: 'pocos datos',
    emo_sem_hostile: 'Ya está enfadado — lo siguiente suele ser una reseña mala o un caso',
    emo_sem_frustrated: 'Descontento pero todavía razonable',
    emo_sem_anxious: 'Teme perder el dinero o la mercancía',
    emo_sem_confused: 'Un hueco de información — pura consulta',
    emo_sem_demanding: 'Una petición concreta: reembolso, cambio',
    emo_sem_neutral: 'Transaccional',
    emo_sem_grateful: 'El problema está cerrado',
    emo_sem_satisfied: 'Experiencia positiva',
    emo_sem_self_blame: 'El comprador cree que el error fue suyo',
    emo_sem_note: 'SELF_BLAME es poco frecuente y aun así merece la pena conservarlo: separa una devolución por culpa del comprador de una por culpa del vendedor, y eso decide quién paga el envío de vuelta.',

    emo_limit_cost_t: 'La inferencia por frase cuesta más cómputo',
    emo_limit_cost_d: 'Un correo de 24 frases es un lote de 24 secuencias, no una. En CPU eso exige medir el P99, y MAX_SENTS baja si no cabe. El intercambio recupera las emociones mezcladas que una sola pasada diluye, y compensa.',
    emo_limit_split_t: 'La división en frases es una regex',
    emo_limit_split_d: '«Mr.» y «No. 5» se dividen mal. El daño está acotado — una división errónea solo acorta una frase — pero a la larga aquí debería ir un splitter de verdad.',
    emo_limit_single_t: 'Un correo cada vez',
    emo_limit_single_d: 'El servicio nunca ve el historial del hilo. Un cliente cuyos tres correos van subiendo de tono tiene que detectarse con lógica acumulativa más arriba, no aquí.',
    emo_tax_title: 'Etiquetas que reconoce',
    emo_tax_sub: (raw, clusters) => `${raw} etiquetas GoEmotions agrupadas en ${clusters} grupos — lo que llega al correo es el grupo`,
    emo_tax_unmapped: (labels) => `Sin grupo a propósito: ${labels} — no encaja con la acción de ningún grupo, así que no se cuenta.`,
    emo_tax_polarity: 'polaridad',
    emo_tax_neg: 'negativo',
    emo_tax_pos: 'positivo',
    emo_tax_mean: 'no agrupado por máximo entre frases',
    emo_tie_band: (band) => `Los grupos a menos de ${band} del máximo cuentan como empate; gana el más negativo.`,
    emo_try_title: 'Pruebe un mensaje',
    emo_try_sub: 'Solo inglés — con otros idiomas el modelo no devuelve resultado, y eso también vale la pena verlo.',
    emo_ph: 'Pegue o escriba lo que podría escribir un cliente…',
    emo_run: 'Analizar',
    emo_running: 'Analizando…',
    emo_samples: 'Ejemplos',
    emo_sample_expect: (label) => `una persona lo leería como ${label}`,
    emo_chars: (n, max) => `${n} / ${max}`,
    emo_result_title: 'Lo que devolvió el modelo',
    emo_result_fail: 'El modelo no devolvió una emoción utilizable.',
    emo_scores_title: 'Puntuación por grupo',
    emo_scores_sub: 'puntuaciones multietiqueta, ordenadas por polaridad — no suman 1',
    emo_l1: 'Nivel de escalado',
    emo_escalation: 'Puntuación de escalado',
    emo_negativity: 'Negatividad',
    emo_latency: 'Latencia del modelo',
    emo_sentences: 'Frases',
    emo_flags: 'Marcas',
    emo_rule_hits: 'Reglas activadas',
    emo_sarcasm: 'Anulación por sarcasmo',
    emo_tested_by: (who, when) => `probado por ${who} · ${when}`,
    emo_fb_title: '¿Acertó?',
    emo_fb_sub: 'Su veredicto es visible para todos y alimenta las cifras de abajo.',
    emo_fb_correct: 'Correcto',
    emo_fb_wrong: 'Incorrecto',
    emo_fb_pick: '¿Qué etiqueta es la correcta? (una o varias)',
    emo_fb_note: 'Nota (opcional)',
    emo_fb_note_ph: '¿Por qué lo lee así?',
    emo_fb_save: 'Guardar veredicto',
    emo_fb_saving: 'Guardando…',
    emo_fb_clear: 'Retirar veredicto',
    emo_fb_by: (who, when) => `${who} · ${when}`,
    emo_fb_need_label: 'Elija la etiqueta que considera correcta.',
    emo_fb_saved: 'Veredicto guardado.',
    emo_kpi_tests: 'Pruebas',
    emo_kpi_tests_sub: (n) => `de ${n} ${n === 1 ? 'persona' : 'personas'}`,
    emo_kpi_reviewed: 'Con veredicto',
    emo_kpi_reviewed_sub: 'pruebas ya juzgadas',
    emo_kpi_accuracy: 'Coincidencia',
    emo_kpi_accuracy_sub: 'correctas sobre juzgadas',
    emo_kpi_speed: 'Latencia media',
    emo_kpi_speed_sub: 'modelo local, por prueba',
    emo_kpi_failed: 'Sin resultado',
    emo_kpi_failed_sub: 'idioma no soportado o servicio caído',
    emo_chart_pred: 'Lo que predijo el modelo',
    emo_chart_pred_sub: 'en todas las pruebas',
    emo_chart_truth: 'Lo que dijeron las personas',
    emo_chart_truth_sub: 'de los veredictos — una etiqueta confirmada cuenta como sí misma',
    emo_table_confusion: 'Predicho × dicho por personas',
    emo_table_confusion_sub: 'la diagonal es coincidencia; todo lo demás es un desacuerdo que vale la pena leer',
    emo_table_percluster: 'Coincidencia por grupo',
    emo_th_predicted: 'Predicho',
    emo_th_correct: 'Correctas',
    emo_th_wrong: 'Incorrectas',
    emo_th_rate: 'Coincidencia',
    emo_records_title: 'Registro de pruebas',
    emo_records_sub: 'más recientes primero — pulse una fila para abrirla en el banco y juzgarla',
    emo_records_empty: 'Todavía no hay pruebas. Ejecute un mensaje arriba y aparecerá aquí para todos.',
    emo_no_verdict: 'sin veredicto',
    emo_verdict_correct: 'Correcto',
    emo_verdict_wrong: 'Incorrecto',
    emo_toast_test_fail: (msg) => `No se pudo ejecutar la prueba: ${msg}`,
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

/* The step-1 taxonomy: intent / urgency / language mirror
   email_automatic_reply_en_US.jinjia2, sentiment mirrors the emotion clusters in
   emotion_recognition.py. Unlike the policy facts, these are closed enums rather
   than model prose, so they can be translated safely. */
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
  /* The nine emotion clusters the local model scores, ordered by polarity.
     `disappointed` and `angry` are the retired six-value vocabulary — kept so
     threads classified before the switch still read. */
  sentiment: {
    satisfied:    { en: 'Satisfied', zh: '满意', es: 'Satisfecho' },
    grateful:     { en: 'Grateful', zh: '感谢', es: 'Agradecido' },
    self_blame:   { en: 'Self-blame', zh: '自责', es: 'Autorreproche' },
    neutral:      { en: 'Neutral', zh: '中性', es: 'Neutral' },
    confused:     { en: 'Confused', zh: '困惑', es: 'Confundido' },
    demanding:    { en: 'Demanding', zh: '强烈诉求', es: 'Exigente' },
    anxious:      { en: 'Anxious', zh: '焦虑', es: 'Ansioso' },
    frustrated:   { en: 'Frustrated', zh: '不满', es: 'Frustrado' },
    hostile:      { en: 'Hostile', zh: '敌意', es: 'Hostil' },
    disappointed: { en: 'Disappointed', zh: '失望', es: 'Decepcionado' },
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
  // Sentiment is an ordered scale with a neutral middle -> diverging: a green arm
  // for the positive clusters, a grey midpoint, an amber arm for the negative
  // ones, each arm monotone in lightness (dim -> bright as it leaves the middle,
  // the dark-surface direction). Validated against --paper #11202e: adjacent ΔL
  // >= 0.06 within each arm, and the two arm/midpoint boundaries clear the CVD
  // floor at ΔE 15.5 and 16.5 (deuteranopia). Do not eyeball replacements.
  // `confused` sits at 2.69:1, under the 3:1 mark floor — legal only because the
  // legend and the breakdown table below carry every count in text.
  sentiment: {
    satisfied:  '#7ac74f',        // hero tunic green, 8.04:1
    grateful:   '#5da33f',
    self_blame: '#40792f',        // 3.15:1
    neutral:    '#7d8f9e',        // grey midpoint, 4.97:1
    confused:   '#8f5230',        // 2.69:1
    demanding:  '#a86436',
    anxious:    '#c47a3c',
    frustrated: '#e09a4c',        // guardian amber
    hostile:    '#f7c26a',
  },
};

/* Reading order for the diverging sentiment bar: positive, neutral, then
   increasingly negative — this is emotion_recognition.POLARITY in descending
   order, and swapping these would change the meaning. `disappointed` and `angry`
   are the retired vocabulary, parked beside the cluster that replaced them so
   threads classified before the switch still show up in the totals. */
const SENTIMENT_ORDER = [
  'satisfied', 'grateful', 'self_blame', 'neutral', 'confused', 'demanding',
  'anxious', 'disappointed', 'frustrated', 'hostile', 'angry',
];
const URGENCY_ORDER = ['low', 'medium', 'high', 'critical'];

/* Colour follows the cluster, never its position in the bar. The two retired
   labels take the colour of the cluster they mean — same bucket, older name. */
const SENTIMENT_LEGACY = { disappointed: 'frustrated', angry: 'hostile' };
const sentimentColor = (value) =>
  VIZ.sentiment[value] || VIZ.sentiment[SENTIMENT_LEGACY[value]] || VIZ.sentiment.neutral;

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
  if (state.view === 'emotion') renderEmotionView();
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
    // 情绪测试台的计数挂在 rail 上，不进那个页面也要显示；这一路失败不该拖垮启动
    api('/api/emotion/stats?scope=all')
      .then((s) => { $('#count-emotion').textContent = s.total; })
      .catch(() => {});

    const params = new URLSearchParams(location.search);
    const wanted = params.get('view');
    // 子页要在 setView 之前定好：setView('emotion') 会把当前子页写回 URL
    if (EMO_TABS.includes(params.get('tab'))) state.emoTab = params.get('tab');
    if (DEEP_VIEWS.includes(wanted) && wanted !== 'mail') setView(wanted);
    // ?test=<id> 直接把某一条测试载进结果卡——"你看模型把我这句话读成什么了"
    // 是要发给别人看的，链接得能指到具体那一条。必须等词表到位再打开：
    // renderEmotionView() 在 emoMeta 为空时直接返回，结果卡还没进 DOM 就滚不过去。
    const testId = Number(params.get('test'));
    if (testId) {
      Promise.all([loadEmotionMeta(), api(`/api/emotion/tests/${testId}`)])
        .then(([, test]) => { setView('emotion'); openEmotionTest(test); })
        .catch(() => {});
    }
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

/* The bench and the analytics view are shared boards — "look at what the model
   did to my sentence" is a thing you send someone. So the view lives in the URL
   and a pasted link opens on the right panel. */
const DEEP_VIEWS = ['mail', 'policy', 'tags', 'emotion'];

function setView(view) {
  state.view = view;
  const url = new URL(location.href);
  if (view === 'mail') url.searchParams.delete('view');
  else url.searchParams.set('view', view);
  if (view === 'emotion') {
    url.searchParams.set('tab', state.emoTab);
  } else {
    url.searchParams.delete('tab');
    url.searchParams.delete('test');
  }
  history.replaceState(null, '', url);
  const ws = document.querySelector('.workspace');
  ws.classList.toggle('is-policy', view === 'policy');
  ws.classList.toggle('is-tags', view === 'tags');
  ws.classList.toggle('is-emotion', view === 'emotion');
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
  } else if (view === 'emotion') {
    // 说明书部分（可识别标签）不依赖任何测试记录，先渲染出来再补数据，
    // 免得第一次进页面时先闪一屏空白
    renderEmotionView();
    loadEmotionMeta().then(() => { renderEmotionView(); return refreshEmotion(); });
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

/* --------------------------------------------- emotion recognition view --- */
/* Four sub-pages behind one rail entry, in the order you'd want them explained:
   what the model is, what it can label, try it yourself, and what everyone's
   tests add up to. They are separate pages rather than one long scroll because
   only two of them are reference material — the bench and the log are worked in,
   and a reader who came to run a sentence should not have to scroll past a
   model card to reach the textarea. The result card doubles as the feedback
   form, so clicking a row in the log loads it into the bench rather than
   growing a second form. */

const EMO_TABS = ['model', 'labels', 'triage', 'bench', 'log'];

const fmtWhen = (ts) => (ts ? new Date(ts * 1000).toLocaleString() : '—');
const emoShortUser = (id) => (id || '').replace(/^user-/, '');

function setEmoTab(tab) {
  if (!EMO_TABS.includes(tab) || tab === state.emoTab) return;
  state.emoTab = tab;
  const url = new URL(location.href);
  url.searchParams.set('tab', tab);
  // ?test= 指的是载进测试台的那一条，离开测试台之后这个参数就没有指向了
  if (tab !== 'bench') url.searchParams.delete('test');
  history.replaceState(null, '', url);
  renderEmotionView();
  $('#emotion-body').scrollTop = 0;
}

/* ------------------------------------------------------ sub-page: model -- */

/* The identity card. Everything factual here comes from /api/emotion/meta so
   that swapping the model is a one-file change on the server; the page only
   translates the field names. */
function emoModelCard(meta) {
  const m = meta.model || {};
  const card = chartCard(tr('emo_model_title'), tr('emo_model_sub'));
  card.classList.add('emomodel');

  const id = el('div', 'emomodel__id');
  if (m.home) {
    const link = el('a', 'emomodel__name', m.id);
    link.href = m.home;
    link.target = '_blank';
    link.rel = 'noreferrer noopener';
    id.append(link);
  } else {
    id.append(el('span', 'emomodel__name', m.id || '—'));
  }
  if (m.license) id.append(el('span', 'emomodel__badge', m.license));
  card.append(id);

  card.append(el('p', 'emomodel__lede', tr('emo_model_lede')));

  const dl = el('dl', 'kv kv--fact');
  kvRow(dl, tr('emo_spec_base'), m.base);
  kvRow(dl, tr('emo_spec_params'), m.params);
  kvRow(dl, tr('emo_spec_head'), tr('emo_spec_head_v', m.raw_labels), m.task);
  kvRow(dl, tr('emo_spec_dataset'), m.dataset_size, m.dataset);
  kvRow(dl, tr('emo_spec_language'), m.language);
  kvRow(dl, tr('emo_spec_training'),
    [tr('emo_spec_epochs', m.epochs), `lr ${m.learning_rate}`, `weight decay ${m.weight_decay}`].join(' · '));
  kvRow(dl, tr('emo_spec_threshold'), m.default_threshold);
  kvRow(dl, tr('emo_spec_serving'),
    meta.enabled ? tr('emo_spec_serving_on', meta.timeout) : tr('emo_spec_serving_off'));
  card.append(dl);

  card.append(el('p', 'emonote', tr('emo_model_why')));
  return card;
}

/* The published numbers, labelled as published numbers. They are the author's
   GoEmotions test-set scores — quoting them without that caveat would read as a
   claim about this deployment on support email, which nothing here measures. */
function emoMetricsCard(meta) {
  const m = meta.model || {};
  const rows = m.metrics || [];
  if (!rows.length) return null;
  const card = chartCard(tr('emo_metrics_title'), tr('emo_metrics_sub'));

  const table = el('table', 'dtable');
  const thead = el('thead');
  const hr = el('tr');
  hr.append(el('th', null, tr('emo_th_setting')));
  for (const h of ['accuracy', 'precision', 'recall', 'f1']) hr.append(el('th', 'dtable__num', h));
  thead.append(hr);
  table.append(thead);

  const tbody = el('tbody');
  for (const row of rows) {
    const line = el('tr');
    line.append(el('td', null,
      tr(row.setting === 'threshold_0.5' ? 'emo_metric_05' : 'emo_metric_tuned')));
    for (const k of ['accuracy', 'precision', 'recall', 'f1']) {
      line.append(el('td', 'dtable__num' + (k === 'f1' ? ' dtable__rowtotal' : ''),
        row[k] === undefined ? '·' : row[k].toFixed(3)));
    }
    tbody.append(line);
  }
  table.append(tbody);
  card.append(table);

  if (m.best_label && (m.worst_labels || []).length) {
    card.append(el('p', 'emonote', tr('emo_metrics_spread',
      m.best_label.label, m.best_label.f1.toFixed(3), m.worst_labels.join(' / '))));
  }
  card.append(el('p', 'emonote', tr('emo_metrics_caveat')));
  return card;
}

/* The full service-side chain as a strip, then the four choices in it that are
   not obvious. The strip exists to make one point visually: the model is a
   single stage, and the nine stages around it are ordinary deterministic code —
   which is why the tag is reproducible at all. */
function emoChainCard(meta) {
  const card = chartCard(tr('emo_chain_title'), tr('emo_chain_sub'));

  const strip = el('div', 'emochain');
  for (let i = 1; i <= 10; i += 1) {
    if (i > 1) strip.append(el('span', 'emochain__arrow', '→'));
    // 第 5 步是唯一一次模型前向，其余九步都是确定性代码，样式上要分得开
    strip.append(el('span', 'emochain__node' + (i === 5 ? ' is-model' : ''), tr(`emo_chain_${i}`)));
  }
  card.append(strip);

  const list = el('div', 'emolimits');
  for (const key of ['sent', 'max', 'norm', 'neutral']) {
    const item = el('div', 'emolimits__item is-choice');
    item.append(el('div', 'emolimits__t', tr(`emo_rule_${key}_t`)));
    item.append(el('p', 'emolimits__d', tr(`emo_rule_${key}_d`)));
    list.append(item);
  }
  card.append(list);

  const band = (meta.taxonomy || {}).tie_band;
  card.append(el('p', 'emonote', tr('emo_step5_d', band)));
  return card;
}

/* The response contract. Field names stay verbatim — they are the keys you would
   grep for in the service log, so translating them would break the only use this
   table has. */
function emoContractCard(meta) {
  const fields = meta.response_fields || [];
  if (!fields.length) return null;
  const card = chartCard(tr('emo_contract_title'), tr('emo_contract_sub'));

  const table = el('table', 'dtable');
  const thead = el('thead');
  const hr = el('tr');
  hr.append(el('th', null, tr('emo_th_field')));
  hr.append(el('th', null, tr('emo_th_meaning')));
  thead.append(hr);
  table.append(thead);

  const tbody = el('tbody');
  for (const f of fields) {
    const line = el('tr');
    const key = el('td');
    key.append(el('code', 'emofield', f));
    line.append(key);
    line.append(el('td', null, tr(`emo_field_${f}`)));
    tbody.append(line);
  }
  table.append(tbody);
  card.append(table);
  return card;
}

function emoLimitsCard(meta) {
  const m = meta.model || {};
  const card = chartCard(tr('emo_limits_title'), tr('emo_limits_sub'));
  const list = el('div', 'emolimits');
  for (const key of ['domain', 'lang', 'sarcasm', 'rare', 'cost', 'split', 'single']) {
    const item = el('div', 'emolimits__item');
    item.append(el('div', 'emolimits__t', tr(`emo_limit_${key}_t`)));
    // 域偏移那条的数字来自模型档案，不写死在文案里
    const ft = m.finetune_advice || {};
    item.append(el('p', 'emolimits__d', key === 'domain'
      ? tr('emo_limit_domain_d', (m.domain_shift_points || []).join('–'), ft.examples, ft.method)
      : tr(`emo_limit_${key}_d`)));
    list.append(item);
  }
  card.append(list);
  return card;
}

/* ----------------------------------------------------- sub-page: triage -- */

/* The three grains. Without this the response looks like it carries three
   competing answers; it carries one answer read three ways. */
function emoLayersCard(meta) {
  const agg = meta.aggregator || {};
  const layers = agg.layers || [];
  if (!layers.length) return null;
  const card = chartCard(tr('emo_layers_title'), tr('emo_layers_sub'));

  const list = el('div', 'emolayers');
  for (const l of layers) {
    const row = el('div', 'emolayers__row');
    const tag = el('div', 'emolayers__tag');
    tag.append(el('span', 'emolayers__name', l.layer));
    tag.append(el('span', 'emolayers__size', `${l.size}`));
    row.append(tag);
    const text = el('div', 'emolayers__text');
    const head = el('div', 'emolayers__head');
    head.append(el('code', 'emofield', l.field));
    text.append(head);
    text.append(el('p', 'emolimits__d', tr(`emo_layer_${l.layer.toLowerCase()}`)));
    row.append(text);
    list.append(row);
  }
  card.append(list);
  card.append(el('p', 'emonote', tr('emo_layers_note')));
  return card;
}

/* Each band with its cost. The SLA is the part that makes the band mean
   something to someone who does not care how the score was computed. */
function emoL1Card(meta) {
  const actions = (meta.aggregator || {}).l1_actions;
  if (!actions) return null;
  const card = chartCard(tr('emo_l1_title'), tr('emo_l1_sub'));

  const table = el('table', 'dtable');
  const thead = el('thead');
  const hr = el('tr');
  hr.append(el('th', null, tr('emo_th_level')));
  hr.append(el('th', null, tr('emo_th_action')));
  hr.append(el('th', 'dtable__num', tr('emo_th_sla')));
  thead.append(hr);
  table.append(thead);

  const tbody = el('tbody');
  for (const [level, spec] of Object.entries(actions)) {
    const line = el('tr');
    const cell = el('td');
    cell.append(el('span', `tagchip is-l1-${level}`, level));
    line.append(cell);
    line.append(el('td', null, tr(`emo_act_${spec.automation}`)));
    line.append(el('td', 'dtable__num' + (spec.sla_hours === null ? ' is-zero' : ''),
      spec.sla_hours === null ? '·' : tr('emo_sla_h', spec.sla_hours)));
    tbody.append(line);
  }
  table.append(tbody);
  card.append(table);
  card.append(el('p', 'emonote', tr('emo_l1_amb')));
  return card;
}

/* The score, written the way the service computes it. Everything here is a
   tunable, so it is rendered from the spec rather than typed into prose — the
   numbers on the page cannot drift away from the numbers in the code. */
function emoScoreCard(meta) {
  const esc = (meta.aggregator || {}).escalation;
  if (!esc) return null;
  const card = chartCard(tr('emo_score_title'), tr('emo_score_sub'));

  const formula = el('div', 'emoformula');
  formula.append(el('div', 'emoformula__cap', tr('emo_score_weights')));
  const weights = Object.entries(esc.weights)
    .map(([c, w]) => `${c} × ${w.toFixed(2)}`).join(', ');
  formula.append(el('div', 'emoformula__line', `score = max(${weights})`));
  formula.append(el('div', 'emoformula__cap', tr('emo_score_mods')));
  for (const [name, add] of Object.entries(esc.modifiers)) {
    formula.append(el('div', 'emoformula__line',
      `     + ${add.toFixed(2)}  ${tr(`emo_score_mod_${name}`, esc.demanding_trigger)}`));
  }
  card.append(formula);

  card.append(el('p', 'emobench__label', tr('emo_score_bands')));
  const table = el('table', 'dtable');
  const thead = el('thead');
  const hr = el('tr');
  hr.append(el('th', null, tr('emo_th_band')));
  hr.append(el('th', 'dtable__num', tr('emo_th_score')));
  thead.append(hr);
  table.append(thead);
  const tbody = el('tbody');
  for (const [level, floor] of esc.bands) {
    const line = el('tr');
    const cell = el('td');
    cell.append(el('span', `tagchip is-l1-${level}`, level));
    line.append(cell);
    line.append(el('td', 'dtable__num', `≥ ${floor}`));
    tbody.append(line);
  }
  table.append(tbody);
  card.append(table);

  card.append(el('p', 'emonote',
    tr('emo_score_p3', esc.p3_gate.negative_max, esc.p3_gate.positive_min)));

  const fb = el('div', 'emofallback');
  fb.append(el('p', 'emonote', tr('emo_score_fallback')));
  const chips = el('div', 'emofallback__chips');
  for (const [cluster, floor] of Object.entries(esc.fallback)) {
    const chip = el('span', 'emothreshold');
    const dot = el('span', 'emopick__dot');
    dot.style.background = sentimentColor(cluster.toLowerCase());
    chip.append(dot);
    chip.append(el('span', null, `${tagLabel('sentiment', cluster.toLowerCase())} ≥ ${floor}`));
    chips.append(chip);
  }
  fb.append(chips);
  card.append(fb);

  card.append(el('p', 'emonote', tr('emo_score_why')));
  return card;
}

/* Threat rules bypass the model entirely, which is the single most surprising
   thing about the service — so the verified example sits right under it. */
function emoThreatCard(meta) {
  const rules = (meta.aggregator || {}).threat_rules || [];
  if (!rules.length) return null;
  const card = chartCard(tr('emo_rules_title'), tr('emo_rules_sub'));

  const table = el('table', 'dtable');
  const thead = el('thead');
  const hr = el('tr');
  hr.append(el('th', null, tr('emo_th_rule')));
  hr.append(el('th', null, tr('emo_th_covers')));
  thead.append(hr);
  table.append(thead);
  const tbody = el('tbody');
  for (const r of rules) {
    const line = el('tr');
    const key = el('td');
    key.append(el('code', 'emofield', r.rule));
    line.append(key);
    line.append(el('td', 'emocovers', r.covers));
    tbody.append(line);
  }
  table.append(tbody);
  card.append(table);
  card.append(el('p', 'emonote', tr('emo_rules_note')));
  return card;
}

function emoSarcasmCard(meta) {
  const kinds = (meta.aggregator || {}).sarcasm_kinds || [];
  if (!kinds.length) return null;
  const card = chartCard(tr('emo_sarcasm_title'), tr('emo_sarcasm_sub'));

  const table = el('table', 'dtable');
  const thead = el('thead');
  const hr = el('tr');
  hr.append(el('th', null, tr('emo_th_kind')));
  hr.append(el('th', null, tr('emo_th_example')));
  thead.append(hr);
  table.append(thead);
  const tbody = el('tbody');
  for (const k of kinds) {
    const line = el('tr');
    const key = el('td');
    key.append(el('code', 'emofield', k.kind));
    line.append(key);
    line.append(el('td', 'emoquote', k.example));
    tbody.append(line);
  }
  table.append(tbody);
  card.append(table);
  card.append(el('p', 'emonote', tr('emo_sarcasm_note')));
  card.append(el('p', 'emonote', tr('emo_sarcasm_miss')));
  return card;
}

/* Preprocessing and gating: the two stages that run before the model and decide
   what it never sees. Both are the reason a score is trustworthy at all. */
function emoGateCard(meta) {
  const agg = meta.aggregator || {};
  const steps = agg.preprocessing || [];
  const gates = agg.gates || [];
  if (!steps.length && !gates.length) return null;
  const card = chartCard(tr('emo_gate_title'), tr('emo_gate_sub'));

  if (steps.length) {
    card.append(el('div', 'panel__head', tr('emo_pre_head')));
    const list = el('div', 'emolimits');
    for (const s of steps) {
      const item = el('div', 'emolimits__item is-choice');
      const head = el('div', 'emolimits__t');
      head.append(el('code', 'emofield', s.step));
      head.append(el('span', 'emomap__raw', s.detail));
      item.append(head);
      item.append(el('p', 'emolimits__d', tr(`emo_pre_${s.step}`)));
      list.append(item);
    }
    card.append(list);
  }

  if (gates.length) {
    card.append(el('div', 'panel__head panel__head--gap', tr('emo_gate_head')));
    const table = el('table', 'dtable');
    const thead = el('thead');
    const hr = el('tr');
    hr.append(el('th', null, tr('emo_th_gate')));
    hr.append(el('th', null, 'ambiguous_reason'));
    hr.append(el('th', null, tr('emo_th_meaning')));
    thead.append(hr);
    table.append(thead);
    const tbody = el('tbody');
    for (const g of gates) {
      const line = el('tr');
      line.append(el('td', 'emocovers', g.detail));
      const key = el('td');
      key.append(el('code', 'emofield', g.reason));
      line.append(key);
      line.append(el('td', null, tr(`emo_gate_${g.gate}`)));
      tbody.append(line);
    }
    table.append(tbody);
    card.append(table);
  }

  card.append(el('p', 'emonote', tr('emo_gate_note')));
  return card;
}

/* ----------------------------------------------------- sub-page: labels -- */

/* The reverse index of the cluster grid. The question a reader actually arrives
   with is "the model said realization, what does that become", and the grid
   above cannot answer that without a scan. */
function emoLabelMapCard(meta) {
  const rows = (meta.taxonomy || {}).label_map || [];
  if (!rows.length) return null;
  const card = chartCard(tr('emo_map_title'), tr('emo_map_sub', rows.length));

  const table = el('table', 'dtable');
  const thead = el('thead');
  const hr = el('tr');
  hr.append(el('th', null, tr('emo_th_rawlabel')));
  hr.append(el('th', null, tr('emo_th_cluster')));
  thead.append(hr);
  table.append(thead);

  const tbody = el('tbody');
  for (const row of rows) {
    const line = el('tr');
    const label = el('td');
    label.append(el('code', 'emofield', row.label));
    line.append(label);

    const target = el('td');
    if (row.sentiment) {
      const dot = el('span', 'emomap__dot');
      dot.style.background = sentimentColor(row.sentiment);
      target.append(dot);
      const name = tagLabel('sentiment', row.sentiment);
      target.append(el('span', null, name));
      // 服务端的大写簇名只在它和译名不是同一个词时才补上——英文界面里
      // "Satisfied SATISFIED" 只是把同一个词说两遍
      const same = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
      if (same(name) !== same(row.cluster)) target.append(el('span', 'emomap__raw', row.cluster));
    } else {
      target.classList.add('is-zero');
      target.textContent = tr('emo_map_unmapped');
    }
    line.append(target);
    tbody.append(line);
  }
  table.append(tbody);
  card.append(table);
  return card;
}

/* What the tag is for. Without this the taxonomy reads as trivia — these are the
   deterministic rules in tags.py that actually consume it. */
function emoDownstreamCard() {
  const card = chartCard(tr('emo_use_title'), tr('emo_use_sub'));
  const list = el('div', 'emolimits');
  for (let i = 1; i <= 5; i += 1) {
    const item = el('div', 'emolimits__item' + (i === 5 ? '' : ' is-review'));
    item.append(el('div', 'emolimits__t', tr(`emo_use_${i}_t`)));
    item.append(el('p', 'emolimits__d', tr(`emo_use_${i}_d`)));
    list.append(item);
  }
  card.append(list);
  card.append(el('p', 'emonote', tr('emo_use_source')));
  return card;
}

/* The nine clusters, each with the raw GoEmotions labels behind it. This is the
   answer to "what can it even tell apart", so the raw labels are shown, not
   hidden behind a tooltip. */
function emoTaxonomyCard(meta) {
  const tax = meta.taxonomy;
  const card = chartCard(tr('emo_tax_title'), tr('emo_tax_sub', tax.label_count, tax.clusters.length));

  // 服务端按 CLUSTERS 的定义顺序给，这里按极性重排：页面上其他每一处（图例、
  // 堆叠条、混淆表）都是这个顺序，说明书没理由自成一套
  const grid = el('div', 'emogrid');
  const ordered = [...tax.clusters].sort(
    (a, b) => SENTIMENT_ORDER.indexOf(a.sentiment) - SENTIMENT_ORDER.indexOf(b.sentiment));
  for (const c of ordered) {
    const cell = el('div', 'emocell');
    const head = el('div', 'emocell__head');
    const dot = el('span', 'emocell__dot');
    dot.style.background = sentimentColor(c.sentiment);
    head.append(dot);
    head.append(el('span', 'emocell__name', tagLabel('sentiment', c.sentiment)));
    if (c.negative) head.append(el('span', 'emocell__tag is-neg', tr('emo_tax_neg')));
    if (c.positive) head.append(el('span', 'emocell__tag is-pos', tr('emo_tax_pos')));
    // 这个簇有多少分是靠 GoEmotions 上没学好的标签撑着，值得警告
    if ((c.low_support || []).length) {
      const warn = el('span', 'emocell__tag is-thin', tr('emo_tax_lowsupport'));
      warn.title = c.low_support.join(', ');
      head.append(warn);
    }
    cell.append(head);
    // 电商语义：这个簇在业务上意味着什么，比极性数值更能说明该怎么处理
    cell.append(el('p', 'emocell__sem', tr(`emo_sem_${c.sentiment}`)));
    cell.append(el('div', 'emocell__meta',
      `${c.cluster} · ${tr('emo_tax_polarity')} ${c.polarity}` +
      (c.pooling !== 'max' ? ` · ${tr('emo_tax_mean')}` : '')));
    const labels = el('div', 'emocell__labels');
    for (const l of c.labels) {
      labels.append(el('span', 'emolabel' + ((c.low_support || []).includes(l) ? ' is-thin' : ''), l));
    }
    cell.append(labels);
    if (c.example) cell.append(el('p', 'emocell__quote', `“${c.example}”`));
    grid.append(cell);
  }
  card.append(grid);

  card.append(el('p', 'emonote', tr('emo_sem_note')));
  card.append(el('p', 'emonote', tr('emo_tax_unmapped', tax.unmapped_labels.join(', '))));
  card.append(el('p', 'emonote', tr('emo_tie_band', tax.tie_band)));
  return card;
}

/* GoEmotions label frequencies are Reddit frequencies. Which of the 28 actually
   turn up in a support inbox decides which ones are worth arguing about at all. */
function emoPriorsCard(meta) {
  const tax = meta.taxonomy || {};
  const priors = tax.label_priors;
  if (!priors) return null;
  const card = chartCard(tr('emo_priors_title'), tr('emo_priors_sub'));

  const thin = new Set(tax.low_support_labels || []);
  for (const tier of ['high', 'mid', 'low']) {
    const labels = priors[tier] || [];
    if (!labels.length) continue;
    const block = el('div', `emotier is-${tier}`);
    const head = el('div', 'emotier__head');
    head.append(el('span', 'emotier__name', tr(`emo_prior_${tier}`)));
    head.append(el('span', 'emotier__sub', tr(`emo_prior_${tier}_d`)));
    block.append(head);
    const row = el('div', 'emocell__labels');
    for (const l of labels) {
      row.append(el('span', 'emolabel' + (thin.has(l) ? ' is-thin' : ''), l));
    }
    block.append(row);
    card.append(block);
  }
  card.append(el('p', 'emonote', tr('emo_priors_note', (tax.low_support_labels || []).join(' / '))));
  return card;
}

/* Input + one-click examples. Each example carries the label a human would give
   it, so a mismatch is visible the moment the result lands. */
function emoBenchCard(meta) {
  const card = chartCard(tr('emo_try_title'), tr('emo_try_sub'));

  const run = el('button', 'btn btn--primary', state.emoBusy ? tr('emo_running') : tr('emo_run'));
  run.type = 'button';
  run.disabled = !state.emoDraft.trim() || state.emoBusy;

  const ta = el('textarea', 'emoinput');
  ta.id = 'emo-text';
  ta.rows = 4;
  ta.maxLength = meta.max_chars;
  ta.placeholder = tr('emo_ph');
  ta.value = state.emoDraft;
  const counter = el('span', 'emobench__count', tr('emo_chars', state.emoDraft.length, meta.max_chars));
  ta.addEventListener('input', () => {
    state.emoDraft = ta.value;
    counter.textContent = tr('emo_chars', ta.value.length, meta.max_chars);
    run.disabled = !ta.value.trim() || state.emoBusy;
  });
  card.append(ta);

  run.addEventListener('click', () => runEmotionTest(ta.value, null));
  const foot = el('div', 'emobench__foot');
  foot.append(counter);
  foot.append(run);
  card.append(foot);

  card.append(el('p', 'emobench__label', tr('emo_samples')));
  const chips = el('div', 'emosamples');
  for (const s of meta.samples) {
    const chip = el('button', 'emosample');
    chip.type = 'button';
    chip.append(el('span', 'emosample__text', s.text));
    chip.append(el('span', 'emosample__hint',
      tr('emo_sample_expect', tagLabel('sentiment', s.expect))));
    chip.title = s.text;
    chip.addEventListener('click', () => {
      state.emoDraft = s.text;
      runEmotionTest(s.text, s.id);
    });
    chips.append(chip);
  }
  card.append(chips);
  return card;
}

/* One horizontal bar per cluster, in polarity order rather than sorted by score:
   the shape of the profile is then comparable between two different tests, and
   the winning cluster is already named in the chip above. */
function emoScoreBars(l2, winner) {
  const plot = el('div', 'barlist');
  for (const s of SENTIMENT_ORDER) {
    const cluster = s.toUpperCase();
    if (!(cluster in l2)) continue;          // legacy vocabulary entries
    const score = l2[cluster];
    const row = el('div', 'barlist__row' + (s === winner ? ' is-on' : ''));
    row.append(el('span', 'barlist__name', tagLabel('sentiment', s)));
    const track = el('span', 'barlist__track');
    const fill = el('span', 'barlist__fill');
    fill.style.width = `${Math.max(score * 100, 0.6)}%`;
    fill.style.background = sentimentColor(s);
    track.append(fill);
    row.append(track);
    row.append(el('span', 'barlist__val', score.toFixed(3)));
    plot.append(row);
  }
  return plot;
}

function emoResultCard(test) {
  const card = chartCard(tr('emo_result_title'),
    tr('emo_tested_by', emoShortUser(test.user_id), fmtWhen(test.created_at)));
  card.classList.add('emoresult');

  card.append(el('p', 'emoresult__text', test.text));

  if (test.error) {
    card.append(el('p', 'analysis__fail', `${tr('emo_result_fail')} ${test.error}`));
    card.append(emoFeedbackForm(test));
    return card;
  }

  const r = test.result || {};
  const chips = el('div', 'analysis__chips');
  chips.append(tagChip('sentiment', test.sentiment, test.score));
  const l1chip = el('span', `tagchip is-l1-${r.l1 || 'none'}`);
  l1chip.append(el('span', 'tagchip__k', tr('emo_l1')));
  l1chip.append(el('span', 'tagchip__v', r.l1 || '—'));
  chips.append(l1chip);
  if (r.sarcasm_override) {
    const sc = el('span', 'tagchip is-sarcasm');
    sc.append(el('span', 'tagchip__k', tr('emo_sarcasm')));
    sc.append(el('span', 'tagchip__v', r.sarcasm_kind || 'yes'));
    chips.append(sc);
  }
  card.append(chips);

  const dl = el('dl', 'kv kv--fact');
  kvRow(dl, tr('emo_escalation'), r.escalation_score);
  kvRow(dl, tr('emo_negativity'), r.negativity);
  kvRow(dl, tr('emo_sentences'), r.n_sentences);
  kvRow(dl, tr('emo_latency'), test.latency_ms === null ? '—' : `${test.latency_ms} ms`);
  const flags = Object.entries(r.flags || {}).filter(([, v]) => v).map(([k]) => k);
  if (flags.length) kvRow(dl, tr('emo_flags'), flags.join(', '));
  if ((r.rule_hits || []).length) kvRow(dl, tr('emo_rule_hits'), r.rule_hits.join(', '));
  card.append(dl);

  const scores = el('div', 'emoscores');
  scores.append(el('div', 'panel__head', tr('emo_scores_title')));
  scores.append(el('p', 'emonote', tr('emo_scores_sub')));
  scores.append(emoScoreBars(r.l2 || {}, test.sentiment));
  card.append(scores);

  card.append(emoFeedbackForm(test));
  return card;
}

/* Correct / Wrong, plus the labels the reader thinks are right. "Wrong" without
   a label would be a complaint with no data in it, so save stays disabled until
   at least one is ticked. */
function emoFeedbackForm(test) {
  const wrap = el('div', 'emofb');
  wrap.append(el('div', 'panel__head', tr('emo_fb_title')));
  wrap.append(el('p', 'emonote', tr('emo_fb_sub')));

  const verdictRow = el('div', 'emofb__verdicts');
  const pickBox = el('div', 'emofb__labels');
  const save = el('button', 'btn btn--primary', tr('emo_fb_save'));
  save.type = 'button';

  const syncPick = () => {
    pickBox.hidden = state.emoVerdict !== 'wrong';
    save.disabled = !state.emoVerdict || (state.emoVerdict === 'wrong' && !state.emoPick.length);
  };

  for (const [value, key] of [['correct', 'emo_fb_correct'], ['wrong', 'emo_fb_wrong']]) {
    const b = el('button', `emofb__verdict is-${value}` + (state.emoVerdict === value ? ' is-on' : ''));
    b.type = 'button';
    b.dataset.verdict = value;
    b.textContent = tr(key);
    b.addEventListener('click', () => {
      // 再点一次同一个按钮 = 撤回评价，保存后这条记录回到"还没人评价"
      state.emoVerdict = state.emoVerdict === value ? null : value;
      verdictRow.querySelectorAll('.emofb__verdict').forEach((n) => {
        n.classList.toggle('is-on', n.dataset.verdict === state.emoVerdict);
      });
      syncPick();
    });
    verdictRow.append(b);
  }
  wrap.append(verdictRow);

  pickBox.append(el('p', 'emofb__hint', tr('emo_fb_pick')));
  const picks = el('div', 'emofb__picks');
  for (const s of SENTIMENT_ORDER) {
    if (!(state.emoMeta.taxonomy.clusters || []).some((c) => c.sentiment === s)) continue;
    const b = el('button', 'emopick' + (state.emoPick.includes(s) ? ' is-on' : ''));
    b.type = 'button';
    const dot = el('span', 'emopick__dot');
    dot.style.background = sentimentColor(s);
    b.append(dot);
    b.append(el('span', null, tagLabel('sentiment', s)));
    b.addEventListener('click', () => {
      state.emoPick = state.emoPick.includes(s)
        ? state.emoPick.filter((v) => v !== s)
        : [...state.emoPick, s];
      b.classList.toggle('is-on', state.emoPick.includes(s));
      syncPick();
    });
    picks.append(b);
  }
  pickBox.append(picks);
  wrap.append(pickBox);

  const note = el('textarea', 'emoinput emoinput--note');
  note.rows = 2;
  note.maxLength = 400;
  note.placeholder = tr('emo_fb_note_ph');
  note.value = test.note || '';
  wrap.append(note);

  const foot = el('div', 'emofb__foot');
  if (test.verdict) {
    foot.append(el('span', 'emofb__saved',
      `${tr(test.verdict === 'correct' ? 'emo_verdict_correct' : 'emo_verdict_wrong')} · ` +
      tr('emo_fb_by', emoShortUser(test.feedback_by), fmtWhen(test.feedback_at))));
  }
  save.addEventListener('click', async () => {
    save.disabled = true;
    save.textContent = tr('emo_fb_saving');
    try {
      const updated = await api(`/api/emotion/tests/${test.id}/feedback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          verdict: state.emoVerdict,
          true_labels: state.emoVerdict === 'wrong' ? state.emoPick : [],
          note: note.value,
        }),
      });
      state.emoOpen = updated;
      toast(tr('emo_fb_saved'));
      await refreshEmotion();
    } catch (err) {
      toast(err.message, 5000);
      save.disabled = false;
      save.textContent = tr('emo_fb_save');
    }
  });
  foot.append(save);
  wrap.append(foot);

  syncPick();
  return wrap;
}

/* Predicted vs what people said. The diagonal is agreement; the cells off it are
   the reason this page exists, so they get the tint and the diagonal stays plain. */
function emoConfusionTable(stats) {
  const rows = SENTIMENT_ORDER.filter((s) => stats.confusion[s]);
  if (!rows.length) return null;
  const cols = SENTIMENT_ORDER.filter((s) =>
    rows.some((r) => (stats.confusion[r] || {})[s]));

  const card = chartCard(tr('emo_table_confusion'), tr('emo_table_confusion_sub'));
  const table = el('table', 'dtable');
  const thead = el('thead');
  const hr = el('tr');
  hr.append(el('th', null, tr('emo_th_predicted')));
  for (const c of cols) hr.append(el('th', 'dtable__num', tagLabel('sentiment', c)));
  hr.append(el('th', 'dtable__num', tr('th_total')));
  thead.append(hr);
  table.append(thead);

  const peak = Math.max(...rows.flatMap((r) => Object.values(stats.confusion[r] || {})));
  const tbody = el('tbody');
  for (const r of rows) {
    const line = stats.confusion[r] || {};
    const tr_ = el('tr');
    tr_.append(el('td', null, tagLabel('sentiment', r)));
    for (const c of cols) {
      const n = line[c] || 0;
      const cell = el('td', 'dtable__num', n ? String(n) : '·');
      if (n && r !== c) cell.style.background = `rgba(239,106,82,${0.06 + 0.18 * (n / peak)})`;
      if (n && r === c) cell.classList.add('is-diagonal');
      tr_.append(cell);
    }
    tr_.append(el('td', 'dtable__num dtable__rowtotal',
      String(Object.values(line).reduce((a, b) => a + b, 0))));
    tbody.append(tr_);
  }
  table.append(tbody);
  card.append(table);
  return card;
}

function emoPerClusterTable(stats) {
  const rows = SENTIMENT_ORDER.filter((s) => stats.per_cluster[s]);
  if (!rows.length) return null;
  const card = chartCard(tr('emo_table_percluster'), null);
  const table = el('table', 'dtable');
  const thead = el('thead');
  const hr = el('tr');
  hr.append(el('th', null, tr('th_tag')));
  hr.append(el('th', 'dtable__num', tr('emo_th_correct')));
  hr.append(el('th', 'dtable__num', tr('emo_th_wrong')));
  hr.append(el('th', 'dtable__num', tr('emo_th_rate')));
  thead.append(hr);
  table.append(thead);

  const tbody = el('tbody');
  for (const s of rows) {
    const b = stats.per_cluster[s];
    const n = b.correct + b.wrong;
    const line = el('tr');
    line.append(el('td', null, tagLabel('sentiment', s)));
    line.append(el('td', 'dtable__num', String(b.correct)));
    line.append(el('td', 'dtable__num', String(b.wrong)));
    line.append(el('td', 'dtable__num', `${pct(b.correct, n)}%`));
    tbody.append(line);
  }
  table.append(tbody);
  card.append(table);
  return card;
}

function emoRecordsCard() {
  const card = chartCard(tr('emo_records_title'), tr('emo_records_sub'));
  if (!state.emoTests.length) {
    card.append(el('p', 'list__empty', tr('emo_records_empty')));
    return card;
  }
  const list = el('div', 'emolog');
  for (const t of state.emoTests) {
    const row = el('button', 'emolog__row' + (state.emoOpen && state.emoOpen.id === t.id ? ' is-on' : ''));
    row.type = 'button';

    const top = el('div', 'emolog__top');
    const dot = el('span', 'emolog__dot');
    dot.style.background = t.sentiment ? sentimentColor(t.sentiment) : 'var(--ink-3)';
    top.append(dot);
    top.append(el('span', 'emolog__pred',
      t.sentiment ? tagLabel('sentiment', t.sentiment) : tr('emo_kpi_failed')));
    if (t.score !== null && t.score !== undefined) {
      top.append(el('span', 'emolog__score', t.score.toFixed(3)));
    }
    const badge = el('span', `emolog__verdict is-${t.verdict || 'none'}`);
    badge.textContent = t.verdict
      ? tr(t.verdict === 'correct' ? 'emo_verdict_correct' : 'emo_verdict_wrong')
      : tr('emo_no_verdict');
    top.append(badge);
    row.append(top);

    row.append(el('p', 'emolog__text', t.text));

    const meta = el('div', 'emolog__meta');
    meta.append(el('span', null, `${emoShortUser(t.user_id)} · ${fmtWhen(t.created_at)}`));
    if (t.verdict === 'wrong' && t.true_labels.length) {
      meta.append(el('span', 'emolog__true',
        `→ ${t.true_labels.map((v) => tagLabel('sentiment', v)).join(' / ')}`));
    }
    row.append(meta);

    row.addEventListener('click', () => openEmotionTest(t));
    list.append(row);
  }
  card.append(list);
  return card;
}

/* Opening a test always lands on the bench, because the result card and the
   feedback form are the same card — judging a row from the log means going to
   where the form is. */
function openEmotionTest(test) {
  state.emoOpen = test;
  state.emoTab = 'bench';
  state.emoVerdict = test.verdict || null;
  state.emoPick = [...(test.true_labels || [])];
  const url = new URL(location.href);
  url.searchParams.set('view', 'emotion');
  url.searchParams.set('tab', 'bench');
  url.searchParams.set('test', test.id);
  history.replaceState(null, '', url);
  renderEmotionView();
  const card = document.querySelector('.emoresult');
  if (card) card.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function renderEmotionView() {
  const box = $('#emotion-body');
  const tab = state.emoTab;
  box.innerHTML = '';

  document.querySelectorAll('#emo-tabs button').forEach((b) => {
    const on = b.dataset.emotab === tab;
    b.classList.toggle('is-on', on);
    b.setAttribute('aria-selected', String(on));
  });
  // 按人筛选只改测试记录页的内容，摆在说明书旁边只会让人以为说明书也分人
  $('#emo-scope').hidden = tab !== 'log';
  document.querySelectorAll('#emo-scope button').forEach((b) => {
    b.classList.toggle('is-on', b.dataset.emoscope === state.emoScope);
  });
  $('#emo-view-desc').textContent = tr(`emo_desc_${tab}`);

  const meta = state.emoMeta;
  if (!meta) return;
  // 端点没配好只影响"跑一段"，标签体系是本地词表，照样讲得清楚
  if (!meta.enabled && (tab === 'bench' || tab === 'model')) {
    box.append(el('p', 'analysis__fail', tr('emo_off')));
  }

  if (tab === 'model') {
    box.append(emoModelCard(meta));
    const metrics = emoMetricsCard(meta);
    if (metrics) box.append(metrics);
    box.append(emoChainCard(meta));
    const contract = emoContractCard(meta);
    if (contract) box.append(contract);
    box.append(emoLimitsCard(meta));
    return;
  }

  if (tab === 'labels') {
    box.append(emoTaxonomyCard(meta));
    const map = emoLabelMapCard(meta);
    if (map) box.append(map);
    const priors = emoPriorsCard(meta);
    if (priors) box.append(priors);
    box.append(emoDownstreamCard());
    return;
  }

  if (tab === 'triage') {
    for (const build of [emoLayersCard, emoL1Card, emoScoreCard,
                         emoThreatCard, emoSarcasmCard, emoGateCard]) {
      const card = build(meta);
      if (card) box.append(card);
    }
    return;
  }

  if (tab === 'bench') {
    box.append(emoBenchCard(meta));
    if (state.emoOpen) box.append(emoResultCard(state.emoOpen));
    return;
  }

  const s = state.emoStats;
  if (s && s.total) {
    const kpis = el('div', 'statrow');
    kpis.append(statTile(tr('emo_kpi_tests'), String(s.total), tr('emo_kpi_tests_sub', s.testers)));
    kpis.append(statTile(tr('emo_kpi_reviewed'), String(s.reviewed), tr('emo_kpi_reviewed_sub')));
    kpis.append(statTile(tr('emo_kpi_accuracy'),
      s.accuracy === null ? '—' : `${Math.round(s.accuracy * 100)}%`, tr('emo_kpi_accuracy_sub')));
    kpis.append(statTile(tr('emo_kpi_speed'),
      s.avg_latency_ms === null ? '—' : `${s.avg_latency_ms} ms`, tr('emo_kpi_speed_sub')));
    if (s.failed) kpis.append(statTile(tr('emo_kpi_failed'), String(s.failed), tr('emo_kpi_failed_sub')));
    box.append(kpis);

    const stacks = el('div', 'vizgrid__col');
    const graded = Object.values(s.predicted).reduce((a, b) => a + b, 0);
    const pred = stackedChart('emo_chart_pred', 'emo_chart_pred_sub', 'sentiment',
      SENTIMENT_ORDER, sentimentColor, s.predicted, graded);
    if (pred) stacks.append(pred);
    const truthTotal = Object.values(s.truth).reduce((a, b) => a + b, 0);
    const truth = stackedChart('emo_chart_truth', 'emo_chart_truth_sub', 'sentiment',
      SENTIMENT_ORDER, sentimentColor, s.truth, truthTotal);
    if (truth) stacks.append(truth);
    box.append(stacks);

    const confusion = emoConfusionTable(s);
    if (confusion) box.append(confusion);
    const perCluster = emoPerClusterTable(s);
    if (perCluster) box.append(perCluster);
  }

  box.append(emoRecordsCard());
}

async function runEmotionTest(text, sampleId) {
  const body = (text || '').trim();
  if (!body || state.emoBusy) return;
  state.emoBusy = true;
  renderEmotionView();
  try {
    const test = await api('/api/emotion/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: body, sample_id: sampleId }),
    });
    state.emoBusy = false;
    openEmotionTest(test);
    await refreshEmotion();
  } catch (err) {
    state.emoBusy = false;
    toast(tr('emo_toast_test_fail', err.message), 5000);
    renderEmotionView();
  }
}

async function loadEmotionMeta() {
  if (state.emoMeta) return;
  try {
    state.emoMeta = await api('/api/emotion/meta');
  } catch {
    state.emoMeta = null;
  }
}

async function refreshEmotion() {
  try {
    const [tests, stats] = await Promise.all([
      api(`/api/emotion/tests?scope=${state.emoScope}&limit=200`),
      api(`/api/emotion/stats?scope=${state.emoScope}`),
    ]);
    state.emoTests = tests.tests;
    state.emoStats = stats;
    $('#count-emotion').textContent = stats.total;
    // 记录列表刷新后，结果卡跟着换成同一条的最新版本（别人可能刚改过评价）
    if (state.emoOpen) {
      const fresh = tests.tests.find((t) => t.id === state.emoOpen.id);
      if (fresh) state.emoOpen = fresh;
    }
  } catch (err) {
    toast(err.message, 5000);
  }
  if (state.view === 'emotion') renderEmotionView();
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

document.querySelectorAll('#emo-tabs button').forEach((btn) => {
  btn.addEventListener('click', () => setEmoTab(btn.dataset.emotab));
});

document.querySelectorAll('#emo-scope button').forEach((btn) => {
  btn.addEventListener('click', () => {
    state.emoScope = btn.dataset.emoscope;
    refreshEmotion();
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
