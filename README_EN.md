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

# English version
ccfp init --ai claude --lang en
ccfp init --ai cursor --lang en
ccfp init --ai kiro --lang en

# Specify output directory
ccfp init --ai claude --output /path/to/project
```

## Options

| Option | Description | Default |
|--------|-------------|---------|
| `--ai <type>` | Target AI (claude, cursor, windsurf, copilot, kiro) | claude |
| `--lang <language>` | Language (zh, en) | zh |
| `--output <path>` | Output directory | . |

## Supported AI Assistants

| AI Assistant | Generated File | Usage |
|--------------|----------------|-------|
| Claude Code | `.claude/commands/fingerprint.md` | Type `/fingerprint` |
| Cursor | `.cursor/rules/fingerprint.mdc` | Ask "identify what model you are" |
| Windsurf | `.windsurfrules` | Ask "identify what model you are" |
| GitHub Copilot | `.github/copilot-instructions.md` | Ask "identify what model you are" |
| Kiro | `.kiro/rules/fingerprint.md` | Ask "identify what model you are" |

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
