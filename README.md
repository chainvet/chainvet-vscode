# Chainvet — VS Code extension

Live Solidity security analysis in VS Code, powered by the
[Chainvet](https://github.com/chainvet/chainvet) language server (`chainvet-lsp`).
Findings appear as native diagnostics — inline squiggles and the Problems panel —
as you open, edit, and save `.sol` files.

## Prerequisites

Install the Chainvet language server so `chainvet-lsp` is on your `PATH`:

```bash
cargo install --git https://github.com/chainvet/chainvet chainvet-lsp
# or, from a workspace checkout: cargo build --release -p chainvet-lsp
```

(Requires the Z3 system library.) If the binary isn't on `PATH`, set
`chainvet.serverPath` to its absolute path.

## Install / run from source

```bash
npm install
npm run compile        # builds out/extension.js
```

Press <kbd>F5</kbd> in VS Code to launch an Extension Development Host, or package
a VSIX:

```bash
npx @vscode/vsce package
code --install-extension chainvet-0.1.0.vsix
```

## How it works

The extension is a thin language client: it launches `chainvet-lsp` over stdio and
lets it publish diagnostics for Solidity documents. Severities map High → Error,
Medium → Warning, Low/Info → Information. Settings are passed to the server as
environment variables, so AI features are opt-in per-workspace.

## Settings

| Setting | Default | Description |
| --- | --- | --- |
| `chainvet.serverPath` | `chainvet-lsp` | Path to the language-server binary |
| `chainvet.aiReports.enabled` | `false` | LLM review of findings (local Ollama; adds latency) |
| `chainvet.aiFallbackParser.enabled` | `false` | AI fallback parser when solc + tree-sitter both fail |
| `chainvet.ai.endpoint` | `http://127.0.0.1:11434` | Ollama endpoint for the AI features |
| `chainvet.ai.model` | `qwen2.5-coder:7b` | Ollama model for the AI features |

## Commands

| Command | What it does |
| --- | --- |
| `Chainvet: Restart Language Server` | Restart `chainvet-lsp` (e.g. after changing settings) |

## License

MIT — see the [Chainvet LICENSE](https://github.com/chainvet/chainvet/blob/main/LICENSE).
