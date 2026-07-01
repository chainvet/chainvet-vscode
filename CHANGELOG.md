# Changelog

All notable changes to the Chainvet VS Code extension are documented here.

## 0.1.4 — Initial release

- Live static diagnostics for `.sol` files, powered by the `chainvet-lsp` language server.
- **Full Hybrid Scan** command — on-demand symbolic execution + fuzzing, surfacing Confirmed-tier findings.
- **Findings** panel in the Activity Bar: findings grouped by severity, tagged with confidence tier and provenance, click-to-navigate.
- **Filter by Tier** — All / Confirmed / Candidate.
- Standalone Solidity language registration — diagnostics work without a separate Solidity extension.
- Opt-in, local-[Ollama](https://ollama.com) AI review and fallback parser (off by default).
