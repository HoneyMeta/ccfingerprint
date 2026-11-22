import { describe, it } from 'node:test';
import assert from 'node:assert';
import http from 'node:http';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import { loadDataset } from '../src/init.js';
import { findIdentity, sameModel } from '../src/verify.js';
import { runOnce, loadConfig, parseInterval, slug } from '../src/run.js';
import { detectDrift, analyzeHistory, readHistory, renderHistory } from '../src/history.js';
import { markdownToHtml, renderHtml } from '../src/html.js';

const dataset = loadDataset();
const CLI = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'ccfp.js');
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'ccfp-run-'));

const GOOD = {
  model_id: 'claude-opus-5-5', provider: 'Anthropic', context_length: '1000000', knowledge_cutoff: 'June 2026', capabilities: 'text, tools',
  nobel_physics_2024: 'Hopfield and Hinton', nobel_chemistry_2024: 'Baker, Hassabis, Jumper', gpt5_release: 'August 2025',
  nobel_physics_2025: 'Clarke, Devoret, Martinis', nobel_chemistry_2025: 'Kitagawa, Robson, Yaghi', gemini3_release: 'November 2025',
  claude_opus_46: 'February 2026', gpt55_release: 'April 2026', claude_opus_48: 'May 2026',
  letter_count: '7', instruction_strict: 'fox', needle: 'ZX9-QY7-KP3', string_transform: 'A-N-A-N-A-B', code_trace: '259',
  weekday_calc: 'Sunday', knights_knaves: 'knight', inclusion_exclusion: '400', crt: '654', ascii_signature: '[opus]'
};

const promptToId = new Map();
for (const q of [...dataset.self_declare, ...dataset.knowledge, ...dataset.capability, ...dataset.behavior]) {
  promptToId.set(q.prompt_en, q.id);
  promptToId.set(q.prompt_zh, q.id);
}

// Every path prefix is its own "relay": /a/..., /b/... ; `backends` can be swapped between rounds.
function startRelays(backends) {
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const j = JSON.parse(body);
      const b = backends[req.url.split('/')[1]];
      const user = j.messages[j.messages.length - 1].content;
      const system = j.messages[0].content;
      const id = promptToId.get(user);
      const text = /OK/.test(user) && !id ? 'OK' : (b.answers[id] ?? "I don't know");
      const promptTokens = Math.ceil((system.length + user.length) / b.divisor) + (b.offset || 0);
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ id: 'chatcmpl-x', model: b.model ?? j.model, choices: [{ message: { role: 'assistant', content: text } }], usage: { prompt_tokens: promptTokens, completion_tokens: 3 } }));
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, url: `http://127.0.0.1:${server.address().port}` })));
}

const env = { CCFP_API_KEY: 'sk-shared-test', RELAY_B_KEY: 'sk-b-test' };

describe('Claude 5 family ids', () => {
  it('resolves current model ids in the forms vendors and relays use', () => {
    const cases = {
      'Claude Opus 5.5': ['claude-opus-5-5', 'claude-opus-5-5-20260922', 'anthropic/claude-opus-5.5', 'us.anthropic.claude-opus-5-5-v1:0', 'claude-opus-5-5[1m]'],
      'Claude Sonnet 5.5': ['claude-sonnet-5-5', 'claude-sonnet-5.5'],
      'Claude Haiku 5.5': ['claude-haiku-5-5', 'claude-haiku-5-5-20261015'],
      'Claude Fable 5.2': ['claude-fable-5-2', 'claude-fable-5.2']
    };
    for (const [label, ids] of Object.entries(cases)) {
      for (const id of ids) assert.strictEqual(findIdentity(id, dataset)?.label, label, id);
    }
    assert.strictEqual(findIdentity('claude-opus-5', dataset)?.label, 'Claude Opus 5');
    assert.ok(!sameModel('claude-opus-5-5', 'claude-haiku-5-5', dataset));
    assert.ok(!sameModel('claude-fable-5-2', 'claude-fable-5-1', dataset));
  });
});

describe('html report', () => {
  it('renders the Markdown subset ccfp writes and escapes everything else', () => {
    const html = markdownToHtml('# T\n\n> note\n\n| a | b |\n|---|---|\n| **x** | <script> |\n\n- one\n- `two`\n\n```\nASCII <art>\n```\ntext');
    assert.ok(html.includes('<h1>T</h1>'));
    assert.ok(html.includes('<blockquote>note</blockquote>'));
    assert.ok(html.includes('<td><strong>x</strong></td><td>&lt;script&gt;</td>'));
    assert.ok(html.includes('<li><code>two</code></li>'));
    assert.ok(html.includes('<pre>ASCII &lt;art&gt;</pre>'));
    assert.ok(html.includes('<p>text</p>'));
    assert.ok(!html.includes('<script>'));
  });
  it('builds a standalone page with a verdict badge and dark mode', () => {
    const page = renderHtml('# Verdict\n\nbody', { title: 'x', badge: { level: 'untrustworthy', confidence: 31 } });
    assert.ok(page.startsWith('<!doctype html>'));
    assert.ok(/<\/h1>\n<div class="badge untrustworthy"><b>31\/100<\/b>/.test(page));
    assert.ok(page.includes('prefers-color-scheme:dark'));
    assert.ok(!/<script|https?:\/\/(?!github\.com)/.test(page), 'page must be self-contained');
  });
});

describe('drift between runs', () => {
  const base = { name: 'r', endpoint: 'e', model: 'claude-opus-5-5', protocol: 'openai', probe_set: 'quick', lang: 'en', dataset: '2.4.0',
    level: 'trustworthy', confidence: 92, cap_ratio: 1, latest_known: '2026-05', identity: 'Claude Opus 5.5', returned_models: ['claude-opus-5-5'], canary_tokens: 40, mixed_routing: false };
  it('stays quiet when nothing meaningful changed', () => {
    assert.deepStrictEqual(detectDrift(base, { ...base, confidence: 88, cap_ratio: 0.9 }), []);
    assert.deepStrictEqual(detectDrift(null, base), []);
  });
  it('flags a changed tokenizer, model field, identity, routing and verdict', () => {
    const kinds = detectDrift(base, { ...base, canary_tokens: 52, returned_models: ['deepseek-chat'], identity: 'DeepSeek V4', mixed_routing: true, level: 'questionable' }).map((d) => d.kind);
    assert.deepStrictEqual(kinds, ['canary', 'model-field', 'self-id', 'routing', 'level']);
  });
  it('flags weaker capability and older knowledge as soft changes', () => {
    const d = detectDrift(base, { ...base, confidence: 70, cap_ratio: 0.6, latest_known: '2025-08' });
    assert.deepStrictEqual(d.map((x) => [x.kind, x.strong]), [['confidence', false], ['capability', false], ['cutoff', false]]);
  });
  it('does not compare canary tokens across languages or datasets', () => {
    assert.deepStrictEqual(detectDrift(base, { ...base, lang: 'zh', canary_tokens: 70 }), []);
    assert.deepStrictEqual(detectDrift(base, { ...base, dataset: '2.5.0', canary_tokens: 70 }), []);
  });
});

describe('ccfp run --config', () => {
  it('validates the config and refuses API keys in it', () => {
    assert.match(loadConfig({}).error, /endpoints/);
    assert.match(loadConfig({ endpoints: [{ baseUrl: 'https://x', model: 'm', apiKey: 'sk-1' }] }).error, /never put API keys/);
    assert.match(loadConfig({ api_key: 'sk', endpoints: [{ baseUrl: 'https://x', model: 'm' }] }).error, /never put API keys/);
    assert.match(loadConfig({ endpoints: [{ name: 'a', baseUrl: 'https://x', model: 'm' }, { name: 'a', baseUrl: 'https://y', model: 'm' }] }).error, /duplicate/);
    assert.match(loadConfig({ endpoints: [{ name: 'a', baseUrl: 'https://x' }] }).error, /required/);
  });
  it('probes baseline endpoints first and shares top-level settings', () => {
    const { endpoints } = loadConfig({
      model: 'claude-opus-5-5', base_url: 'https://relay.example/v1', baseline: 'official', quick: true,
      endpoints: [{ name: 'relay' }, { name: 'official', base_url: 'https://api.anthropic.com', api: 'anthropic' }]
    });
    assert.deepStrictEqual(endpoints.map((e) => e.name), ['official', 'relay']);
    assert.strictEqual(endpoints[0].baseline, undefined);
    assert.strictEqual(endpoints[1].baseline, 'official');
    assert.strictEqual(endpoints[1].quick, true);
    assert.strictEqual(endpoints[0].baseUrl, 'https://api.anthropic.com');
  });
  it('parses intervals and slugs', () => {
    assert.strictEqual(parseInterval('90s'), 90000);
    assert.strictEqual(parseInterval('30'), 1800000);
    assert.strictEqual(parseInterval('6h'), 21600000);
    assert.strictEqual(parseInterval('1d'), 86400000);
    assert.strictEqual(parseInterval('soon'), null);
    assert.strictEqual(slug('Relay A / opus'), 'relay-a-opus');
  });

  it('probes several endpoints, compares them with an in-run baseline, records history and catches a backend swap', async () => {
    const backends = {
      official: { answers: GOOD, divisor: 4 },
      a: { answers: GOOD, divisor: 4, offset: 120 }, // same model, hidden system prompt
      b: { answers: GOOD, divisor: 4 }
    };
    const relay = await startRelays(backends);
    const dir = tmp();
    const config = {
      lang: 'en', quick: true, canary: 2, model: 'claude-opus-5-5', baseline: 'official', out_dir: 'out',
      endpoints: [
        { name: 'relay-a', base_url: `${relay.url}/a/v1` },
        { name: 'relay-b', base_url: `${relay.url}/b/v1`, api_key_env: 'RELAY_B_KEY' },
        { name: 'official', base_url: `${relay.url}/official/v1` },
        { name: 'no-key', base_url: `${relay.url}/b/v1`, api_key_env: 'MISSING_KEY_ENV', api: 'anthropic' }
      ]
    };
    try {
      const r1 = await runOnce(config, { configDir: dir, env });
      assert.ifError(r1.error);
      assert.deepStrictEqual(r1.results.map((x) => x.name), ['official', 'relay-a', 'relay-b', 'no-key']);
      assert.match(r1.results[3].error, /MISSING_KEY_ENV/);
      assert.strictEqual(r1.errors, 1);
      const a = r1.results[1].verdict;
      assert.strictEqual(a.baseline.tokenOffset, 120, JSON.stringify(a.baseline));
      assert.ok(a.flags.some((f) => /hidden system prompt/.test(f)));
      assert.strictEqual(r1.results[2].verdict.level, 'trustworthy');
      assert.ok(!r1.drifted);
      for (const f of ['official.json', 'relay-a.md', 'relay-b.html', 'summary.md', 'summary.html', 'history.jsonl']) {
        assert.ok(fs.existsSync(path.join(dir, 'out', f)), f);
      }
      const summary = fs.readFileSync(path.join(dir, 'out', 'summary.md'), 'utf-8');
      assert.ok(summary.includes('| relay-a |') && summary.includes('no-key: '), summary);
      assert.ok(!fs.readFileSync(path.join(dir, 'out', 'history.jsonl'), 'utf-8').includes('sk-'), 'key leaked into history');

      // round 2: relay-b quietly moves to a different model with a different tokenizer
      backends.b = { answers: { ...GOOD, crt: '1001', code_trace: '385' }, divisor: 3, model: 'deepseek-chat' };
      const r2 = await runOnce(config, { configDir: dir, env, overrides: { failOnDrift: true } });
      const b2 = r2.results.find((x) => x.name === 'relay-b');
      assert.deepStrictEqual(b2.drift.filter((d) => d.strong).map((d) => d.kind).slice(0, 2), ['canary', 'model-field']);
      assert.deepStrictEqual(r2.results.find((x) => x.name === 'relay-a').drift, []);
      assert.ok(r2.drifted);
      assert.ok(fs.readFileSync(path.join(dir, 'out', 'summary.md'), 'utf-8').includes('Changed since the previous run'));
      assert.ok(fs.readFileSync(path.join(dir, 'out', 'relay-b.md'), 'utf-8').includes('Changed since the previous run'));

      const groups = analyzeHistory(readHistory(path.join(dir, 'out', 'history.jsonl')));
      assert.strictEqual(groups.length, 3);
      assert.deepStrictEqual(groups.map((g) => g.drifted), [false, false, true]);
      assert.ok(renderHistory(groups).includes('⚠ canary'));
    } finally {
      relay.server.close();
    }
  });

  it('CLI: run exits 2 with --fail-on-drift, history and watch work end to end', async () => {
    const backends = { a: { answers: GOOD, divisor: 4 } };
    const relay = await startRelays(backends);
    const dir = tmp();
    const cfg = path.join(dir, 'ccfp.config.json');
    fs.writeFileSync(cfg, JSON.stringify({ lang: 'en', quick: true, canary: 1, endpoints: [{ name: 'a', base_url: `${relay.url}/a/v1`, model: 'claude-sonnet-5-5' }] }));
    const cli = (args) => new Promise((resolve) => {
      // async spawn: the mock relay lives in this process, so spawnSync would deadlock
      import('child_process').then(({ spawn }) => {
        const p = spawn(process.execPath, [CLI, ...args], { cwd: dir, env: { ...process.env, CCFP_API_KEY: 'sk-test' } });
        let out = '';
        let err = '';
        p.stdout.on('data', (c) => (out += c));
        p.stderr.on('data', (c) => (err += c));
        p.on('close', (status) => resolve({ status, out, err }));
      });
    });
    try {
      const w = await cli(['watch', '--config', cfg, '--every', '1s', '--times', '2', '--json']);
      assert.strictEqual(w.status, 0, w.err);
      assert.strictEqual((w.err.match(/round/g) || []).length, 2);
      backends.a = { answers: GOOD, divisor: 5 };
      const r = await cli(['run', '--config', cfg, '--fail-on-drift']);
      assert.strictEqual(r.status, 2, r.err);
      assert.match(r.err, /changed since the previous run/);
      const h = await cli(['history', 'ccfp-runs/history.jsonl', '--json', '--html', 'h.html', '--fail-on-drift']);
      assert.strictEqual(h.status, 2, h.err);
      const j = JSON.parse(h.out);
      assert.strictEqual(j.endpoints[0].runs.length, 3);
      assert.ok(fs.readFileSync(path.join(dir, 'h.html'), 'utf-8').includes('<table>'));
    } finally {
      relay.server.close();
    }
  });

  it('CLI: verify --html writes a shareable page', () => {
    const dir = tmp();
    const report = path.join(dir, 'r.json');
    fs.writeFileSync(report, JSON.stringify({ dataset_version: dataset.version, claimed: { model_id: 'claude-haiku-5-5' }, answers: GOOD }));
    const r = spawnSync(process.execPath, [CLI, 'verify', report, '--lang', 'en', '--output', path.join(dir, 'v.md'), '--html', path.join(dir, 'v.html')], { encoding: 'utf-8' });
    assert.strictEqual(r.status, 0, r.stderr);
    const page = fs.readFileSync(path.join(dir, 'v.html'), 'utf-8');
    assert.ok(page.includes('class="badge'));
    assert.ok(page.includes('Identity Verdict'));
  });
});
