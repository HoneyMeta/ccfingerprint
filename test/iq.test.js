import { describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import {
  buildTasks, gradeAnswer, extractAnswer, buildHaystack, gradeLongOutput, runIq, scoreIq, renderIq, iqJson,
  modelClass, buildSheet, gradeSheet, detectIqDrift, appendIqHistory, iqHistoryRecord, taskPrompt
} from '../src/iq.js';
import { parseResponse } from '../src/probe.js';
import { runOnce } from '../src/run.js';
import { readHistory, analyzeHistory } from '../src/history.js';

const CLI = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'ccfp.js');
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'ccfp-iq-'));

// Independent re-computation of a task's answer from its English prompt (guards prompt/answer drift).
function recompute(t) {
  const p = t.en;
  switch (t.kind) {
    case 'mul': {
      const [, a, b] = p.match(/of (\d+) × (\d+)/);
      return (BigInt(a) * BigInt(b)).toString();
    }
    case 'letters': {
      const [, ch] = p.match(/letter "(\w)"/);
      const s = p.split('\n')[1].replace(/ /g, '');
      return String([...s].filter((c) => c === ch).length);
    }
    case 'listops': {
      let list = p.match(/starts as \[([^\]]*)\]/)[1].split(', ').map(Number);
      for (const line of p.split('\n').slice(1)) {
        let m;
        if ((m = line.match(/append (\d+)/))) list.push(Number(m[1]));
        else if (/remove the first/.test(line)) list.shift();
        else if (/remove the last/.test(line)) list.pop();
        else if ((m = line.match(/swap the elements at positions (\d+) and (\d+)/))) {
          const [i, j] = [Number(m[1]) - 1, Number(m[2]) - 1];
          [list[i], list[j]] = [list[j], list[i]];
        } else if (/reverse/.test(line)) list.reverse();
        else if ((m = line.match(/insert (\d+) at position (\d+)/))) list.splice(Number(m[2]) - 1, 0, Number(m[1]));
        else if ((m = line.match(/rotate left by (\d+)/))) list = [...list.slice(Number(m[1])), ...list.slice(0, Number(m[1]))];
      }
      return `[${list.join(', ')}]`;
    }
    case 'modpow': {
      const [, a, b, m] = p.match(/Compute (\d+)\^(\d+) mod (\d+)/).map(Number);
      let r = 1;
      for (let i = 0; i < b; i++) r = (r * a) % m;
      return String(r);
    }
    case 'crt': {
      const pairs = [...p.matchAll(/n mod (\d+) = (\d+)/g)].map((m) => [Number(m[1]), Number(m[2])]);
      for (let n = 1; ; n++) if (pairs.every(([m, r]) => n % m === r)) return String(n);
    }
    case 'code': {
      const [, x0, y0] = p.match(/x, y = (\d+), (\d+)/).map(Number);
      const n = Number(p.match(/range\((\d+)\)/)[1]);
      const m = Number(p.match(/i\) % (\d+)/)[1]);
      const c = Number(p.match(/y = \(y \+ x\) % (\d+)/)[1]);
      let x = x0;
      let y = y0;
      for (let i = 0; i < n; i++) {
        x = x % 3 === 0 ? Math.floor(x / 3) + y : (x * 2 + i) % m;
        y = (y + x) % c;
      }
      return String(x * 1000 + y);
    }
    case 'dates': {
      const ds = [...p.matchAll(/(\d{4}-\d{2}-\d{2})/g)].map((m) => Date.parse(`${m[1]}T00:00:00Z`));
      if (t.level === 1) return ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][new Date(ds[1]).getUTCDay()];
      return String(Math.round((ds[1] - ds[0]) / 86400000));
    }
    case 'inclusion': {
      const [, N, a, b, c] = p.match(/from 1 to (\d+) inclusive are divisible by (\d+) or (\d+) but not by (\d+)/).map(Number);
      let k = 0;
      for (let i = 1; i <= N; i++) if ((i % a === 0 || i % b === 0) && i % c !== 0) k++;
      return String(k);
    }
    case 'sorting': {
      const words = p.split('\n')[1].split(' ');
      const k = Number(p.match(/position (\d+)/)[1]);
      const sorted = t.level === 2 ? [...words].sort() : [...words].sort((x, y) => x.length - y.length || y.localeCompare(x));
      return sorted[k - 1];
    }
    case 'base': {
      if (t.level === 2) return Number(p.match(/number (\d+)/)[1]).toString(7);
      return parseInt(p.match(/base-12 number (\w+)/)[1], 12).toString(5);
    }
    case 'knights': {
      const names = p.match(/people: ([^.]+)\./)[1].split(', ');
      const says = p.split('\n').filter((l) => / says: /.test(l)).map((l) => l.match(/says: "(.*)"/)[1]);
      const idx = (n) => names.indexOf(n);
      const sols = [];
      for (let mask = 0; mask < 1 << names.length; mask++) {
        const k = (i) => !!(mask & (1 << i));
        const truth = (s) => {
          let m;
          if ((m = s.match(/^(\w+) is a knight\.$/))) return k(idx(m[1]));
          if ((m = s.match(/^(\w+) is a knave\.$/))) return !k(idx(m[1]));
          if ((m = s.match(/^(\w+) and (\w+) are the same type\.$/))) return k(idx(m[1])) === k(idx(m[2]));
          if ((m = s.match(/^At least one of (\w+) and (\w+) is a knave\.$/))) return !k(idx(m[1])) || !k(idx(m[2]));
          if ((m = s.match(/^Exactly (\d+) of the \d+ of us are knights\.$/))) return names.filter((_, i) => k(i)).length === Number(m[1]);
          throw new Error(`unparsed: ${s}`);
        };
        if (says.every((s, i) => truth(s) === k(i))) sols.push(mask);
      }
      assert.strictEqual(sols.length, 1, 'knights puzzle must have exactly one solution');
      const ks = names.filter((_, i) => sols[0] & (1 << i));
      return ks.length ? ks.join(', ') : 'none';
    }
    default: throw new Error(t.kind);
  }
}

// A fake OpenAI-compatible endpoint. `mode`: 'good' answers everything and reasons; 'degraded' fails
// the hard tasks, reports no reasoning and only sees the second half of long prompts.
function fakeFetch({ seed, level, lang = 'en', mode = 'good', model = 'gpt-6.1' }) {
  const answers = new Map(buildTasks(seed, level).map((t) => [taskPrompt(t, lang), t]));
  const calls = [];
  const impl = async (url, init) => {
    const body = JSON.parse(init.body);
    calls.push(body);
    const prompt = body.messages.find((m) => m.role === 'user').content;
    let text = 'OK';
    let reasoning = mode === 'good' ? 900 : 0;
    let promptTokens = Math.round(prompt.length / 4);
    let finish = 'stop';
    const t = answers.get(prompt);
    if (t) {
      text = mode === 'degraded' && t.level === 3 ? 'Working…\nANSWER: 12345' : `Let me think.\nANSWER: ${t.answer}`;
      if (t.level === 1) reasoning = mode === 'good' ? 100 : 0;
    } else if (/access codes for vaults/.test(prompt)) {
      const seen = mode === 'degraded' ? prompt.slice(Math.floor(prompt.length * 0.6)) : prompt;
      if (mode === 'degraded') promptTokens = Math.round(seen.length / 4);
      const codes = Object.fromEntries([...seen.matchAll(/vault ([ABC]) is ([A-Z0-9-]+)\./g)].map((m) => [m[1], m[2]]));
      text = `ANSWER: A=${codes.A || '?'}, B=${codes.B || '?'}, C=${codes.C || '?'}`;
    } else if (/Output every integer from 1 to/.test(prompt)) {
      const n = mode === 'degraded' ? 700 : 1500;
      text = Array.from({ length: n }, (_, i) => i + 1).join(' ');
      finish = mode === 'degraded' ? 'length' : 'stop';
    }
    const res = {
      id: 'x', model, choices: [{ message: { role: 'assistant', content: text }, finish_reason: finish }],
      usage: { prompt_tokens: promptTokens, completion_tokens: reasoning + 40, completion_tokens_details: { reasoning_tokens: reasoning } }
    };
    return { ok: true, status: 200, text: async () => JSON.stringify(res) };
  };
  impl.calls = calls;
  return impl;
}

describe('iq task generation', () => {
  it('is reproducible from the seed and differs between seeds', () => {
    const a = buildTasks(123, 'standard');
    assert.deepStrictEqual(a, buildTasks(123, 'standard'));
    assert.notDeepStrictEqual(a.map((t) => t.answer), buildTasks(124, 'standard').map((t) => t.answer));
    assert.strictEqual(buildTasks(1, 'quick').length, 12);
    assert.strictEqual(a.length, 23);
    assert.strictEqual(buildTasks(1, 'full').length, 46);
    assert.ok(a.some((t) => t.level === 1) && a.some((t) => t.level === 3));
  });

  it('every prompt matches its expected answer (independent re-computation, 150 seeds)', () => {
    for (let seed = 1; seed <= 150; seed++) {
      for (const t of buildTasks(seed * 7919, 'standard')) {
        assert.strictEqual(recompute(t), t.answer, `${t.id} seed ${seed * 7919}`);
        assert.ok(gradeAnswer(t, `ANSWER: ${t.answer}`), `own answer must pass: ${t.id}`);
        assert.ok(t.zh && t.en && !/undefined|NaN/.test(t.zh + t.en), t.id);
      }
    }
  });

  it('rejects wrong answers', () => {
    for (const t of buildTasks(99, 'standard')) {
      const wrong = { int: '1', list: '[1, 2]', exact: 'zzzz', set: 'none', weekday: t.answer === 'Monday' ? 'Tuesday' : 'Monday' }[t.grade];
      if (t.answer === wrong || (t.grade === 'set' && t.answer === 'none')) continue;
      assert.ok(!gradeAnswer(t, `ANSWER: ${wrong}`), t.id);
    }
  });
});

describe('iq answer extraction', () => {
  it('takes the last ANSWER line and normalises it', () => {
    assert.strictEqual(extractAnswer('work\nANSWER: 5\nmore\n**Answer:** 1,234,567.'), '1,234,567');
    assert.strictEqual(extractAnswer('推理……\n答案：星期三'), '星期三');
    assert.strictEqual(extractAnswer('so the result is\n\\boxed{42}'), '42');
    const t = { grade: 'int', answer: '1234567' };
    assert.ok(gradeAnswer(t, 'ANSWER: 1,234,567'));
    assert.ok(gradeAnswer(t, 'ANSWER: 1 234 567'));
    assert.ok(gradeAnswer({ grade: 'weekday', answer: 'Sunday' }, '答案：周日'));
    assert.ok(gradeAnswer({ grade: 'set', answer: 'Ann, Cyd' }, 'ANSWER: Cyd and Ann'));
    assert.ok(!gradeAnswer({ grade: 'set', answer: 'Ann, Cyd' }, 'ANSWER: Ann, Ben, Cyd'));
    assert.ok(gradeAnswer({ grade: 'list', answer: '[3, 1, 2]' }, 'ANSWER: [3, 1, 2]'));
  });

  it('parses reasoning tokens and finish reasons from both protocols', () => {
    const o = parseResponse('openai', { model: 'm', choices: [{ message: { content: 'hi', reasoning_content: 'abc' }, finish_reason: 'length' }], usage: { prompt_tokens: 3, completion_tokens: 9, completion_tokens_details: { reasoning_tokens: 7 } } });
    assert.strictEqual(o.reasoning_tokens, 7);
    assert.strictEqual(o.reasoning_chars, 3);
    assert.strictEqual(o.finish_reason, 'length');
    const a = parseResponse('anthropic', { model: 'c', content: [{ type: 'thinking', thinking: 'hmm' }, { type: 'text', text: 'ok' }], stop_reason: 'max_tokens', usage: { input_tokens: 1, output_tokens: 2 } });
    assert.strictEqual(a.text, 'ok');
    assert.strictEqual(a.reasoning_chars, 3);
    assert.strictEqual(a.finish_reason, 'max_tokens');
  });
});

describe('iq haystack and long output', () => {
  it('builds a prompt of roughly the requested size with three ordered needles', () => {
    const h = buildHaystack(5, 20000);
    assert.ok(h.approxTokens > 18000 && h.approxTokens < 22000, String(h.approxTokens));
    const pos = ['A', 'B', 'C'].map((k) => h.prompt.indexOf(h.codes[k]));
    assert.ok(pos[0] > 0 && pos[0] < pos[1] && pos[1] < pos[2]);
    assert.ok(pos[0] < h.prompt.length * 0.1 && pos[2] > h.prompt.length * 0.9);
  });

  it('grades a long output by its longest correct prefix', () => {
    assert.deepStrictEqual(gradeLongOutput('1 2 3 4'), { reached: 4, complete: false });
    assert.strictEqual(gradeLongOutput(Array.from({ length: 1500 }, (_, i) => i + 1).join(' ')).complete, true);
    assert.strictEqual(gradeLongOutput('1 2 3 9 10').reached, 3);
  });
});

describe('iq scoring', () => {
  it('classifies model names', () => {
    assert.deepStrictEqual(modelClass('gpt-6.1-sol'), { frontier: true, reasoning: true });
    assert.deepStrictEqual(modelClass('gpt-5-mini'), { frontier: false, reasoning: true });
    assert.strictEqual(modelClass('gpt-5-chat-latest').reasoning, false);
    assert.strictEqual(modelClass('claude-opus-5-5').frontier, true);
    assert.strictEqual(modelClass('claude-haiku-5-5').frontier, false);
    assert.strictEqual(modelClass('llama-3-8b').frontier, false);
  });

  it('a healthy endpoint passes; a downgraded one is caught on every signal', async () => {
    const opts = { baseUrl: 'https://relay.example/v1', apiKey: 'k', model: 'gpt-6.1', lang: 'en', level: 'standard', seed: 77, context: 8000, longOutput: true };
    const good = await runIq({ ...opts, fetchImpl: fakeFetch({ seed: 77, level: 'standard' }) });
    const gv = scoreIq(good);
    assert.strictEqual(gv.score, 100);
    assert.strictEqual(gv.level, 'trustworthy', JSON.stringify(gv.flags));
    assert.strictEqual(gv.reasoning.median, 900);
    assert.deepStrictEqual(gv.context.found, { A: true, B: true, C: true });
    assert.strictEqual(gv.longOutput.complete, true);

    const bad = await runIq({ ...opts, fetchImpl: fakeFetch({ seed: 77, level: 'standard', mode: 'degraded' }) });
    const bv = scoreIq(bad);
    assert.strictEqual(bv.level, 'untrustworthy');
    assert.ok(bv.l3 === 0 && bv.l1 === 1);
    const kinds = bv.flags.map((f) => f.kind);
    for (const k of ['hard', 'reasoning', 'context', 'context-tokens', 'output']) assert.ok(kinds.includes(k), `${k} in ${kinds}`);

    const cmp = scoreIq(bad, { baseline: good });
    const ck = cmp.flags.filter((f) => f.strong).map((f) => f.kind);
    for (const k of ['baseline-score', 'baseline-hard', 'baseline-context', 'baseline-output']) assert.ok(ck.includes(k), `${k} in ${ck}`);
    assert.strictEqual(cmp.baseline.sameSeed, true);

    const md = renderIq(cmp, bad);
    assert.match(md, /降智 \/ downgraded/);
    assert.match(md, /官方基准 \/ Official baseline/);
    assert.strictEqual(iqJson(cmp).verdict, 'untrustworthy');
  });

  it('sends reasoning_effort / thinking only when asked, and never the key in the report', async () => {
    const f = fakeFetch({ seed: 3, level: 'quick' });
    const r = await runIq({ baseUrl: 'https://relay.example/v1?key=secret', apiKey: 'sk-secret', model: 'gpt-6.1', lang: 'en', level: 'quick', seed: 3, context: 0, reasoningEffort: 'high', fetchImpl: f });
    assert.ok(f.calls.every((b) => b.reasoning_effort === 'high'));
    assert.ok(!JSON.stringify(r).includes('secret'));
    const g = fakeFetch({ seed: 3, level: 'quick' });
    await runIq({ baseUrl: 'https://relay.example/v1', apiKey: 'k', model: 'gpt-6.1', lang: 'en', level: 'quick', seed: 3, context: 0, fetchImpl: g });
    assert.ok(g.calls.every((b) => !('reasoning_effort' in b)));
  });

  it('flags intermittent downgrades across rounds and treats mostly-failed runs as inconclusive', () => {
    const tasks = buildTasks(8, 'quick');
    const round = (passAll) => ({ results: tasks.map((t) => ({ id: t.id, pass: passAll || t.level < 3, meta: { reasoning_tokens: 500 } })) });
    const report = { seed: 8, level: 'quick', api: { model: 'gpt-6.1' }, tasks: tasks.map((t) => ({ id: t.id, level: t.level, expected: t.answer })), rounds: [round(true), round(false)], context: null, long_output: null };
    const v = scoreIq(report);
    assert.ok(v.flags.some((f) => f.kind === 'rounds' && f.strong), JSON.stringify(v.flags));
    const errs = { ...report, rounds: [{ results: tasks.map((t) => ({ id: t.id, pass: false, meta: { error: 'HTTP 502' } })) }] };
    const ev = scoreIq(errs);
    assert.strictEqual(ev.inconclusive, true);
    assert.strictEqual(ev.level, 'questionable');
  });

  it('spots hidden prompts on some requests (split channels), inflated billing and abbreviated output', () => {
    const tasks = buildTasks(21, 'quick');
    // every third request goes through a channel that adds ~5.7k hidden tokens and gets the task wrong
    const results = tasks.map((t, i) => ({ id: t.id, pass: i % 3 !== 0, meta: { reasoning_tokens: 400, prompt_chars: 200, prompt_tokens: i % 3 === 0 ? 5800 : 90 } }));
    const report = {
      seed: 21, level: 'quick', api: { model: 'gpt-6.1' }, tasks: tasks.map((t) => ({ id: t.id, level: t.level })), rounds: [{ results }],
      context: { approx_tokens: 21000, found: { A: true, B: true, C: true }, meta: { prompt_tokens: 62000, prompt_chars: 64000 } },
      long_output: { n: 1500, reached: 3, complete: false, meta: { finish_reason: 'stop', prompt_tokens: 80, prompt_chars: 260 } }
    };
    const v = scoreIq(report);
    const byKind = Object.fromEntries(v.flags.map((f) => [f.kind, f]));
    assert.ok(byKind['hidden-prompt-mixed']?.strong, JSON.stringify(v.flags));
    assert.match(byKind['hidden-prompt-mixed'].message, /4\/14/);
    assert.ok(byKind['context-billing'] && !byKind['context-billing'].strong);
    assert.ok(byKind['output-abbreviated']?.note);
    assert.ok(!byKind.output, 'a model that stops by itself is not a length cap');
    assert.match(byKind['hidden-prompt-mixed'].message, /0%（注入）\/ 100%（未注入）/);
    assert.strictEqual(v.level, 'untrustworthy');
    assert.strictEqual(v.channels.hidden.pass, 0);

    // a split that does not hurt accuracy proves mixed channels, not a downgrade: soft
    const even = { ...report, context: null, long_output: null, rounds: [{ results: results.map((x) => ({ ...x, pass: true })) }] };
    const ev = scoreIq(even);
    assert.ok(ev.flags.some((f) => f.kind === 'hidden-prompt-mixed' && !f.strong));
    assert.strictEqual(ev.level, 'questionable');

    // the same hidden prompt on every request is a relay wrapper, not a split: soft
    const all = { ...report, context: null, long_output: null, rounds: [{ results: results.map((x) => ({ ...x, pass: true, meta: { ...x.meta, prompt_tokens: 5800 } })) }] };
    const av = scoreIq(all);
    assert.ok(av.flags.some((f) => f.kind === 'hidden-prompt' && !f.strong));
    assert.strictEqual(av.level, 'questionable');

    // normal billing: no token flags at all
    const clean = { ...all, rounds: [{ results: results.map((x) => ({ ...x, meta: { ...x.meta, prompt_tokens: 90 } })) }] };
    assert.ok(!scoreIq(clean).flags.some((f) => /hidden|billing/.test(f.kind)));
  });

  it('a light model gets no absolute verdict, only a note', () => {
    const tasks = buildTasks(8, 'quick');
    const report = { seed: 8, level: 'quick', api: { model: 'gpt-5-nano' }, tasks: tasks.map((t) => ({ id: t.id, level: t.level })), rounds: [{ results: tasks.map((t) => ({ id: t.id, pass: false, meta: { reasoning_tokens: 300 } })) }], context: null, long_output: null };
    const v = scoreIq(report);
    assert.ok(!v.flags.some((f) => f.kind === 'hard'));
    assert.match(renderIq(v, report), /--baseline/);
  });
});

describe('iq history, sheet and run integration', () => {
  it('flags a later run that got worse', () => {
    const prev = { kind: 'iq', level: 'quick', score: 90, reasoning_median: 1200, context_found: 3, long_complete: true, verdict: 'trustworthy' };
    const cur = { ...prev, score: 55, reasoning_median: 80, context_found: 1, long_complete: false, verdict: 'untrustworthy' };
    const kinds = detectIqDrift(prev, cur).map((d) => d.kind);
    assert.deepStrictEqual(kinds, ['iq-score', 'iq-reasoning', 'iq-context', 'iq-output', 'iq-verdict']);
    assert.deepStrictEqual(detectIqDrift(prev, prev), []);
  });

  it('keeps iq records out of the probe history views', async () => {
    const dir = tmp();
    const file = path.join(dir, 'h.jsonl');
    const r = await runIq({ baseUrl: 'https://relay.example/v1', apiKey: 'k', model: 'gpt-6.1', lang: 'en', level: 'quick', seed: 4, context: 0, fetchImpl: fakeFetch({ seed: 4, level: 'quick' }) });
    const v = scoreIq(r);
    assert.deepStrictEqual(appendIqHistory(file, iqHistoryRecord(r, v)).drift, []);
    assert.strictEqual(readHistory(file).length, 1);
    assert.deepStrictEqual(analyzeHistory(readHistory(file)), []);
  });

  it('grades a pasted chat-app reply to the sheet', () => {
    const { text, tasks } = buildSheet(11, 'quick', 'zh');
    assert.match(text, /ANSWERS/);
    assert.ok(text.includes(tasks[0].zh));
    const reply = `我来逐题解答……\n\nANSWERS\n${tasks.map((t, i) => `${i + 1}: ${i === 1 ? 'wrong' : t.answer}`).join('\n')}`;
    const report = gradeSheet(reply, 11, 'quick', 'gpt-6.1');
    const v = scoreIq(report);
    assert.strictEqual(report.rounds[0].results.filter((x) => x.pass).length, tasks.length - 1);
    assert.ok(v.score > 85 && v.score < 100);
  });

  it('ccfp run with "iq" checks every endpoint on the same tasks and compares with the baseline', async () => {
    const dir = tmp();
    const seed = 2024;
    const good = fakeFetch({ seed, level: 'quick' });
    const bad = fakeFetch({ seed, level: 'quick', mode: 'degraded' });
    const fetchImpl = (url, init) => (url.includes('official') ? good(url, init) : bad(url, init));
    const raw = {
      iqSeed: seed,
      lang: 'en',
      quick: true,
      canary: 0,
      iq: { level: 'quick', context: 4000 },
      endpoints: [
        { name: 'relay', baseUrl: 'https://relay.example/v1', model: 'gpt-6.1', baseline: 'official' },
        { name: 'official', baseUrl: 'https://official.example/v1', model: 'gpt-6.1' }
      ]
    };
    const r = await runOnce(raw, { configDir: dir, env: { CCFP_API_KEY: 'k' }, fetchImpl });
    assert.ok(!r.error, r.error);
    const relay = r.results.find((x) => x.name === 'relay');
    assert.strictEqual(relay.iq.level, 'untrustworthy');
    assert.strictEqual(relay.iq.baseline.sameSeed, true);
    assert.ok(relay.iq.flags.some((f) => f.kind === 'baseline-hard'));
    assert.strictEqual(r.results.find((x) => x.name === 'official').iq.level, 'trustworthy');
    for (const f of ['relay.iq.json', 'relay.iq.md', 'relay.iq.html', 'iq-history.jsonl']) assert.ok(fs.existsSync(path.join(r.outDir, f)), f);
    assert.match(r.summary, /降智检测 \/ Downgrade check/);
  });

  it('CLI: --sheet then --grade, and --from re-scores a saved report', () => {
    const dir = tmp();
    const sheet = spawnSync(process.execPath, [CLI, 'iq', '--sheet', path.join(dir, 's.md'), '--seed', '9', '--lang', 'en'], { encoding: 'utf-8', cwd: dir });
    assert.strictEqual(sheet.status, 0, sheet.stderr);
    const tasks = buildTasks(9, 'quick');
    fs.writeFileSync(path.join(dir, 'reply.txt'), `ANSWERS\n${tasks.map((t, i) => `${i + 1}: ${t.answer}`).join('\n')}\n`);
    const graded = spawnSync(process.execPath, [CLI, 'iq', '--grade', 'reply.txt', '--seed', '9', '--model', 'gpt-6.1', '--json', '--report', 'r.json'], { encoding: 'utf-8', cwd: dir });
    assert.strictEqual(graded.status, 0, graded.stderr);
    const out = JSON.parse(graded.stdout);
    assert.strictEqual(out.score, 100);
    assert.strictEqual(out.verdict, 'trustworthy');
    const again = spawnSync(process.execPath, [CLI, 'iq', '--from', 'r.json', '--json', '--fail-under', '101'], { encoding: 'utf-8', cwd: dir });
    assert.strictEqual(again.status, 2);
    const missing = spawnSync(process.execPath, [CLI, 'iq', '--grade', 'reply.txt'], { encoding: 'utf-8', cwd: dir });
    assert.strictEqual(missing.status, 1);
  });
});
