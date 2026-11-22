import fs from 'fs';
import path from 'path';

// Run history: one JSON line per probed endpoint, so scheduled runs (cron, `ccfp watch`) can spot an
// endpoint that quietly changes what it serves. Only compact, key-free facts are stored.

const LEVEL_RANK = { trustworthy: 2, questionable: 1, untrustworthy: 0 };

// Thresholds chosen to stay above normal sampling noise of the probe set.
export const DRIFT_LIMITS = {
  confidenceDrop: 15, // points
  capabilityDrop: 0.25, // 25 percentage points
  cutoffBackMonths: 6 // demonstrated knowledge moved this many months earlier
};

export function historyRecord(report, v, { name, reportPath } = {}) {
  const api = report.api || {};
  return {
    at: report.generated_at || new Date().toISOString(),
    name: name || null,
    endpoint: api.endpoint || null,
    model: api.model || report.claimed?.model_id || null,
    protocol: api.protocol || null,
    probe_set: report.probe_set || 'full',
    lang: report.lang || null,
    dataset: report.dataset_version || null,
    level: v.level,
    confidence: v.confidence,
    cap_ratio: Number(v.capRatio.toFixed(3)),
    latest_known: v.cutoff?.latestKnown || null,
    claimed_model: v.claimed?.model_id || null,
    identity: v.identity ? v.identity.label : null,
    returned_models: v.api ? v.api.returnedModels.map((m) => m.value) : [],
    canary_tokens: v.api?.canaryTokens ?? null,
    mixed_routing: v.api ? v.api.mixedRouting : null,
    flags: v.flags.length,
    report: reportPath || null
  };
}

export const recordKey = (r) => `${r.name || r.endpoint || '-'} | ${r.model || '-'} | ${r.protocol || '-'}`;

const monthNum = (s) => {
  const m = /^(\d{4})-(\d{2})/.exec(s || '');
  return m ? Number(m[1]) * 12 + Number(m[2]) - 1 : null;
};

// What changed between two runs of the same endpoint. Each item: { kind, strong, message }.
export function detectDrift(prev, cur) {
  if (!prev || !cur) return [];
  const out = [];
  const add = (kind, strong, message) => out.push({ kind, strong, message });
  const sameSetup = prev.lang === cur.lang && prev.dataset === cur.dataset && prev.protocol === cur.protocol;

  if (sameSetup && prev.canary_tokens != null && cur.canary_tokens != null && prev.canary_tokens !== cur.canary_tokens) {
    add('canary', true, `canary 输入 token 数 ${prev.canary_tokens} → ${cur.canary_tokens}：同样的请求换了分词器或注入的系统提示词，后端变了 / canary prompt tokens ${prev.canary_tokens} → ${cur.canary_tokens}: the same request is now tokenized differently or wrapped in a different hidden prompt, so the backend changed`);
  }
  const newModels = (cur.returned_models || []).filter((m) => !(prev.returned_models || []).includes(m));
  if (prev.returned_models?.length && newModels.length) {
    add('model-field', true, `接口返回了新的 model 字段 ${newModels.join(', ')}（上次 ${prev.returned_models.join(', ')}）/ new model field ${newModels.join(', ')} (was ${prev.returned_models.join(', ')})`);
  }
  if (prev.identity && cur.identity && prev.identity !== cur.identity) {
    add('self-id', true, `自称身份 ${prev.identity} → ${cur.identity} / self-declared identity ${prev.identity} → ${cur.identity}`);
  }
  if (!prev.mixed_routing && cur.mixed_routing) {
    add('routing', true, '本次出现混合/轮换路由迹象，上次没有 / mixed or rotating routing appeared since the last run');
  }
  if ((LEVEL_RANK[cur.level] ?? 2) < (LEVEL_RANK[prev.level] ?? 2)) {
    add('level', true, `结论 ${prev.level} → ${cur.level} / verdict ${prev.level} → ${cur.level}`);
  }
  if (prev.confidence - cur.confidence >= DRIFT_LIMITS.confidenceDrop) {
    add('confidence', false, `可信度 ${prev.confidence} → ${cur.confidence} / confidence ${prev.confidence} → ${cur.confidence}`);
  }
  if (prev.probe_set === cur.probe_set && prev.cap_ratio - cur.cap_ratio >= DRIFT_LIMITS.capabilityDrop) {
    add('capability', false, `能力通过率 ${Math.round(prev.cap_ratio * 100)}% → ${Math.round(cur.cap_ratio * 100)}% / capability ${Math.round(prev.cap_ratio * 100)}% → ${Math.round(cur.cap_ratio * 100)}%`);
  }
  const a = monthNum(prev.latest_known);
  const b = monthNum(cur.latest_known);
  if (prev.dataset === cur.dataset && prev.probe_set === cur.probe_set && a != null && (b == null || a - b >= DRIFT_LIMITS.cutoffBackMonths)) {
    add('cutoff', false, `推断知识截止 ${prev.latest_known} → ${cur.latest_known || '早于全部探针 / before every probe'}：像换成了更旧的模型 / demonstrated knowledge moved back from ${prev.latest_known} to ${cur.latest_known || 'before every probe'}, like an older model`);
  }
  return out;
}

export function readHistory(file) {
  if (!file || !fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf-8').split(/\r?\n/).filter((l) => l.trim()).flatMap((l) => {
    try {
      return [JSON.parse(l)];
    } catch {
      return []; // a half-written line from an interrupted run must not break the history
    }
  });
}

export function lastRecordFor(records, key) {
  for (let i = records.length - 1; i >= 0; i--) if (recordKey(records[i]) === key) return records[i];
  return null;
}

// Append a record and return the drift against the previous run of the same endpoint.
export function appendHistory(file, record) {
  const prev = lastRecordFor(readHistory(file), recordKey(record));
  const dir = path.dirname(file);
  if (dir && !fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.appendFileSync(file, JSON.stringify(record) + '\n', 'utf-8');
  return { previous: prev, drift: detectDrift(prev, record) };
}

// Group by endpoint, oldest first, with the drift of each run against the one before it.
export function analyzeHistory(records) {
  const groups = new Map();
  for (const r of records) {
    const k = recordKey(r);
    groups.set(k, [...(groups.get(k) || []), r]);
  }
  return [...groups.entries()].map(([key, list]) => {
    const sorted = [...list].sort((x, y) => String(x.at).localeCompare(String(y.at)));
    const runs = sorted.map((r, i) => ({ ...r, drift: i ? detectDrift(sorted[i - 1], r) : [] }));
    return { key, runs, drifted: runs.some((r) => r.drift.length) };
  });
}

const pct = (x) => (x == null ? '-' : `${Math.round(x * 100)}%`);

export function renderHistory(groups, { last = 20 } = {}) {
  const lines = ['# 检测历史 / Probe history', ''];
  lines.push(`> ${groups.length} 个端点 / endpoints · ⚠ = 与上一次相比发生变化 / changed since the previous run`);
  lines.push('');
  for (const g of groups) {
    lines.push(`## ${g.key}`);
    lines.push('| 时间 / time | 结论 / verdict | 可信度 / score | 能力 / capability | 推断截止 / cutoff | 自称 / claims | 返回 model / returned | canary | 变化 / drift |');
    lines.push('|---|---|---|---|---|---|---|---|---|');
    for (const r of g.runs.slice(-last)) {
      const drift = r.drift.length ? `⚠ ${r.drift.map((d) => d.kind).join(', ')}` : '';
      lines.push(`| ${String(r.at).replace('T', ' ').slice(0, 16)} | ${r.level} | ${r.confidence} | ${pct(r.cap_ratio)} | ${r.latest_known || '-'} | ${r.claimed_model || '-'} | ${(r.returned_models || []).join(', ') || '-'} | ${r.canary_tokens ?? '-'} | ${drift} |`);
    }
    lines.push('');
    const changes = g.runs.filter((r) => r.drift.length).slice(-5);
    for (const r of changes) {
      for (const d of r.drift) lines.push(`- ${String(r.at).slice(0, 16).replace('T', ' ')} ${d.strong ? '**[强 / strong]** ' : ''}${d.message}`);
    }
    if (changes.length) lines.push('');
  }
  return lines.join('\n');
}

// ---------- CLI ----------

export async function history(file, options = {}) {
  const lang = options.lang || 'zh';
  const en = lang === 'en';
  const target = file || 'ccfp-runs/history.jsonl';
  if (!fs.existsSync(target)) {
    console.error(en
      ? `Error: no history at "${target}". Create one with "ccfp probe ... --history ${target}" or "ccfp run --config ...".`
      : `错误: 找不到历史文件 "${target}"。先用 "ccfp probe ... --history ${target}" 或 "ccfp run --config ..." 生成。`);
    process.exit(1);
  }
  const groups = analyzeHistory(readHistory(target));
  const last = Math.max(1, parseInt(options.last, 10) || 20);
  const md = renderHistory(groups, { last });
  if (options.html) {
    const { renderHtml } = await import('./html.js');
    fs.writeFileSync(options.html, renderHtml(md, { title: 'ccfp · history' }), 'utf-8');
    console.error(en ? `Saved HTML report to ${options.html}` : `已保存 HTML 报告: ${options.html}`);
  }
  if (options.json) {
    console.log(JSON.stringify({ tool: 'ccfingerprint', history: target, endpoints: groups.map((g) => ({ key: g.key, drifted: g.drifted, runs: g.runs.slice(-last) })) }, null, 2));
  } else {
    console.log(md);
  }
  // only the latest run of each endpoint decides the exit code, so an old incident does not fail CI forever
  if (options.failOnDrift && groups.some((g) => g.runs[g.runs.length - 1].drift.length)) process.exitCode = 2;
  return groups;
}
