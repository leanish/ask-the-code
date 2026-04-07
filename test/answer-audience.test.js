import { describe, expect, it } from "vitest";

import { DEFAULT_ANSWER_AUDIENCE, resolveAnswerAudience } from "../src/core/answer/answer-audience.js";

describe("answer-audience", () => {
  it("returns the default audience only for nullish values", () => {
    expect(resolveAnswerAudience(undefined)).toBe(DEFAULT_ANSWER_AUDIENCE);
    expect(resolveAnswerAudience(null)).toBe(DEFAULT_ANSWER_AUDIENCE);
  });

  it("preserves non-nullish values as-is", () => {
    expect(resolveAnswerAudience("codebase")).toBe("codebase");
    expect(resolveAnswerAudience("")).toBe("");
  });
});
