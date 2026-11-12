import fs from 'fs';
import { loadDataset, probeSet } from './init.js';

// ---------- answer normalization & checking ----------

function norm(s) {
  return String(s ?? '').toLowerCase().trim();
}

function extractNumber(s) {
  const m = norm(s).replace(/[, ]/g, '').match(/-?\d+(\.\d+)?/);
  return m ? parseFloat(m[0]) : null;
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ASCII keywords match as whole words ("no" must not hit "not" or "know");
// CJK keywords match as substrings.
function hasToken(answer, token) {
  const t = norm(token);
  if (/^[a-z0-9 .'-]+$/.test(t)) {
    return new RegExp(`(?<![a-z0-9])${escapeRe(t)}(?![a-z0-9])`).test(answer);
  }
  return answer.includes(t);
}

const IDK = /(我?不知道|不清楚|无法确定|不确定|没有.*信息|i\s*don'?t\s*know|not\s*sure|unknown|no\s*(idea|knowledge)|cannot\s*(answer|determine))/i;

export function isIDK(answer) {
  return IDK.test(String(answer ?? ''));
}

const MONTHS = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5,
  jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9,
  oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12
};

// Pull every (year, month) mentioned in free text: 2025-08, 2025/8, 2025年8月, Aug 2025,
// August 7, 2025, 7 August 2025. A bare year yields { year, month: null }.
export function parseDates(text) {
  const s = norm(text);
  const out = [];
  const push = (y, m) => {
    const year = parseInt(y, 10);
    const month = m == null ? null : parseInt(m, 10);
    if (year >= 1900 && year <= 2100 && (month == null || (month >= 1 && month <= 12))) out.push({ year, month });
  };
  let m;
  const iso = /(\d{4})\s*[-/.年]\s*(\d{1,2})(?!\d)/g;
  while ((m = iso.exec(s))) push(m[1], m[2]);
  const names = Object.keys(MONTHS).sort((a, b) => b.length - a.length).join('|');
  const nameFirst = new RegExp(`\\b(${names})\\.?\\s+(?:\\d{1,2}(?:st|nd|rd|th)?,?\\s+)?(\\d{4})`, 'g');
  while ((m = nameFirst.exec(s))) push(m[2], MONTHS[m[1]]);
  const dayFirst = new RegExp(`\\b\\d{1,2}\\s+(${names})\\.?,?\\s+(\\d{4})`, 'g');
  while ((m = dayFirst.exec(s))) push(m[2], MONTHS[m[1]]);
  const cjkMonth = /(\d{1,2})\s*月/g;
  const years = [...s.matchAll(/(?<!\d)(\d{4})(?!\d)/g)].map((x) => x[1]);
  while ((m = cjkMonth.exec(s))) {
    if (!out.some((d) => d.month === parseInt(m[1], 10)) && years.length) push(years[0], m[1]);
  }
  for (const y of years) if (!out.some((d) => d.year === parseInt(y, 10))) push(y, null);
  return out;
}

function monthIndex(year, month) {
  return year * 12 + (month - 1);
}

export function monthValue(d) {
  if (!d) return null;
  const dates = parseDates(d);
  const withMonth = dates.find((x) => x.month != null);
  if (withMonth) return monthIndex(withMonth.year, withMonth.month);
  return dates.length ? monthIndex(dates[0].year, 1) : null;
}

function monthLabel(v) {
  if (v == null) return null;
  const y = Math.floor(v / 12);
  return `${y}-${String((v % 12) + 1).padStart(2, '0')}`;
}

// Returns true / false, or 'partial' for a date answer with the right year but a missing/wrong month.
export function checkAnswer(answer, check) {
  if (!check) return null;
  const a = norm(answer);
  if (!a) return false;
  if (check.reject && check.reject.some((k) => hasToken(a, k))) return false;

  if ('exact' in check) {
    const cleaned = a.replace(/^[\s"'`.,:;]+|[\s"'`.,:;]+$/g, '');
    return cleaned === norm(check.exact);
  }
  if ('numeric' in check) {
    const n = extractNumber(answer);
    return n !== null && Math.abs(n - check.numeric) < 1e-6;
  }
  if ('contains' in check) {
    return a.includes(norm(check.contains));
  }
  if ('month' in check) {
    const target = monthValue(check.month);
    const tolerance = check.tolerance ?? 1;
    const dates = parseDates(answer);
    if (dates.some((d) => d.month != null && Math.abs(monthIndex(d.year, d.month) - target) <= tolerance)) return true;
    if (dates.some((d) => d.year === Math.floor(target / 12))) return 'partial';
    return false;
  }
  if ('any' in check) {
    return check.any.some((k) => hasToken(a, k));
  }
  if ('all' in check) {
    return check.all.every((group) => group.some((k) => hasToken(a, k)));
  }
  return null;
}

// ---------- scoring ----------

function scoreKnowledge(dataset, answers) {
  return dataset.knowledge.map((q) => {
    const ans = answers[q.id];
    const answered = !!norm(ans);
    const result = checkAnswer(ans, q.check);
    const pass = result === true;
    const partial = result === 'partial';
    const idk = isIDK(ans);
    // known: the model demonstrably knows the event happened (exact, or right year for a date)
    const known = pass || partial;
    // fabrication: a confident answer that is wrong (not "I don't know", not roughly right)
    const fabricated = answered && !idk && !known;
    return { id: q.id, date: q.date, answered, idk, pass, partial, known, fabricated, answer: ans };
  });
}

function scoreCapability(dataset, answers) {
  return dataset.capability.map((q) => {
    const ans = answers[q.id];
    const pass = checkAnswer(ans, q.check) === true;
    return { id: q.id, tier: q.tier, weight: q.weight, pass, answer: ans, expected: q.check };
  });
}

function inferCutoff(kn) {
  // latest date the model demonstrably knew
  const known = kn.filter((k) => k.known).map((k) => k.date).sort();
  // earliest date it demonstrably did NOT know
  const unknown = kn.filter((k) => !k.known).map((k) => k.date).sort();
  return {
    latestKnown: known.length ? known[known.length - 1] : null,
    earliestUnknown: unknown.length ? unknown[0] : null
  };
}

// Months between a model's knowledge cutoff and the events it should know reliably; without an
// official cutoff we count back from the release month instead (cutoff is usually 3–9 months earlier).
const SAFE_MARGIN_FROM_CUTOFF = 4;
const SAFE_MARGIN_FROM_RELEASE = 10;

export function findIdentity(modelId, dataset) {
  const id = String(modelId || '');
  if (!id) return null;
  return (dataset.identities || []).find((it) => new RegExp(it.pattern, 'i').test(id)) || null;
}

// A model claiming identity X must know events that happened well before X's knowledge cutoff.
// (Asking X about its own release is useless: models are trained before they are released.)
export function identitySelfCheck(identity, knowledge) {
  if (!identity) return null;
  const horizon = identity.cutoff
    ? monthValue(identity.cutoff) - SAFE_MARGIN_FROM_CUTOFF
    : monthValue(identity.released) - SAFE_MARGIN_FROM_RELEASE;
  const expected = knowledge.filter((k) => monthValue(k.date) <= horizon);
  const missed = expected.filter((k) => !k.known);
  if (expected.length >= 2 && missed.length * 2 >= expected.length) {
    return { label: identity.label, horizon: monthLabel(horizon), expected: expected.length, missed: missed.map((k) => k.id) };
  }
  return null;
}

// Scores one set of answers (one run). verifyReport() combines runs and API-level signals.
export function scoreRun(report, dataset) {
  const answers = report.answers || {};
  const claimed = report.claimed || {};

  const knowledge = scoreKnowledge(dataset, answers);
  const capability = scoreCapability(dataset, answers);

  const capGot = capability.filter((c) => c.pass).reduce((s, c) => s + c.weight, 0);
  const capMax = capability.reduce((s, c) => s + c.weight, 0);
  const capRatio = capMax ? capGot / capMax : 0;

  const cutoff = inferCutoff(knowledge);
  const fabrications = knowledge.filter((k) => k.fabricated);

  // capability verdict
  let capLabel, capDowngrade;
  if (capRatio >= 0.85) { capLabel = '能力正常 / normal'; capDowngrade = false; }
  else if (capRatio >= 0.6) { capLabel = '轻度存疑 / mild concern'; capDowngrade = false; }
  else { capLabel = '疑似降智 / suspected downgrade'; capDowngrade = true; }

  const identity = findIdentity(claimed.model_id, dataset);
  const identityMismatch = identitySelfCheck(identity, knowledge);

  // consistency: claimed cutoff vs demonstrated knowledge
  const claimedCutoffM = monthValue(claimed.knowledge_cutoff);
  const latestKnownM = monthValue(cutoff.latestKnown);
  const knowsLater = claimedCutoffM != null && latestKnownM != null && latestKnownM - claimedCutoffM > 2;
  // claims a cutoff it cannot back up: misses most events dated >= 3 months before that cutoff
  let overclaimsCutoff = false;
  if (claimedCutoffM != null) {
    const before = knowledge.filter((k) => monthValue(k.date) <= claimedCutoffM - 3);
    const missed = before.filter((k) => !k.known);
    overclaimsCutoff = before.length >= 2 && missed.length * 2 >= before.length;
  }

  const flags = [];
  if (identityMismatch) {
    flags.push(`自称 ${claimed.model_id}（${identityMismatch.label}），却不知道 ${identityMismatch.horizon} 之前 ${identityMismatch.expected} 个事件中的 ${identityMismatch.missed.length} 个——真实知识比该模型旧（强身份疑点）/ claims to be ${identityMismatch.label} but misses ${identityMismatch.missed.length}/${identityMismatch.expected} events it should know`);
  }
  if (knowsLater) {
    flags.push('知道的事件晚于自称的知识截止日期（可能联网/身份不符）/ knows events later than its claimed cutoff');
  }
  if (overclaimsCutoff) {
    flags.push(`自称知识截止 ${claimed.knowledge_cutoff}，却不知道其前的大部分探针事件（可能高报身份）/ claims a later cutoff than it can demonstrate`);
  }
  if (fabrications.length >= 2) {
    flags.push(`对 ${fabrications.length} 道知识题自信编造了错误答案 / confidently fabricated ${fabrications.length} knowledge answers`);
  }
  if (capDowngrade) {
    flags.push('能力探针通过率过低，疑似被替换为更弱的模型 / capability pass-rate too low for the claimed model');
  }

  // deterministic confidence score
  let confidence = 100;
  confidence -= fabrications.length * 8;
  confidence -= Math.round((1 - capRatio) * 40);
  if (identityMismatch) confidence -= 30;
  if (knowsLater) confidence -= 15;
  if (overclaimsCutoff) confidence -= 10;
  confidence = Math.max(0, Math.min(100, confidence));
  const { level, conclusion } = conclude(confidence, capDowngrade || !!identityMismatch);

  return {
    claimed,
    identity,
    knowledge,
    capability,
    capRatio,
    capLabel,
    capDowngrade,
    cutoff,
    fabrications,
    identityMismatch,
    knowsLater,
    overclaimsCutoff,
    flags,
    confidence,
    level,
    conclusion,
    ascii: answers.ascii_signature || ''
  };
}

const CONCLUSIONS = {
  trustworthy: '可信 / trustworthy',
  questionable: '存疑 / questionable',
  untrustworthy: '不可信 / not trustworthy'
};

// `blocked`: a hard signal (downgrade, identity mismatch, mixed routing …) that rules out "trustworthy".
export function conclude(confidence, blocked) {
  const level = confidence >= 75 && !blocked ? 'trustworthy' : confidence >= 50 ? 'questionable' : 'untrustworthy';
  return { level, conclusion: CONCLUSIONS[level] };
}

// ---------- API-level signals (reports written by `ccfp probe`) ----------

const squash = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');

// Does the `model` field the API returned name the model that was requested?
export function sameModel(requested, returned, dataset) {
  if (!requested || !returned) return true;
  const a = findIdentity(requested, dataset);
  const b = findIdentity(returned, dataset);
  if (a && b) return a.label === b.label;
  const x = squash(requested);
  const y = squash(returned);
  return x.includes(y) || y.includes(x);
}

function countBy(values) {
  const m = new Map();
  for (const v of values) m.set(v, (m.get(v) || 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1]).map(([value, count]) => ({ value, count }));
}

const CAP_SPREAD_LIMIT = 0.35;
const NATIVE_THINK_FAMILIES = /^(Claude|GPT|Gemini)/;

export function analyzeApi(report, scoredRuns, dataset) {
  const api = report.api || {};
  const runs = report.runs?.length ? report.runs : [report];
  const metas = runs.map((r) => r.meta || {});
  const calls = [...metas.flatMap((m) => Object.values(m)), ...(api.canary || [])];

  // 1. the `model` field in responses (relays often rewrite it to echo the request, so only a mismatch counts)
  const returnedModels = countBy(calls.map((c) => c.model).filter(Boolean));
  const foreignModels = returnedModels.filter((m) => !sameModel(api.model, m.value, dataset));

  // 2. identical request bytes must yield identical prompt-token counts on one backend
  const tokensByPrompt = new Map();
  metas.forEach((m) => {
    for (const [id, c] of Object.entries(m)) {
      if (Number.isFinite(c.prompt_tokens)) tokensByPrompt.set(id, [...(tokensByPrompt.get(id) || []), c.prompt_tokens]);
    }
  });
  const canaryTokens = (api.canary || []).map((c) => c.prompt_tokens).filter(Number.isFinite);
  if (canaryTokens.length) tokensByPrompt.set('canary', canaryTokens);
  const tokenDrift = [...tokensByPrompt.entries()]
    .filter(([, list]) => new Set(list).size > 1)
    .map(([id, list]) => ({ id, values: [...new Set(list)] }));

  // 3. the self-declared identity and the capability level should not change between runs
  const claimedIds = [...new Set(runs.map((r) => r.claimed?.model_id).filter(Boolean).map((id) => findIdentity(id, dataset)?.label || squash(id)))];
  const ratios = scoredRuns.map((s) => s.capRatio);
  const capSpread = ratios.length > 1 ? Math.max(...ratios) - Math.min(...ratios) : 0;

  const reasons = [];
  if (tokenDrift.length) reasons.push('tokens');
  if (returnedModels.length > 1 && foreignModels.length) reasons.push('model-field');
  if (claimedIds.length > 1) reasons.push('self-id');
  if (capSpread >= CAP_SPREAD_LIMIT) reasons.push('capability');

  // 4. <think> tags in the visible answer are typical of DeepSeek/Qwen-style open models, never of Claude/GPT/Gemini
  const thinkTags = calls.filter((c) => c.think).length;
  const requestedIdentity = findIdentity(api.model, dataset);
  const thinkLeak = thinkTags > 0 && !!requestedIdentity && NATIVE_THINK_FAMILIES.test(requestedIdentity.label);

  const errors = calls.filter((c) => c.error).length;
  const notes = [];
  if (api.protocol === 'anthropic') {
    const foreignIds = calls.filter((c) => c.id && !String(c.id).startsWith('msg_')).length;
    if (foreignIds) notes.push(`${foreignIds} 个响应 id 不是 Anthropic 的 msg_ 格式，中转把其他协议转换成了 Messages 格式 / ${foreignIds} response ids are not Anthropic-style (msg_…): the relay converts from another API format`);
  }
  if (calls.some((c) => c.reasoning_field)) {
    notes.push('响应带有 reasoning_content 字段（DeepSeek/Qwen 风格，也可能是中转改写）/ responses carry a reasoning_content field (DeepSeek/Qwen style, or added by the relay)');
  }

  return {
    protocol: api.protocol,
    requested: api.model,
    calls: calls.length,
    errors,
    errorRate: calls.length ? errors / calls.length : 0,
    returnedModels,
    foreignModels,
    modelMismatch: foreignModels.length > 0,
    tokenDrift,
    claimedIds,
    capSpread,
    mixedRouting: reasons.length > 0,
    mixedReasons: reasons,
    canaryTokens: canaryTokens.length ? canaryTokens[0] : null,
    thinkTags,
    thinkLeak,
    notes
  };
}

// Compare a suspect report with a reference report taken from the official API (same dataset/lang/probe set).
export function compareBaseline(report, baseline, dataset) {
  const why = [];
  if ((report.dataset_version || '') !== (baseline.dataset_version || '')) why.push('dataset_version');
  if ((report.lang || '') !== (baseline.lang || '')) why.push('lang');
  if ((report.probe_set || 'full') !== (baseline.probe_set || 'full')) why.push('probe_set');
  const result = { comparable: why.length === 0, why, model: baseline.api?.model || baseline.claimed?.model_id || null };
  if (!result.comparable) return result;

  // prompt tokens: only meaningful when both used the same protocol (the request bytes are then identical)
  const sameProtocol = !!report.api && report.api.protocol === baseline.api?.protocol;
  const tokensOf = (r) => {
    const out = {};
    const meta = (r.runs?.[0] || r).meta || {};
    for (const [id, c] of Object.entries(meta)) if (Number.isFinite(c.prompt_tokens)) out[id] = c.prompt_tokens;
    const canary = (r.api?.canary || []).find((c) => Number.isFinite(c.prompt_tokens));
    if (canary) out.canary = canary.prompt_tokens;
    return out;
  };
  if (sameProtocol) {
    const a = tokensOf(report);
    const b = tokensOf(baseline);
    const deltas = Object.keys(a).filter((id) => id in b).map((id) => a[id] - b[id]);
    if (deltas.length) {
      const distinct = [...new Set(deltas)];
      result.tokenCompared = deltas.length;
      result.tokenMatch = distinct.length === 1 && distinct[0] === 0;
      result.tokenOffset = distinct.length === 1 && distinct[0] !== 0 ? distinct[0] : null;
      result.tokenizerDiffers = distinct.length > 1;
    }
  }

  const base = verifyReport(baseline, dataset);
  const mine = verifyReport(report, dataset, { skipBaseline: true });
  result.baseCapRatio = base.capRatio;
  result.capDrop = base.capRatio - mine.capRatio;
  result.lessKnown = base.knowledge.filter((k) => k.known)
    .filter((k) => !mine.knowledge.find((m) => m.id === k.id)?.known).map((k) => k.id);
  return result;
}

export function verifyReport(report, dataset, options = {}) {
  const ds = probeSet(dataset, report.probe_set);
  const runs = Array.isArray(report.runs) && report.runs.length ? report.runs : [report];
  const scored = runs.map((r) => scoreRun({ claimed: r.claimed || report.claimed, answers: r.answers || {} }, ds));
  // a relay that rotates models is judged by its worst run
  const worst = scored.reduce((w, s) => (s.confidence < w.confidence ? s : w), scored[0]);
  const v = { ...worst, flags: [...worst.flags], probeSet: report.probe_set || 'full' };
  if (scored.length > 1) {
    v.runs = scored.map((s, i) => ({ run: i + 1, model_id: s.claimed?.model_id || '', capRatio: s.capRatio, confidence: s.confidence, latestKnown: s.cutoff.latestKnown }));
  }

  let confidence = worst.confidence;
  let blocked = worst.capDowngrade || !!worst.identityMismatch;

  if (report.api) {
    const api = analyzeApi(report, scored, ds);
    v.api = api;
    if (api.modelMismatch) {
      confidence -= 25;
      blocked = true;
      v.flags.push(`接口返回的 model 字段是 ${api.foreignModels.map((m) => m.value).join(', ')}，与请求的 ${api.requested} 不符（强替换信号）/ the API answered as ${api.foreignModels.map((m) => m.value).join(', ')}, not the requested ${api.requested}`);
    }
    if (api.mixedRouting) {
      confidence -= 25;
      blocked = true;
      const detail = [];
      if (api.tokenDrift.length) detail.push(`相同请求的输入 token 数不一致 (${api.tokenDrift.slice(0, 3).map((d) => `${d.id}: ${d.values.join('/')}`).join('; ')}) / identical requests got different prompt-token counts`);
      if (api.mixedReasons.includes('model-field')) detail.push(`返回了多个不同的 model 字段 / several different model fields: ${api.returnedModels.map((m) => `${m.value}×${m.count}`).join(', ')}`);
      if (api.mixedReasons.includes('self-id')) detail.push(`不同轮次自称不同模型 / self-declared identity changes between runs: ${api.claimedIds.join(', ')}`);
      if (api.mixedReasons.includes('capability')) detail.push(`各轮能力通过率相差 ${Math.round(api.capSpread * 100)} 个百分点 / capability pass-rate varies by ${Math.round(api.capSpread * 100)} points between runs`);
      v.flags.push(`疑似混合/轮换路由（同一接口背后不止一个模型）/ suspected mixed or rotating routing: ${detail.join('; ')}`);
    }
    if (api.thinkLeak) {
      confidence -= 15;
      v.flags.push(`${api.thinkTags} 个回答带 <think> 标签，这是 DeepSeek/Qwen 类开源模型的特征，${api.requested} 不会这样输出 / ${api.thinkTags} answers contain <think> tags, typical of DeepSeek/Qwen-style models, not of ${api.requested}`);
    }
    if (api.errorRate > 0.2) {
      v.flags.push(`${api.errors}/${api.calls} 个请求失败，结果不完整，请重跑 / ${api.errors}/${api.calls} requests failed; the result is incomplete, re-run it`);
    }
  }

  if (options.baseline && !options.skipBaseline) {
    const b = compareBaseline(report, options.baseline, dataset);
    v.baseline = b;
    if (!b.comparable) {
      v.flags.push(`基准报告不可比（${b.why.join(', ')} 不同），已忽略 / baseline ignored: different ${b.why.join(', ')}`);
    } else {
      if (b.tokenizerDiffers) {
        confidence -= 25;
        blocked = true;
        v.flags.push('与官方基准相比，相同请求的输入 token 数差异不固定：分词器不同，背后很可能是另一个模型 / prompt-token counts differ from the official baseline by varying amounts: a different tokenizer, most likely a different model');
      } else if (b.tokenOffset) {
        confidence -= 10;
        v.flags.push(`与官方基准相比，每个请求固定多出 ${b.tokenOffset} 个输入 token：中转注入了隐藏系统提示词或改写了请求 / every request carries ${b.tokenOffset} extra prompt tokens vs the official baseline: the relay injects a hidden system prompt or rewrites requests`);
      }
      if (b.capDrop >= 0.3) {
        confidence -= 15;
        blocked = true;
        v.flags.push(`能力通过率比官方基准低 ${Math.round(b.capDrop * 100)} 个百分点 / capability pass-rate is ${Math.round(b.capDrop * 100)} points below the official baseline`);
      }
      if (b.lessKnown.length >= 3) {
        confidence -= 10;
        v.flags.push(`官方模型知道、此接口却不知道的事件 ${b.lessKnown.length} 个 / does not know ${b.lessKnown.length} events the official model knows: ${b.lessKnown.join(', ')}`);
      }
    }
  }

  v.confidence = Math.max(0, Math.min(100, confidence));
  Object.assign(v, conclude(v.confidence, blocked));
  return v;
}

// Machine-readable verdict for CI (`--json`). Answer keys are left out.
export function verdictJson(v, dataset) {
  return {
    tool: 'ccfingerprint',
    dataset: dataset.version,
    level: v.level,
    conclusion: v.conclusion,
    confidence: v.confidence,
    probe_set: v.probeSet,
    claimed: v.claimed,
    identity: v.identity ? v.identity.label : null,
    capability: { ratio: Number(v.capRatio.toFixed(3)), label: v.capLabel, downgrade: v.capDowngrade, failed: v.capability.filter((c) => !c.pass).map((c) => c.id) },
    knowledge: { latest_known: v.cutoff.latestKnown, earliest_unknown: v.cutoff.earliestUnknown, fabricated: v.fabrications.map((f) => f.id) },
    identity_mismatch: v.identityMismatch,
    runs: v.runs || null,
    api: v.api || null,
    baseline: v.baseline || null,
    flags: v.flags
  };
}

// ---------- report rendering ----------

const yn = (b) => (b ? '✓' : '✗');

export function renderVerdict(v, dataset) {
  const lines = [];
  lines.push('# AI 模型身份鉴定报告 / Identity Verdict');
  lines.push('');
  lines.push(`> dataset ${dataset.version} (${dataset.updated})${v.probeSet === 'quick' ? ' · 快速探针集 / quick probe set' : ''} · 仅凭模型作答 + 本地确定性评分，无模型自评`);
  lines.push('');
  lines.push('## 自称信息 / Claimed');
  lines.push('| 项目 | 值 |');
  lines.push('|------|-----|');
  lines.push(`| 模型 ID | ${v.claimed.model_id || '-'} |`);
  lines.push(`| 识别为 | ${v.identity ? `${v.identity.label}（发布 ${v.identity.released}${v.identity.cutoff ? `，官方知识截止 ${v.identity.cutoff}` : ''}）` : '未收录 / unknown'} |`);
  lines.push(`| 开发商 | ${v.claimed.provider || '-'} |`);
  lines.push(`| 上下文长度 | ${v.claimed.context_length || '-'} |`);
  lines.push(`| 知识截止 | ${v.claimed.knowledge_cutoff || '-'} |`);
  lines.push('');

  lines.push('## 知识边界 / Knowledge probes');
  lines.push('| 探针 | 日期 | 知道? | 状态 |');
  lines.push('|------|------|-------|------|');
  for (const k of v.knowledge) {
    const status = k.pass ? '正确' : k.partial ? '大致正确（年份对）' : k.idk ? '坦诚未知' : k.answered ? '⚠ 编造' : '空';
    lines.push(`| ${k.id} | ${k.date} | ${yn(k.known)} | ${status} |`);
  }
  lines.push('');
  lines.push(`推断真实知识截止：**${v.cutoff.latestKnown || '早于全部探针'}**` +
    (v.cutoff.earliestUnknown ? `（最早不知道：${v.cutoff.earliestUnknown}）` : ''));
  lines.push('');

  lines.push('## 能力探针 / Capability probes (降智检测)');
  lines.push('| 探针 | 难度 | 通过 |');
  lines.push('|------|------|------|');
  for (const c of v.capability) {
    lines.push(`| ${c.id} | T${c.tier} | ${yn(c.pass)} |`);
  }
  lines.push('');
  lines.push(`能力通过率：**${Math.round(v.capRatio * 100)}%** — ${v.capLabel}`);
  lines.push('');

  if (v.runs) {
    lines.push('## 多轮结果 / Runs (按最差一轮判定 / judged by the worst run)');
    lines.push('| 轮次 | 自称模型 | 能力通过率 | 推断截止 | 可信度 |');
    lines.push('|------|----------|------------|----------|--------|');
    for (const r of v.runs) lines.push(`| ${r.run} | ${r.model_id || '-'} | ${Math.round(r.capRatio * 100)}% | ${r.latestKnown || '-'} | ${r.confidence} |`);
    lines.push('');
  }

  if (v.api) {
    const a = v.api;
    lines.push('## 接口信号 / API signals');
    lines.push('| 项目 | 值 |');
    lines.push('|------|-----|');
    lines.push(`| 协议 / protocol | ${a.protocol || '-'} |`);
    lines.push(`| 请求模型 / requested | ${a.requested || '-'} |`);
    lines.push(`| 返回的 model 字段 / returned | ${a.returnedModels.map((m) => `${m.value}×${m.count}`).join(', ') || '-'} ${yn(!a.modelMismatch)} |`);
    lines.push(`| 输入 token 稳定 / prompt tokens stable | ${yn(!a.tokenDrift.length)}${a.canaryTokens != null ? ` (canary = ${a.canaryTokens})` : ''} |`);
    lines.push(`| 路由一致 / single backend | ${yn(!a.mixedRouting)}${a.mixedReasons.length ? ` (${a.mixedReasons.join(', ')})` : ''} |`);
    lines.push(`| <think> 标签 / think tags | ${a.thinkTags} |`);
    lines.push(`| 失败请求 / failed requests | ${a.errors}/${a.calls} |`);
    lines.push('');
    for (const n of a.notes) lines.push(`- ℹ ${n}`);
    if (a.notes.length) lines.push('');
  }

  if (v.baseline) {
    const b = v.baseline;
    lines.push(`## 与官方基准对比 / Baseline (${b.model || '-'})`);
    if (!b.comparable) {
      lines.push(`不可比 / not comparable: ${b.why.join(', ')}`);
    } else {
      const tok = b.tokenCompared == null ? '未比较（协议不同或无 usage）/ not compared'
        : b.tokenMatch ? `一致 / identical (${b.tokenCompared})`
          : b.tokenOffset ? `固定偏移 / constant offset ${b.tokenOffset > 0 ? '+' : ''}${b.tokenOffset}`
            : '不一致 / tokenizer differs';
      lines.push('| 项目 | 值 |');
      lines.push('|------|-----|');
      lines.push(`| 输入 token / prompt tokens | ${tok} |`);
      lines.push(`| 基准能力通过率 / baseline capability | ${Math.round(b.baseCapRatio * 100)}% (差 / drop ${Math.round(b.capDrop * 100)}) |`);
      lines.push(`| 基准知道而此处不知道 / known only by baseline | ${b.lessKnown.join(', ') || '-'} |`);
    }
    lines.push('');
  }

  if (v.flags.length) {
    lines.push('## ⚠ 疑点 / Flags');
    for (const f of v.flags) lines.push(`- ${f}`);
    lines.push('');
  }

  if (v.ascii) {
    lines.push('## 风格指纹 / Style');
    lines.push('```');
    lines.push(String(v.ascii).split('\n').slice(0, 8).join('\n'));
    lines.push('```');
    lines.push('');
  }

  lines.push('## 最终结论 / Verdict');
  lines.push('| 指标 | 值 |');
  lines.push('|------|-----|');
  lines.push(`| 自称身份 | ${v.claimed.model_id || '-'} |`);
  lines.push(`| 能力评估 | ${v.capLabel} |`);
  lines.push(`| 可信度评分 | ${v.confidence}/100 |`);
  lines.push(`| 鉴定结论 | ${v.conclusion} |`);
  lines.push('');
  return lines.join('\n');
}

// ---------- CLI entry ----------

export function readJsonFile(file, lang) {
  if (!fs.existsSync(file)) {
    console.error(lang === 'en'
      ? `Error: file not found "${file}". Run /fingerprint (or ccfp probe) first to generate a report.`
      : `错误: 找不到文件 "${file}"。请先在 AI 助手中运行 /fingerprint（或 ccfp probe）生成报告。`);
    process.exit(1);
  }
  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch (e) {
    console.error(lang === 'en' ? `Error: "${file}" is not valid JSON. ${e.message}` : `错误: "${file}" 不是合法 JSON。${e.message}`);
    process.exit(1);
  }
}

// Print / save the verdict and set the exit code: 0 ok, 1 error, 2 confidence below --fail-under.
export function emitVerdict(v, dataset, options = {}) {
  const lang = options.lang || 'zh';
  const md = renderVerdict(v, dataset);
  const outPath = options.output || 'ccfp-verdict.md';
  fs.writeFileSync(outPath, md, 'utf-8');
  if (options.json) {
    console.log(JSON.stringify(verdictJson(v, dataset), null, 2));
  } else {
    console.log(md);
    console.log('\n' + (lang === 'en' ? `Saved verdict to ${outPath}` : `已保存鉴定报告: ${outPath}`));
  }
  const threshold = options.failUnder == null ? NaN : Number(options.failUnder);
  if (Number.isFinite(threshold) && v.confidence < threshold) {
    console.error(lang === 'en'
      ? `ccfp: confidence ${v.confidence} is below --fail-under ${threshold}`
      : `ccfp: 可信度 ${v.confidence} 低于 --fail-under ${threshold}`);
    process.exitCode = 2;
  }
}

export async function verify(reportPath, options = {}) {
  const lang = options.lang || 'zh';
  const report = readJsonFile(reportPath || 'ccfp-report.json', lang);
  const baseline = options.baseline ? readJsonFile(options.baseline, lang) : null;

  const dataset = loadDataset();
  if (report.dataset_version && report.dataset_version !== dataset.version) {
    console.error(lang === 'en'
      ? `Warning: report was generated with dataset ${report.dataset_version}, scoring with ${dataset.version}. Re-run ccfp init and /fingerprint for exact results.`
      : `警告: 报告由 dataset ${report.dataset_version} 生成，当前评分用 ${dataset.version}。建议重新 ccfp init 并运行 /fingerprint。`);
  }
  const v = verifyReport(report, dataset, { baseline });
  emitVerdict(v, dataset, options);
  return v;
}
