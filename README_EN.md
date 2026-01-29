# CCFingerprint

🇨🇳 [中文](README.md) | 🇺🇸 [English](README_EN.md)

AI Model Identity Fingerprinting Tool - Verify model identity through self-Q&A

---

🌐 **[View Details](https://honeymeta.com/ccfingerprint)**

---

## Installation

```bash
npm install -g ccfingerprint
```

## Usage

```bash
# First, navigate to your project directory
cd /path/to/your/project

# Chinese version (default)
ccfp init --ai claude
ccfp init --ai cursor
ccfp init --ai windsurf
ccfp init --ai copilot
ccfp init --ai kiro
ccfp init --ai codex

# English version
ccfp init --ai claude --lang en
ccfp init --ai cursor --lang en
ccfp init --ai kiro --lang en
ccfp init --ai codex --lang en

# Start verification
# In the AI assistant, type: /fingerprint
```

## Options

| Option | Description | Default |
|--------|-------------|---------|
| `--ai <type>` | Target AI (claude, cursor, windsurf, copilot, kiro, codex) | claude |
| `--lang <language>` | Language (zh, en) | zh |
| `--output <path>` | Output directory | . |

## Supported AI Assistants

| AI Assistant | Generated File | Usage |
|--------------|----------------|-------|
| Claude Code | `.claude/commands/fingerprint.md` | Type `/fingerprint` |
| Cursor | `.cursor/rules/fingerprint.mdc` | Type `/fingerprint` |
| Windsurf | `.windsurfrules` | Type `/fingerprint` |
| GitHub Copilot | `.github/copilot-instructions.md` | Type `/fingerprint` |
| Kiro | `.kiro/rules/fingerprint.md` | Type `/fingerprint` |
| OpenAI Codex | `AGENTS.md` | Type `/fingerprint` |

## How It Works

Four-phase identity verification process:

### Phase 1: Self-Declaration
Model answers basic questions about itself (model ID, context length, knowledge cutoff, etc.)

### Phase 2: Knowledge Boundary Test
Probe the model's true knowledge cutoff date through time-sensitive questions (Nobel Prizes, etc.)

### Phase 3: Capability Inference
Verify whether the model's claimed capability parameters are reasonable

### Phase 4: Third-Party Verification
Model analyzes the anonymous report from the first three phases as an "LLM Expert" for consistency check

## Output Example

Final output is a Markdown verification report containing:
- Basic information table
- Knowledge boundary test results
- Capability verification results
- Expert analysis (consistency, knowledge cutoff inference, identity inference)
- Final conclusion with credibility score

## License

MIT
