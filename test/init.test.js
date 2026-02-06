import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { init } from '../src/init.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const tmpDir = path.join(__dirname, '.tmp-test');

const AI_TYPES = [
  'claude', 'cursor', 'windsurf', 'copilot', 'kiro', 'codex',
  'augment', 'cline', 'trae'
];

const EXPECTED_FILES = {
  claude: '.claude/commands/fingerprint.md',
  cursor: '.cursor/rules/fingerprint.mdc',
  windsurf: '.windsurfrules',
  copilot: '.github/copilot-instructions.md',
  kiro: '.kiro/rules/fingerprint.md',
  codex: 'AGENTS.md',
  augment: '.augment/fingerprint.md',
  cline: '.clinerules',
  trae: '.trae/rules/fingerprint.md'
};

describe('ccfp init', () => {
  before(() => {
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true });
    }
    fs.mkdirSync(tmpDir, { recursive: true });
  });

  after(() => {
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true });
    }
  });

  for (const ai of AI_TYPES) {
    it(`should generate fingerprint file for ${ai} (zh)`, async () => {
      const outputDir = path.join(tmpDir, `${ai}-zh`);
      fs.mkdirSync(outputDir, { recursive: true });

      // Mock process.exit to prevent test from exiting
      const originalExit = process.exit;
      process.exit = () => { throw new Error('process.exit called'); };

      try {
        await init({ ai, output: outputDir, lang: 'zh' });
      } finally {
        process.exit = originalExit;
      }

      const expectedFile = path.join(outputDir, EXPECTED_FILES[ai]);
      assert.ok(fs.existsSync(expectedFile), `File should exist: ${expectedFile}`);

      const content = fs.readFileSync(expectedFile, 'utf-8');
      assert.ok(content.includes('AI'), 'File should contain AI-related content');
      assert.ok(content.length > 100, 'File should have substantial content');
    });

    it(`should generate fingerprint file for ${ai} (en)`, async () => {
      const outputDir = path.join(tmpDir, `${ai}-en`);
      fs.mkdirSync(outputDir, { recursive: true });

      const originalExit = process.exit;
      process.exit = () => { throw new Error('process.exit called'); };

      try {
        await init({ ai, output: outputDir, lang: 'en' });
      } finally {
        process.exit = originalExit;
      }

      const expectedFile = path.join(outputDir, EXPECTED_FILES[ai]);
      assert.ok(fs.existsSync(expectedFile), `File should exist: ${expectedFile}`);

      const content = fs.readFileSync(expectedFile, 'utf-8');
      assert.ok(content.includes('AI'), 'File should contain AI-related content');
    });
  }
});
