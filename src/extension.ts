import * as vscode from "vscode";
import {
  LanguageClient,
  LanguageClientOptions,
  ServerOptions,
  TransportKind,
} from "vscode-languageclient/node";

let client: LanguageClient | undefined;

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

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  client = makeClient();
  await client.start();

  context.subscriptions.push(
    vscode.commands.registerCommand("chainvet.restartServer", async () => {
      if (!client) {
        return;
      }
      await client.stop();
      client = makeClient();
      await client.start();
      vscode.window.showInformationMessage("Chainvet language server restarted.");
    }),
  );
}

export function deactivate(): Thenable<void> | undefined {
  return client?.stop();
}
