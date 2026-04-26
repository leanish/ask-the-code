import { describe, expect, it } from "vitest";

import { buildRepoRoutingDraft, inferRepoReach } from "../src/core/discovery/repo-routing-draft.ts";

describe("repo-routing-draft", () => {
  it("marks http-surface reach for HTTP route endpoints", () => {
    expect(inferRepoReach(["backend"], [
      "GET /api/widgets",
      "POST /orders"
    ])).toContain("http-surface");
  });

  it("keeps order workflows scoped to order path segments", () => {
    expect(buildRepoRoutingDraft({
      repoName: "storefront",
      description: "Storefront service",
      routeEndpoints: [
        "POST /reorder",
        "GET /border-settings"
      ]
    }).workflows).not.toContain("Handles order-related workflows.");

    expect(buildRepoRoutingDraft({
      repoName: "orders",
      description: "Orders service",
      routeEndpoints: [
        "POST /order",
        "GET /orders/123"
      ]
    }).workflows).toContain("Handles order-related workflows.");
  });

  it("does not generate generic workflow text directly from topics", () => {
    expect(buildRepoRoutingDraft({
      repoName: "java-conventions",
      description: "Shared Gradle conventions",
      topics: ["gradle", "jdk"]
    }).workflows).toEqual([]);
  });

  it("still derives workflow hints from concrete route and cli signals", () => {
    expect(buildRepoRoutingDraft({
      repoName: "ask-the-code",
      description: "Repo-aware CLI",
      classifications: ["cli"],
      routeEndpoints: ["GET /admin/jobs"]
    }).workflows).toEqual([
      "Handles admin-facing workflows.",
      "Handles command execution workflows."
    ]);
  });
});
