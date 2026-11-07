# Praxis

A Cursor plugin that keeps you in the decision loop while building a project: level-aware questions, explained options, and a written record of every architecture decision.

Status: slice 4. The model may add project options and questions. The five core decisions still export if that call is off or invalid. See [PLAN.md](PLAN.md).

## Run

Requires Node.js 20 or newer.

```bash
npm install
npm test
npm run build
```

Cursor starts the server from `.cursor/mcp.json` with `node dist/index.js`. Build before enabling the tool. The same server is declared for the plugin in `mcp.json`.

## Question card

`npm run build` also writes `dist/extension.cjs`. In the Run and Debug view, start **Run Praxis**. That opens `examples/student` in an extension host. Run **Praxis: Show question card**.

The card shows the current question, its options, and one progress line. Record an answer there, or with `record_answer`. Both write the same `.learn-coach/session.json`.

At the start, rate each area. **I don't know** walks the smaller questions for a beginner, and shows an explanation an intermediate or advanced student must confirm. A reason that names a different option is kept only on the second try, word for word.

## Session

Call the tools against the student project, not this repository:

1. `start_session` with `projectRoot` and `goal`. Pass `model` false to keep the five core decisions only.
2. `add_project_questions` for an option or a question this project needs. A failed call leaves the core tree in place. Do not send a lesson.
3. `next_question`
4. `record_answer` with the student's option and their own reason
5. `export_decisions`

The session is stored at `.learn-coach/session.json` inside the student project. Export writes `DECISIONS.md` and `PLAN.md` there. The core tree does not need a model. Project questions are asked after the five core decisions, and a beginner confirms them instead of walking a generated lesson.
