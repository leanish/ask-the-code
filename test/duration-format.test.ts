import { describe, expect, it } from "vitest";

import { formatDuration } from "../src/core/time/duration-format.js";

describe("duration-format", () => {
  it("formats zero and sub-second durations", () => {
    expect(formatDuration(0)).toBe("0s");
    expect(formatDuration(950)).toBe("950ms");
  });

  it("formats seconds and minutes with the same user-facing style", () => {
    expect(formatDuration(5_000)).toBe("5s");
    expect(formatDuration(65_000)).toBe("1m 5s");
    expect(formatDuration(300_000)).toBe("5m");
  });

  it("formats longer durations with hours when needed", () => {
    expect(formatDuration(3_660_000)).toBe("1h 1m");
    expect(formatDuration(3_665_000)).toBe("1h 1m 5s");
  });
});
