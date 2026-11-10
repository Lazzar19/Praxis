import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const rule = readFileSync(new URL("../rules/praxis.mdc", import.meta.url), "utf8");

describe("shipping interview rule", () => {
  it("starts from the chat without a command and keeps the floor", () => {
    assert.match(rule, /alwaysApply:\s*true/);
    assert.match(rule, /Do not ask them to run a command to begin/);
    assert.match(rule, /just this step without questions/);
    assert.match(rule, /explain this code, rename, format, or fix a typo/);
    for (const topic of [
      "Their level",
      "The stack",
      "Where the data lives",
      "Who may see or change it",
      "How it ships",
    ]) {
      assert.ok(rule.includes(topic), topic);
    }
    assert.match(rule, /One answer does not close two topics/);
    assert.match(rule, /AskQuestion tool/);
    assert.match(rule, /Do not ask in plain text/);
    assert.match(rule, /There is no fixed list of answers/);
  });

  it("explains the choice, keeps their words, and records the result", () => {
    assert.match(rule, /what it is, when someone would choose it, and what they give up/);
    assert.match(rule, /only as a suggestion/);
    assert.match(rule, /Keep the choice and the reason as they wrote them/);
    assert.match(rule, /explain that option once more and ask again/);
    assert.match(rule, /Keep the second reason even if it still misses/);
    assert.match(rule, /short map of the parts involved/);
    assert.match(rule, /one sentence about what they expect the code to do/);
    assert.match(rule, /TODO\(praxis:<topic>\)/);
    assert.match(rule, /review the function against the decision/);
    assert.match(rule, /whether the result matched their sentence/);
    assert.match(rule, /DECISIONS\.md/);
    assert.match(rule, /\.learn-coach\/progress\.md/);
    assert.doesNotMatch(rule, /\/praxis|\/vibe-wise|slash command/i);
  });
});
