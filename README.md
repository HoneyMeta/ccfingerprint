# CCFingerprint

🇨🇳 [中文](README.md) | 🇺🇸 [English](README_EN.md)

**你是不是经常感觉 AI 模型"降智"了？怀疑实际使用的模型被偷偷替换，并非服务商所宣称的那个？**

CCFingerprint 是一个 AI 模型身份指纹识别工具。它让模型作答一组探针，再由**本地脚本进行确定性评分**——不依赖模型自我声明、也不让模型自己当裁判——帮你判断 AI 助手背后的模型是否货真价实、是否被降级。

---

🌐 **[查看详细介绍](https://honeymeta.com/ccfingerprint)**

---

## v2.5 更新了什么？

- **一次检测多个端点：`ccfp run --config ccfp.config.json`**。把要测的中转（以及官方 API）写进一个 JSON 文件，ccfp 逐个探测，用同一次运行里测出的官方端点作基准逐个比较，每个端点一份报告，外加一张并排汇总表。key 仍然只放在环境变量里：配置文件里出现 key 会直接拒绝运行。
- **长期监控、发现悄悄换模型：`ccfp watch --every 6h`、`--history`、`ccfp history`**。每次检测给每个端点往历史文件追加一行。端点和上一次相比出现变化（canary 输入 token 数变了、出现新的 `model` 字段、自称身份变了、出现轮换路由、结论变差、能力通过率掉 25 个百分点以上、知识截止往前退 6 个月以上）时，ccfp 会列出变了什么；加 `--fail-on-drift` 时退出码为 2，方便 cron / CI 报警。
- **可分享的 HTML 报告**：`verify`、`probe`、`compare`、`history` 加 `--html report.html`（`run` 默认生成）会写出一个独立的网页：结论徽章、表格、浅色/深色模式，不依赖任何外部文件。可以直接发给中转卖家或丢进群里。
- **Claude 5 系列有测试兜底**：`claude-opus-5-5`、`claude-sonnet-5-5`、`claude-haiku-5-5`、`claude-fable-5-2` 在各家常见写法下（带日期后缀、`anthropic/…`、Bedrock 的 `us.anthropic.…-v1:0`、`[1m]`）都能正确识别。

## v2.4 更新了什么？

- **`ccfp probe`：直接检测 API 中转站**。不用装进助手，直接对 OpenAI 兼容接口（`/v1/chat/completions`）或 Anthropic 接口（`/v1/messages`）发探针：每题一个独立请求、不带工具，然后本地评分。除了答题内容，还检查接口本身的信号：返回的 `model` 字段、输入 token 数、`<think>` 标签、响应 id 格式。
- **发现混合 / 轮换路由**：同一个请求发几次，单一后端返回的输入 token 数必然一样；不一样就说明背后不止一个模型或分词器。`--runs N` 把整套题重复 N 轮，按最差一轮判定，并比较各轮的自称身份和能力通过率。
- **与官方基准对比**：先用官方 API 跑一次存成基准，再用 `--baseline` 比较中转。相同请求的 token 数一致 = 同一分词器；固定多出 N 个 = 中转注入了隐藏系统提示词；差值不固定 = 换了模型。
- **多端点对比**：`ccfp compare a.json b.json …` 把多个中转并排列成一张表。
- **适合 CI**：`--json` 输出机器可读结论，`--fail-under 75` 低于分数时退出码为 2。
- **快速模式**：`--quick`（`probe` 和 `init` 都支持）只用约一半的题（17 个请求，完整版 31 个），省钱省时间，三个难度等级都保留。
- **身份表更新到 2026 年 11 月**：Claude Fable 5.2（2026-11 发布，官方知识截止 2026-06）、Mythos 5.x、Gemini 3.7/3.8、Grok 4.7、DeepSeek V4.1、Qwen 3.8、Kimi K3.1、GLM-5.2/5.3、MiniMax M3/M3.1。v2.3 里 `claude-fable-5-2` 匹配不到任何身份。

## v2.3 更新了什么？

- **14 款助手都装成真正的 `/fingerprint` 命令**：各家助手已普遍改用 Agent Skills / 命令文件，所以每个目标都改为生成独立的、按需调用的命令。旧版写入的 `AGENTS.md`、`.windsurfrules`、`.clinerules`、`copilot-instructions.md` 都是"常驻规则"，会把整套探针注入**每一次**对话，还会覆盖这些文件原有内容；`init` 现在发现这类残留会提示你清理。
- **绝不覆盖你的文件**：目标文件已存在且不是 ccfingerprint 生成的，除非加 `--force`，否则跳过。
- **知识锚点更新到 2026 年 10 月**（Claude 5 / 5.5、GPT-6、Qwen3.8-Max、2026 年诺贝尔奖等）。
- **修正身份核验逻辑**：模型都是先训练、后发布，问模型"你自己是什么时候发布的"本来就答不出来，旧版因此会把真旗舰误判为冒牌。v2.3 改为检查：自称 X 的模型，必须知道 X 官方知识截止日期之前足够早的事件。
- **日期判分更稳**：`2025-08-07`、`Aug 2025`、`7 August 2025`、`2025年8月` 都能识别（±1 个月），"年份对、月份错"算"大致知道"而不算编造。
- **更难的能力探针**：2026 年的小模型也能轻松做对"球拍和球""数字母"，题库新增代码追踪、日历推算、骑士与无赖、容斥计数、中国剩余定理；提示词明确禁止用代码或工具解题。

## 安装

在你的项目里打开 AI 助手（Claude Code / Codex / Cursor / Copilot 等），直接对它说：

> **安装 https://github.com/HoneyMeta/ccfingerprint**

AI 会按下面的「给 AI 的安装步骤」自动完成安装。

### 给 AI 的安装步骤

1. 从 GitHub 安装命令行工具（需要 Node.js 20+ 和 git）：
   ```bash
   npm install -g github:HoneyMeta/ccfingerprint
   ```
2. 在用户的项目根目录，按你自己是哪个助手运行 `ccfp init`（类型对照下方「支持的 AI 助手」表，英文用户加 `--lang en`）：
   ```bash
   ccfp init --ai claude      # Claude Code；Codex 用 codex，Cursor 用 cursor……
   ```
   没有全局安装权限时，可以免安装直接运行：`npx -y github:HoneyMeta/ccfingerprint init --ai claude`。
3. 告诉用户输入 `/fingerprint`（Codex 为 `$fingerprint`）开始鉴定；部分客户端需要重启或重新加载窗口才能识别新命令。

> ⚠️ npm 上的 `ccfingerprint` 包停留在旧版 1.1.0，已不再维护（没有 `ccfp verify`），**请不要用 `npm install -g ccfingerprint`**，以 GitHub 为准。

手动安装就是上面第 1、2 步自己执行一遍。

## 使用（一步）

安装完成后，在 AI 助手里输入 **`/fingerprint`**（Codex 里是 **`$fingerprint`**）即可。模型会自动：
1. 凭内置知识作答全部探针；
2. 生成 `ccfp-report.json`；
3. **自己运行 `ccfp verify ccfp-report.json`**（找不到命令时改用 `npx -y github:HoneyMeta/ccfingerprint verify …`）；
4. 把确定性鉴定结论直接展示给你。

> 不能执行终端命令的助手，会生成 `ccfp-report.json` 并提示你手动运行 `ccfp verify ccfp-report.json`。

英文版加 `--lang en`，例如 `ccfp init --ai claude --lang en`；一次给所有助手安装用 `--ai all`。

## 直接检测 API 中转站（`ccfp probe`）

API key 只从环境变量读取（默认 `CCFP_API_KEY`），不会写进报告。

```bash
# bash / zsh
export CCFP_API_KEY=sk-...
# PowerShell
$env:CCFP_API_KEY="sk-..."

# OpenAI 兼容接口（大多数中转）
ccfp probe --base-url https://relay.example.com/v1 --model claude-opus-5-5

# Anthropic Messages 接口，快速模式，重复 3 轮查轮换路由
ccfp probe --api anthropic --base-url https://relay.example.com --model claude-opus-5-5 --quick --runs 3
```

`--base-url` 写到 `/v1` 或写域名都行。原始报告存到 `ccfp-report.json`（`--report` 可改），鉴定结论存到 `ccfp-verdict.md`。

**和官方 API 对比（最可靠）**：先用官方 key 跑一次存成基准，再用同样参数测中转：

```bash
ccfp probe --base-url https://api.anthropic.com --api anthropic --model claude-opus-5-5 --quick --report official.json
ccfp probe --base-url https://relay.example.com --api anthropic --model claude-opus-5-5 --quick --baseline official.json
```

基准和被测报告必须用同一版本 dataset、同一 `--lang`、同一探针集（都加或都不加 `--quick`），否则不比。ccfingerprint 不自带任何模型的"标准答案"指纹，基准要你自己用官方接口生成。

**多个中转对比**：

```bash
ccfp compare relay-a.json relay-b.json relay-c.json --baseline official.json
```

**接口信号说明**：

| 信号 | 含义 |
|------|------|
| 返回的 `model` 字段与请求不符 | 强替换信号。很多中转会把这个字段改成你请求的名字，所以"相符"不能证明什么 |
| 相同请求的输入 token 数不一致 | 背后不止一个后端（轮换路由，或在多个供应商之间负载均衡） |
| 与官方基准固定差 N 个 token | 中转注入了隐藏系统提示词或改写了请求 |
| 与官方基准差值不固定 | 分词器不同，基本可以确定是另一个模型 |
| Claude / GPT / Gemini 名下出现 `<think>` 标签 | DeepSeek / Qwen 类开源模型的输出特征 |
| Anthropic 接口返回的 id 不是 `msg_…` | 中转把其他协议转成了 Messages 格式（只作提示，不扣分） |

每题一个请求：完整版约 31 个，`--quick` 约 17 个，另加 3 个极短的 canary 请求（`--canary 0` 关闭）。`--runs N` 会把请求数乘以 N。

## 批量检测与长期监控（`ccfp run` / `ccfp watch`）

把端点写进一个 JSON 文件，例如 `ccfp.config.json`：

```json
{
  "lang": "zh",
  "quick": true,
  "model": "claude-opus-5-5",
  "baseline": "official",
  "out_dir": "ccfp-runs",
  "endpoints": [
    { "name": "official", "base_url": "https://api.anthropic.com", "api": "anthropic", "api_key_env": "ANTHROPIC_API_KEY" },
    { "name": "relay-a", "base_url": "https://relay-a.example.com", "api": "anthropic", "api_key_env": "RELAY_A_KEY" },
    { "name": "relay-b", "base_url": "https://relay-b.example.com/v1", "api_key_env": "RELAY_B_KEY" }
  ]
}
```

```bash
ccfp run --config ccfp.config.json                    # 所有端点各测一次
ccfp watch --config ccfp.config.json --every 6h       # 每 6 小时重复一次，Ctrl+C 停止
ccfp history ccfp-runs/history.jsonl --html history.html
```

- 顶层的键对所有端点生效，单个端点可以覆盖。键名就是 `ccfp probe` 的选项（下划线或驼峰都行）：`base_url`、`model`、`api`、`api_key_env`、`quick`、`runs`、`canary`、`concurrency`、`timeout`、`max_tokens`、`temperature`、`lang`、`baseline`。
- `baseline` 可以写同一文件里另一个端点的名字（它会先测），也可以写一个已保存报告的路径。输入 token 只在同协议的端点之间比较（上例的 `relay-b` 只比较能力和知识）。
- 运行设置：`out_dir`（默认 `ccfp-runs`）、`history`（默认 `<out_dir>/history.jsonl`）、`html`（默认 `true`）、`fail_under`、`fail_on_drift`。
- `out_dir` 里的输出：`<name>.json`（原始报告）、`<name>.md` / `<name>.html`（鉴定结论）、`summary.md` / `summary.html`（所有端点并排 + 变化）、`history.jsonl`。
- 缺 key 的端点会跳过并在汇总里列出，其余照常检测（最后退出码为 1）。
- 不想让 `watch` 一直挂着，可以用系统的定时任务（cron / 任务计划程序）跑 `ccfp run --config ccfp.config.json --fail-on-drift`。单个端点也行：`ccfp probe … --history history.jsonl --fail-on-drift`。

**和同一端点上一次检测相比，哪些算"变化"：**

| 变化 | 强弱 |
|------|------|
| canary 输入 token 数不同（同语言、同 dataset、同协议） | 强：分词器变了，或注入了新的隐藏系统提示词 |
| 出现以前从没返回过的 `model` 字段 | 强 |
| 自称身份变了 | 强 |
| 出现混合 / 轮换路由 | 强 |
| 结论变差（可信 → 存疑 → 不可信） | 强 |
| 可信度下降 15 分以上 | 弱 |
| 能力通过率下降 25 个百分点以上 | 弱 |
| 推断知识截止往前退 6 个月以上 | 弱 |

阈值都高于单次检测的正常波动，答错一两道题不会报警。`ccfp history --fail-on-drift` 只看每个端点最近一次检测，旧的异常不会让 CI 一直红着。

## 在 CI 里使用

```bash
ccfp verify ccfp-report.json --json --fail-under 75
ccfp probe --base-url "$RELAY_URL" --model claude-sonnet-5-5 --quick --json --fail-under 75
```

退出码：`0` 正常；`1` 参数或文件错误；`2` 可信度低于 `--fail-under`，或加了 `--fail-on-drift` 且与上次相比有变化。`--json` 把结论（等级、分数、疑点、接口信号）以 JSON 输出到 stdout，Markdown 仍会写到 `--output`。

## 命令

| 命令 | 描述 |
|------|------|
| `ccfp init --ai <type>` | 安装 `/fingerprint` 命令 |
| `ccfp verify [report]` | 对 `ccfp-report.json` 进行本地评分（默认读取当前目录） |
| `ccfp probe --base-url <url> --model <id>` | 直接探测一个 API 端点并评分 |
| `ccfp compare <reports...>` | 多个报告并排对比 |
| `ccfp run --config <file>` | 按配置文件检测所有端点、并排对比、记录历史 |
| `ccfp watch --config <file> --every <间隔>` | 定时重复 `run`（`30m`、`6h`、`1d`） |
| `ccfp history [file]` | 查看历史和每次之间的变化 |

### 选项

| 选项 | 适用命令 | 描述 | 默认值 |
|------|----------|------|--------|
| `--ai <type>` | init | 目标助手（见下表），或 `all` 一次装全部 | claude |
| `--lang <language>` | 全部 | 语言 (zh, en) | zh |
| `--output <path>` | 全部 | init: 输出目录；其他: Markdown 结论文件 | . / ccfp-verdict.md / ccfp-compare.md |
| `--force` | init | 覆盖不是 ccfingerprint 生成的同名文件 | 关 |
| `--quick` | init, probe | 快速探针集（约一半题目） | 关 |
| `--json` | verify, probe, compare, run, watch, history | 以 JSON 输出结论 | 关 |
| `--fail-under <score>` | verify, probe, compare, run, watch | 可信度低于该值时退出码为 2 | - |
| `--baseline <report>` | verify, probe, compare | 官方接口生成的基准报告 | - |
| `--api <protocol>` | probe | `openai` 或 `anthropic` | openai |
| `--api-key-env <name>` | probe | 存放 API key 的环境变量 | CCFP_API_KEY |
| `--runs <n>` | probe | 整套题重复 n 轮 | 1 |
| `--canary <n>` | probe | 用于检查 token 稳定性的相同短请求数 | 3 |
| `--concurrency <n>` | probe | 并发请求数 | 4 |
| `--max-tokens <n>` / `--temperature <t>` | probe | 默认 anthropic 发 2048、openai 不发；temperature 默认不发 | - |
| `--timeout <s>` | probe | 单个请求超时秒数 | 120 |
| `--report <path>` | probe | 原始报告保存位置 | ccfp-report.json |
| `--html <path>` | verify, probe, compare, history | 另存一份独立的 HTML 报告 | - |
| `--history <file>` | probe, run, watch | JSONL 历史文件，并检查与上次相比的变化 | run: `<out_dir>/history.jsonl` |
| `--fail-on-drift` | probe, run, watch, history | 与上次相比有变化时退出码为 2 | 关 |
| `--config <file>` | run, watch | 端点配置文件（JSON） | - |
| `--out-dir <dir>` | run, watch | 报告输出目录 | ccfp-runs |
| `--every <间隔>` / `--times <n>` | watch | 每轮间隔 / 跑 n 轮后停止 | - / 一直运行 |
| `--last <n>` | history | 每个端点显示的行数 | 20 |

## 支持的 AI 助手

| `--ai` | AI 助手 | 生成文件 | 调用方式 |
|--------|---------|----------|----------|
| `claude` | **Claude Code** | `.claude/skills/fingerprint/SKILL.md` | `/fingerprint` |
| `codex` | **OpenAI Codex** | `.agents/skills/fingerprint/SKILL.md`（+ `agents/openai.yaml`） | `$fingerprint` |
| `cursor` | Cursor | `.cursor/skills/fingerprint/SKILL.md` | `/fingerprint` |
| `copilot` | GitHub Copilot（VS Code） | `.github/prompts/fingerprint.prompt.md`（agent 模式） | `/fingerprint` |
| `windsurf` | Windsurf / Devin Desktop | `.windsurf/workflows/fingerprint.md` | `/fingerprint` |
| `cline` | Cline | `.cline/skills/fingerprint/SKILL.md` | `/fingerprint` |
| `kiro` | Kiro | `.kiro/skills/fingerprint/SKILL.md` | `/fingerprint` |
| `augment` | Augment Code | `.augment/commands/fingerprint.md` | `/fingerprint` |
| `trae` | Trae | `.trae/commands/fingerprint.md` | `/fingerprint` |
| `opencode` | OpenCode | `.opencode/commands/fingerprint.md` | `/fingerprint` |
| `qwen` | Qwen Code | `.qwen/commands/fingerprint.md` | `/fingerprint` |
| `roo` | Roo Code | `.roo/commands/fingerprint.md` | `/fingerprint` |
| `antigravity` | Google Antigravity | `.agents/skills/fingerprint/SKILL.md` | `/fingerprint` |
| `gemini` | Gemini CLI（企业版） | `.gemini/commands/fingerprint.toml` | `/fingerprint` |

Skill 文件设置了 `disable-model-invocation: true`，只有你主动调用时才会运行。

## 工作原理

```
ccfp init  →  /fingerprint  ┌─ 模型作答 → ccfp-report.json → 模型自己跑 ccfp verify ─┐ →  鉴定结论
 安装命令      (一条命令)     └──────────── 全部在一次 /fingerprint 内完成 ───────────┘    + ccfp-verdict.md
```

模型作答四类探针（提示词里**只有题目、没有答案**）：

1. **自我声明**：自报模型 ID、开发商、上下文长度、知识截止——仅作记录与比对，不作为可信依据。
2. **知识边界探针**：带日期锚点的时间敏感题，用于推断**真实**知识截止、检测"自信编造"，以及发现联网作弊（知道自称截止日期之后的事）。
3. **能力探针（降智检测）**：分难度等级、答案唯一可校验的题（计数、严格指令遵循、带干扰项的 needle 召回、代码追踪、日历推算、逻辑推理、数论）。通过率过低 = 疑似被换成更弱的模型。
4. **风格指纹**：ASCII 签名，供人工参考。

`ccfp verify` 离线读取报告，按内置答案键确定性打分，推断真实知识截止、计算能力通过率，核对"自称身份"与"表现出的知识"是否一致，最后给出 0–100 可信度评分与结论（可信 / 存疑 / 不可信）。**整个评分过程不经过被测模型。**

`ccfp probe` 生成的报告还带有每个请求的接口元数据（返回的 `model`、输入/输出 token 数、响应 id、耗时、是否有 `<think>`），`verify` 会额外检查上面"接口信号"表里的各项。多轮报告按最差一轮打分。

## 更新知识题库

全部数据都在 `src/dataset.json`：

- `knowledge`：带日期的知识探针（`date` + `check`）；"X 是什么时候发布的"这类题用 `{"month": "YYYY-MM"}`。
- `identities`：模型 ID 匹配规则，含发布月份，以及（若官方公布）知识截止月份。官方没公布截止日期的就不写 `cutoff`，按发布月份往前推算。
- 探针上的 `"quick": true` 表示它属于快速探针集。

随着模型知识截止前移，增补锚点与身份条目即可，无需改动代码。答案键只被 `ccfp verify` 使用，永远不会出现在模型看到的提示词中。

## 许可证

MIT
