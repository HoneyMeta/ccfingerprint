# CCFingerprint

🇨🇳 [中文](README.md) | 🇺🇸 [English](README_EN.md)

**Ever feel like your AI assistant suddenly got "dumber"? Suspect the model was secretly swapped and isn't actually what the provider claims?**

CCFingerprint is an AI model identity fingerprinting tool that uses a four-phase self-Q&A test to make models prove their identity, helping you verify whether the AI assistant is actually what it claims to be.

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
ccfp init --ai augment
ccfp init --ai cline
ccfp init --ai trae

# English version
ccfp init --ai claude --lang en
ccfp init --ai cursor --lang en
ccfp init --ai kiro --lang en
ccfp init --ai codex --lang en
ccfp init --ai augment --lang en
ccfp init --ai cline --lang en
ccfp init --ai trae --lang en

# Start verification
# In the AI assistant, type: /fingerprint
```

## Options

| Option | Description | Default |
|--------|-------------|---------|
| `--ai <type>` | Target AI (claude, cursor, windsurf, copilot, kiro, codex, augment, cline, trae) | claude |
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
| Augment Code | `.augment/fingerprint.md` | Type `/fingerprint` |
| Cline | `.clinerules` | Type `/fingerprint` |
| Trae | `.trae/rules/fingerprint.md` | Type `/fingerprint` |

## How It Works

Four-phase identity verification process:

### Phase 1: Self-Declaration
Model answers basic questions about itself (model ID, context length, knowledge cutoff, etc.)

### Phase 2: Knowledge Boundary Test
Probe the model's true knowledge cutoff date through time-sensitive questions (Nobel Prizes, AI milestones, etc.)

### Phase 3: Capability Inference
Verify whether the model's claimed capability parameters are reasonable (context calculation, reasoning mode, tool calling, etc.)

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
