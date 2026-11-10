# Praxis

A Cursor plugin that teaches in the chat the student already opened. They describe what they want to build. Praxis asks one decision at a time, explains each option in terms of that project, and waits for their own words. Code for a step starts only after they confirm it.

Display name: Praxis. Package name: `learn-coach`.

This plan replaces the one locked on 2026-11-04. That plan used a fixed YAML quiz and a question card outside the chat. Those pieces stay in the repository until a later slice removes them from the path a student follows. New work follows the slices below.

## Goal

From the first description of a product, the student meets enough explained decisions that they choose and can say why. A short prompt does not collapse into one or two questions.

## Non-goals

- No custom model and no extra account. The Cursor conversation is the teacher.
- No attempt to intercept Cursor's own clarifying-question control and multiply it.
- No slash command to turn learning on.
- No marketplace release, fading, timeline, or skill map in these slices.

---

## Locked decisions

| # | Topic | Choice | Why |
|---|---|---|---|
| 1 | Where learning happens | Cursor's AskQuestion control in this chat | The student selects an option. A separate card is a second place to ignore |
| 2 | How it starts | An always-on rule. No command | Installing the plugin is the only setup |
| 3 | What starts the interview | A request to build a product, add a feature, or change how it works | A named small edit is not an architecture lesson |
| 4 | One step without questions | The sentence that this step should be done without questions | Learning returns on the next build request |
| 5 | Who writes the questions | The model, from the student's prompt, through AskQuestion | The lesson has to be about their project. The answers are not a fixed list |
| 6 | Floor | Level, stack, where data lives, who may see or change it, how it ships | A vague prompt still teaches these five in the first reply |
| 7 | Extra decisions | Anything the prompt opens that the floor does not cover | The floor is a minimum, not the whole conversation |
| 8 | Shape of a question | What this decision changes here, then each option: what it is, when to choose it, what is given up | A bare list of names is a blind pick |
| 9 | Recommendation | A suggestion, after the explanations | The student still chooses |
| 10 | Their words | Choice and reason stored verbatim. One fresh explanation and one retry if the reason describes another option. The second reason is kept | The record is theirs |
| 11 | Pace | One AskQuestion call, then wait | The next question can follow the answer they just selected |
| 12 | Existing code | A short map of the parts involved, with unknowns marked, then questions only about the part they are changing | Do not re-decide the whole repository |
| 13 | When code may be written | After they confirm that step | Confirmation covers the step that was explained |
| 14 | Prediction | Before the confirmed step is written, one sentence about what they expect the code to do. The report afterwards compares that sentence with the result | They meet the code as a check of their own guess |
| 15 | Their hands | One marked function per confirmed step, for them to write. A review quotes the decision that required it | Reading a diff is weaker practice than writing one piece |
| 16 | Record | `DECISIONS.md` in the project, in their words, plus `.praxis/` notes so a new chat can continue | The file is for the student. The notes are for the model |
| 17 | Hard gate | A hook refuses file edits while a decision is still open | A rule can be skipped. A hook cannot |
| 18 | Resume | A session-start hook reloads the notes | A new chat must not forget an open decision |
| 19 | Level | Changes how much is explained, not who decides | Beginner means more grounding. Advanced means harder assumptions |

### Rules that bind the choices

- **Plugin work is not a student session.** Inside this repository, implement this plan. Do not interview the person who is building Praxis.
- **A recommendation is not a decision** until the student confirms it.
- **An explanation is not a quiz.** Teach the idea, then ask them to use it on their project.
- **Details the model adds** are labeled as proposals. They are not written down as the student's decision.
- **Small edit.** Explain, rename, format, or fix a typo in a place they name. Do that, and do not open the floor.
- **The old path.** The YAML tree, the question card, and `scaffold_todos` are the previous product. Do not extend them. Remove them from the student path in the last slice.

---

## What a session does

1. The student describes the product in ordinary language. There is no setup command.
2. If the repository already has code, the model writes a short map and marks what it could not see.
3. The model calls AskQuestion once, waits, then calls it again. The questions and options come from the student's prompt. The floor is the minimum, plus any decision the prompt opens. Each question explains the options for this project.
4. The student answers in their own words. A reason that describes another option gets one more explanation and one more try.
5. They confirm the step. Before code, they say what they expect it to do.
6. The model writes that step and leaves one marked function. The student writes the function. The review quotes the decision.
7. `DECISIONS.md` gains one entry in their words. `.praxis/` keeps the open topic so the next chat continues.

---

## Build order

Each slice is done only when its check passes. Do not start a slice early.

### Slice 1 — the chat asks

The always-on rule in `rules/praxis.mdc`. A build request starts the interview. A small edit and a one-step bypass do not. The floor, the explanation, the verbatim reason, the retry, the map, the prediction, the marked function, and `DECISIONS.md` are all in that rule.

Done when a test reads the shipping rule and finds each of those obligations, and the rule does not tell the student to run a command.

### Slice 2 — the gate and the memory

A session-start hook reloads `.praxis/` notes. A hook refuses file edits while a decision is open. "Just this step" is the only bypass, and it covers one step.

Done when a pending decision denies a file edit, a confirmed step allows it, and a new session is told about the open decision without a command.

### Slice 3 — the record and the map

Confirmed decisions are written to `DECISIONS.md` from the notes, in the student's words. An existing repository gets a map file that keeps unknowns visible.

Done when a session with five confirmed floor topics exports five entries whose reasons match the notes, and a repository that already has code gets a map before new questions.

### Slice 4 — prediction and the student's function

The confirmed step stores the prediction. The marked function is the only code the model does not write for that step. The review quotes the decision and the prediction.

Done when a filled function is reviewed against the decision that required it, and the report says whether the result matched the student's sentence.

### Slice 5 — one path

The question card, the fixed YAML conversation, and the old scaffold tools leave the path a student follows. The chat rule is the product.

Done when a student project can finish a session without the card and without the core YAML tree.

---

## Later

- Publishing to the Cursor marketplace.
- Fading hints across projects.
- A decision timeline in a panel.

## Files this plan starts from

- `rules/praxis.mdc` — the interview, slice 1
- `.cursor/hooks.json` — the gate and the memory, slice 2
- `templates/` — `DECISIONS.md`, slice 3
- `.praxis/` in the student project — notes, not the plugin source
