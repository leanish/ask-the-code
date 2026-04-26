import { describe, expect, it } from "vitest";

import { DEFAULT_ANSWER_AUDIENCE, resolveAnswerAudience } from "../src/core/answer/answer-audience.ts";

describe("answer-audience", () => {
  it("returns the default audience for nullish or unsupported values", () => {
    expect(resolveAnswerAudience(undefined)).toBe(DEFAULT_ANSWER_AUDIENCE);
    expect(resolveAnswerAudience(null)).toBe(DEFAULT_ANSWER_AUDIENCE);
    expect(resolveAnswerAudience("")).toBe(DEFAULT_ANSWER_AUDIENCE);
    expect(resolveAnswerAudience("internal")).toBe(DEFAULT_ANSWER_AUDIENCE);
  });

  it("preserves supported values", () => {
    expect(resolveAnswerAudience("codebase")).toBe("codebase");
  });
});
