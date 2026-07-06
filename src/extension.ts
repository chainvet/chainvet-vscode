import * as vscode from "vscode";
import {
  LanguageClient,
  LanguageClientOptions,
  ServerOptions,
  TransportKind,
  ExecuteCommandRequest,
} from "vscode-languageclient/node";

let client: LanguageClient | undefined;
let findingsProvider: FindingsProvider;

interface LspPosition {
  line: number;
  character: number;
}
interface LspRange {
  start: LspPosition;
  end: LspPosition;
}
/** A finding row from the server's `chainvet/publishFindings` notification. */
interface FindingItem {
  provenance: string;
  /** Raw per-detector engine confidence (`high`/`medium`/`low`); may be absent. */
  confidence?: string;
  kind: string;
  severity: string;
  category: string;
  message: string;
  range: LspRange;
}
interface PublishFindingsParams {
  uri: string;
  findings: FindingItem[];
}

type ConfidenceFilter = "all" | "high" | "medium" | "low";

// ─── Language server ────────────────────────────────────────────────────────

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

// ─── Presentation helpers ───────────────────────────────────────────────────

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

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// ─── Findings tree view ─────────────────────────────────────────────────────

class SeverityGroup {
  constructor(
    public readonly severity: string,
    public readonly items: { uri: string; finding: FindingItem }[],
  ) {}
}

class FindingLeaf {
  constructor(
    public readonly uri: string,
    public readonly finding: FindingItem,
  ) {}
}

type TreeNode = SeverityGroup | FindingLeaf;

class FindingsProvider implements vscode.TreeDataProvider<TreeNode> {
  private readonly emitter = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.emitter.event;
  private readonly byUri = new Map<string, FindingItem[]>();
  private filter: ConfidenceFilter = "all";

  setForUri(uri: string, findings: FindingItem[]): void {
    if (findings.length > 0) {
      this.byUri.set(uri, findings);
    } else {
      this.byUri.delete(uri);
    }
    this.emitter.fire();
  }

  clear(): void {
    this.byUri.clear();
    this.emitter.fire();
  }

  setFilter(filter: ConfidenceFilter): void {
    this.filter = filter;
    this.emitter.fire();
  }

  private collect(): { uri: string; finding: FindingItem }[] {
    const out: { uri: string; finding: FindingItem }[] = [];
    for (const [uri, findings] of this.byUri) {
      for (const finding of findings) {
        if (this.filter === "all" || (finding.confidence ?? "low") === this.filter) {
          out.push({ uri, finding });
        }
      }
    }
    return out;
  }

  getChildren(node?: TreeNode): TreeNode[] {
    if (!node) {
      const items = this.collect();
      return ["high", "medium", "low"]
        .map((sev) => new SeverityGroup(sev, items.filter((i) => i.finding.severity === sev)))
        .filter((group) => group.items.length > 0);
    }
    if (node instanceof SeverityGroup) {
      return node.items.map((i) => new FindingLeaf(i.uri, i.finding));
    }
    return [];
  }

  getTreeItem(node: TreeNode): vscode.TreeItem {
    if (node instanceof SeverityGroup) {
      const item = new vscode.TreeItem(
        `${capitalize(node.severity)} (${node.items.length})`,
        vscode.TreeItemCollapsibleState.Expanded,
      );
      item.iconPath = new vscode.ThemeIcon("circle-large-filled", severityColor(node.severity));
      return item;
    }
    const f = node.finding;
    const confidence = f.confidence ?? "unknown";
    const item = new vscode.TreeItem(f.kind, vscode.TreeItemCollapsibleState.None);
    item.description = `${confidence} conf. · ${f.message}`;
    item.tooltip = new vscode.MarkdownString(
      `**${f.severity.toUpperCase()}** · ${confidence} confidence _(${f.provenance})_\n\n` +
        `${f.category} — \`${f.kind}\`\n\n${f.message}`,
    );
    item.iconPath = new vscode.ThemeIcon(
      f.confidence === "high" ? "pass-filled" : "circle-outline",
      severityColor(f.severity),
    );
    item.command = {
      command: "chainvet.openFinding",
      title: "Open Finding",
      arguments: [node],
    };
    return item;
  }
}

async function openFinding(node: FindingLeaf): Promise<void> {
  const doc = await vscode.workspace.openTextDocument(vscode.Uri.parse(node.uri));
  const editor = await vscode.window.showTextDocument(doc);
  const r = node.finding.range;
  const range = new vscode.Range(r.start.line, r.start.character, r.end.line, r.end.character);
  editor.selection = new vscode.Selection(range.start, range.end);
  editor.revealRange(range, vscode.TextEditorRevealType.InCenter);
}

// ─── Commands ───────────────────────────────────────────────────────────────

async function runHybridScan(): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor || editor.document.languageId !== "solidity") {
    vscode.window.showWarningMessage("Chainvet: open a Solidity (.sol) file to run a hybrid scan.");
    return;
  }
  if (!client) {
    return;
  }
  if (editor.document.isDirty) {
    await editor.document.save();
  }
  const uri = editor.document.uri.toString();
  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: "Chainvet: full hybrid scan…",
      cancellable: true,
    },
    async (_progress, token) => {
      try {
        await client!.sendRequest(
          ExecuteCommandRequest.type,
          { command: "chainvet.hybridScan", arguments: [uri] },
          token,
        );
      } catch (e) {
        if (!token.isCancellationRequested) {
          vscode.window.showErrorMessage(`Chainvet hybrid scan failed: ${String(e)}`);
        }
      }
    },
  );
}

async function chooseConfidenceFilter(treeView: vscode.TreeView<TreeNode>): Promise<void> {
  const picks: { label: string; value: ConfidenceFilter }[] = [
    { label: "$(list-flat) All findings", value: "all" },
    { label: "$(pass-filled) High confidence only", value: "high" },
    { label: "$(circle-outline) Medium confidence only", value: "medium" },
    { label: "$(circle-outline) Low confidence only", value: "low" },
  ];
  const pick = await vscode.window.showQuickPick(picks, {
    placeHolder: "Filter Chainvet findings by confidence",
  });
  if (!pick) {
    return;
  }
  findingsProvider.setFilter(pick.value);
  treeView.description =
    pick.value === "all" ? undefined : `${capitalize(pick.value)} confidence only`;
}

// ─── Activation ─────────────────────────────────────────────────────────────

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  client = makeClient();
  await client.start();

  findingsProvider = new FindingsProvider();
  const treeView = vscode.window.createTreeView("chainvetFindings", {
    treeDataProvider: findingsProvider,
  });

  context.subscriptions.push(
    treeView,
    client.onNotification("chainvet/publishFindings", (params: PublishFindingsParams) => {
      findingsProvider.setForUri(params.uri, params.findings);
    }),
    vscode.commands.registerCommand("chainvet.restartServer", async () => {
      if (!client) {
        return;
      }
      await client.stop();
      client = makeClient();
      await client.start();
      vscode.window.showInformationMessage("Chainvet language server restarted.");
    }),
    vscode.commands.registerCommand("chainvet.runHybridScan", () => runHybridScan()),
    vscode.commands.registerCommand("chainvet.filterConfidence", () =>
      chooseConfidenceFilter(treeView),
    ),
    vscode.commands.registerCommand("chainvet.clearFindings", () => findingsProvider.clear()),
    vscode.commands.registerCommand("chainvet.openFinding", (node: FindingLeaf) => openFinding(node)),
  );
}

export function deactivate(): Thenable<void> | undefined {
  return client?.stop();
}
