# Praxis

A Cursor plugin that teaches in the chat you already have open. Describe what you want to build. The first reply asks every floor decision and explains each option before you choose.

Status: slice 5 of the new [PLAN.md](PLAN.md). The chat is the whole session. A confirmed step stores your sentence about what the code will do, leaves one marked function for you to write, and the review quotes the decision and that sentence. There is no setup command.

## Run

Requires Node.js 20 or newer.

```bash
npm install
npm test
```

Enable the plugin on the student project. The interview starts in the chat they already opened.

## Chat

A short request still gets every floor topic in the first reply: your level, the stack, where data lives, who may see or change it, and how it ships. Each option is explained for this project. Your wording is what gets stored. A small edit, or one sentence that this step should skip questions, does not open the whole interview.

While a decision is open, edits outside `.learn-coach/` are refused. Asking to do just this step allows that one step, and the next edit waits again. A new chat is told about the open decision.

Confirmed decisions are appended to `.learn-coach/decisions.md`. `DECISIONS.md` is generated from that file, with the reason and the prediction unchanged. If the project already has code, `.learn-coach/map.md` lists the parts before a new question. A part stays under Unknowns until it has been read, and a file that appears later is added there.

The step is written around one `TODO(praxis:...)` function. That mark stays until you write the function. The review quotes the decision and your sentence and says whether the result matched.

## Retired path

The question card, the fixed YAML quiz, and the old scaffold tools are not started for a student project. Their modules remain in the repository so the old tests still run. `npm run build` still compiles them. A session finishes from the chat notes, without that card and without `questions/core.yaml`.
