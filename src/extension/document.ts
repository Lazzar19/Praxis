import type { CardState } from "./card.js";

export function cardDocument(state: CardState, nonce: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Praxis</title>
  <style nonce="${nonce}">
    body {
      margin: 0;
      padding: 24px;
      color: var(--vscode-foreground);
      background: var(--vscode-editor-background);
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
      line-height: 1.45;
    }
    .progress { margin: 0 0 12px; opacity: 0.8; }
    h1 { margin: 0 0 8px; font-size: 1.4rem; font-weight: 600; }
    .prompt, .suggestion, .ready { margin: 0 0 16px; }
    .error { margin: 0 0 16px; color: var(--vscode-errorForeground); }
    form { display: grid; gap: 12px; max-width: 640px; }
    fieldset { margin: 0; padding: 0; border: 0; display: grid; gap: 8px; }
    legend { margin-bottom: 4px; }
    .option {
      display: grid;
      grid-template-columns: auto 1fr;
      gap: 4px 10px;
      padding: 10px 12px;
      border: 1px solid var(--vscode-panel-border, transparent);
      background: var(--vscode-input-background);
    }
    .option.suggested { outline: 1px solid var(--vscode-focusBorder); }
    .option input { margin-top: 4px; }
    .option-label { font-weight: 600; }
    .meta { grid-column: 2; }
    label.field { display: grid; gap: 6px; }
    input[type="text"], textarea {
      width: 100%;
      box-sizing: border-box;
      color: var(--vscode-input-foreground);
      background: var(--vscode-input-background);
      border: 1px solid var(--vscode-input-border, transparent);
      padding: 8px;
      font: inherit;
    }
    textarea { min-height: 88px; resize: vertical; }
    button {
      justify-self: start;
      color: var(--vscode-button-foreground);
      background: var(--vscode-button-background);
      border: 0;
      padding: 8px 14px;
      font: inherit;
      cursor: pointer;
    }
    button:hover { background: var(--vscode-button-hoverBackground); }
  </style>
</head>
<body>
  <p class="progress">${escapeHtml(state.progress)}</p>
  ${state.error ? `<p class="error">${escapeHtml(state.error)}</p>` : ""}
  ${renderBody(state)}
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    document.getElementById("card-form")?.addEventListener("submit", (event) => {
      event.preventDefault();
      const form = new FormData(event.currentTarget);
      vscode.postMessage({
        type: String(form.get("type") ?? ""),
        goal: String(form.get("goal") ?? ""),
        questionId: String(form.get("questionId") ?? ""),
        optionId: String(form.get("optionId") ?? ""),
        reason: String(form.get("reason") ?? ""),
      });
    });
  </script>
</body>
</html>
`;
}

function renderBody(state: CardState): string {
  if (state.kind === "start") {
    return `<form id="card-form">
      <input type="hidden" name="type" value="start">
      <label class="field">What are you building?
        <input type="text" name="goal" value="${escapeHtml(state.goal)}" required>
      </label>
      <button type="submit">Start</button>
    </form>`;
  }

  if (state.kind === "ready") {
    const note = state.exported
      ? "DECISIONS.md and PLAN.md are already written."
      : "Every core decision is stored. Export writes DECISIONS.md and PLAN.md.";
    const button = state.exported
      ? ""
      : `<form id="card-form">
          <input type="hidden" name="type" value="export">
          <button type="submit">Write DECISIONS.md</button>
        </form>`;
    return `<p class="ready">${escapeHtml(note)}</p>${button}`;
  }

  const options = state.options.map((option) => {
    const checked = option.id === state.selectedOptionId ? " checked" : "";
    const suggested = option.suggested ? " suggested" : "";
    return `<label class="option${suggested}">
      <input type="radio" name="optionId" value="${escapeHtml(option.id)}" required${checked}>
      <span class="option-label">${escapeHtml(option.label)}</span>
      <span class="meta">Pros: ${escapeHtml(option.pros)}</span>
      <span class="meta">Cons: ${escapeHtml(option.cons)}</span>
    </label>`;
  }).join("");

  return `<h1>${escapeHtml(state.title)}</h1>
    <p class="prompt">${escapeHtml(state.prompt)}</p>
    <p class="suggestion">${escapeHtml(state.suggestion)}</p>
    <form id="card-form">
      <input type="hidden" name="type" value="answer">
      <input type="hidden" name="questionId" value="${escapeHtml(state.questionId)}">
      <fieldset>
        <legend>Options</legend>
        ${options}
      </fieldset>
      <label class="field">Why this choice?
        <textarea name="reason" required>${escapeHtml(state.reason)}</textarea>
      </label>
      <button type="submit">Record answer</button>
    </form>`;
}

export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
