import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import http from 'node:http';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync, spawnSync, spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { loadDataset, probeSet, buildPrompt } from '../src/init.js';
import { runProbe, endpointUrl, cleanAnswer, parseResponse } from '../src/probe.js';
import { verifyReport, verdictJson, sameModel } from '../src/verify.js';
import { compareReports } from '../src/compare.js';

const dataset = loadDataset();
const CLI = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'ccfp.js');

const GOOD = {
  model_id: 'claude-opus-5-5', provider: 'Anthropic', context_length: '1000000', knowledge_cutoff: 'June 2026', capabilities: 'text, tools',
  nobel_physics_2024: 'Hopfield and Hinton', nobel_chemistry_2024: 'Baker, Hassabis, Jumper', gpt5_release: 'August 2025',
  nobel_physics_2025: 'Clarke, Devoret, Martinis', nobel_chemistry_2025: 'Kitagawa, Robson, Yaghi', gemini3_release: 'November 2025',
  claude_opus_46: 'February 2026', gpt55_release: 'April 2026', claude_opus_48: 'May 2026',
  letter_count: '7', instruction_strict: 'fox', needle: 'ZX9-QY7-KP3', string_transform: 'A-N-A-N-A-B', code_trace: '259',
  weekday_calc: 'Sunday', knights_knaves: 'knight', inclusion_exclusion: '400', crt: '654', ascii_signature: '[opus]'
};
// a cheap model behind the same name: knows little, fails the harder probes
const WEAK = {
  model_id: 'claude-opus-5-5', provider: 'Anthropic', knowledge_cutoff: 'June 2026',
  nobel_physics_2024: 'Hopfield and Hinton', gpt5_release: "I don't know",
  letter_count: '6', needle: 'ZX9-QY7-KP2', string_transform: 'BANANA', code_trace: '385', weekday_calc: 'Wednesday',
  knights_knaves: 'knave', inclusion_exclusion: '466', crt: '1001'
};

const promptToId = new Map();
for (const q of [...dataset.self_declare, ...dataset.knowledge, ...dataset.capability, ...dataset.behavior]) {
  promptToId.set(q.prompt_en, q.id);
  promptToId.set(q.prompt_zh, q.id);
}

// backend: { answers, divisor, offset, model, think }
function startRelay(pickBackend) {
  let n = 0;
  const seen = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const j = JSON.parse(body);
      seen.push({ url: req.url, headers: req.headers, body: j });
      const anthropic = req.url.endsWith('/v1/messages');
      const user = j.messages[j.messages.length - 1].content;
      const system = anthropic ? j.system : j.messages[0].content;
      const b = pickBackend(n++, user);
      const id = promptToId.get(user);
      let text = /OK/.test(user) && !id ? 'OK' : (b.answers[id] ?? "I don't know");
      if (b.think) text = `<think>let me think</think>${text}`;
      const promptTokens = Math.ceil((system.length + user.length) / b.divisor) + (b.offset || 0);
      const model = b.model ?? j.model;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify(anthropic
        ? { id: b.foreignIds ? `chatcmpl-${n}` : `msg_${n}`, type: 'message', model, content: [{ type: 'text', text }], usage: { input_tokens: promptTokens, output_tokens: 5 } }
        : { id: `chatcmpl-${n}`, model, choices: [{ message: { role: 'assistant', content: text } }], usage: { prompt_tokens: promptTokens, completion_tokens: 5 } }));
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, seen, url: `http://127.0.0.1:${server.address().port}` })));
}

const genuine = { answers: GOOD, divisor: 4 };

async function probeWith(backend, opts = {}) {
  const relay = await startRelay(typeof backend === 'function' ? backend : () => backend);
  try {
    const report = await runProbe({ baseUrl: relay.url, model: 'claude-opus-5-5', apiKey: 'sk-test', lang: 'en', retries: 0, ...opts });
    return { report, seen: relay.seen };
  } finally {
    relay.server.close();
  }
}

describe('probe helpers', () => {
  it('builds endpoint URLs from any common base form', () => {
    assert.strictEqual(endpointUrl('openai', 'https://x.com'), 'https://x.com/v1/chat/completions');
    assert.strictEqual(endpointUrl('openai', 'https://x.com/v1/'), 'https://x.com/v1/chat/completions');
    assert.strictEqual(endpointUrl('openai', 'https://x.com/v1/chat/completions'), 'https://x.com/v1/chat/completions');
    assert.strictEqual(endpointUrl('anthropic', 'https://x.com/api'), 'https://x.com/api/v1/messages');
    assert.strictEqual(endpointUrl('anthropic', 'https://x.com/v1'), 'https://x.com/v1/messages');
  });
  it('strips <think> blocks but remembers them', () => {
    assert.deepStrictEqual(cleanAnswer('<think>a\nb</think> 654'), { text: '654', think: true });
    assert.deepStrictEqual(cleanAnswer('654'), { text: '654', think: false });
  });
  it('counts cached Anthropic input tokens as prompt tokens', () => {
    const p = parseResponse('anthropic', { content: [{ type: 'text', text: 'x' }], usage: { input_tokens: 10, cache_read_input_tokens: 90, output_tokens: 1 } });
    assert.strictEqual(p.prompt_tokens, 100);
  });
  it('treats dated or prefixed model fields as the same model', () => {
    assert.ok(sameModel('claude-opus-5-5', 'claude-opus-5-5-20260922', dataset));
    assert.ok(sameModel('gpt-6.1-sol', 'openai/gpt-6.1-sol', dataset));
    assert.ok(!sameModel('claude-opus-5-5', 'claude-sonnet-5-5', dataset));
    assert.ok(!sameModel('claude-opus-5-5', 'deepseek-chat', dataset));
  });
});

describe('ccfp probe against a mock relay', () => {
  it('passes a genuine endpoint (openai protocol) and never stores the key', async () => {
    const { report, seen } = await probeWith(genuine);
    assert.strictEqual(seen[0].headers.authorization, 'Bearer sk-test');
    assert.ok(!JSON.stringify(report).includes('sk-test'), 'API key leaked into the report');
    const v = verifyReport(report, dataset);
    assert.strictEqual(v.capRatio, 1);
    assert.strictEqual(v.api.mixedRouting, false, JSON.stringify(v.api));
    assert.strictEqual(v.api.modelMismatch, false);
    assert.strictEqual(v.level, 'trustworthy', v.flags.join('\n'));
  });

  it('speaks the Anthropic Messages protocol', async () => {
    const { report, seen } = await probeWith(genuine, { protocol: 'anthropic' });
    assert.strictEqual(seen[0].url, '/v1/messages');
    assert.strictEqual(seen[0].headers['x-api-key'], 'sk-test');
    assert.ok(seen[0].body.max_tokens > 0);
    assert.strictEqual(verifyReport(report, dataset).level, 'trustworthy');
  });

  it('notes non-Anthropic response ids on the Messages protocol', async () => {
    const { report } = await probeWith({ ...genuine, foreignIds: true }, { protocol: 'anthropic', quick: true });
    const v = verifyReport(report, dataset);
    assert.ok(v.api.notes.some((n) => n.includes('msg_')));
  });

  it('quick mode sends about half the requests and still scores', async () => {
    const full = dataset.self_declare.length + dataset.knowledge.length + dataset.capability.length + dataset.behavior.length;
    const { report, seen } = await probeWith(genuine, { quick: true, canary: 0 });
    const q = probeSet(dataset, 'quick');
    assert.strictEqual(seen.length, q.self_declare.length + q.knowledge.length + q.capability.length);
    assert.ok(seen.length <= full * 0.6, `${seen.length} of ${full}`);
    const v = verifyReport(report, dataset);
    assert.strictEqual(v.probeSet, 'quick');
    assert.strictEqual(v.capability.length, q.capability.length);
    assert.strictEqual(v.level, 'trustworthy', v.flags.join('\n'));
  });

  it('catches a relay that rotates between the real model and a cheaper one', async () => {
    const cheap = { answers: WEAK, divisor: 3 };
    const { report } = await probeWith((i) => (i % 2 ? cheap : genuine), { quick: true, runs: 2 });
    const v = verifyReport(report, dataset);
    assert.ok(v.api.mixedRouting, JSON.stringify(v.api));
    assert.ok(v.api.tokenDrift.length > 0);
    assert.ok(v.runs && v.runs.length === 2);
    assert.notStrictEqual(v.level, 'trustworthy');
    assert.ok(v.flags.some((f) => f.includes('rotating routing')));
  });

  it('flags a returned model field that names another model', async () => {
    const { report } = await probeWith({ ...genuine, model: 'deepseek-v4-flash' }, { quick: true });
    const v = verifyReport(report, dataset);
    assert.ok(v.api.modelMismatch);
    assert.notStrictEqual(v.level, 'trustworthy');
  });

  it('flags <think> tags behind a Claude model name', async () => {
    const { report } = await probeWith({ ...genuine, think: true }, { quick: true });
    const v = verifyReport(report, dataset);
    assert.ok(v.api.thinkLeak);
    assert.ok(v.capRatio === 1, 'think blocks must be stripped before scoring');
    assert.ok(v.flags.some((f) => f.includes('<think>')));
  });

  it('records failed requests instead of crashing', async () => {
    const report = await runProbe({
      baseUrl: 'http://127.0.0.1:9', model: 'claude-opus-5-5', apiKey: 'k', lang: 'en', quick: true, canary: 1, retries: 0, timeoutMs: 2000
    });
    const v = verifyReport(report, dataset);
    assert.strictEqual(v.api.errors, v.api.calls);
    assert.ok(v.flags.some((f) => f.includes('requests failed')));
  });
});

describe('baseline comparison', () => {
  it('matches a baseline from the same model and detects hidden prompts or another tokenizer', async () => {
    const { report: official } = await probeWith(genuine, { quick: true });
    const { report: same } = await probeWith(genuine, { quick: true });
    const { report: injected } = await probeWith({ ...genuine, offset: 120 }, { quick: true });
    const { report: other } = await probeWith({ answers: GOOD, divisor: 3 }, { quick: true });

    const a = verifyReport(same, dataset, { baseline: official });
    assert.strictEqual(a.baseline.tokenMatch, true);
    assert.strictEqual(a.level, 'trustworthy');

    const b = verifyReport(injected, dataset, { baseline: official });
    assert.strictEqual(b.baseline.tokenOffset, 120);
    assert.ok(b.flags.some((f) => f.includes('hidden system prompt')));

    const c = verifyReport(other, dataset, { baseline: official });
    assert.strictEqual(c.baseline.tokenizerDiffers, true);
    assert.notStrictEqual(c.level, 'trustworthy');
  });

  it('refuses to compare reports made with different probe sets', async () => {
    const { report: official } = await probeWith(genuine, { quick: true, canary: 0 });
    const { report: full } = await probeWith(genuine, { canary: 0 });
    const v = verifyReport(full, dataset, { baseline: official });
    assert.strictEqual(v.baseline.comparable, false);
    assert.deepStrictEqual(v.baseline.why, ['probe_set']);
  });

  it('compare groups endpoints sharing a tokenizer', async () => {
    const { report: r1 } = await probeWith(genuine, { quick: true });
    const { report: r2 } = await probeWith(genuine, { quick: true });
    const { report: r3 } = await probeWith({ answers: WEAK, divisor: 3 }, { quick: true });
    const res = compareReports([{ file: 'a.json', report: r1 }, { file: 'b.json', report: r2 }, { file: 'c.json', report: r3 }], dataset);
    assert.strictEqual(res.rows.length, 3);
    assert.ok(res.tokenGroups.some((g) => g.names.length === 2));
    assert.ok(res.rows[2].verdict.confidence < res.rows[0].verdict.confidence);
  });
});

function runCli(args, env) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [CLI, ...args], { env: { ...process.env, ...env } });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    child.on('close', (status) => resolve({ status, stdout, stderr }));
  });
}

describe('ccfp probe / compare CLI', () => {
  it('probes from the command line, saves the report and compares two endpoints', async () => {
    const relay = await startRelay(() => genuine);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ccfp-probe-'));
    try {
      const r1 = path.join(dir, 'a.json');
      const res = await runCli(['probe', '--base-url', `${relay.url}/v1`, '--model', 'claude-opus-5-5', '--quick', '--lang', 'en',
        '--report', r1, '--output', path.join(dir, 'a.md'), '--json', '--fail-under', '75'], { CCFP_API_KEY: 'sk-cli-secret' });
      assert.strictEqual(res.status, 0, res.stderr);
      assert.strictEqual(JSON.parse(res.stdout).level, 'trustworthy');
      const saved = fs.readFileSync(r1, 'utf-8');
      assert.ok(!saved.includes('sk-cli-secret'));
      assert.strictEqual(JSON.parse(saved).source, 'api');

      const missingKey = await runCli(['probe', '--base-url', relay.url, '--model', 'm', '--api-key-env', 'CCFP_NOPE_KEY'], { OPENAI_API_KEY: '' });
      assert.strictEqual(missingKey.status, 1);

      const cmp = await runCli(['compare', r1, r1, '--output', path.join(dir, 'c.md')]);
      assert.strictEqual(cmp.status, 0, cmp.stderr);
      assert.ok(cmp.stdout.includes('Endpoint comparison'));
    } finally {
      relay.server.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('assistant reports, JSON output and exit codes', () => {
  it('init --quick writes a shorter prompt tagged with the quick probe set', () => {
    const full = buildPrompt('claude', 'en', dataset);
    const quick = buildPrompt('claude', 'en', dataset, { quick: true });
    assert.ok(quick.length < full.length * 0.8);
    assert.ok(quick.includes('"probe_set": "quick"'));
    assert.ok(!quick.includes('ascii_signature'));
  });

  it('verdictJson leaves answer keys out', () => {
    const v = verifyReport({ claimed: { model_id: 'claude-opus-5-5' }, answers: GOOD }, dataset);
    const j = verdictJson(v, dataset);
    assert.strictEqual(j.level, 'trustworthy');
    assert.ok(!JSON.stringify(j).includes('A-N-A-N-A-B'));
  });

  it('ccfp verify --json --fail-under exits 2 below the threshold', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ccfp-cli-'));
    try {
      const file = path.join(dir, 'r.json');
      fs.writeFileSync(file, JSON.stringify({ claimed: { model_id: 'claude-opus-5-5', knowledge_cutoff: '2026-06' }, answers: WEAK }));
      const out = path.join(dir, 'v.md');
      const bad = spawnSync(process.execPath, [CLI, 'verify', file, '--json', '--fail-under', '70', '--output', out], { encoding: 'utf-8' });
      assert.strictEqual(bad.status, 2, bad.stderr);
      const j = JSON.parse(bad.stdout);
      assert.ok(j.confidence < 70);
      assert.ok(fs.existsSync(out));
      fs.writeFileSync(file, JSON.stringify({ claimed: { model_id: 'claude-opus-5-5', knowledge_cutoff: '2026-06' }, answers: GOOD }));
      execFileSync(process.execPath, [CLI, 'verify', file, '--fail-under', '70', '--output', out]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
