import fs from 'fs';
import { loadDataset } from './init.js';

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

export function verifyReport(report, dataset) {
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

  let conclusion;
  if (confidence >= 75 && !capDowngrade && !identityMismatch) conclusion = '可信 / trustworthy';
  else if (confidence >= 50) conclusion = '存疑 / questionable';
  else conclusion = '不可信 / not trustworthy';

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
    conclusion,
    ascii: answers.ascii_signature || ''
  };
}

// ---------- report rendering ----------

const yn = (b) => (b ? '✓' : '✗');

export function renderVerdict(v, dataset) {
  const lines = [];
  lines.push('# AI 模型身份鉴定报告 / Identity Verdict');
  lines.push('');
  lines.push(`> dataset ${dataset.version} (${dataset.updated}) · 仅凭模型作答 + 本地确定性评分，无模型自评`);
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

export async function verify(reportPath, options = {}) {
  const lang = options.lang || 'zh';
  const file = reportPath || 'ccfp-report.json';

  if (!fs.existsSync(file)) {
    console.error(lang === 'en'
      ? `Error: report file not found "${file}". Run /fingerprint first to generate ccfp-report.json.`
      : `错误: 找不到报告文件 "${file}"。请先在 AI 助手中运行 /fingerprint 生成 ccfp-report.json。`);
    process.exit(1);
  }

  let report;
  try {
    report = JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch (e) {
    console.error(lang === 'en'
      ? `Error: "${file}" is not valid JSON. ${e.message}`
      : `错误: "${file}" 不是合法 JSON。${e.message}`);
    process.exit(1);
  }

  const dataset = loadDataset();
  if (report.dataset_version && report.dataset_version !== dataset.version) {
    console.error(lang === 'en'
      ? `Warning: report was generated with dataset ${report.dataset_version}, scoring with ${dataset.version}. Re-run ccfp init and /fingerprint for exact results.`
      : `警告: 报告由 dataset ${report.dataset_version} 生成，当前评分用 ${dataset.version}。建议重新 ccfp init 并运行 /fingerprint。`);
  }
  const v = verifyReport(report, dataset);
  const md = renderVerdict(v, dataset);

  console.log(md);

  const outPath = options.output || 'ccfp-verdict.md';
  fs.writeFileSync(outPath, md, 'utf-8');
  console.log('\n' + (lang === 'en' ? `Saved verdict to ${outPath}` : `已保存鉴定报告: ${outPath}`));

  return v;
}
