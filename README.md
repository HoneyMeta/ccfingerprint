# CCFingerprint

🇨🇳 [中文](README.md) | 🇺🇸 [English](README_EN.md)

AI 模型身份指纹识别工具 - 通过自问自答验证模型真实身份

---

🌐 **[查看详细介绍](https://honeymeta.com/ccfingerprint)**

---

## 安装

```bash
npm install -g ccfingerprint
```

## 使用

```bash
# 先进入你的项目目录
cd /path/to/your/project

# 中文版 (默认)
ccfp init --ai claude
ccfp init --ai cursor
ccfp init --ai windsurf
ccfp init --ai copilot
ccfp init --ai kiro
ccfp init --ai codex

# 英文版
ccfp init --ai claude --lang en
ccfp init --ai cursor --lang en
ccfp init --ai kiro --lang en
ccfp init --ai codex --lang en

# 开始鉴别
# 在 AI 助手中输入: /fingerprint
```

## 选项

| 选项 | 描述 | 默认值 |
|------|------|--------|
| `--ai <type>` | 目标 AI (claude, cursor, windsurf, copilot, kiro, codex) | claude |
| `--lang <language>` | 语言 (zh, en) | zh |
| `--output <path>` | 输出目录 | . |

## 支持的 AI 助手

| AI 助手 | 生成文件 | 使用方式 |
|---------|----------|----------|
| Claude Code | `.claude/commands/fingerprint.md` | 输入 `/fingerprint` |
| Cursor | `.cursor/rules/fingerprint.mdc` | 输入 `/fingerprint` |
| Windsurf | `.windsurfrules` | 输入 `/fingerprint` |
| GitHub Copilot | `.github/copilot-instructions.md` | 输入 `/fingerprint` |
| Kiro | `.kiro/rules/fingerprint.md` | 输入 `/fingerprint` |
| OpenAI Codex | `AGENTS.md` | 输入 `/fingerprint` |

## 工作原理

四阶段身份验证流程：

### 阶段 1: 自我声明
模型回答关于自身的基本问题（模型 ID、上下文长度、知识截止日期等）

### 阶段 2: 知识边界测试
通过时间敏感问题（诺贝尔奖等）探测模型的真实知识截止日期

### 阶段 3: 能力推算
验证模型声称的能力参数是否合理

### 阶段 4: 第三方验证
模型以"LLM 专家"身份分析前三阶段的匿名报告，进行一致性检查

## 输出示例

最终输出为 Markdown 验证报告，包含：
- 基本信息表格
- 知识边界测试结果
- 能力验证结果
- 专家分析（一致性、知识截止推断、身份推断）
- 最终结论与可信度评分

## 许可证

MIT
