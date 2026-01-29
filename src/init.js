import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const AI_CONFIGS = {
  claude: {
    template: { zh: 'claude.md', en: 'claude.en.md' },
    targetFile: '.claude/commands/fingerprint.md',
    description: { zh: 'Claude Code 技能文件', en: 'Claude Code skill file' }
  },
  cursor: {
    template: { zh: 'cursor.md', en: 'cursor.en.md' },
    targetFile: '.cursor/rules/fingerprint.mdc',
    description: { zh: 'Cursor 规则文件', en: 'Cursor rules file' }
  },
  windsurf: {
    template: { zh: 'windsurf.md', en: 'windsurf.en.md' },
    targetFile: '.windsurfrules',
    description: { zh: 'Windsurf 规则文件', en: 'Windsurf rules file' }
  },
  copilot: {
    template: { zh: 'copilot.md', en: 'copilot.en.md' },
    targetFile: '.github/copilot-instructions.md',
    description: { zh: 'GitHub Copilot 提示词', en: 'GitHub Copilot instructions' }
  }
};

const MESSAGES = {
  zh: {
    unsupportedAI: (ai) => `错误: 不支持的 AI 类型 "${ai}"`,
    supportedTypes: '支持的类型: claude, cursor, windsurf, copilot',
    templateNotFound: (path) => `错误: 模板文件不存在 "${path}"`,
    createdDir: (dir) => `创建目录: ${dir}`,
    installed: (desc) => `✓ 已安装 ${desc}`,
    location: (path) => `  位置: ${path}`,
    usage: '使用方式:',
    claudeUsage: '  在 Claude Code 中输入: /fingerprint',
    otherUsage: (ai) => `  在 ${ai} 中询问: "帮我鉴别一下你是什么模型"`
  },
  en: {
    unsupportedAI: (ai) => `Error: Unsupported AI type "${ai}"`,
    supportedTypes: 'Supported types: claude, cursor, windsurf, copilot',
    templateNotFound: (path) => `Error: Template file not found "${path}"`,
    createdDir: (dir) => `Created directory: ${dir}`,
    installed: (desc) => `✓ Installed ${desc}`,
    location: (path) => `  Location: ${path}`,
    usage: 'Usage:',
    claudeUsage: '  In Claude Code, type: /fingerprint',
    otherUsage: (ai) => `  In ${ai}, ask: "identify what model you are"`
  }
};

export async function init(options) {
  const { ai, output, lang = 'zh' } = options;
  const messages = MESSAGES[lang] || MESSAGES.zh;

  const config = AI_CONFIGS[ai];
  if (!config) {
    console.error(messages.unsupportedAI(ai));
    console.log(messages.supportedTypes);
    process.exit(1);
  }

  const templateFile = config.template[lang] || config.template.zh;
  const templatePath = path.join(__dirname, 'templates', templateFile);
  const targetPath = path.join(output, config.targetFile);
  const targetDir = path.dirname(targetPath);

  // 检查模板文件是否存在
  if (!fs.existsSync(templatePath)) {
    console.error(messages.templateNotFound(templatePath));
    process.exit(1);
  }

  // 创建目标目录
  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
    console.log(messages.createdDir(targetDir));
  }

  // 复制模板文件
  fs.copyFileSync(templatePath, targetPath);
  const description = config.description[lang] || config.description.zh;
  console.log(messages.installed(description));
  console.log(messages.location(targetPath));

  // 显示使用说明
  console.log('\n' + messages.usage);
  if (ai === 'claude') {
    console.log(messages.claudeUsage);
  } else {
    console.log(messages.otherUsage(ai));
  }
}
