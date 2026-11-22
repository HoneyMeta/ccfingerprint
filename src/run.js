import fs from 'fs';
import path from 'path';
import { loadDataset } from './init.js';
import { runProbe, probeParams, printDrift } from './probe.js';
import { verifyReport, verdictJson, renderVerdict } from './verify.js';
import { compareReports, renderCompare } from './compare.js';
import { appendHistory, historyRecord } from './history.js';
import { renderHtml } from './html.js';

// `ccfp run --config ccfp.config.json`: probe several endpoints in one go (optionally against an
// official endpoint probed in the same run), write one report per endpoint plus a comparison,
// append to a history file and flag endpoints that changed since the previous run.
// `ccfp watch` is the same thing on a timer.

const SHARED = ['lang', 'quick', 'runs', 'canary', 'concurrency', 'timeout', 'maxTokens', 'temperature', 'api', 'apiKeyEnv', 'model', 'baseUrl', 'baseline'];
const SECRET_KEYS = /^(api[-_]?key|key|token|authorization|secret)$/i;

const camel = (k) => k.replace(/[-_]([a-z])/g, (_, c) => c.toUpperCase());
function normalizeKeys(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj || {})) out[camel(k)] = v;
  return out;
}

export function slug(s) {
  return String(s || 'endpoint').toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'endpoint';
}

// Returns { error } or { settings, endpoints } with every endpoint fully resolved.
export function loadConfig(raw) {
  const cfg = normalizeKeys(raw);
  const list = Array.isArray(cfg.endpoints) ? cfg.endpoints : null;
  if (!list || !list.length) return { error: 'config: "endpoints" must be a non-empty array' };
  for (const [where, obj] of [['top level', raw], ...list.map((e, i) => [`endpoints[${i}]`, e])]) {
    const bad = Object.keys(obj || {}).find((k) => SECRET_KEYS.test(k));
    if (bad) return { error: `config ${where}: "${bad}" — never put API keys in the config file; name the environment variable with "apiKeyEnv" instead` };
  }
  const shared = Object.fromEntries(SHARED.filter((k) => cfg[k] !== undefined).map((k) => [k, cfg[k]]));
  const names = new Set();
  const endpoints = [];
  for (const [i, e] of list.entries()) {
    const ep = { ...shared, ...normalizeKeys(e) };
    ep.name = ep.name || (() => {
      try {
        return `${new URL(ep.baseUrl).host}-${ep.model}`;
      } catch {
        return `endpoint-${i + 1}`;
      }
    })();
    if (names.has(ep.name)) return { error: `config: duplicate endpoint name "${ep.name}"` };
    names.add(ep.name);
    if (!ep.baseUrl || !ep.model) return { error: `config endpoints[${i}] (${ep.name}): "baseUrl" and "model" are required` };
    endpoints.push(ep);
  }
  // an endpoint used as another one's baseline is probed first
  const isBaseline = (ep) => endpoints.some((o) => o.baseline === ep.name);
  for (const ep of endpoints) {
    if (ep.baseline === ep.name) delete ep.baseline; // a shared top-level baseline does not apply to itself
  }
  for (const ep of endpoints) {
    const ref = endpoints.find((o) => o.name === ep.baseline);
    if (ref && ref.baseline && names.has(ref.baseline)) return { error: `config: baseline "${ref.name}" must not itself use another endpoint as baseline` };
  }
  endpoints.sort((a, b) => Number(isBaseline(b)) - Number(isBaseline(a)));
  const settings = {
    lang: cfg.lang || 'zh',
    outDir: cfg.outDir || 'ccfp-runs',
    history: cfg.history === false ? null : cfg.history || null,
    html: cfg.html !== false,
    failUnder: cfg.failUnder,
    failOnDrift: !!cfg.failOnDrift
  };
  return { settings, endpoints };
}

export async function runOnce(raw, { configDir = '.', env = process.env, fetchImpl, log = () => {}, overrides = {} } = {}) {
  const loaded = loadConfig(raw);
  if (loaded.error) return { error: loaded.error };
  const settings = { ...loaded.settings, ...Object.fromEntries(Object.entries(overrides).filter(([, v]) => v !== undefined)) };
  const at = (p) => (path.isAbsolute(p) ? p : path.join(configDir, p));
  const outDir = at(settings.outDir);
  fs.mkdirSync(outDir, { recursive: true });
  const historyFile = settings.history ? at(settings.history) : path.join(outDir, 'history.jsonl');
  const dataset = loadDataset();

  const results = [];
  const reports = new Map();
  for (const ep of loaded.endpoints) {
    const { error, params } = probeParams({ ...ep, lang: overrides.lang || ep.lang || settings.lang }, env);
    if (error) {
      results.push({ name: ep.name, error });
      log(`✗ ${ep.name}: ${error}`);
      continue;
    }
    log(`→ ${ep.name} (${params.protocol} ${params.model})`);
    const report = await runProbe({ ...params, fetchImpl, retries: ep.retries });
    reports.set(ep.name, report);
    let baseline = null;
    if (ep.baseline) {
      if (reports.has(ep.baseline)) baseline = reports.get(ep.baseline);
      else if (loaded.endpoints.some((o) => o.name === ep.baseline)) log(`  baseline "${ep.baseline}" failed, comparing without it`);
      else if (fs.existsSync(at(ep.baseline))) baseline = JSON.parse(fs.readFileSync(at(ep.baseline), 'utf-8'));
      else log(`  baseline file not found: ${ep.baseline}`);
    }
    const v = verifyReport(report, dataset, { baseline });
    const base = path.join(outDir, slug(ep.name));
    fs.writeFileSync(`${base}.json`, JSON.stringify(report, null, 2), 'utf-8');
    const { drift } = appendHistory(historyFile, historyRecord(report, v, { name: ep.name, reportPath: `${base}.json` }));
    v.drift = drift;
    const md = renderVerdict(v, dataset);
    fs.writeFileSync(`${base}.md`, md, 'utf-8');
    if (settings.html) {
      fs.writeFileSync(`${base}.html`, renderHtml(md, { title: `ccfp · ${ep.name} · ${v.confidence}/100`, badge: { level: v.level, confidence: v.confidence } }), 'utf-8');
    }
    log(`  ${v.confidence}/100 ${v.level}${drift.length ? ` · ⚠ ${drift.map((d) => d.kind).join(', ')}` : ''}`);
    results.push({ name: ep.name, file: `${base}.json`, report, verdict: v, drift });
  }

  const ok = results.filter((r) => r.verdict);
  let summary = '';
  if (ok.length) {
    const cmp = compareReports(ok.map((r) => ({ name: r.name, file: r.file, report: r.report })), dataset);
    // keep the per-endpoint verdicts (they include the baseline) instead of the baseline-free re-score
    cmp.rows.forEach((row, i) => { row.verdict = ok[i].verdict; });
    summary = renderCompare(cmp, dataset);
    const changed = ok.filter((r) => r.drift.length);
    if (changed.length) {
      summary += '\n## ⚠ 与上一次检测相比的变化 / Changed since the previous run\n';
      for (const r of changed) for (const d of r.drift) summary += `- ${r.name}: ${d.strong ? '**[强 / strong]** ' : ''}${d.message}\n`;
    }
    const failed = results.filter((r) => r.error);
    if (failed.length) {
      summary += '\n## 未完成 / Not probed\n';
      for (const r of failed) summary += `- ${r.name}: ${r.error}\n`;
    }
    fs.writeFileSync(path.join(outDir, 'summary.md'), summary, 'utf-8');
    if (settings.html) fs.writeFileSync(path.join(outDir, 'summary.html'), renderHtml(summary, { title: 'ccfp · endpoints' }), 'utf-8');
  }

  const threshold = settings.failUnder == null ? NaN : Number(settings.failUnder);
  return {
    at: new Date().toISOString(),
    outDir,
    historyFile,
    results,
    summary,
    belowThreshold: Number.isFinite(threshold) && ok.some((r) => r.verdict.confidence < threshold),
    drifted: ok.some((r) => r.drift.length),
    errors: results.filter((r) => r.error).length,
    settings,
    dataset
  };
}

export function parseInterval(s) {
  const m = /^(\d+(?:\.\d+)?)\s*(s|m|h|d)?$/i.exec(String(s ?? '').trim());
  if (!m) return null;
  const unit = { s: 1, m: 60, h: 3600, d: 86400 }[(m[2] || 'm').toLowerCase()];
  const ms = Math.round(Number(m[1]) * unit * 1000);
  return ms > 0 ? ms : null;
}

function resultJson(r) {
  return {
    tool: 'ccfingerprint',
    at: r.at,
    out_dir: r.outDir,
    history: r.historyFile,
    endpoints: r.results.map((x) => (x.error ? { name: x.name, error: x.error } : { name: x.name, file: x.file, ...verdictJson(x.verdict, r.dataset) }))
  };
}

// ---------- CLI ----------

function readConfig(file, lang) {
  const en = lang === 'en';
  if (!file || !fs.existsSync(file)) {
    console.error(en ? `Error: config file not found "${file}". See "ccfp run --help" and the README for the format.` : `错误: 找不到配置文件 "${file}"，格式见 README。`);
    process.exit(1);
  }
  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch (e) {
    console.error(en ? `Error: "${file}" is not valid JSON. ${e.message}` : `错误: "${file}" 不是合法 JSON。${e.message}`);
    process.exit(1);
  }
}

export async function run(options, { watch = false } = {}) {
  const raw = readConfig(options.config, options.lang || 'zh');
  const lang = options.lang || raw.lang || 'zh';
  const en = lang === 'en';
  const configDir = path.dirname(path.resolve(options.config));
  const every = watch ? parseInterval(options.every) : null;
  if (watch && !every) {
    console.error(en ? `Error: --every needs an interval like 30m, 6h or 1d` : `错误: --every 需要时间间隔，例如 30m、6h、1d`);
    process.exit(1);
  }
  const times = options.times == null ? (watch ? Infinity : 1) : Math.max(1, parseInt(options.times, 10) || 1);
  const overrides = {
    outDir: options.outDir,
    history: options.history,
    failUnder: options.failUnder,
    failOnDrift: options.failOnDrift || undefined,
    lang: options.lang
  };

  let last = null;
  for (let round = 1; round <= times; round++) {
    if (watch) console.error(`\n[${new Date().toISOString()}] ${en ? 'round' : '第'} ${round}${en ? '' : ' 轮'}`);
    const r = await runOnce(raw, { configDir, overrides, log: (m) => console.error(m) });
    if (r.error) {
      console.error(r.error);
      process.exit(1);
    }
    for (const x of r.results) if (x.drift?.length) printDrift(x.drift, lang, `${x.name}: `);
    if (options.json) console.log(JSON.stringify(resultJson(r), null, 2));
    else if (r.summary) console.log('\n' + r.summary);
    console.error(en ? `Reports, summary and history are in ${r.outDir}` : `报告、汇总和历史记录在 ${r.outDir}`);
    last = r;
    if (round < times) await new Promise((res) => setTimeout(res, every));
  }
  if (last.errors) process.exitCode = 1;
  if (last.belowThreshold || (last.settings.failOnDrift && last.drifted)) process.exitCode = 2;
  return last;
}
