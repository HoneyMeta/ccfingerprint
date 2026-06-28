#!/usr/bin/env node

import { Command } from 'commander';
import { init, SUPPORTED_AI } from '../src/init.js';
import { verify } from '../src/verify.js';
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
  .description('Install the /fingerprint prompt for an AI assistant / 安装 /fingerprint 提示词')
  .option('--ai <type>', `Target AI (${SUPPORTED_AI.join(', ')})`, 'claude')
  .option('--lang <language>', 'Language (zh, en)', 'zh')
  .option('--output <path>', 'Output directory path / 输出目录', '.')
  .action(async (options) => {
    await init(options);
  });

program
  .command('verify [report]')
  .description('Score a fingerprint report deterministically / 对指纹报告进行本地确定性评分')
  .option('--lang <language>', 'Language (zh, en)', 'zh')
  .option('--output <path>', 'Verdict output file / 鉴定报告输出文件', 'ccfp-verdict.md')
  .action(async (report, options) => {
    await verify(report, options);
  });

program.parse();
