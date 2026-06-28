# CCFingerprint

🇨🇳 [中文](README.md) | 🇺🇸 [English](README_EN.md)

**你是不是经常感觉 AI 模型"降智"了？怀疑实际使用的模型被偷偷替换，并非服务商所宣称的那个？**

CCFingerprint 是一个 AI 模型身份指纹识别工具。它让模型作答一组探针，再由**本地脚本进行确定性评分**——不依赖模型自我声明、也不让模型自己当裁判——帮你判断 AI 助手背后的模型是否货真价实、是否被降级。

---

🌐 **[查看详细介绍](https://honeymeta.com/ccfingerprint)**

---

## v2 有什么不同？

v1 的思路是"问模型你是谁"，但这在今天有几个硬伤：能偷换模型的服务商同样能让便宜模型谎报身份；硬编码的冷知识会过期；而且让模型给自己打分毫无意义。v2 改变了方法论：

- **能力天花板探针**：用一批"便宜模型会做错、目标旗舰会做对"的题来**检测降智**——你不需要认出确切是哪个模型，只需要发现它能力掉档了。
- **本地确定性评分**：模型只负责作答，评判交给 `ccfp verify`。答案键（answer key）保存在工具内部，**不会出现在模型看到的提示词里**，避免被运行环境里的编程 Agent 直接抄答案。
- **可滚动更新的知识锚点**：知识题集中在 `src/dataset.json`，带日期锚点，便于随时间更新。
- **诚实度检测**：区分"坦诚说不知道"与"自信编造错误答案"，后者是身份造假的强信号。

## 安装

```bash
npm install -g ccfingerprint
```

## 使用（两步）

```bash
# 1. 在你的项目目录安装 /fingerprint 提示词
cd /path/to/your/project
ccfp init --ai claude          # 或 cursor / windsurf / copilot / kiro / codex / augment / cline / trae

# 2. 在 AI 助手里运行
#    /fingerprint
#    模型答完题后会在项目根目录生成 ccfp-report.json

# 3. 回到终端，进行本地确定性评分
ccfp verify ccfp-report.json
#    输出鉴定结论，并保存为 ccfp-verdict.md
```

英文版加 `--lang en`，例如 `ccfp init --ai claude --lang en`。

## 命令

| 命令 | 描述 |
|------|------|
| `ccfp init --ai <type>` | 安装 `/fingerprint` 提示词 |
| `ccfp verify [report]` | 对 `ccfp-report.json` 进行本地评分（默认读取当前目录） |

### 选项

| 选项 | 描述 | 默认值 |
|------|------|--------|
| `--ai <type>` | 目标 AI (claude, cursor, windsurf, copilot, kiro, codex, augment, cline, trae) | claude |
| `--lang <language>` | 语言 (zh, en) | zh |
| `--output <path>` | init: 输出目录 / verify: 鉴定报告文件 | . / ccfp-verdict.md |

## 支持的 AI 助手

| AI 助手 | 生成文件 | 使用方式 |
|---------|----------|----------|
| Claude Code | `.claude/commands/fingerprint.md` | 输入 `/fingerprint` |
| Cursor | `.cursor/rules/fingerprint.mdc` | 输入 `/fingerprint` |
| Windsurf | `.windsurfrules` | 输入 `/fingerprint` |
| GitHub Copilot | `.github/copilot-instructions.md` | 输入 `/fingerprint` |
| Kiro | `.kiro/rules/fingerprint.md` | 输入 `/fingerprint` |
| OpenAI Codex | `AGENTS.md` | 输入 `/fingerprint` |
| Augment Code | `.augment/fingerprint.md` | 输入 `/fingerprint` |
| Cline | `.clinerules` | 输入 `/fingerprint` |
| Trae | `.trae/rules/fingerprint.md` | 输入 `/fingerprint` |

## 工作原理

```
ccfp init  →  /fingerprint  →  ccfp-report.json  →  ccfp verify  →  ccfp-verdict.md
 安装提示词     模型作答         机读作答报告          本地确定性评分      鉴定报告
```

模型作答四类探针（提示词里**只有题目、没有答案**）：

1. **自我声明**：自报模型 ID、开发商、上下文长度、知识截止——仅作记录与比对，不作为可信依据。
2. **知识边界探针**：带日期锚点的时间敏感题，用于推断**真实**知识截止；并检测"自信编造"。
3. **能力探针（降智检测）**：分难度等级、答案唯一可校验的硬题（计数、混合推理、严格指令遵循、needle 召回、逻辑推理）。通过率过低 = 疑似被换成更弱的模型。
4. **风格指纹**：ASCII 签名等风格信号，供人工参考。

`ccfp verify` 离线读取报告，按内置答案键确定性打分，推断真实知识截止、计算能力通过率、做一致性检查（自称 vs 表现），最后给出 0–100 可信度评分与结论（可信 / 存疑 / 不可信）。**整个评分过程不经过被测模型。**

## 更新知识题库

所有探针都在 `src/dataset.json`。随着模型知识截止前移，旧锚点会失去区分度——增删 `knowledge` 条目（带 `date` 与 `check`）即可，无需改动其他代码。`check` 字段是答案键，只被 `ccfp verify` 使用，永远不会出现在模型看到的提示词中。

## 许可证

MIT
