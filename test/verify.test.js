import { describe, it } from 'node:test';
import assert from 'node:assert';
import { loadDataset } from '../src/init.js';
import { checkAnswer, isIDK, verifyReport, parseDates, monthValue, findIdentity } from '../src/verify.js';

const dataset = loadDataset();

const CORRECT_CAPABILITY = {
  letter_count: '7',
  instruction_strict: 'fox',
  needle: 'ZX9-QY7-KP3',
  string_transform: 'A-N-A-N-A-B',
  code_trace: '259',
  weekday_calc: 'Sunday',
  knights_knaves: 'knight',
  inclusion_exclusion: '400',
  crt: '654'
};

// What an honest model with a mid-2026 cutoff should answer.
const KNOWS_UNTIL_2026_05 = {
  nobel_physics_2024: 'Hopfield 和 Hinton',
  nobel_chemistry_2024: 'Baker, Hassabis, Jumper',
  gpt5_release: '2025-08-07',
  nobel_physics_2025: 'Clarke, Devoret, Martinis',
  nobel_chemistry_2025: 'Kitagawa, Robson, Yaghi',
  gemini3_release: 'November 18, 2025',
  claude_opus_46: '2026年2月',
  gpt55_release: 'April 2026',
  claude_opus_48: '2026年5月',
  claude_sonnet_5: "I don't know",
  claude_opus_5: "I don't know",
  qwen38_max: '不知道',
  gpt6_release: '不知道',
  claude_opus_55: "I don't know",
  nobel_physics_2026: '不知道',
  nobel_chemistry_2026: "I don't know"
};

describe('checkAnswer', () => {
  it('numeric matches regardless of surrounding text', () => {
    assert.strictEqual(checkAnswer('答案是 654', { numeric: 654 }), true);
    assert.strictEqual(checkAnswer('655', { numeric: 654 }), false);
  });
  it('exact ignores wrapping punctuation/case', () => {
    assert.strictEqual(checkAnswer('"Fox".', { exact: 'fox' }), true);
    assert.strictEqual(checkAnswer('brown', { exact: 'fox' }), false);
  });
  it('contains + reject catches the revoked distractor key', () => {
    assert.strictEqual(checkAnswer('the key is ZX9-QY7-KP3 ok', { contains: 'ZX9-QY7-KP3', reject: ['ZX9-QY7-KP2'] }), true);
    assert.strictEqual(checkAnswer('ZX9-QY7-KP2 / ZX9-QY7-KP3', { contains: 'ZX9-QY7-KP3', reject: ['ZX9-QY7-KP2'] }), false);
  });
  it('ASCII keywords match whole words only', () => {
    const spec = { any: ['yes'], reject: ['no'] };
    assert.strictEqual(checkAnswer('Yes — it does not depend on jumping', spec), true, '"not" must not count as "no"');
    assert.strictEqual(checkAnswer('No', spec), false);
    assert.strictEqual(checkAnswer('Geoffrey Hinton and Hopfield', { any: ['Hinton'] }), true);
    assert.strictEqual(checkAnswer('Hintonian', { any: ['Hinton'] }), false);
  });
  it('month checks accept any common date format within ±1 month', () => {
    const spec = { month: '2025-08' };
    for (const ok of ['2025-08-07', '2025/8', '2025年8月', 'August 2025', 'Aug 7, 2025', '7 August 2025', 'released 2025-09']) {
      assert.strictEqual(checkAnswer(ok, spec), true, ok);
    }
    assert.strictEqual(checkAnswer('sometime in 2025', spec), 'partial');
    assert.strictEqual(checkAnswer('2023年3月', spec), false);
  });
});

describe('date parsing', () => {
  it('parses claimed cutoffs in English and Chinese', () => {
    assert.strictEqual(monthValue('May 2026'), monthValue('2026-05'));
    assert.strictEqual(monthValue('2026年5月'), monthValue('2026-05'));
    assert.deepStrictEqual(parseDates('8月, 2025'), [{ year: 2025, month: 8 }]);
  });
});

describe('isIDK', () => {
  it('detects honest non-answers', () => {
    assert.ok(isIDK('我不知道'));
    assert.ok(isIDK("I don't know"));
    assert.ok(!isIDK('Geoffrey Hinton'));
  });
});

describe('identities', () => {
  it('matches the most specific identity first', () => {
    assert.strictEqual(findIdentity('claude-opus-5-5', dataset).label, 'Claude Opus 5.5');
    assert.strictEqual(findIdentity('claude-opus-5', dataset).label, 'Claude Opus 5');
    assert.strictEqual(findIdentity('gpt-6.1-sol', dataset).label, 'GPT-6.1');
    assert.strictEqual(findIdentity('gpt-6-astra', dataset).label, 'GPT-6');
    assert.strictEqual(findIdentity('gpt-5', dataset).label, 'GPT-5');
    assert.strictEqual(findIdentity('my-local-llm', dataset), null);
  });
});

describe('verifyReport end-to-end', () => {
  it('passes a healthy flagship that does not know its own release date', () => {
    const report = {
      claimed: { model_id: 'claude-opus-5-5', provider: 'Anthropic', knowledge_cutoff: 'June 2026' },
      answers: { ...KNOWS_UNTIL_2026_05, ...CORRECT_CAPABILITY }
    };
    const v = verifyReport(report, dataset);
    assert.strictEqual(v.identityMismatch, null);
    assert.strictEqual(v.capRatio, 1);
    assert.strictEqual(v.fabrications.length, 0);
    assert.ok(!v.knowsLater && !v.overclaimsCutoff, JSON.stringify(v.flags));
    assert.ok(v.confidence >= 75, `confidence ${v.confidence}`);
    assert.ok(v.conclusion.startsWith('可信'));
  });

  it('flags an old model wearing a new name (knowledge older than the claimed cutoff)', () => {
    const answers = { ...CORRECT_CAPABILITY };
    for (const id of Object.keys(KNOWS_UNTIL_2026_05)) answers[id] = '我不知道';
    answers.nobel_physics_2024 = 'Hopfield, Hinton';
    answers.nobel_chemistry_2024 = 'Baker, Hassabis, Jumper';
    const v = verifyReport({ claimed: { model_id: 'claude-opus-5-5', knowledge_cutoff: '2026-06' }, answers }, dataset);
    assert.ok(v.identityMismatch, 'identity mismatch expected');
    assert.ok(v.identityMismatch.missed.includes('gpt5_release'));
    assert.ok(!v.conclusion.startsWith('可信'));
  });

  it('flags a downgraded model: wrong capability + fabricated knowledge', () => {
    const report = {
      claimed: { model_id: 'gpt-6-astra', provider: 'OpenAI', knowledge_cutoff: '2026-04' },
      answers: {
        nobel_physics_2024: '我不知道',
        gpt5_release: '2023年发布',
        nobel_physics_2025: 'Albert Einstein',
        letter_count: '5',
        instruction_strict: 'The quick brown fox jumps',
        needle: 'ZX9-QY7-KP2',
        string_transform: 'BANANA',
        code_trace: '385',
        weekday_calc: '星期三',
        knights_knaves: 'knave',
        inclusion_exclusion: '466',
        crt: '1001'
      }
    };
    const v = verifyReport(report, dataset);
    assert.ok(v.capRatio < 0.5, 'capability ratio should be low');
    assert.ok(v.capDowngrade, 'should flag downgrade');
    assert.ok(v.fabrications.length >= 2);
    assert.ok(v.confidence < 50, `confidence ${v.confidence}`);
  });

  it('flags knowledge beyond the claimed cutoff (likely web search)', () => {
    const report = {
      claimed: { model_id: 'claude-opus-5-5', knowledge_cutoff: '2026-06' },
      answers: { ...KNOWS_UNTIL_2026_05, ...CORRECT_CAPABILITY, nobel_physics_2026: 'Francis Halzen (IceCube)' }
    };
    const v = verifyReport(report, dataset);
    assert.ok(v.knowsLater);
    assert.strictEqual(v.cutoff.latestKnown, '2026-10');
  });
});
