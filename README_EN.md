# CCFingerprint

🇨🇳 [中文](README.md) | 🇺🇸 [English](README_EN.md)

**Ever feel like your AI assistant suddenly got "dumber"? Suspect the model was secretly swapped and isn't actually what the provider claims?**

CCFingerprint makes the model answer a set of probes, then scores the answers **deterministically with a local script** — it does not rely on the model's self-declaration, and it never lets the model grade itself. This helps you tell whether the model behind your AI assistant is genuine, or has been quietly downgraded.

---

🌐 **[View Details](https://honeymeta.com/ccfingerprint)**

---

## What's new in v2.5

- **Many endpoints in one run: `ccfp run --config ccfp.config.json`.** List your relays (and the official API) in one JSON file. ccfp probes each of them, compares every relay with the official endpoint probed in the same run, and writes one report per endpoint plus a side-by-side summary. Keys stay in environment variables: a config file that contains a key is refused.
- **Catch silent swaps over time: `ccfp watch --every 6h`, `--history`, `ccfp history`.** Every run appends one line per endpoint to a history file. When an endpoint changes between runs (a different canary token count, a new `model` field, a different self-declared identity, rotating routing appearing, a worse verdict, a capability drop of 25+ points, knowledge that moved 6+ months back), ccfp says what changed, and `--fail-on-drift` exits with code 2 so cron or CI can alert you.
- **Shareable HTML reports.** `--html report.html` on `verify`, `probe`, `compare` and `history` (and by default in `run`) writes one self-contained page: verdict badge, tables, light/dark mode, no external files. Send it to the relay seller or drop it in a group chat.
- **Claude 5 family pinned by tests**: `claude-opus-5-5`, `claude-sonnet-5-5`, `claude-haiku-5-5` and `claude-fable-5-2` are recognised in the forms vendors and relays use (dated suffixes, `anthropic/…`, Bedrock `us.anthropic.…-v1:0`, `[1m]`).

## What's new in v2.4

- **`ccfp probe`: test an API relay directly.** No assistant needed. It sends the probes to an OpenAI-compatible endpoint (`/v1/chat/completions`) or an Anthropic endpoint (`/v1/messages`), one fresh request per probe with no tools, and scores the answers locally. It also checks signals from the API itself: the returned `model` field, prompt-token counts, `<think>` tags and response id format.
- **Mixed / rotating routing detection.** One backend always reports the same prompt-token count for the same request. If the count changes, there is more than one model or tokenizer behind the endpoint. `--runs N` repeats the whole probe set N times, judges by the worst run, and compares self-declared identity and capability between runs.
- **Official baseline comparison.** Run the probe once against the official API, save it, then pass it to `--baseline` when testing a relay. Identical token counts = same tokenizer. A constant extra N tokens = the relay injects a hidden system prompt. A varying difference = a different model.
- **Multi-endpoint comparison.** `ccfp compare a.json b.json …` puts several relays side by side in one table.
- **CI-friendly.** `--json` prints a machine-readable verdict; `--fail-under 75` exits with code 2 below that score.
- **Quick mode.** `--quick` (for both `probe` and `init`) uses about half the probes (17 requests instead of 31) and keeps all three difficulty tiers.
- **Identity table updated to November 2026**: Claude Fable 5.2 (released 2026-11, official cutoff 2026-06), Mythos 5.x, Gemini 3.7/3.8, Grok 4.7, DeepSeek V4.1, Qwen 3.8, Kimi K3.1, GLM-5.2/5.3, MiniMax M3/M3.1. In v2.3, `claude-fable-5-2` matched no identity at all.

## What's new in v2.3

- **Real `/fingerprint` commands for 14 assistants**. Assistants have converged on Agent Skills / command files, so every target now gets a dedicated, on-demand command instead of an always-on rules file. Older versions wrote into `AGENTS.md`, `.windsurfrules`, `.clinerules` and `copilot-instructions.md`, which injected the probe into *every* chat and overwrote those files; `init` now warns if such leftovers exist.
- **Never overwrites your files** — a target file that ccfingerprint did not generate is left alone unless you pass `--force`.
- **Knowledge anchors refreshed to October 2026** (Claude 5 / 5.5, GPT-6, Qwen3.8-Max, 2026 Nobel prizes …).
- **Fixed identity check** — models are trained before they are released, so asking a model about its *own* release date proved nothing and flagged genuine flagships. v2.3 instead checks that a model claiming identity X knows events that happened well before X's official knowledge cutoff.
- **Robust date scoring** — `2025-08-07`, `Aug 2025`, `7 August 2025` and `2025年8月` are all understood (±1 month), and a right-year-wrong-month answer counts as "roughly known" instead of fabrication.
- **Harder capability probes** — 2026 small models ace bat-and-ball and letter counting, so the battery now includes code tracing, calendar arithmetic, knights-and-knaves, inclusion–exclusion and a Chinese-remainder puzzle. Running code or tools to solve them is forbidden by the prompt.

## Installation

Open your AI assistant (Claude Code / Codex / Cursor / Copilot …) in your project and tell it:

> **Install https://github.com/HoneyMeta/ccfingerprint**

The assistant follows the "Install steps for AI assistants" below.

### Install steps for AI assistants

1. Install the CLI straight from GitHub (needs Node.js 20+ and git):
   ```bash
   npm install -g github:HoneyMeta/ccfingerprint
   ```
2. In the user's project root, run `ccfp init` for the assistant you are (see the "Supported AI Assistants" table; add `--lang en` for English):
   ```bash
   ccfp init --ai claude --lang en   # Claude Code; use codex for Codex, cursor for Cursor, …
   ```
   Without permission for a global install, run it directly instead: `npx -y github:HoneyMeta/ccfingerprint init --ai claude --lang en`.
3. Tell the user to type `/fingerprint` (`$fingerprint` in Codex). Some clients need a restart or window reload before a new command shows up.

> ⚠️ The `ccfingerprint` package on npm is stuck at the old 1.1.0 and no longer maintained (it has no `ccfp verify`). **Do not use `npm install -g ccfingerprint`** — GitHub is the source of truth.

To install manually, run steps 1 and 2 yourself.

## Usage (one step)

Once installed, type **`/fingerprint`** in your AI assistant (**`$fingerprint`** in Codex). The model will automatically:
1. answer every probe from its built-in knowledge;
2. write `ccfp-report.json`;
3. **run `ccfp verify ccfp-report.json` itself** (falling back to `npx -y github:HoneyMeta/ccfingerprint verify …`);
4. show you the deterministic verdict.

> If an assistant cannot run terminal commands, the model writes `ccfp-report.json` and asks you to run `ccfp verify ccfp-report.json` manually.

## Test an API relay directly (`ccfp probe`)

The API key is read only from an environment variable (`CCFP_API_KEY` by default) and is never written to the report.

```bash
# bash / zsh
export CCFP_API_KEY=sk-...
# PowerShell
$env:CCFP_API_KEY="sk-..."

# OpenAI-compatible endpoint (most relays)
ccfp probe --base-url https://relay.example.com/v1 --model claude-opus-5-5 --lang en

# Anthropic Messages endpoint, quick mode, 3 runs to catch rotating routing
ccfp probe --api anthropic --base-url https://relay.example.com --model claude-opus-5-5 --quick --runs 3 --lang en
```

`--base-url` may end in `/v1` or be just the host. The raw report goes to `ccfp-report.json` (change it with `--report`) and the verdict to `ccfp-verdict.md`.

**Compare with the official API (most reliable).** Run once with an official key and save it as the baseline, then test the relay with the same options:

```bash
ccfp probe --base-url https://api.anthropic.com --api anthropic --model claude-opus-5-5 --quick --lang en --report official.json
ccfp probe --base-url https://relay.example.com --api anthropic --model claude-opus-5-5 --quick --lang en --baseline official.json
```

The baseline and the tested report must use the same dataset version, the same `--lang` and the same probe set (both with or both without `--quick`); otherwise the baseline is ignored. ccfingerprint ships no reference fingerprints for any model. You make the baseline yourself from the official endpoint.

**Compare several relays:**

```bash
ccfp compare relay-a.json relay-b.json relay-c.json --baseline official.json --lang en
```

**What the API signals mean:**

| Signal | Meaning |
|--------|---------|
| Returned `model` field names another model | Strong substitution signal. Many relays rewrite this field to echo the request, so a match proves nothing |
| Same request, different prompt-token counts | More than one backend (rotating routing, or load-balancing across providers) |
| Constant +N tokens vs the official baseline | The relay injects a hidden system prompt or rewrites requests |
| Varying difference vs the official baseline | Different tokenizer: almost certainly a different model |
| `<think>` tags under a Claude / GPT / Gemini name | Typical output of DeepSeek / Qwen-style open models |
| Anthropic endpoint returns ids other than `msg_…` | The relay converts another protocol into Messages format (shown as a note, no penalty) |

One request per probe: about 31 for the full set, 17 with `--quick`, plus 3 tiny canary requests (`--canary 0` turns them off). `--runs N` multiplies the request count by N.

## Monitor several relays (`ccfp run` / `ccfp watch`)

Put the endpoints in a JSON file, for example `ccfp.config.json`:

```json
{
  "lang": "en",
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
ccfp run --config ccfp.config.json                    # probe all endpoints once
ccfp watch --config ccfp.config.json --every 6h       # repeat every 6 hours until stopped (Ctrl+C)
ccfp history ccfp-runs/history.jsonl --html history.html
```

- Top-level keys apply to every endpoint; an endpoint can override any of them. Keys are the `ccfp probe` options in snake_case or camelCase: `base_url`, `model`, `api`, `api_key_env`, `quick`, `runs`, `canary`, `concurrency`, `timeout`, `max_tokens`, `temperature`, `lang`, `baseline`.
- `baseline` is either the name of another endpoint in the same file (it is probed first) or the path of a saved report. Prompt tokens are only compared between endpoints on the same protocol (`relay-b` above is compared on capability and knowledge only).
- Run settings: `out_dir` (default `ccfp-runs`), `history` (default `<out_dir>/history.jsonl`), `html` (default `true`), `fail_under`, `fail_on_drift`.
- Output in `out_dir`: `<name>.json` (raw report), `<name>.md` / `<name>.html` (verdict), `summary.md` / `summary.html` (all endpoints side by side, plus what changed), `history.jsonl`.
- An endpoint whose key is missing is skipped and listed in the summary; the others still run (exit code 1 at the end).
- Prefer the system scheduler over a long-running `watch`? Run `ccfp run --config ccfp.config.json --fail-on-drift` from cron or Task Scheduler. A single endpoint works too: `ccfp probe … --history history.jsonl --fail-on-drift`.

**What counts as a change since the previous run of the same endpoint:**

| Change | Strength |
|--------|----------|
| Canary prompt-token count differs (same language, dataset and protocol) | strong: new tokenizer or a new hidden system prompt |
| A `model` field that was never returned before | strong |
| Self-declared identity changed | strong |
| Mixed / rotating routing appeared | strong |
| Verdict got worse (trustworthy → questionable → not trustworthy) | strong |
| Confidence fell by 15+ points | soft |
| Capability pass-rate fell by 25+ points | soft |
| Demonstrated knowledge moved 6+ months back | soft |

The thresholds sit above the normal noise of a probe run, so one unlucky answer does not raise an alarm. `ccfp history --fail-on-drift` only looks at the latest run of each endpoint, so an old incident does not keep CI red.

## Use in CI

```bash
ccfp verify ccfp-report.json --json --fail-under 75
ccfp probe --base-url "$RELAY_URL" --model claude-sonnet-5-5 --quick --json --fail-under 75
```

Exit codes: `0` ok; `1` bad arguments or files; `2` confidence below `--fail-under`, or a change since the previous run with `--fail-on-drift`. `--json` prints the verdict (level, score, flags, API signals) as JSON on stdout; the Markdown is still written to `--output`.

## Commands

| Command | Description |
|---------|-------------|
| `ccfp init --ai <type>` | Install the `/fingerprint` command |
| `ccfp verify [report]` | Score `ccfp-report.json` locally (defaults to current dir) |
| `ccfp probe --base-url <url> --model <id>` | Probe an API endpoint directly and score it |
| `ccfp compare <reports...>` | Compare several reports side by side |
| `ccfp run --config <file>` | Probe every endpoint in a config file, compare, record history |
| `ccfp watch --config <file> --every <interval>` | `run` on a timer (`30m`, `6h`, `1d`) |
| `ccfp history [file]` | Show the history and what changed between runs |

### Options

| Option | Commands | Description | Default |
|--------|----------|-------------|---------|
| `--ai <type>` | init | Target assistant (see table below) or `all` | claude |
| `--lang <language>` | all | Language (zh, en) | zh |
| `--output <path>` | all | init: output dir; others: Markdown verdict file | . / ccfp-verdict.md / ccfp-compare.md |
| `--force` | init | Overwrite a target file not generated by ccfingerprint | off |
| `--quick` | init, probe | Quick probe set (about half the probes) | off |
| `--json` | verify, probe, compare, run, watch, history | Print the verdict as JSON | off |
| `--fail-under <score>` | verify, probe, compare, run, watch | Exit with code 2 below this confidence | - |
| `--baseline <report>` | verify, probe, compare | Baseline report made against the official API | - |
| `--api <protocol>` | probe | `openai` or `anthropic` | openai |
| `--api-key-env <name>` | probe | Environment variable holding the API key | CCFP_API_KEY |
| `--runs <n>` | probe | Repeat the probe set n times | 1 |
| `--canary <n>` | probe | Identical short requests used to check token stability | 3 |
| `--concurrency <n>` | probe | Parallel requests | 4 |
| `--max-tokens <n>` / `--temperature <t>` | probe | Anthropic sends 2048 by default, OpenAI sends none; temperature is not sent by default | - |
| `--timeout <s>` | probe | Per-request timeout in seconds | 120 |
| `--report <path>` | probe | Where to save the raw report | ccfp-report.json |
| `--html <path>` | verify, probe, compare, history | Also write a self-contained HTML report | - |
| `--history <file>` | probe, run, watch | JSONL history file; flags changes since the previous run | run: `<out_dir>/history.jsonl` |
| `--fail-on-drift` | probe, run, watch, history | Exit with code 2 if an endpoint changed since its previous run | off |
| `--config <file>` | run, watch | Endpoint config (JSON) | - |
| `--out-dir <dir>` | run, watch | Where reports go | ccfp-runs |
| `--every <interval>` / `--times <n>` | watch | Interval between rounds / stop after n rounds | - / until stopped |
| `--last <n>` | history | Rows per endpoint | 20 |

## Supported AI Assistants

| `--ai` | Assistant | Generated file | Invoke |
|--------|-----------|----------------|--------|
| `claude` | **Claude Code** | `.claude/skills/fingerprint/SKILL.md` | `/fingerprint` |
| `codex` | **OpenAI Codex** | `.agents/skills/fingerprint/SKILL.md` (+ `agents/openai.yaml`) | `$fingerprint` |
| `cursor` | Cursor | `.cursor/skills/fingerprint/SKILL.md` | `/fingerprint` |
| `copilot` | GitHub Copilot (VS Code) | `.github/prompts/fingerprint.prompt.md` (agent mode) | `/fingerprint` |
| `windsurf` | Windsurf / Devin Desktop | `.windsurf/workflows/fingerprint.md` | `/fingerprint` |
| `cline` | Cline | `.cline/skills/fingerprint/SKILL.md` | `/fingerprint` |
| `kiro` | Kiro | `.kiro/skills/fingerprint/SKILL.md` | `/fingerprint` |
| `augment` | Augment Code | `.augment/commands/fingerprint.md` | `/fingerprint` |
| `trae` | Trae | `.trae/commands/fingerprint.md` | `/fingerprint` |
| `opencode` | OpenCode | `.opencode/commands/fingerprint.md` | `/fingerprint` |
| `qwen` | Qwen Code | `.qwen/commands/fingerprint.md` | `/fingerprint` |
| `roo` | Roo Code | `.roo/commands/fingerprint.md` | `/fingerprint` |
| `antigravity` | Google Antigravity | `.agents/skills/fingerprint/SKILL.md` | `/fingerprint` |
| `gemini` | Gemini CLI (enterprise) | `.gemini/commands/fingerprint.toml` | `/fingerprint` |

Skill files set `disable-model-invocation: true`, so the probe only runs when you ask for it. Codex ignores that key, so the description says "run only when the user invokes it"; `agents/openai.yaml` carries only the display name and no longer sets `policy.allow_implicit_invocation: false`, which made Codex hide the skill (see [#2](https://github.com/HoneyMeta/ccfingerprint/issues/2)). With `codex exec` in a shell, use single quotes (`codex exec '$fingerprint'`), otherwise the shell expands `$fingerprint` to an empty string.

## How it works

```
ccfp init  →  /fingerprint  ┌─ model answers → ccfp-report.json → model runs ccfp verify ─┐ →  verdict
install command (one step)  └──────────────── all inside a single /fingerprint ──────────┘   + ccfp-verdict.md
```

The model answers four kinds of probes (the prompt contains **only the questions, never the answers**):

1. **Self-declaration** — model ID, provider, context length, cutoff. Recorded for comparison only; not trusted on its own.
2. **Knowledge-boundary probes** — date-anchored, time-sensitive questions used to infer the *real* cutoff, to catch confident fabrication, and to spot web lookups (knowing events after the claimed cutoff).
3. **Capability probes (downgrade detection)** — tiered, single-answer tasks (counting, strict instruction following, needle recall with a decoy, code tracing, calendar arithmetic, logic, number theory). A low pass-rate = likely swapped for a weaker model.
4. **Style fingerprint** — ASCII signature, for human reference.

`ccfp verify` reads the report offline, scores it against built-in answer keys, infers the real cutoff, computes the capability pass-rate, checks the claimed identity against the knowledge it demonstrates, and produces a 0–100 confidence score and a verdict (trustworthy / questionable / not trustworthy). **None of this scoring goes through the model under test.**

Reports written by `ccfp probe` also carry per-request API metadata (returned `model`, prompt/completion tokens, response id, latency, whether `<think>` appeared), and `verify` checks the items in the "API signals" table above. Multi-run reports are scored by their worst run.

## Updating the probe set

Everything lives in `src/dataset.json`:

- `knowledge` — dated probes (`date` + `check`); use `{"month": "YYYY-MM"}` for "when was X released" questions.
- `identities` — model-ID patterns with their release month and, when published, the official knowledge cutoff. Leave `cutoff` out when the vendor has not published one; the check then counts back from the release month.
- `"quick": true` on a probe puts it in the quick probe set.

As model cutoffs advance, add new anchors and identities — no code changes needed. Answer keys are used only by `ccfp verify` and never rendered into the prompt the model sees.

## License

MIT
