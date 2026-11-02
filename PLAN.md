# Learn Coach: plan

A Cursor plugin that keeps the developer in the decision loop. Instead of accepting the agent's defaults,
the user answers level-aware questions, picks between explained options, and gets a written record of
every decision (and why) before code is generated.

> How to use this file: every feature lists 2-3 ways to build it. Pick one per feature, write your choice
> and one-sentence reason under **Decision**, then implement. Order matters: each step builds on the last.

## Goals
- The user makes every architecture decision, with enough explanation to make it consciously.
- Questions adapt to the user's level (beginner / intermediate / advanced) and to "I don't know" answers.
- The output is a `DECISIONS.md` the user can read later, plus a project plan the coding agent follows.

## Non-goals (for the MVP)
- No custom model, no fine-tuning. The Cursor agent's own model does the reasoning.
- No cloud backend or accounts. Everything is local, per project.

---

## Feature order

### 1. Plugin shell: how the coach plugs into Cursor
How the coach gets into the agent's flow.

| Option | How | Why it's good | Trade-off |
|---|---|---|---|
| A. Rules / skill only | A `.cursor/rules/*.mdc` file that tells the agent: no code until the decision phase is done; ask questions in a fixed format | Zero code, works today, fastest to try the idea | No persistent state, the agent can drift from the rules, nothing to measure |
| B. MCP server + rules | Rules start the flow; a local MCP server exposes tools like `start_session`, `next_question`, `record_answer`, `export_decisions` | State lives in code, not in the prompt; the flow is deterministic and testable | You write and run a small server |
| C. VS Code extension + MCP server | B, plus a webview panel showing questions as cards and a progress map | Best UX, can be published on the Marketplace | Most work; extension API plus webview |

Recommendation: start with **B**. It is the smallest version that is a real, testable program, and C can be added on top later.

**Decision:** _

### 2. MCP server language and runtime

| Option | Why it's good | Trade-off |
|---|---|---|
| A. TypeScript + official MCP SDK (`@modelcontextprotocol/sdk`) | First-class SDK, same language as a later VS Code extension, so code can be shared | Needs Node (not installed in WSL yet) |
| B. Python + `mcp` SDK (FastMCP) | Very little boilerplate; you already know Python | Separate language from the extension if you build C later |
| C. Go + community MCP SDK | Single static binary, easy to install, good practice for Go | Less mature SDK, fewer examples |

**Decision:** _

### 3. Session state storage
Stores the user's level, the questions asked, the answers, and the decisions per project.

| Option | Why it's good | Trade-off |
|---|---|---|
| A. JSON file in the project (`.learn-coach/session.json`) | Simple, readable, committed with the project | Has no queries; concurrent writes are unsafe (fine for one user) |
| B. SQLite (`.learn-coach/coach.db`) | Real queries (for example "which concepts have I struggled with?"), can be shared across projects later | Binary file, needs a migration story |
| C. Markdown only (`DECISIONS.md` is the state) | One source of truth that the human reads | Hard to parse back reliably |

**Decision:** _

### 4. Skill-level calibration (first question)

| Option | How | Why it's good | Trade-off |
|---|---|---|---|
| A. Self-rating | "Rate yourself: beginner / intermediate / advanced" per area (backend, DB, deploy...) | Instant, respects the user | People misjudge themselves |
| B. Short diagnostic | 3-5 quick concept questions per area; the score sets the level | More accurate | Slower start, needs a question bank |
| C. Self-rating, then adapt | Start from A, and move the level up or down from how answers go (for example many "I don't know" answers lower it) | Accurate over time with a fast start | Slightly more logic |

**Decision:** _

### 5. Question engine: what to ask and in what order

| Option | How | Why it's good | Trade-off |
|---|---|---|---|
| A. Static decision tree | Hand-written YAML: stack, then DB, then API style, then auth, then deploy, each with options and explanations | Predictable, high-quality explanations, testable | Rigid; misses project-specific decisions |
| B. LLM-generated questions | The server asks the agent to propose the next decision and 2-4 options in a fixed JSON schema | Adapts to any project | Quality varies; harder to test |
| C. Hybrid | A static skeleton of core decisions, where the LLM fills in project-specific options and adds extra questions | Reliable core plus flexibility | Two code paths |

Each question should carry: the options, the pros and cons of each, a recommendation for the user's level, and an "I don't know" path.

**Decision:** _

### 6. "I don't know" handling

| Option | Why it's good | Trade-off |
|---|---|---|
| A. Explain and recommend | Short explanation of the concept, then a recommended default the user confirms | Never blocks |
| B. Socratic sub-questions | Break the decision into simpler questions ("Will data have relations?" before "SQL or NoSQL?") | Real learning | Takes longer |
| C. Level-dependent | Beginners get B, advanced users get A | Best of both | More branching |

**Decision:** _

### 7. Understanding check

| Option | Why it's good | Trade-off |
|---|---|---|
| A. None | Fastest | No proof of learning |
| B. One "why?" after each decision; the user writes the reason in their own words and it goes into `DECISIONS.md` | Cheap, forces reflection | No grading |
| C. Short quiz graded by the LLM | Measurable learning | Can feel like school; risk of bad grading |

**Decision:** _

### 8. Output: DECISIONS.md and project plan
- `DECISIONS.md`: one ADR-style entry per decision with context, options considered, the choice, the user's reason, and the date.
- `PLAN.md` for the generated project: an ordered feature list the coding agent must follow.

| Option | Why it's good | Trade-off |
|---|---|---|
| A. Templates (Handlebars / string templates) | Deterministic, testable | Less natural prose |
| B. LLM-written from session state | Reads well | Can drift from what was decided |

**Decision:** _

### 9. Scaffolding: from decisions to code

| Option | Why it's good | Trade-off |
|---|---|---|
| A. The agent generates everything after decisions | Fast | The user is back to pressing Enter |
| B. The agent generates the skeleton and leaves marked TODOs (one key function per feature) for the user to write, then reviews them | Real learning by doing | Slower; needs a review flow |
| C. Configurable "hands-on level" | Users choose how much they write | More settings |

**Decision:** _

### 10. Progressive fading (later)
Track concepts per user (for example "SQL vs NoSQL: decided 3 times, explained well"). Over time, skip explanations the
user has already mastered and ask the user to propose options first. This needs feature 3 (option B) to be useful.

**Decision:** _

### 11. UI (optional, after the MVP)
A VS Code webview panel with question cards, a decision timeline, and a skill map. Publish to the VS Code Marketplace / Open VSX.

**Decision:** _

### 12. Metrics (for the README and CV)
Count sessions, decisions made, "I don't know" rate over time, and the share of TODOs written by the user. Keep it local and opt-in.

**Decision:** _

---

## Milestones
1. **M1 (weekend):** features 1-5 as an MVP. A session runs end to end in Cursor and writes `DECISIONS.md`.
2. **M2:** features 6-9. Adaptive help and hands-on scaffolding.
3. **M3:** features 10-12. Fading, UI, and metrics, then release to classmates and gather feedback.

## Open questions
- Should a session be per project, or should the user profile be global (`~/.learn-coach`)?
- How should the plugin be distributed: a Cursor plugin/marketplace entry, an npm package, or a manual MCP config?
