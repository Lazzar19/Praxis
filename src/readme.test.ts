import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");

function section(heading: string): string {
  const start = readme.indexOf(heading);
  assert.notEqual(start, -1, heading);
  const rest = readme.slice(start + heading.length);
  const next = rest.search(/\n## /);
  return next === -1 ? rest : rest.slice(0, next);
}

describe("README documentation", () => {
  it("leads with the first successful result", () => {
    const quick = section("## Quick start");
    const steps = [
      "npm run plugin:install",
      "Reload Window",
      "enable **Praxis**",
      "new Agent chat",
      "Ask to build something",
      "first AskQuestion",
    ];
    let at = 0;
    for (const step of steps) {
      const found = quick.indexOf(step, at);
      assert.notEqual(found, -1, step);
      at = found + step.length;
    }
    assert.match(quick, /turn Praxis on for this project, or leave it off/);
    assert.ok(readme.indexOf("## Quick start") < readme.indexOf("## Retired compatibility path"));
    assert.match(quick, /retired MCP path/);
  });

  it("shows the demo, the files a session writes, and the limits", () => {
    const demo = section("## Demo");
    assert.match(demo, /not included yet/);
    assert.match(demo, /illustrative chat transcript/i);
    assert.match(demo, /npm run demo/);
    const files = section("## What gets written");
    for (const name of ["state.json", "session.json", "review.json", "stats.json", "stats.csv", "portfolio.md", "summary.json", "tests.md"]) {
      assert.match(files, new RegExp(name.replace(".", "\\.")));
    }
    assert.match(files, /omits reasons, predictions, and file paths/);
    const limits = section("## Known limitations");
    assert.match(limits, /Marketplace distribution is not available/);
    assert.match(limits, /depth 12 and 40 files/);
    assert.match(limits, /Shell is not gated/);
    assert.match(limits, /Tests run only after `Tests: run`/);
  });

  it("states status, the retired path, and the four planned items", () => {
    const status = section("## Status and roadmap");
    assert.match(status, /Experimental, version 0\.1\.0, pre-release/);
    assert.match(status, /Marketplace \| Not available/);
    assert.match(status, /What works[\s\S]*decision timeline is `\.praxis\/timeline\.md`/);
    assert.match(status, /What is retired/);
    assert.match(status, /MCP server/);
    const planned = status.split("What is planned")[1] ?? "";
    assert.match(planned, /publishing to the Cursor marketplace/);
    assert.match(planned, /fading hints/);
    assert.match(planned, /recall question/);
    assert.doesNotMatch(planned, /decision timeline/);
  });
});
