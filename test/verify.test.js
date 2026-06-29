import { describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { checkAnswer, isIDK, verifyReport } from '../src/verify.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dataset = JSON.parse(
  fs.readFileSync(path.join(__dirname, '../src/dataset.json'), 'utf-8')
);

describe('checkAnswer', () => {
  it('numeric matches regardless of surrounding text', () => {
    assert.strictEqual(checkAnswer('答案是 0.05 元', { numeric: 0.05 }), true);
    assert.strictEqual(checkAnswer('0.10', { numeric: 0.05 }), false);
  });
  it('exact ignores wrapping punctuation/case', () => {
    assert.strictEqual(checkAnswer('"Fox".', { exact: 'fox' }), true);
    assert.strictEqual(checkAnswer('brown', { exact: 'fox' }), false);
  });
  it('contains finds the needle', () => {
    assert.strictEqual(checkAnswer('the key is ZX9-QY7-KP3 ok', { contains: 'ZX9-QY7-KP3' }), true);
  });
  it('any/all keyword groups', () => {
    assert.strictEqual(checkAnswer('Geoffrey Hinton 和 Hopfield', { any: ['辛顿', 'Hinton'] }), true);
    assert.strictEqual(checkAnswer('2025年8月发布', { all: [['2025'], ['8月', 'august']] }), true);
    assert.strictEqual(checkAnswer('2024年发布', { all: [['2025'], ['8月']] }), false);
  });
  it('any with reject rejects the opposite token', () => {
    assert.strictEqual(checkAnswer('否', { any: ['是', 'yes'], reject: ['否', 'no'] }), false);
    assert.strictEqual(checkAnswer('是的，必然成立', { any: ['是', 'yes'], reject: ['否', 'no'] }), true);
  });
});

describe('isIDK', () => {
  it('detects honest non-answers', () => {
    assert.ok(isIDK('我不知道'));
    assert.ok(isIDK("I don't know"));
    assert.ok(!isIDK('Geoffrey Hinton'));
  });
});

describe('verifyReport end-to-end', () => {
  it('flags a downgraded model: wrong capability + fabricated knowledge', () => {
    const report = {
      claimed: { model_id: 'gpt-5', provider: 'OpenAI', knowledge_cutoff: '2025-10' },
      answers: {
        nobel_physics_2024: '我不知道',
        gpt5_release: '2023年发布',          // fabricated (wrong)
        ball_bat: '0.10',                    // wrong (downgrade signal)
        letter_count: '5',                   // wrong
        mixed_arithmetic: '408',             // wrong
        instruction_strict: 'The quick brown fox jumps', // wrong (didn't follow)
        needle: 'I cannot find a key',       // wrong
        syllogism: '否',                      // wrong
        date_reasoning: '星期三'              // wrong
      }
    };
    const v = verifyReport(report, dataset);
    assert.ok(v.capRatio < 0.5, 'capability ratio should be low');
    assert.ok(v.capDowngrade, 'should flag downgrade');
    assert.ok(v.confidence < 50, 'confidence should be low');
  });

  it('flags identity mismatch: claims a model it has never heard of', () => {
    const report = {
      claimed: { model_id: 'claude-opus-4-8', provider: 'Anthropic', knowledge_cutoff: '2026-05' },
      answers: {
        // healthy capability + honest knowledge, but stops before its own claimed release
        gpt5_release: '2025年8月',
        gemini3_release: '2025年11月',
        claude_opus_46: '2026年2月',
        gpt55_release: '我不知道',
        claude_opus_48: '我不知道',
        ball_bat: '0.05', letter_count: '7', mixed_arithmetic: '708',
        instruction_strict: 'fox', needle: 'ZX9-QY7-KP3', syllogism: '是', date_reasoning: '星期一'
      }
    };
    const v = verifyReport(report, dataset);
    assert.strictEqual(v.identityMismatch, 'claude_opus_48');
    assert.ok(v.capRatio > 0.95, 'capability still fine');
    assert.ok(v.confidence < 75, 'identity mismatch should drag confidence below trustworthy');
    assert.ok(!v.conclusion.startsWith('可信'), 'should not be trustworthy');
  });

  it('passes a healthy flagship model', () => {
    const report = {
      claimed: { model_id: 'claude-opus-4-8', provider: 'Anthropic', knowledge_cutoff: '2026-05' },
      answers: {
        nobel_physics_2024: 'Hopfield 和 Hinton',
        nobel_chemistry_2024: 'Baker, Hassabis, Jumper',
        nobel_physics_2025: 'Clarke, Devoret, Martinis',
        nobel_chemistry_2025: 'Kitagawa, Robson, Yaghi',
        gpt5_release: '2025年8月',
        gemini3_release: '2025年11月',
        claude_opus_46: '2026年2月',
        gpt55_release: '2026年4月',
        claude_opus_48: '2026年5月，引入动态工作流',
        ball_bat: '0.05',
        letter_count: '7',
        mixed_arithmetic: '708',
        instruction_strict: 'fox',
        needle: 'ZX9-QY7-KP3',
        syllogism: '是',
        date_reasoning: '星期一'
      }
    };
    const v = verifyReport(report, dataset);
    assert.ok(v.capRatio > 0.95, 'capability ratio should be high');
    assert.ok(!v.capDowngrade, 'should not flag downgrade');
    assert.ok(v.confidence >= 75, 'confidence should be high');
    assert.strictEqual(v.conclusion.startsWith('可信'), true);
  });
});
