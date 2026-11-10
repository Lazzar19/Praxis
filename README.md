# Praxis

Praxis is a Cursor plugin. A student describes what they want to build in the chat they already have open. The plugin asks them to choose, one decision at a time, before that choice becomes code.

The questions are Cursor's own question control (`AskQuestion`). Each one is written from the student's prompt. The options are not a fixed quiz. The student selects an option. A recommendation is only a suggestion.

Display name: Praxis. Package name: `learn-coach`. There is no setup command inside a student project.

## What the student meets

A request to build a product, add a feature, or change how it works opens the interview. A short prompt still has to cover five topics, each as its own question:

1. Their level for the work in front of them.
2. The stack.
3. Where the data lives.
4. Who may see or change it.
5. How it ships.

Anything else the prompt opens is asked as well. One answer does not close two topics. Each question says what the decision changes in this project, then what each option is, when someone would choose it, and what they give up.

The choice and the reason are stored as the student wrote them. If the reason describes a different option, that option is explained once more and they answer again. The second reason is kept.

Before a confirmed step is written, they say in one sentence what they expect the code to do. The step is then written around one function marked `TODO(praxis:<topic>)`. They write that function. The review quotes the decision and their sentence and says whether the result matched. The model does not rewrite the function.

## When questions stay closed

A named small edit does not open the interview: explain this code, rename, format, or fix a typo in a place they point to.

One sentence that this step should be done without questions allows that step only. The next build request asks again.

A `PLAN.md` that is already in the folder does not turn the questions off. If the folder also has source code, Praxis writes a short map first and asks about the part they are changing.

## What a project keeps

| File | Who it is for |
|---|---|
| `.learn-coach/progress.md` | The open decision, so a new chat continues it |
| `.learn-coach/decisions.md` | The notes the model appends, in the student's words |
| `.learn-coach/map.md` | Parts of an existing repository, with unknowns still listed |
| `.learn-coach/review.md` | The verdict after the student writes the marked function |
| `.learn-coach/report.md` | The review the student can read: decision, prediction, matched or not |
| `DECISIONS.md` | The same decisions, generated from the notes |

While a decision is open, edits outside `.learn-coach/` are refused. The notes stay writable, so the open question can be recorded. `DECISIONS.md` is regenerated from the notes. Edit the notes when a wording should change.

## Try it

Copy this repository into Cursor's local plugin folder. A symlink that points outside that folder is not loaded.

```bash
mkdir -p ~/.cursor/plugins/local/praxis
rsync -a --delete --exclude node_modules --exclude .git --exclude dist \
  ~/Projects/learn-coach/ ~/.cursor/plugins/local/praxis/
```

Run `Developer: Reload Window`. Praxis should appear in Customize. Turn it on once if it is listed and off. That switch is for the Cursor account, not for each folder.

Open any other project and start a new Agent chat. Ask to build something. The first thing to appear is one question with options for that project.

This repository is the plugin. The interview does not run here. Use another folder to try a session.

After a change in this repository, run the `rsync` again and reload the window. The copy does not follow this folder by itself.

## Develop

Node.js 20 or newer.

```bash
npm install
npm test
```

`npm test` is the check for the interview, the edit gate, the decision record, the map, and the review. `npm run build` still compiles the retired question card and MCP server. Those are not started for a student.

The product path is `rules/praxis.mdc` and `hooks/`. The plan for what comes next is [PLAN.md](PLAN.md).
