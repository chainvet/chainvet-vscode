import * as vscode from "vscode";
import { execFile, ChildProcess } from "child_process";
import * as fs from "fs";
import {
  LanguageClient,
  LanguageClientOptions,
  ServerOptions,
  TransportKind,
} from "vscode-languageclient/node";

let client: LanguageClient | undefined;
let hybridDiagnostics: vscode.DiagnosticCollection;
let findingsProvider: FindingsProvider;

/** A finding row from `chainvet scan -f json` (only the fields we render). */
interface Finding {
  tier: string;
  provenance: string;
  kind: string;
  severity: string;
  category: string;
  message: string;
  file: string;
  start: number;
  end: number;
}

// ─── Language server (live static diagnostics) ──────────────────────────────

/** Map Chainvet settings to the environment the language server reads. */
function buildEnv(): NodeJS.ProcessEnv {
  const config = vscode.workspace.getConfiguration("chainvet");
  const env: NodeJS.ProcessEnv = { ...process.env };
  if (config.get<boolean>("aiReports.enabled")) {
    env.CHAINVET_AI_REPORT = "1";
  }
  if (config.get<boolean>("aiFallbackParser.enabled")) {
    env.CHAINVET_AI_FALLBACK_PARSER = "1";
  }
  const endpoint = config.get<string>("ai.endpoint");
  if (endpoint) {
    env.CHAINVET_AI_ENDPOINT = endpoint;
  }
  const model = config.get<string>("ai.model");
  if (model) {
    env.CHAINVET_AI_MODEL = model;
  }
  return env;
}

function makeClient(): LanguageClient {
  const serverPath = vscode.workspace
    .getConfiguration("chainvet")
    .get<string>("serverPath", "chainvet-lsp");

  const exec = {
    command: serverPath,
    transport: TransportKind.stdio,
    options: { env: buildEnv() },
  };
  const serverOptions: ServerOptions = { run: exec, debug: exec };
  const clientOptions: LanguageClientOptions = {
    documentSelector: [{ scheme: "file", language: "solidity" }],
  };
  return new LanguageClient("chainvet", "Chainvet", serverOptions, clientOptions);
}

// ─── Byte-offset → Position (start/end are UTF-8 byte offsets) ──────────────

function bytePosition(buf: Buffer, offset: number): vscode.Position {
  const clamped = Math.max(0, Math.min(offset, buf.length));
  const prefix = buf.subarray(0, clamped).toString("utf8");
  let line = 0;
  let lastNewline = -1;
  for (let i = 0; i < prefix.length; i++) {
    if (prefix.charCodeAt(i) === 10) {
      line++;
      lastNewline = i;
    }
  }
  return new vscode.Position(line, prefix.length - lastNewline - 1);
}

function byteRange(buf: Buffer, start: number, end: number): vscode.Range {
  return new vscode.Range(bytePosition(buf, start), bytePosition(buf, end));
}

function diagnosticSeverity(severity: string): vscode.DiagnosticSeverity {
  switch (severity) {
    case "high":
      return vscode.DiagnosticSeverity.Error;
    case "medium":
      return vscode.DiagnosticSeverity.Warning;
    default:
      return vscode.DiagnosticSeverity.Information;
  }
}

function severityColor(severity: string): vscode.ThemeColor {
  switch (severity) {
    case "high":
      return new vscode.ThemeColor("charts.red");
    case "medium":
      return new vscode.ThemeColor("charts.yellow");
    default:
      return new vscode.ThemeColor("charts.blue");
  }
}

function basename(p: string): string {
  const slash = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"));
  return slash >= 0 ? p.slice(slash + 1) : p;
}

// ─── Findings tree view ─────────────────────────────────────────────────────

class SeverityGroup {
  constructor(
    public readonly severity: string,
    public readonly findings: Finding[],
  ) {}
}

type TreeNode = SeverityGroup | Finding;

function isGroup(node: TreeNode): node is SeverityGroup {
  return (node as SeverityGroup).findings !== undefined;
}

class FindingsProvider implements vscode.TreeDataProvider<TreeNode> {
  private readonly emitter = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.emitter.event;
  private findings: Finding[] = [];

  setFindings(findings: Finding[]): void {
    this.findings = findings;
    this.emitter.fire();
  }

  clear(): void {
    this.findings = [];
    this.emitter.fire();
  }

  getChildren(node?: TreeNode): TreeNode[] {
    if (!node) {
      return ["high", "medium", "low"]
        .map((sev) => new SeverityGroup(sev, this.findings.filter((f) => f.severity === sev)))
        .filter((group) => group.findings.length > 0);
    }
    if (isGroup(node)) {
      return node.findings;
    }
    return [];
  }

  getTreeItem(node: TreeNode): vscode.TreeItem {
    if (isGroup(node)) {
      const label = node.severity.charAt(0).toUpperCase() + node.severity.slice(1);
      const item = new vscode.TreeItem(
        `${label} (${node.findings.length})`,
        vscode.TreeItemCollapsibleState.Expanded,
      );
      item.iconPath = new vscode.ThemeIcon("circle-large-filled", severityColor(node.severity));
      return item;
    }
    const item = new vscode.TreeItem(node.kind, vscode.TreeItemCollapsibleState.None);
    item.description = `${node.tier} · ${node.message}`;
    item.tooltip = new vscode.MarkdownString(
      `**${node.severity.toUpperCase()}** · ${node.tier} _(${node.provenance})_\n\n` +
        `${node.category} — \`${node.kind}\`\n\n${node.message}`,
    );
    item.iconPath = new vscode.ThemeIcon(
      node.tier === "confirmed" ? "pass-filled" : "circle-outline",
      severityColor(node.severity),
    );
    item.command = {
      command: "chainvet.openFinding",
      title: "Open Finding",
      arguments: [node],
    };
    return item;
  }
}

async function openFinding(finding: Finding): Promise<void> {
  const uri = vscode.Uri.file(finding.file);
  const doc = await vscode.workspace.openTextDocument(uri);
  const editor = await vscode.window.showTextDocument(doc);
  const range = byteRange(Buffer.from(doc.getText(), "utf8"), finding.start, finding.end);
  editor.selection = new vscode.Selection(range.start, range.end);
  editor.revealRange(range, vscode.TextEditorRevealType.InCenter);
}

// ─── On-demand hybrid scan (via the chainvet CLI) ───────────────────────────

function runCli(
  cli: string,
  file: string,
  token: vscode.CancellationToken,
): Promise<Finding[] | undefined> {
  return new Promise((resolve) => {
    const child: ChildProcess = execFile(
      cli,
      ["scan", "-m", "hybrid", "-f", "json", file],
      { maxBuffer: 64 * 1024 * 1024 },
      (error, stdout, stderr) => {
        if (token.isCancellationRequested) {
          resolve(undefined);
          return;
        }
        const out = (stdout || "").trim();
        if (!out.startsWith("{")) {
          const detail = stderr || (error && error.message) || "no output";
          vscode.window.showErrorMessage(`Chainvet scan failed: ${detail}`);
          resolve(undefined);
          return;
        }
        try {
          const report = JSON.parse(out) as { findings?: Finding[] };
          resolve(report.findings ?? []);
        } catch (e) {
          vscode.window.showErrorMessage(`Chainvet: could not parse scan output: ${String(e)}`);
          resolve(undefined);
        }
      },
    );
    token.onCancellationRequested(() => child.kill());
  });
}

async function runHybridScan(): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor || editor.document.languageId !== "solidity") {
    vscode.window.showWarningMessage("Chainvet: open a Solidity (.sol) file to run a hybrid scan.");
    return;
  }
  if (editor.document.isDirty) {
    await editor.document.save();
  }
  const file = editor.document.fileName;
  const cli = vscode.workspace.getConfiguration("chainvet").get<string>("cliPath", "chainvet");

  const findings = await vscode.window.withProgress<Finding[] | undefined>(
    {
      location: vscode.ProgressLocation.Notification,
      title: `Chainvet: hybrid scan of ${basename(file)}…`,
      cancellable: true,
    },
    (_progress, token) => runCli(cli, file, token),
  );
  if (!findings) {
    return;
  }

  const buf = fs.readFileSync(file);
  const diagnostics = findings.map((f) => {
    const diag = new vscode.Diagnostic(
      byteRange(buf, f.start, f.end),
      `[${f.tier}] ${f.message} (${f.kind})`,
      diagnosticSeverity(f.severity),
    );
    diag.source = "chainvet (hybrid)";
    diag.code = f.category;
    return diag;
  });
  hybridDiagnostics.set(vscode.Uri.file(file), diagnostics);
  findingsProvider.setFindings(findings);

  const confirmed = findings.filter((f) => f.tier === "confirmed").length;
  vscode.window.showInformationMessage(
    `Chainvet: ${findings.length} finding(s), ${confirmed} confirmed.`,
  );
}

// ─── Activation ─────────────────────────────────────────────────────────────

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  client = makeClient();
  await client.start();

  hybridDiagnostics = vscode.languages.createDiagnosticCollection("chainvet-hybrid");
  findingsProvider = new FindingsProvider();
  const treeView = vscode.window.createTreeView("chainvetFindings", {
    treeDataProvider: findingsProvider,
  });

  context.subscriptions.push(
    hybridDiagnostics,
    treeView,
    vscode.commands.registerCommand("chainvet.restartServer", async () => {
      if (!client) {
        return;
      }
      await client.stop();
      client = makeClient();
      await client.start();
      vscode.window.showInformationMessage("Chainvet language server restarted.");
    }),
    vscode.commands.registerCommand("chainvet.hybridScan", () => runHybridScan()),
    vscode.commands.registerCommand("chainvet.refreshFindings", () => runHybridScan()),
    vscode.commands.registerCommand("chainvet.clearFindings", () => {
      hybridDiagnostics.clear();
      findingsProvider.clear();
    }),
    vscode.commands.registerCommand("chainvet.openFinding", (finding: Finding) =>
      openFinding(finding),
    ),
  );
}

export function deactivate(): Thenable<void> | undefined {
  return client?.stop();
}
