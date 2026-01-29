# CCFingerprint

AI 模型身份指纹识别工具 - 通过自问自答验证模型真实身份

AI Model Identity Fingerprinting Tool - Verify model identity through self-Q&A

## 安装 / Installation

```bash
npm install -g ccfingerprint
```

## 使用 / Usage

```bash
# 中文版 (默认)
ccfp init --ai claude
ccfp init --ai cursor
ccfp init --ai windsurf
ccfp init --ai copilot

# English version
ccfp init --ai claude --lang en
ccfp init --ai cursor --lang en

# 指定输出目录 / Specify output directory
ccfp init --ai claude --output /path/to/project
ccfp init --ai claude --lang en --output /path/to/project
```

## 选项 / Options

| Option | Description | Default |
|--------|-------------|---------|
| `--ai <type>` | Target AI (claude, cursor, windsurf, copilot) | claude |
| `--lang <language>` | Language (zh, en) | zh |
| `--output <path>` | Output directory | . |

## 支持的 AI 助手 / Supported AI Assistants

| AI Assistant | Generated File | Usage |
|--------------|----------------|-------|
| Claude Code | `.claude/commands/fingerprint.md` | Type `/fingerprint` |
| Cursor | `.cursor/rules/fingerprint.mdc` | Ask "identify what model you are" |
| Windsurf | `.windsurfrules` | Ask "identify what model you are" |
| GitHub Copilot | `.github/copilot-instructions.md` | Ask "identify what model you are" |

## 工作原理 / How It Works

Four-phase identity verification process:

### Phase 1: Self-Declaration / 阶段 1: 自我声明
Model answers basic questions about itself (model ID, context length, knowledge cutoff, etc.)

### Phase 2: Knowledge Boundary Test / 阶段 2: 知识边界测试
Probe the model's true knowledge cutoff date through time-sensitive questions (Nobel Prizes, etc.)

### Phase 3: Capability Inference / 阶段 3: 能力推算
Verify whether the model's claimed capability parameters are reasonable

### Phase 4: Third-Party Verification / 阶段 4: 第三方验证
Model analyzes the anonymous report from the first three phases as an "LLM Expert" for consistency check

## 输出示例 / Output Example

Final output is a Markdown verification report containing:
- Basic information table / 基本信息表格
- Knowledge boundary test results / 知识边界测试结果
- Capability verification results / 能力验证结果
- Expert analysis (consistency, knowledge cutoff inference, identity inference) / 专家分析
- Final conclusion with credibility score / 最终结论与可信度评分

## License

MIT
