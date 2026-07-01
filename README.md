<p align="center">
  <img src="https://raw.githubusercontent.com/chainvet/chainvet-vscode/main/media/banner.png" alt="Chainvet" width="520">
</p>

<h1 align="center">Chainvet for VS Code</h1>

<p align="center">
  Hybrid Solidity smart-contract security analysis — static, symbolic, and fuzzing — right in your editor.
</p>

<p align="center">
  <a href="https://marketplace.visualstudio.com/items?itemName=chainvet.chainvet"><img src="https://img.shields.io/visual-studio-marketplace/v/chainvet.chainvet?label=VS%20Marketplace&color=7287fd" alt="VS Marketplace"></a>
  <a href="https://marketplace.visualstudio.com/items?itemName=chainvet.chainvet"><img src="https://img.shields.io/visual-studio-marketplace/i/chainvet.chainvet?color=7287fd" alt="Installs"></a>
  <a href="https://open-vsx.org/extension/chainvet/chainvet"><img src="https://img.shields.io/open-vsx/v/chainvet/chainvet?label=Open%20VSX&color=cba6f7" alt="Open VSX"></a>
  <a href="https://github.com/chainvet/chainvet/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue" alt="License"></a>
</p>

Chainvet analyzes Solidity contracts with three engines — **45+ static detectors**, **symbolic execution (Z3)**, and **coverage-guided fuzzing** — and surfaces the results as native diagnostics plus a dedicated Findings panel. Every finding carries a **confidence tier**: _Confirmed_ (validated by symbolic or dynamic evidence) or _Candidate_ (static heuristics only).

<!-- Add a short demo GIF for the best first impression — e.g. running a hybrid scan
     and clicking through the Findings panel. Record it, drop it at media/demo.gif, and
     uncomment:
<p align="center"><img src="https://raw.githubusercontent.com/chainvet/chainvet-vscode/main/media/demo.gif" width="820"></p>
-->

## Features

- **Live diagnostics** — static findings as you open, edit, and save `.sol` files, shown as inline squiggles and in the Problems panel.
- **Full Hybrid Scan on demand** — run symbolic execution + fuzzing on the current file (▶ in the editor title, or the Command Palette) to surface **Confirmed** vulnerabilities the live pass can't reach.
- **Findings panel** — a dedicated Activity Bar view grouping findings by severity, each tagged with its tier and the engine that found it; click a finding to jump to the exact location.
- **Filter by tier** — show All, Confirmed only, or Candidate only.
- **Works standalone** — Chainvet registers the Solidity language itself, so diagnostics work without any other extension (pair it with a Solidity syntax extension for highlighting).

## Requirements

Chainvet's analysis runs in a native language server, **`chainvet-lsp`**, which this extension launches. Install it so it's on your `PATH`:

```sh
# Linux (x86_64)
curl -fsSL https://install.chainvet.dev/install.sh | CHAINVET_BINS=chainvet-lsp sh
```

Or download `chainvet-lsp` from the [releases page](https://github.com/chainvet/chainvet/releases) and put it on your `PATH`. If it lives elsewhere, point `chainvet.serverPath` at the binary.

> Other platforms: build from source — `cargo build --release -p chainvet-lsp` (requires the Z3 system library) — until prebuilt binaries land. See the [Chainvet repository](https://github.com/chainvet/chainvet).

## Getting started

1. Install `chainvet-lsp` (above) and reload VS Code.
2. Open a `.sol` file — static findings appear as you type.
3. Run **Chainvet: Full Hybrid Scan (Current File)** (▶ in the editor title bar) for the deep symbolic + fuzzing pass.
4. Open the **Chainvet** view in the Activity Bar to browse findings; use the **funnel** to filter by tier.

## Commands

| Command | Description |
| --- | --- |
| `Chainvet: Full Hybrid Scan (Current File)` | Run the full static + symbolic + fuzzing pipeline on the active file |
| `Chainvet: Filter by Tier` | Filter the Findings view: All / Confirmed / Candidate |
| `Chainvet: Clear Findings` | Clear the Findings view and hybrid diagnostics |
| `Chainvet: Restart Language Server` | Restart `chainvet-lsp` (e.g. after changing settings) |

## Extension settings

| Setting | Default | Description |
| --- | --- | --- |
| `chainvet.serverPath` | `chainvet-lsp` | Path to the language-server binary |
| `chainvet.aiReports.enabled` | `false` | LLM review of findings via a local [Ollama](https://ollama.com) — drops likely false positives and annotates the rest (adds latency) |
| `chainvet.aiFallbackParser.enabled` | `false` | AI-assisted parsing when solc and tree-sitter both fail |
| `chainvet.ai.endpoint` | `http://127.0.0.1:11434` | Ollama endpoint for the AI features |
| `chainvet.ai.model` | `qwen2.5-coder:7b` | Ollama model for the AI features |

The AI features are **off by default** — with them off, Chainvet runs fully offline and deterministically.

## How it works

The extension is a thin language client. It launches `chainvet-lsp` over stdio; the server runs the analysis and publishes findings as LSP diagnostics (severities map High → Error, Medium → Warning, Low → Information) plus a structured notification the Findings panel consumes. The hybrid scan is a `workspace/executeCommand` the server handles — so the same capability is available to any LSP client (Neovim, IntelliJ, …), not just VS Code.

## Known limitations

- Prebuilt `chainvet-lsp` binaries are currently **x86_64 Linux** only; other platforms build from source.
- The hybrid scan runs on demand (it takes a few seconds); live diagnostics are static-only, for editor responsiveness.

## Release notes

See [CHANGELOG.md](CHANGELOG.md).

## License

[MIT](https://github.com/chainvet/chainvet/blob/main/LICENSE)
