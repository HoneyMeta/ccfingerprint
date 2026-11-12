import fs from 'fs';
import { loadDataset, probeSet } from './init.js';
import { verifyReport, emitVerdict, readJsonFile } from './verify.js';

// `ccfp probe`: send every probe straight to an OpenAI-compatible or Anthropic endpoint (one fresh
// request per probe, no tools), record what the API returns, then score it with the same verifier.

const SYSTEM = {
  zh: '这是一次模型身份检测中的单个问题。只用你的内置知识和即时推理作答，不要使用任何工具或搜索。不知道就只回答"不知道"，不要猜测。只给出答案本身，不要解释。',
  en: 'This is a single question from a model identity check. Answer from your built-in knowledge and on-the-spot reasoning only; do not use tools or search. If you do not know, reply only "I don\'t know" and do not guess. Give only the answer itself, no explanation.'
};

// Same bytes for every endpoint, so prompt-token counts are comparable between runs and endpoints.
const CANARY = { zh: '只回复两个字母：OK', en: 'Reply with the two letters OK and nothing else.' };

export function endpointUrl(protocol, baseUrl) {
  const base = String(baseUrl || '').replace(/\/+$/, '');
  const tail = protocol === 'anthropic' ? '/messages' : '/chat/completions';
  if (base.endsWith(tail)) return base;
  if (/\/v\d+(beta)?$/.test(base)) return base + tail;
  return `${base}/v1${tail}`;
}

// Strip reasoning wrappers some open models put into the visible answer; remember that they were there.
export function cleanAnswer(text) {
  const raw = String(text ?? '');
  const think = /<think(ing)?>/i.test(raw);
  const cleaned = raw
    .replace(/<think(ing)?>[\s\S]*?<\/think(ing)?>/gi, '')
    .replace(/^[\s\S]*?<\/think(ing)?>/i, '')
    .trim();
  return { text: cleaned, think };
}

function contentText(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map((p) => (typeof p === 'string' ? p : p?.type === 'text' || p?.text ? p.text || '' : '')).join('');
  return '';
}

export function parseResponse(protocol, body) {
  if (protocol === 'anthropic') {
    const u = body.usage || {};
    const input = [u.input_tokens, u.cache_creation_input_tokens, u.cache_read_input_tokens].filter(Number.isFinite);
    return {
      text: (body.content || []).filter((b) => b.type === 'text').map((b) => b.text).join(''),
      model: body.model || null,
      id: body.id || null,
      prompt_tokens: input.length ? input.reduce((a, b) => a + b, 0) : null,
      completion_tokens: Number.isFinite(u.output_tokens) ? u.output_tokens : null,
      reasoning_field: false
    };
  }
  const msg = body.choices?.[0]?.message || {};
  const u = body.usage || {};
  return {
    text: contentText(msg.content),
    model: body.model || null,
    id: body.id || null,
    prompt_tokens: Number.isFinite(u.prompt_tokens) ? u.prompt_tokens : Number.isFinite(u.input_tokens) ? u.input_tokens : null,
    completion_tokens: Number.isFinite(u.completion_tokens) ? u.completion_tokens : Number.isFinite(u.output_tokens) ? u.output_tokens : null,
    reasoning_field: typeof msg.reasoning_content === 'string' && msg.reasoning_content.length > 0
  };
}

function requestBody(protocol, { model, system, prompt, maxTokens, temperature }) {
  if (protocol === 'anthropic') {
    const body = { model, max_tokens: maxTokens || 2048, system, messages: [{ role: 'user', content: prompt }] };
    if (temperature != null) body.temperature = temperature;
    return body;
  }
  const body = { model, messages: [{ role: 'system', content: system }, { role: 'user', content: prompt }], stream: false };
  if (maxTokens) body.max_tokens = maxTokens;
  if (temperature != null) body.temperature = temperature;
  return body;
}

function headers(protocol, apiKey) {
  const h = { 'content-type': 'application/json' };
  if (protocol === 'anthropic') {
    h['x-api-key'] = apiKey;
    h['anthropic-version'] = '2023-06-01';
  } else {
    h.authorization = `Bearer ${apiKey}`;
  }
  return h;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function callModel(opts) {
  const { protocol, url, apiKey, retries = 2, timeoutMs = 120000, fetchImpl = fetch } = opts;
  const started = Date.now();
  let lastError = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt) await sleep(Math.min(8000, 1500 * 2 ** (attempt - 1)));
    try {
      const res = await fetchImpl(url, {
        method: 'POST',
        headers: headers(protocol, apiKey),
        body: JSON.stringify(requestBody(protocol, opts)),
        signal: AbortSignal.timeout(timeoutMs)
      });
      const text = await res.text();
      if (!res.ok) {
        lastError = `HTTP ${res.status}: ${text.slice(0, 200)}`;
        if (res.status === 429 || res.status >= 500) continue;
        break;
      }
      const parsed = parseResponse(protocol, JSON.parse(text));
      const { text: answer, think } = cleanAnswer(parsed.text);
      return { answer, meta: { ...parsed, text: undefined, think, latency_ms: Date.now() - started } };
    } catch (e) {
      lastError = e.name === 'TimeoutError' ? `timeout after ${timeoutMs} ms` : e.message;
    }
  }
  return { answer: '', meta: { error: lastError, latency_ms: Date.now() - started } };
}

async function pool(tasks, concurrency) {
  const results = new Array(tasks.length);
  let next = 0;
  const worker = async () => {
    while (next < tasks.length) {
      const i = next++;
      results[i] = await tasks[i]();
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, tasks.length)) }, worker));
  return results;
}

export async function runProbe(options) {
  const {
    baseUrl, model, apiKey, protocol = 'openai', lang = 'en', quick = false, runs = 1, canary = 3,
    concurrency = 4, maxTokens, temperature, timeoutMs, retries, fetchImpl, onProgress
  } = options;
  const dataset = loadDataset();
  const set = probeSet(dataset, quick ? 'quick' : 'full');
  const url = endpointUrl(protocol, baseUrl);
  const system = SYSTEM[lang] || SYSTEM.en;
  const call = (prompt) => callModel({ protocol, url, apiKey, model, system, prompt, maxTokens, temperature, timeoutMs, retries, fetchImpl });
  const prompt = (q) => q[`prompt_${lang}`] || q.prompt_en;

  const groups = [
    ['claimed', set.self_declare],
    ['answers', [...set.knowledge, ...set.capability, ...set.behavior]]
  ];
  const total = runs * groups.reduce((n, [, list]) => n + list.length, 0) + canary;
  let done = 0;
  const tick = () => onProgress && onProgress(++done, total);

  const runResults = [];
  for (let r = 0; r < runs; r++) {
    const run = { claimed: {}, answers: {}, meta: {} };
    const tasks = groups.flatMap(([field, list]) => list.map((q) => async () => {
      const { answer, meta } = await call(prompt(q));
      run[field][q.id] = answer;
      run.meta[q.id] = meta;
      tick();
    }));
    await pool(tasks, concurrency);
    runResults.push(run);
  }

  const canaryResults = await pool(Array.from({ length: canary }, () => async () => {
    const { meta } = await call(CANARY[lang] || CANARY.en);
    tick();
    return meta;
  }), concurrency);

  let host = baseUrl;
  try {
    const u = new URL(url);
    host = `${u.origin}${u.pathname}`; // never keep query strings (some relays put keys there)
  } catch { /* keep as given */ }

  return {
    tool: 'ccfingerprint',
    source: 'api',
    dataset_version: dataset.version,
    probe_set: quick ? 'quick' : 'full',
    lang,
    generated_at: new Date().toISOString(),
    api: { protocol, endpoint: host, model, canary: canaryResults },
    claimed: runResults[0].claimed,
    answers: runResults[0].answers,
    runs: runResults
  };
}

// ---------- CLI ----------

export async function probe(options) {
  const lang = options.lang || 'zh';
  const en = lang === 'en';
  const protocol = (options.api || 'openai').toLowerCase();
  if (!['openai', 'anthropic'].includes(protocol)) {
    console.error(en ? `Error: --api must be openai or anthropic` : `错误: --api 只能是 openai 或 anthropic`);
    process.exit(1);
  }
  if (!options.baseUrl || !options.model) {
    console.error(en ? 'Error: --base-url and --model are required' : '错误: 必须提供 --base-url 和 --model');
    process.exit(1);
  }
  const keyEnv = options.apiKeyEnv || 'CCFP_API_KEY';
  const apiKey = process.env[keyEnv] || (protocol === 'anthropic' ? process.env.ANTHROPIC_API_KEY : process.env.OPENAI_API_KEY);
  if (!apiKey) {
    console.error(en
      ? `Error: no API key. Put it in the ${keyEnv} environment variable (the key is never written to the report).`
      : `错误: 没有 API key。请放在环境变量 ${keyEnv} 中（key 不会写进报告）。`);
    process.exit(1);
  }
  const int = (v, d) => (v == null ? d : Math.max(0, parseInt(v, 10) || 0));
  const runs = Math.max(1, int(options.runs, 1));
  const baseline = options.baseline ? readJsonFile(options.baseline, lang) : null;

  const report = await runProbe({
    baseUrl: options.baseUrl,
    model: options.model,
    apiKey,
    protocol,
    lang,
    quick: !!options.quick,
    runs,
    canary: int(options.canary, 3),
    concurrency: Math.max(1, int(options.concurrency, 4)),
    maxTokens: options.maxTokens ? int(options.maxTokens) : undefined,
    temperature: options.temperature != null ? Number(options.temperature) : undefined,
    timeoutMs: int(options.timeout, 120) * 1000,
    onProgress: (d, t) => process.stderr.write(`\r${en ? 'probing' : '探测中'} ${d}/${t}`)
  });
  process.stderr.write('\n');

  const reportPath = options.report || 'ccfp-report.json';
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf-8');
  console.error(en ? `Saved raw report to ${reportPath}` : `已保存原始报告: ${reportPath}`);

  const dataset = loadDataset();
  const v = verifyReport(report, dataset, { baseline });
  emitVerdict(v, dataset, options);
  return v;
}
