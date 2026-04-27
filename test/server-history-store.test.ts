import { describe, expect, it } from "vitest";

import { createHistoryStore } from "../src/server/history-store.ts";

describe("createHistoryStore", () => {
  it("keeps newest job ids first without exposing mutable state", () => {
    const store = createHistoryStore(3);

    store.record("one");
    store.record("two");
    store.record("three");
    store.record("two");
    const snapshot = store.list();
    snapshot.push("mutated");

    expect(store.list()).toEqual(["two", "three", "one"]);
  });

  it("drops entries beyond the configured limit and can be cleared", () => {
    const store = createHistoryStore(2);

    store.record("one");
    store.record("two");
    store.record("three");
    expect(store.list()).toEqual(["three", "two"]);

    store.clear();
    expect(store.list()).toEqual([]);
  });
});
