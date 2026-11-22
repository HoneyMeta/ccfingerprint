# Changelog

## 2.5.0 (2026-11-22)

- `ccfp run --config <file>`: probe several endpoints from one JSON config, compare each relay with an official endpoint probed in the same run (`"baseline": "<endpoint name>"`), write one report per endpoint plus `summary.md` / `summary.html`. API keys stay in environment variables; a config containing a key is refused. An endpoint with a missing key is skipped and listed; the rest still run.
- `ccfp watch --config <file> --every 6h [--times n]`: `run` on a timer.
- History and drift detection: `ccfp probe --history <file>` and every `run` append one JSON line per endpoint. Changes since the previous run of the same endpoint are flagged: canary prompt-token count, new `model` field, self-declared identity, rotating routing appearing, worse verdict (strong); confidence −15, capability −25 points, demonstrated knowledge 6+ months older (soft). `--fail-on-drift` exits with code 2.
- `ccfp history [file]`: per-endpoint timeline with the changes, as Markdown, `--json` or `--html`.
- `--html <path>` on `verify`, `probe`, `compare`, `history`: a self-contained, shareable HTML report with a verdict badge and light/dark mode.
- Tests pin the Claude 5 family ids (`claude-opus-5-5`, `claude-sonnet-5-5`, `claude-haiku-5-5`, `claude-fable-5-2`) in dated, `anthropic/…`, Bedrock and `[1m]` forms.

## 2.4.0 (2026-11-12)

- `ccfp probe`: probe an OpenAI-compatible or Anthropic endpoint directly; API signals (returned `model`, prompt-token stability, `<think>` tags, response ids).
- Rotating-routing detection (`--runs`), official baselines (`--baseline`), `ccfp compare`, `--json` / `--fail-under`, `--quick`.
- Identity table updated to November 2026.

## 2.3.1 (2026-10-08)

- Install from GitHub via the AI assistant; the npm package is no longer maintained.

## 2.3.0 (2026-10-08)

- Real `/fingerprint` commands for 14 assistants; never overwrites user files; fixed identity check; dataset 2026-10.

## 2.2.0 (2026-06-28)

- A single `/fingerprint`: the AI runs `ccfp verify` itself.

## 2.1.0 (2026-06-28)

- Knowledge anchors refreshed to mid-2026; identity self-knowledge check.

## 2.0.0 (2026-06-28)

- Redesign: capability probes plus deterministic local scoring.
