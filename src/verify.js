import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { loadDataset } from './init.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ---------- answer normalization & checking ----------

function norm(s) {
  return String(s ?? '').toLowerCase().trim();
}

function extractNumber(s) {
  const m = norm(s).replace(/[, ]/g, '').match(/-?\d+(\.\d+)?/);
  return m ? parseFloat(m[0]) : null;
}

const IDK = /(我?不知道|不清楚|无法确定|不确定|没有.*信息|i\s*don'?t\s*know|not\s*sure|unknown|no\s*(idea|knowledge)|cannot\s*(answer|determine))/i;

export function isIDK(answer) {
  return IDK.test(String(answer ?? ''));
}

// Returns true if the answer satisfies the check spec.
export function checkAnswer(answer, check) {
  if (!check) return null;
  const a = norm(answer);
  if (!a) return false;

  if (check.reject && check.reject.some((k) => a.includes(norm(k)))) {
    // a rejected token present -> only pass if an accepted token is ALSO unambiguously present
    // (handled below); but a bare "no" should fail
  }

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
  if ('any' in check) {
    const hit = check.any.some((k) => a.includes(norm(k)));
    if (!hit) return false;
    if (check.reject) {
      // ambiguous if both an accept and a reject token appear
      const bad = check.reject.some((k) => a.includes(norm(k)));
      if (bad) return false;
    }
    return true;
  }
  if ('all' in check) {
    return check.all.every((group) => group.some((k) => a.includes(norm(k))));
  }
  return null;
}

// ---------- scoring ----------

function scoreKnowledge(dataset, answers) {
  return dataset.knowledge.map((q) => {
    const ans = answers[q.id];
    const answered = !!norm(ans);
    const pass = checkAnswer(ans, q.check) === true;
    const idk = isIDK(ans);
    // fabrication: gave a confident answer that is wrong (not "I don't know")
    const fabricated = answered && !idk && !pass;
    return { id: q.id, date: q.date, answered, idk, pass, fabricated, answer: ans };
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
  const known = kn.filter((k) => k.pass).map((k) => k.date).sort();
  // earliest date it demonstrably did NOT know (failed or said IDK, not fabricated-correct)
  const unknown = kn.filter((k) => !k.pass).map((k) => k.date).sort();
  return {
    latestKnown: known.length ? known[known.length - 1] : null,
    earliestUnknown: unknown.length ? unknown[0] : null
  };
}

// Map a claimed model_id to the knowledge probe that asks about that very model.
// Order matters: more specific patterns first (gpt-5.5 before gpt-5).
const IDENTITY_PROBES = [
  { pat: /opus[\s._-]*4[\s._-]*8/i, id: 'claude_opus_48' },
  { pat: /opus[\s._-]*4[\s._-]*6/i, id: 'claude_opus_46' },
  { pat: /gpt[\s._-]*5\.?5/i, id: 'gpt55_release' },
  { pat: /gpt[\s._-]*5(?![\s._-]*\d)/i, id: 'gpt5_release' },
  { pat: /gemini[\s._-]*3/i, id: 'gemini3_release' }
];

export function identitySelfCheck(modelId, knowledge) {
  const id = String(modelId || '');
  for (const ip of IDENTITY_PROBES) {
    if (ip.pat.test(id)) {
      const probe = knowledge.find((k) => k.id === ip.id);
      if (probe && !probe.pass) return ip.id;
      return null; // claimed model matched a probe and it passed -> consistent
    }
  }
  return null; // no probe covers this claimed model -> can't judge
}

function monthValue(d) {
  if (!d) return null;
  const m = /(\d{4})\D*(\d{1,2})?/.exec(d);
  if (!m) return null;
  return parseInt(m[1], 10) * 12 + (m[2] ? parseInt(m[2], 10) - 1 : 0);
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

  // identity self-knowledge: does the model know about the very model it claims to be?
  // A model that claims to BE Opus 4.8 but has never heard of Opus 4.8 is a strong tell.
  const identityMismatch = identitySelfCheck(claimed.model_id, knowledge);

  // consistency: claimed cutoff vs demonstrated knowledge
  const claimedCutoffM = monthValue(claimed.knowledge_cutoff);
  const latestKnownM = monthValue(cutoff.latestKnown);
  const earliestUnknownM = monthValue(cutoff.earliestUnknown);

  const knowsLater = claimedCutoffM != null && latestKnownM != null && latestKnownM - claimedCutoffM > 2;
  // claims a cutoff at/after an event (dated >=1 month before that cutoff) it failed to know
  const overclaimsCutoff = claimedCutoffM != null && earliestUnknownM != null && earliestUnknownM < claimedCutoffM;

  const flags = [];
  if (identityMismatch) {
    flags.push(`自称是 ${claimed.model_id}，却不知道该模型自身的发布信息（强身份疑点）/ claims to be ${claimed.model_id} but does not know that model exists`);
  }
  if (knowsLater) {
    flags.push('知道的事件晚于自称的知识截止日期（可能联网/身份不符）/ knows events later than its claimed cutoff');
  }
  if (overclaimsCutoff) {
    flags.push(`自称知识截止 ${claimed.knowledge_cutoff}，却不知道更早的 ${cutoff.earliestUnknown} 事件（可能高报身份）/ claims a later cutoff than it can demonstrate`);
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
  if (overclaimsCutoff) confidence -= 15;
  confidence = Math.max(0, Math.min(100, confidence));

  let conclusion;
  if (confidence >= 75 && !capDowngrade) conclusion = '可信 / trustworthy';
  else if (confidence >= 50) conclusion = '存疑 / questionable';
  else conclusion = '不可信 / not trustworthy';

  return {
    claimed,
    knowledge,
    capability,
    capRatio,
    capLabel,
    capDowngrade,
    cutoff,
    fabrications,
    identityMismatch,
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
  lines.push(`> dataset ${dataset.version} · 仅凭模型作答 + 本地确定性评分，无模型自评`);
  lines.push('');
  lines.push('## 自称信息 / Claimed');
  lines.push('| 项目 | 值 |');
  lines.push('|------|-----|');
  lines.push(`| 模型 ID | ${v.claimed.model_id || '-'} |`);
  lines.push(`| 开发商 | ${v.claimed.provider || '-'} |`);
  lines.push(`| 上下文长度 | ${v.claimed.context_length || '-'} |`);
  lines.push(`| 知识截止 | ${v.claimed.knowledge_cutoff || '-'} |`);
  lines.push('');

  lines.push('## 知识边界 / Knowledge probes');
  lines.push('| 探针 | 日期 | 知道? | 状态 |');
  lines.push('|------|------|-------|------|');
  for (const k of v.knowledge) {
    const status = k.pass ? '正确' : k.idk ? '坦诚未知' : k.answered ? '⚠ 编造' : '空';
    lines.push(`| ${k.id} | ${k.date} | ${yn(k.pass)} | ${status} |`);
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
  const v = verifyReport(report, dataset);
  const md = renderVerdict(v, dataset);

  console.log(md);

  const outPath = options.output || 'ccfp-verdict.md';
  fs.writeFileSync(outPath, md, 'utf-8');
  console.log('\n' + (lang === 'en' ? `Saved verdict to ${outPath}` : `已保存鉴定报告: ${outPath}`));

  return v;
}
