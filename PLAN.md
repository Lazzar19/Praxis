# Praxis

A Cursor plugin that teaches in the chat the student already opened. The student says, in their own words, what they want to build and what architecture they think it needs. Praxis does not accept that sentence as the design. It works like a small team in the same chat: one voice restates their architecture, one names a single problem in it, one puts a proposal beside that sentence. The student answers the problem in their own words, then chooses.

Display name: Praxis. Package name: `learn-coach`.

This plan replaces the menu-first interview. That interview, built in slices 1–5, asks five floor topics as option lists and attaches a suggestion to each question. Those slices stay in the repository. They are the base to refactor, not a product to throw away. The YAML quiz and the question card remain off the student path.

## Goal

The student learns by defending a design, not by picking from a menu.

From the first prompt, Praxis gets their architecture in their own words. It then holds a short debate about one real problem in that design and one proposal that answers it. The proposal covers the decision in front of them: architecture, infrastructure, tech stack, where data lives, who may see it, or how it ships. The debate compares the proposal with what the student already said. The student decides whether to keep their design, take the proposal, or mix the two.

A thin prompt still has to produce that sentence before any option list appears. A short prompt is not accepted as the architecture, and it is not answered with a stack suggestion alone.

## Non-goals

- No custom model and no extra account. The Cursor conversation is the team.
- No unbounded chat. One problem, then a choice. The next debate starts from what they just chose.
- No five voices in one message. Three beats, one at a time: their sentence, one problem, one proposal beside it.
- No slash command to turn learning on.
- No second screen, diagram panel, or quiz product in this refactor.
- No marketplace release, fading, or decision timeline in this refactor.
- Do not bring the YAML tree, the question card, or `scaffold_todos` back onto the student path.

---

## What already stands

Slices 1–5 are in the tree and stay. The refactor changes the interview on top of them.

- The student turns Praxis on or off for the project with one AskQuestion, before any debate. Off leaves no `.praxis` directory and no notes. On is the only moment notes begin.
- An always-on rule. No setup command. A named small edit does not open a debate. "Just this step without questions" covers one step, then the debate returns.
- AskQuestion is how they choose. The model does not ask the choice in plain text.
- Their words are stored verbatim. A reason that describes another option gets one more explanation and one retry. The second reason is kept.
- Code for a step waits until they confirm it. Before that code, one sentence says what they expect it to do. One marked function is left for them to write. The review says whether the result matched that sentence.
- `DECISIONS.md` is generated from `.praxis/decisions.md`. A new chat reloads `.praxis/progress.md`. A hook refuses project edits while a decision is open.
- An existing repository gets a short map, with unknowns marked, and the debate is only about the part they are changing.
- Level changes how much is explained, not who decides.

## The debate

Each important decision is one round. A round has three beats. Only the last beat is an AskQuestion.

1. **Their sentence.** Restate the architecture they already gave, in their words. If the prompt never states one, ask only for that sentence. Do not offer a stack, a database, or a deployment yet.
2. **One problem.** Name one concrete failure in that sentence, in this project. Ask how they would handle it. Their reply is kept verbatim. This is the discussion.
3. **The proposal.** Put one proposal next to their sentence. Say what problem it solves and what it costs. Then AskQuestion with three options: keep theirs, take the proposal, or mix the two. The choice and the reason are theirs.

The next round starts from the choice they just made. One answer does not close two topics.

The minimum rounds, when the prompt does not already settle them, are:

1. Their level for the work in front of them. This one is a short question, not a debate. It only sets how full the later explanations are.
2. The stack.
3. Where the data lives.
4. Who may see or change it.
5. How it ships.

Also debate a decision their prompt opens that those five do not cover. Skip a round when two designs would not produce different systems. A small edit never opens a round.

A proposal is not a decision until they select it. Details the model adds stay labeled as the proposal. They are not written down as the student's architecture.

---

## What to refactor

### `rules/praxis.mdc`

This is the change that defines the product. Replace the menu-first floor with the three beats.

Remove the obligation to open every floor topic as an option list with a suggestion inside the question. Keep the on/off choice, the small-edit skip, the one-step bypass, the verbatim reason, the retry, the map, the prediction, the marked function, and the decision block.

The rule must say: do not accept the opening prompt as the architecture; get their sentence first; raise one problem; put one proposal beside that sentence; let them keep, take, or mix.

### `hooks/praxis.mjs`

The gate, the on/off memory, and the resume note stay. Change only the text a new or pending session injects, so the model continues the open beat of the debate instead of a menu called "the floor".

Do not create `.praxis` when they leave Praxis off. Notes still begin only when they turn it on.

### The decision record

`hooks/record.mjs`, `templates/decision-entry.md`, and `templates/decisions.md`.

A debate round stores, unchanged:

- their architecture sentence
- the problem
- their reply to the problem
- the proposal
- the choice: keep, take, or mix
- the reason
- the prediction, once they confirm the step

The export keeps those fields. It does not rewrite them. A level question has no problem and no proposal; the record says so.

### Tests and the README

`src/rule.test.ts` today requires the five floor topics and a recommendation inside the question. Point it at the three beats instead.

`src/record.test.ts` exports five floor topics from notes that have no problem or proposal. Extend the notes and the export for one debate round, and keep the level question able to export without those fields.

`README.md` and `docs/demo-session.mjs` still describe the menu. Update them after the rule, so a student reading the repo sees the debate.

Do not refactor `src/server.ts`, `src/extension/`, the YAML tree, or `scaffold_todos`. They are off the student path.

---

## What a session does

1. The student describes the product in ordinary language. There is no setup command.
2. If this project has not chosen yet, one AskQuestion offers Praxis on or off. Off stops. On continues.
3. If the repository already has code, the model writes a short map and marks what it could not see. The debate covers only the part they are changing.
4. The model takes their architecture from the prompt, or asks for that sentence alone.
5. For each round: one problem, their reply, one proposal beside their sentence, then one AskQuestion. Keep, take, or mix.
6. They confirm the step. Before code, they say what they expect it to do.
7. The model writes that step and leaves one marked function. The student writes it. The review quotes the decision and the prediction.
8. `DECISIONS.md` gains one entry in their words. `.praxis/` keeps the open beat so the next chat continues the same round.

---

## Build order

Each slice is done only when its check passes. Do not start a slice early. Do not implement from this file until that work is asked for.

### Slice 6 — the rule debates

Rewrite `rules/praxis.mdc` to the three beats. Update `src/rule.test.ts`.

Done when the test finds: their sentence before any option list, one problem, one proposal beside that sentence, and the three choices keep, take, and mix. The test still finds AskQuestion, the verbatim reason, the retry, the on/off choice, the small-edit skip, the prediction, and the marked function. The rule does not tell the student to run a command.

### Slice 7 — the record holds the debate

Extend the notes and the export with their sentence, the problem, their reply, and the proposal. A level entry may omit them.

Done when a session exports one debate round whose four fields match the notes verbatim, and a level entry still exports without them.

### Slice 8 — the hook continues the open beat

Point the session text at the open beat. A pending debate resumes at their sentence, the problem, or the proposal, whichever is unfinished. The edit gate is unchanged.

Done when a new student chat is told to take their sentence before offering options, and a pending problem is named on the next session without a command.

### Slice 9 — the docs match the debate

Update `README.md` and `docs/demo-session.mjs` to one round: their sentence, one problem, one proposal, then the choice.

Done when the demo script finishes and the README no longer says the interview opens as five option lists.

---

## Later

- Publishing to the Cursor marketplace.
- Fading hints across projects.
- A decision timeline in a panel.
- A recall question after the review, brought back in a later chat if the answer does not hold.

## Files this refactor starts from

- `rules/praxis.mdc` — the debate, slice 6
- `hooks/record.mjs` and `templates/` — the record, slice 7
- `hooks/praxis.mjs` — resume the open beat, slice 8
- `README.md` and `docs/demo-session.mjs` — slice 9
- `.praxis/` in the student project — notes, not the plugin source
