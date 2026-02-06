import { describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const puzzlesDir = path.join(__dirname, '../src/puzzles');
const templatesDir = path.join(__dirname, '../src/templates');

describe('puzzles data integrity', () => {
  const puzzleFiles = ['self-declare.json', 'confusion.json', 'capability.json', 'verification.json'];

  for (const file of puzzleFiles) {
    it(`${file} should be valid JSON`, () => {
      const content = fs.readFileSync(path.join(puzzlesDir, file), 'utf-8');
      const data = JSON.parse(content);
      assert.ok(data.category || data.report_template, `${file} should have category or report_template`);
    });
  }

  it('confusion.json should have 2024, 2025 Nobel and AI milestone questions', () => {
    const data = JSON.parse(fs.readFileSync(path.join(puzzlesDir, 'confusion.json'), 'utf-8'));
    const ids = data.questions.map(q => q.id);
    assert.ok(ids.includes('nobel_physics_2024'), 'Should have 2024 Nobel Physics');
    assert.ok(ids.includes('nobel_physics_2025'), 'Should have 2025 Nobel Physics');
    assert.ok(ids.includes('gpt5_release'), 'Should have GPT-5 release question');
    assert.ok(ids.includes('claude_opus_46'), 'Should have Claude Opus 4.6 question');
  });

  it('capability.json should have reasoning and tool calling questions', () => {
    const data = JSON.parse(fs.readFileSync(path.join(puzzlesDir, 'capability.json'), 'utf-8'));
    const ids = data.questions.map(q => q.id);
    assert.ok(ids.includes('reasoning_mode'), 'Should have reasoning mode question');
    assert.ok(ids.includes('tool_calling'), 'Should have tool calling question');
  });
});

describe('templates completeness', () => {
  const AI_TYPES = ['claude', 'cursor', 'windsurf', 'copilot', 'kiro', 'codex', 'augment', 'cline', 'trae'];

  for (const ai of AI_TYPES) {
    it(`${ai} should have both zh and en templates`, () => {
      const zhFile = ai === 'claude' || ai === 'cursor'
        ? `${ai}.md`
        : `${ai}.md`;
      const enFile = `${ai}.en.md`;

      assert.ok(fs.existsSync(path.join(templatesDir, zhFile)), `${zhFile} should exist`);
      assert.ok(fs.existsSync(path.join(templatesDir, enFile)), `${enFile} should exist`);
    });

    it(`${ai} templates should contain updated Phase 2 content`, () => {
      const zhContent = fs.readFileSync(path.join(templatesDir, `${ai}.md`), 'utf-8');
      const enContent = fs.readFileSync(path.join(templatesDir, `${ai}.en.md`), 'utf-8');

      assert.ok(zhContent.includes('GPT-5'), `${ai}.md should mention GPT-5`);
      assert.ok(zhContent.includes('Claude Opus 4.6'), `${ai}.md should mention Claude Opus 4.6`);
      assert.ok(enContent.includes('GPT-5'), `${ai}.en.md should mention GPT-5`);
      assert.ok(enContent.includes('Claude Opus 4.6'), `${ai}.en.md should mention Claude Opus 4.6`);
    });
  }
});
