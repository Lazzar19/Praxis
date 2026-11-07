import { randomBytes } from "node:crypto";
import * as vscode from "vscode";
import { setPackageRoot } from "../paths.js";
import { resetCoreTreeCache } from "../tree.js";
import { applyCardMessage, cardState, parseCardMessage, type CardDeps, type CardState } from "./card.js";
import { cardDocument } from "./document.js";

let current: vscode.WebviewPanel | undefined;

export function activate(context: vscode.ExtensionContext): void {
  setPackageRoot(context.extensionPath);
  resetCoreTreeCache();
  context.subscriptions.push(vscode.commands.registerCommand("praxis.showQuestion", () => {
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder) {
      void vscode.window.showErrorMessage("Open a student project folder first.");
      return;
    }
    openPanel(folder.uri.fsPath);
  }));
}

export function deactivate(): void {
  current = undefined;
}

function openPanel(projectRoot: string): void {
  const deps: CardDeps = { projectRoot };
  if (current) {
    current.reveal(vscode.ViewColumn.Beside);
    show(current, cardState(deps));
    return;
  }

  const panel = vscode.window.createWebviewPanel(
    "praxis.question",
    "Praxis",
    vscode.ViewColumn.Beside,
    { enableScripts: true },
  );
  current = panel;
  panel.onDidDispose(() => {
    current = undefined;
  });
  panel.webview.onDidReceiveMessage((message: unknown) => {
    const parsed = parseCardMessage(message);
    show(panel, parsed ? applyCardMessage(deps, parsed) : cardState(deps));
  });
  show(panel, cardState(deps));
}

function show(panel: vscode.WebviewPanel, state: CardState): void {
  const nonce = randomBytes(16).toString("hex");
  panel.webview.html = cardDocument(state, nonce);
}
