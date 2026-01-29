#!/usr/bin/env node

import { Command } from 'commander';
import { init } from '../src/init.js';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const pkg = JSON.parse(readFileSync(join(__dirname, '../package.json'), 'utf-8'));

const program = new Command();

program
  .name('ccfp')
  .description('AI Model Identity Fingerprinting Tool / AI 模型身份指纹识别工具')
  .version(pkg.version);

program
  .command('init')
  .description('Initialize AI assistant fingerprint skill / 初始化 AI 助手的指纹识别技能')
  .option('--ai <type>', 'Target AI type (claude, cursor, windsurf, copilot, kiro, codex)', 'claude')
  .option('--lang <language>', 'Language (zh, en)', 'zh')
  .option('--output <path>', 'Output directory path / 输出目录路径', '.')
  .action(async (options) => {
    await init(options);
  });

program.parse();
