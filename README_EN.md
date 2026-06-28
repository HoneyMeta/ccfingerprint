# CCFingerprint

🇨🇳 [中文](README.md) | 🇺🇸 [English](README_EN.md)

**Ever feel like your AI assistant suddenly got "dumber"? Suspect the model was secretly swapped and isn't actually what the provider claims?**

CCFingerprint makes the model answer a set of probes, then scores the answers **deterministically with a local script** — it does not rely on the model's self-declaration, and it never lets the model grade itself. This helps you tell whether the model behind your AI assistant is genuine, or has been quietly downgraded.

---

🌐 **[View Details](https://honeymeta.com/ccfingerprint)**

---

## What's new in v2?

v1 asked the model "who are you?", which fails today: a provider that can swap the model can also make a cheap model lie about its identity; hard-coded trivia goes stale; and letting a model grade itself is meaningless. v2 changes the methodology:

- **Capability-ceiling probes** — a battery of tasks a cheap model gets wrong but the claimed flagship gets right, used to **detect downgrades**. You don't need to identify the exact model; you only need to catch a capability drop.
- **Deterministic local scoring** — the model only answers; judgment is done by `ccfp verify`. The answer keys live inside the tool and **never appear in the prompt the model sees**, so a coding agent in the project can't just read them off.
- **Rolling knowledge anchors** — knowledge probes sit in `src/dataset.json` with date anchors, easy to refresh over time.
- **Honesty check** — distinguishes "honestly says I don't know" from "confidently fabricates a wrong answer"; the latter is a strong identity-spoofing signal.

## Installation

```bash
npm install -g ccfingerprint
```

## Usage (two steps)

```bash
# 1. Install the /fingerprint prompt in your project
cd /path/to/your/project
ccfp init --ai claude --lang en   # or cursor / windsurf / copilot / kiro / codex / augment / cline / trae

# 2. In your AI assistant, run
#    /fingerprint
#    The model answers and writes ccfp-report.json in the project root

# 3. Back in the terminal, score it deterministically
ccfp verify ccfp-report.json --lang en
#    Prints the verdict and saves ccfp-verdict.md
```

## Commands

| Command | Description |
|---------|-------------|
| `ccfp init --ai <type>` | Install the `/fingerprint` prompt |
| `ccfp verify [report]` | Score `ccfp-report.json` locally (defaults to current dir) |

### Options

| Option | Description | Default |
|--------|-------------|---------|
| `--ai <type>` | Target AI (claude, cursor, windsurf, copilot, kiro, codex, augment, cline, trae) | claude |
| `--lang <language>` | Language (zh, en) | zh |
| `--output <path>` | init: output dir / verify: verdict file | . / ccfp-verdict.md |

## Supported AI Assistants

| AI Assistant | Generated File | How to use |
|--------------|----------------|------------|
| Claude Code | `.claude/commands/fingerprint.md` | Type `/fingerprint` |
| Cursor | `.cursor/rules/fingerprint.mdc` | Type `/fingerprint` |
| Windsurf | `.windsurfrules` | Type `/fingerprint` |
| GitHub Copilot | `.github/copilot-instructions.md` | Type `/fingerprint` |
| Kiro | `.kiro/rules/fingerprint.md` | Type `/fingerprint` |
| OpenAI Codex | `AGENTS.md` | Type `/fingerprint` |
| Augment Code | `.augment/fingerprint.md` | Type `/fingerprint` |
| Cline | `.clinerules` | Type `/fingerprint` |
| Trae | `.trae/rules/fingerprint.md` | Type `/fingerprint` |

## How it works

```
ccfp init  →  /fingerprint  →  ccfp-report.json  →  ccfp verify  →  ccfp-verdict.md
install prompt   model answers   machine-readable      local scoring     verdict report
```

The model answers four kinds of probes (the prompt contains **only the questions, never the answers**):

1. **Self-declaration** — model ID, provider, context length, cutoff. Recorded for comparison only; not trusted on its own.
2. **Knowledge-boundary probes** — date-anchored, time-sensitive questions used to infer the *real* cutoff and to catch confident fabrication.
3. **Capability probes (downgrade detection)** — tiered, single-answer hard tasks (counting, mixed reasoning, strict instruction following, needle recall, logic). A low pass-rate = likely swapped for a weaker model.
4. **Style fingerprint** — ASCII signature and other style signals, for human reference.

`ccfp verify` reads the report offline, scores it against built-in answer keys, infers the real cutoff, computes the capability pass-rate, runs consistency checks (claimed vs demonstrated), and produces a 0–100 confidence score and a verdict (trustworthy / questionable / not trustworthy). **None of this scoring goes through the model under test.**

## Updating the probe set

All probes live in `src/dataset.json`. As model cutoffs advance, old anchors lose discriminative power — just add/remove `knowledge` entries (each with a `date` and a `check`), no other code changes needed. The `check` field is the answer key, used only by `ccfp verify`, and never rendered into the prompt the model sees.

## License

MIT
