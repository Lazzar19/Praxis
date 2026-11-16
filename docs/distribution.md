# Distribution

Status: experimental, version 0.1.0, pre-release. Praxis is not on the Cursor marketplace.

## Versioning

`.cursor-plugin/plugin.json` and `package.json` carry the same version. Each version gets a section in `CHANGELOG.md`. A new copy replaces the installed plugin files. It does not rewrite a student project's notes.

## Compatibility

| Requirement | What Praxis expects |
|---|---|
| Node | 20 or newer, for the hook and for `node --test` when the student asks |
| Cursor | Project hooks and an always-on rule |
| Notes | `.praxis/state.json` schema 1 |
| Shell | Not gated. A shell command can still write a file while a decision is open |

Schema 0 is copied to `state.json.bak` and migrated to schema 1. A newer schema is left in place and the session says this version cannot read it.

## What can be blocked

While `Status: pending`, these edit tools are refused for project files: Write, StrReplace, Delete, EditNotebook, Edit, and ApplyPatch. Notes under `.praxis/` are allowed. A bypass allows only the scope written in `progress.md`. Removing `TODO(praxis:…)` from a source file is refused even after the decision is confirmed.

Praxis can block project edits while a learning decision is open.

## What Praxis reads and writes

The hook reads project source to build the map and to find marks, and it reads `.praxis/` notes. It writes `.praxis/` (progress, decisions, timeline, map, marks, review report, state, tests, and `export/`) and regenerates `DECISIONS.md` at the project root.

It does not upload source or notes. The Cursor chat itself is sent by Cursor to the model provider; that is outside this plugin.

Cross-project progress is off until `Progress: on`. That record stays in the local state directory on this computer. `Progress: clear` deletes it. Uninstalling the plugin does not delete a student project's `.praxis/` directory. Delete that folder, and write `Progress: clear` before uninstall if the local progress record should go too.

## Install

From the plugin repository:

```bash
npm run plugin:install
npm run plugin:update
npm run plugin:status
npm run plugin:rollback
npm run plugin:uninstall
npm run plugin:package
```

`plugin:install` and `plugin:update` print the block warning, copy this repository to `~/.cursor/plugins/local/praxis`, and keep the previous copy for `plugin:rollback`. `plugin:package` writes a copy under `dist/praxis-plugin` without `node_modules`, `.git`, or `dist`. Then use **Developer: Reload Window** and open a new Agent chat in a student project.

## Tests

`npm test` runs the shipping path and the retired path. `npm run test:active` is the rule and the hooks. `npm run test:legacy` is the old MCP server, the question card, and the YAML session.
