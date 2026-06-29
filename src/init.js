import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Claude Code and Codex first — the two assistants that can run the whole flow
// (answer -> save report -> run `ccfp verify`) in a single /fingerprint.
export const AI_CONFIGS = {
  claude:   { targetFile: '.claude/commands/fingerprint.md', mdc: false },
  codex:    { targetFile: 'AGENTS.md',                       mdc: false },
  cursor:   { targetFile: '.cursor/rules/fingerprint.mdc',   mdc: true  },
  windsurf: { targetFile: '.windsurfrules',                  mdc: false },
  copilot:  { targetFile: '.github/copilot-instructions.md', mdc: false },
  kiro:     { targetFile: '.kiro/rules/fingerprint.md',      mdc: false },
  augment:  { targetFile: '.augment/fingerprint.md',         mdc: false },
  cline:    { targetFile: '.clinerules',                     mdc: false },
  trae:     { targetFile: '.trae/rules/fingerprint.md',      mdc: false }
};

export const SUPPORTED_AI = Object.keys(AI_CONFIGS);

const MESSAGES = {
  zh: {
    unsupportedAI: (ai) => `错误: 不支持的 AI 类型 "${ai}"`,
    supportedTypes: `支持的类型: ${SUPPORTED_AI.join(', ')}`,
    createdDir: (dir) => `创建目录: ${dir}`,
    installed: '✓ 已安装指纹识别提示词',
    location: (p) => `  位置: ${p}`,
    usage: '使用方式（一步）:',
    step1: '  在 AI 助手中输入 /fingerprint',
    step2: '  → 模型会自动答题、生成 ccfp-report.json、运行 ccfp verify 并展示鉴定结论',
    step3: '  （若该助手不能执行终端命令，请手动运行: ccfp verify ccfp-report.json）'
  },
  en: {
    unsupportedAI: (ai) => `Error: Unsupported AI type "${ai}"`,
    supportedTypes: `Supported types: ${SUPPORTED_AI.join(', ')}`,
    createdDir: (dir) => `Created directory: ${dir}`,
    installed: '✓ Installed fingerprint prompt',
    location: (p) => `  Location: ${p}`,
    usage: 'Usage (one step):',
    step1: '  In your AI assistant, type /fingerprint',
    step2: '  -> it answers, writes ccfp-report.json, runs ccfp verify, and shows the verdict',
    step3: '  (if that assistant cannot run terminal commands, run it manually: ccfp verify ccfp-report.json)'
  }
};

export function loadDataset() {
  return JSON.parse(fs.readFileSync(path.join(__dirname, 'dataset.json'), 'utf-8'));
}

const TXT = {
  zh: {
    title: 'AI 模型身份指纹识别',
    intro: '当用户请求进行模型身份鉴定（输入 /fingerprint）时，严格执行以下流程。',
    rulesH: '强制规则（违反任意一条则结果无效）',
    rules: [
      '作答期间禁止联网搜索，所有答案必须出自你的内置知识与即时推理。',
      '禁止为了作答而查阅或读取任何文件、答案键（尤其是 ccfingerprint、node_modules、dataset.json）。允许在答题完成后运行 `ccfp verify` 命令。',
      '逐题独立作答，不知道就如实写"不知道"，禁止猜测或编造看似合理的答案。',
      '不要对自己评分。你的任务是如实作答，然后运行评分脚本；判定逻辑全部在 `ccfp verify` 里。'
    ],
    s1: '第 1 步 · 自我声明（你是谁）',
    s2: '第 2 步 · 知识边界探针（你知道什么）',
    s2note: '逐题作答。不知道请明确写"不知道"，不要编造。',
    s3: '第 3 步 · 能力探针（你能做到什么）',
    s3note: '这些题用于检测模型是否被降级。请严格按要求作答，只给被要求的内容。',
    s4: '第 4 步 · 风格指纹',
    s5: '第 5 步 · 保存报告并自动评分（一步完成）',
    s5note: '把以上全部答案填入下面的 JSON（每个探针 id 对应一条作答），保存为项目根目录下的 `ccfp-report.json`。不要在回答里粘贴分析，也不要自己打分。',
    after: '保存好 `ccfp-report.json` 后，**用你的终端/命令执行能力直接运行**：\n\n```bash\nccfp verify ccfp-report.json\n```\n\n然后把该命令输出的鉴定报告原样展示给用户，并用一句话点明结论（可信 / 存疑 / 不可信）。\n\n> 如果你（当前 AI 助手）无法执行终端命令，则保存好 `ccfp-report.json` 并提示用户自行运行上面的命令。'
  },
  en: {
    title: 'AI Model Identity Fingerprinting',
    intro: 'When the user requests identity verification (types /fingerprint), follow this procedure strictly.',
    rulesH: 'Mandatory rules (violating any one invalidates the result)',
    rules: [
      'No web search while answering. Every answer must come from your built-in knowledge and on-the-spot reasoning.',
      'Do not read any file or answer key to inform your answers (especially ccfingerprint, node_modules, dataset.json). You MAY run the `ccfp verify` command after you have answered.',
      'Answer each item independently. If you do not know, write "I don\'t know" — never guess or fabricate a plausible-looking answer.',
      'Do not grade yourself. Your job is to answer honestly, then run the scoring script; all judgment lives in `ccfp verify`.'
    ],
    s1: 'Step 1 · Self-declaration (who you are)',
    s2: 'Step 2 · Knowledge-boundary probes (what you know)',
    s2note: 'Answer each item. If you do not know, say "I don\'t know" — do not fabricate.',
    s3: 'Step 3 · Capability probes (what you can do)',
    s3note: 'These detect model downgrades. Follow each instruction exactly and output only what is asked.',
    s4: 'Step 4 · Style fingerprint',
    s5: 'Step 5 · Save the report and auto-score it (one step)',
    s5note: 'Fill every answer into the JSON below (one entry per probe id) and save it as `ccfp-report.json` in the project root. Add no analysis and do not score yourself.',
    after: 'Once `ccfp-report.json` is saved, **run this yourself using your terminal/command capability**:\n\n```bash\nccfp verify ccfp-report.json\n```\n\nThen show the user the verdict that command prints, and state the conclusion in one line (trustworthy / questionable / not trustworthy).\n\n> If you (the current AI assistant) cannot execute terminal commands, just save `ccfp-report.json` and tell the user to run the command above themselves.'
  }
};

function numberedList(items, lang) {
  return items.map((it, i) => `${i + 1}. ${it[`prompt_${lang}`]}`).join('\n');
}

export function buildPrompt(ai, lang, dataset) {
  const t = TXT[lang] || TXT.zh;
  const cfg = AI_CONFIGS[ai];
  const p = (q) => q[`prompt_${lang}`];

  // Report schema: every probe id maps to a string answer
  const answerIds = [
    ...dataset.knowledge.map((q) => q.id),
    ...dataset.capability.map((q) => q.id),
    ...dataset.behavior.map((q) => q.id)
  ];
  const answersStub = answerIds.map((id) => `    "${id}": ""`).join(',\n');

  const body = `# ${t.title}

${t.intro}

> dataset ${dataset.version} · updated ${dataset.updated}

## ${t.rulesH}

${t.rules.map((r) => `- ${r}`).join('\n')}

---

## ${t.s1}

${numberedList(dataset.self_declare, lang)}

## ${t.s2}

${t.s2note}

${numberedList(dataset.knowledge, lang)}

## ${t.s3}

${t.s3note}

${dataset.capability.map((q, i) => `${i + 1}. ${p(q)}`).join('\n\n')}

## ${t.s4}

${dataset.behavior.map((q) => `- ${p(q)}`).join('\n')}

---

## ${t.s5}

${t.s5note}

\`\`\`json
{
  "dataset_version": "${dataset.version}",
  "claimed": {
${dataset.self_declare.map((q) => `    "${q.id}": ""`).join(',\n')}
  },
  "answers": {
${answersStub}
  }
}
\`\`\`

${t.after}
`;

  if (cfg.mdc) {
    return `---\ndescription: AI model identity fingerprint (/fingerprint)\nalwaysApply: false\n---\n\n${body}`;
  }
  return body;
}

export async function init(options) {
  const { ai, output = '.', lang = 'zh' } = options;
  const messages = MESSAGES[lang] || MESSAGES.zh;

  const config = AI_CONFIGS[ai];
  if (!config) {
    console.error(messages.unsupportedAI(ai));
    console.log(messages.supportedTypes);
    process.exit(1);
  }

  const dataset = loadDataset();
  const content = buildPrompt(ai, lang, dataset);

  const targetPath = path.join(output, config.targetFile);
  const targetDir = path.dirname(targetPath);

  if (targetDir && !fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
    console.log(messages.createdDir(targetDir));
  }

  fs.writeFileSync(targetPath, content, 'utf-8');
  console.log(messages.installed);
  console.log(messages.location(targetPath));

  console.log('\n' + messages.usage);
  console.log(messages.step1);
  console.log(messages.step2);
  console.log(messages.step3);
}
