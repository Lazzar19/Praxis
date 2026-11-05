import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CoachError } from "./errors.js";
import { loadCoreTree, parseCoreTree } from "./tree.js";
import { AREAS, LEVELS } from "./types.js";

describe("core tree", () => {
  it("loads the five core decisions in order without a model", () => {
    const tree = loadCoreTree();
    assert.deepEqual(tree.map((question) => question.id), [...AREAS]);
    for (const question of tree) {
      assert.equal(question.area, question.id);
      assert.ok(question.whyRubric.length >= 2);
      const optionIds = new Set(question.options.map((option) => option.id));
      for (const level of LEVELS) {
        assert.ok(optionIds.has(question.recommendation[level]));
      }
      assert.ok(optionIds.has(question.idk.explain.recommend));
      assert.ok(question.idk.subquestions.length >= 1);
    }
  });

  it("rejects a tree that skips a core decision", () => {
    assert.throws(() => parseCoreTree({ questions: [] }), CoachError);
  });
});
