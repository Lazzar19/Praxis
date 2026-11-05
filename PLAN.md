# Learn Coach: implementation plan

A Cursor extension that keeps the student in the decision loop. Before any project code is written, the student answers level-aware questions, picks between explained options, and confirms a short reason. The coach then writes a `DECISIONS.md` the student can reread, and a `PLAN.md` the coding agent must follow.

Decisions below were locked on 2026-11-04. Implement from [Build order](#build-order). The comparison tables that led here are removed on purpose, so the next session builds the chosen path.

Repository name: `learn-coach`. Display name: Learn Coach.

## Goals
- The student makes every architecture decision, with enough explanation to make it consciously.
- Questions adapt to the student's level (beginner / intermediate / advanced) and to "I don't know" answers.
- The output in the target project is a `DECISIONS.md`, plus a project plan the coding agent follows.

## Non-goals
- No custom model and no fine-tuning. The Cursor agent's own model does the reasoning.
- No cloud backend and no accounts. State stays on disk.
- No multi-question quiz, no decision timeline, no skill map, no metrics, and no marketplace release until the slices below say so.

---

## Locked decisions

| # | Topic | Choice | Why |
|---|---|---|---|
| 1 | Shell | VS Code extension + local MCP server, plus a rule that blocks project code until export | Question cards sit outside the chat, where accepting the model's default is easiest. Rules and the server work before the panel exists |
| 2 | Server language | TypeScript, MCP SDK v2 (`@modelcontextprotocol/server`) | Official SDK, and the extension is TypeScript too. The v1 package name was `@modelcontextprotocol/sdk` |
| 3 | Session storage | JSON file in the target project: `.learn-coach/session.json` | One student, one document: level, questions, answers, decisions. Readable and safe to commit. `DECISIONS.md` is the report generated from this file |
| 4 | Level | Self-rating per area, then adapt | Fast start. The level moves one step after three answers in the same area, so one reply cannot swing it |
| 5 | Questions | Hybrid | A hand-written core tree always finishes a session. The model may add project-specific options and extra questions later |
| 6 | "I don't know" | Depends on level | Beginners get short sub-questions. Advanced students get a short explanation and a recommendation. Both must confirm before it counts as their decision |
| 7 | Understanding check | One "why?" per decision, checked against the choice | The student's own words become the reason in `DECISIONS.md`. On a mismatch: one hint, one retry, then continue. No separate score and no extra quiz items |
| 8 | Output | Templates | The file must contain the choice and the reason the student actually gave. Option text lives in YAML; the template assembles the ADR and the agent plan |
| 9 | Scaffolding | Hands-on level is a setting. Default, and the only mode to build first: skeleton + marked TODOs | The student writes one key function per feature, then the agent reviews it. Full generation stays a later choice for an area they already know |
| 10 | Fading | Later | A JSON profile is enough when this starts. SQLite waits until cross-project queries need it |
| 11 | Panel | In scope with the shell, in a small form | Slice 2 shows the current question, its options, and a short progress line. Timeline and skill map wait |
| 12 | Metrics | Later, local, opt-in | Sessions, decisions, "I don't know" rate, share of TODOs the student wrote. Does not affect the first slices |

### Rules that bind the choices

- **Where files go.** `.learn-coach/session.json`, `DECISIONS.md`, and the generated `PLAN.md` belong to the project being coached. This repository is the coach itself.
- **Core tree order.** Stack, then database, then API style, then auth, then deploy. Each node has options, pros, cons, a recommendation per level, an "I don't know" path, and a few phrases a sound reason should touch.
- **Beginner "I don't know" paths are authored** in that same YAML for the core tree. The model does not invent the lesson.
- **The core tree completes a session** when the model adds nothing.
- **Level updates.** Three "I don't know" answers in one area lower that area by one step, and beginner is the floor. Three why-checks that pass without a retry raise it by one step, and advanced is the ceiling. Three is the starting threshold.
- **A recommendation is not a decision** until the student confirms it.
- **The why-check stores the student's text verbatim.** The model judges fit. It does not rewrite the reason.
- **Hands-on default** is skeleton plus TODOs. The setting exists in the session from the start; only this mode is implemented in the first scaffolding slice.

### Closed questions
- A session is per target project. A global profile at `~/.learn-coach` starts only with fading, and it is JSON until a real query workload shows up.
- During development the extension and MCP server load locally from this repo. Marketplace or Open VSX comes after the panel is worth installing.

---

## What a session does

1. The student rates themselves per area and the hands-on mode is recorded (default: write the TODOs).
2. The server asks the next core question, with pros, cons, and a level-aware recommendation.
3. "I don't know" branches as in decision 6, then returns to a confirmable choice.
4. The student states why, in their own words. One hint and one retry if the reason misses the choice.
5. The answer is appended to `.learn-coach/session.json`.
6. After the tree, export writes `DECISIONS.md` (one ADR per decision: context, options, choice, reason, date) and a `PLAN.md` of ordered features for the coding agent.
7. Only then may the agent scaffold the project. Until the TODO slice, scaffolding is out of scope: export is the end of the session.

MCP tools for this loop: `start_session`, `next_question`, `record_answer`, `export_decisions`. The why-check is part of recording an answer, not a separate product.

---

## Build order

Each slice is done only when its check passes. Do not start a slice early.

### Slice 1 — session writes DECISIONS.md
TypeScript MCP server, JSON session, static core tree, templates. A Cursor rule tells the agent not to write project code before `export_decisions`.

Done when a session runs in Cursor from the first question through export, the core tree needs no model output, and `DECISIONS.md` matches the choices and reasons in the JSON.

### Slice 2 — one question card
VS Code extension webview that shows the current question, the options, and a one-line progress indicator. It calls the same server as the chat tools.

Done when a student can answer a question from the card and the JSON session matches an answer given through the tool.

### Slice 3 — level, "I don't know", why-check
Self-rating at start, the three-answer level rule, authored beginner sub-questions, advanced explain-and-confirm, and the single why-check with one hint.

Done when a beginner "I don't know" walks the YAML sub-questions, an advanced "I don't know" still requires confirmation, and a mismatched reason is stored only after a retry or the second attempt.

### Slice 4 — project-specific options
The model may add options and extra questions for this project, in a fixed JSON shape. The core tree still runs if that call fails.

Done when a session with model additions and a session with the model disabled both export a coherent `DECISIONS.md`.

### Slice 5 — skeleton and TODOs
Using the exported plan, the agent scaffolds the project and leaves one marked TODO per feature for the student to write, then reviews it. This is the only hands-on mode.

Done when a fresh export produces a skeleton whose TODOs map to the plan, and a student-written function can be reviewed against the decision that required it.

---

## Later, not in the slices above
- Progressive fading, backed first by `~/.learn-coach` JSON. SQLite only if cross-project queries outgrow that file.
- Full code generation as a hands-on choice for a mastered area.
- Decision timeline and skill map in the panel.
- Opt-in local metrics.
- Publishing to the VS Code Marketplace or Open VSX.

## First files when implementation starts
- `package.json` — MCP server and, from slice 2, the extension
- `src/server/` — the four tools and the session read/write
- `questions/core.yaml` — the five core decisions
- `templates/` — `DECISIONS.md` and the student `PLAN.md`
- `rules/` — no project code until export
- `src/extension/` — slice 2 only

Requires Node.js 20 or newer. Run `npm install` and `npm run build` before Cursor starts the server.
