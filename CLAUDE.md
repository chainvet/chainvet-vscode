# CLAUDE.md

Guidance for Claude Code (claude.ai/code) working in this repository.

## Overview

`chainvet-vscode` is the VS Code extension for
[Chainvet](https://github.com/chainvet/chainvet). It's a thin **language client**
(TypeScript) that spawns the **`chainvet-lsp`** binary and surfaces its diagnostics
plus a Findings tree view. All analysis lives in `chainvet-lsp` (main repo); this
repo is UI/glue only.

## Build & Run

```bash
npm install
npm run compile        # tsc -> out/extension.js   (npm run watch = rebuild on save)
# then press F5 in VS Code (.vscode/launch.json) to launch an Extension Dev Host
npx vsce package       # -> chainvet-<version>.vsix
```

Requires `chainvet-lsp` on PATH (or set the `chainvet.serverPath` setting).

## Layout

- `src/extension.ts` — the whole extension: starts the `LanguageClient`
  (`vscode-languageclient`), builds the `chainvetFindings` tree (`FindingsProvider`),
  and registers commands. Compiled to `out/extension.js` (the manifest's `main`).
- `package.json` — manifest: settings, the `chainvet` activity-bar view, and commands
  (`runHybridScan`, `filterConfidence`, `clearFindings`, `restartServer`).
- `media/` — icons + banner.

## How it consumes chainvet-lsp

- **Settings → env** for the spawned server (`buildEnv`): `chainvet.aiReports.enabled`
  →`CHAINVET_LLM_REPORT`, `aiFallbackParser.enabled`→`CHAINVET_LLM_FALLBACK_PARSER`,
  `ai.endpoint`→`CHAINVET_LLM_ENDPOINT`, `ai.model`→`CHAINVET_LLM_MODEL`.
- The Findings tree is fed by the LSP **`chainvet/publishFindings`** notification
  (structured rows: provenance/confidence/severity/kind/category/message/range); `runHybridScan`
  triggers the `chainvet.hybridScan` LSP command. Confidence filter: all / high / medium / low.

## Conventions

- Keep logic in `chainvet-lsp`; this repo stays a thin client. The `FindingItem` /
  notification shape is the LSP's contract — match it, don't diverge.
- The README's marketplace / open-vsx badges are **intentionally commented out** (not yet
  published) and the banner image is intentional — don't uncomment/revert them.
