# Praxis

A Cursor plugin that teaches in the chat you already have open. Describe what you want to build. Praxis asks one decision at a time and explains each option before you choose.

Status: slice 1 of the new [PLAN.md](PLAN.md). The interview is `rules/praxis.mdc`. There is no setup command. The question card and the fixed quiz remain in the repo until slice 5 removes them from the student path.

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

## Previous path

`npm run build` still writes the MCP server and the question card. That path is the old product. Do not extend it. Slice 5 removes it from the student path.
