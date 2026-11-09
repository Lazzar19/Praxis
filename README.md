# Praxis

A Cursor plugin that teaches in the chat you already have open. Describe what you want to build. Praxis asks one decision at a time and explains each option before you choose.

Status: slice 3 of the new [PLAN.md](PLAN.md). Confirmed decisions are written to `DECISIONS.md` from the notes, and an existing repository gets a map before the next question. There is no setup command. The question card and the fixed quiz remain until slice 5.

## Run

Requires Node.js 20 or newer.

```bash
npm install
npm test
npm run build
```

Cursor starts the server from `.cursor/mcp.json` with `node dist/index.js`. Build before enabling the tool. The same server is declared for the plugin in `mcp.json`.

## Chat

Enable the plugin on the student project. The next time you ask to build something, the interview starts in that chat.

A short request still gets a separate question for your level, the stack, where data lives, who may see or change it, and how it ships. Each option is explained for this project. Your wording is what gets stored. A small edit, or one sentence that this step should skip questions, does not open the whole interview.

While a decision is open, edits outside `.learn-coach/` are refused. Asking to do just this step allows that one step, and the next edit waits again. A new chat is told about the open decision.

Confirmed decisions are appended to `.learn-coach/decisions.md`. `DECISIONS.md` is generated from that file, with the reason unchanged. If the project already has code, `.learn-coach/map.md` lists the parts and leaves unknowns visible before a new question.

## Previous path

`npm run build` still writes the MCP server and the question card. That path is the old product. Do not extend it. Slice 5 removes it from the student path.
