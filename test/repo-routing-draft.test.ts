import { describe, expect, it } from "vitest";

import { buildRepoRoutingDraft, inferRepoReach } from "../src/core/discovery/repo-routing-draft.js";

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

  it("does not promote inferred topics into ownership claims", () => {
    expect(buildRepoRoutingDraft({
      repoName: "search-service",
      description: "Hosted search service",
      topics: ["search", "graphql", "commerce"]
    }).owns).toEqual([]);
  });

  it("still derives workflow hints from concrete route and cli signals", () => {
    expect(buildRepoRoutingDraft({
      repoName: "archa",
      description: "Repo-aware CLI",
      classifications: ["cli"],
      routeEndpoints: ["GET /admin/jobs"]
    }).workflows).toEqual([
      "Handles admin-facing workflows.",
      "Handles command execution workflows."
    ]);
  });

  it("derives ownership hints from concrete route surfaces", () => {
    expect(buildRepoRoutingDraft({
      repoName: "merchant-platform",
      description: "Merchant application",
      routeEndpoints: [
        "GET /admin/jobs",
        "POST /api/v1/graphql",
        "POST /auth/login",
        "POST /cron/run"
      ]
    }).owns).toEqual([
      "GraphQL routes",
      "admin routes",
      "scheduled job routes",
      "authentication routes",
      "HTTP routes"
    ]);
  });

  it("includes package surfaces for library-style routing drafts", () => {
    const routing = buildRepoRoutingDraft({
      repoName: "search-kit",
      description: "Search JS package",
      classifications: ["library"],
      packageSurfaceNames: [
        "@leanish/search-kit",
        "@leanish/search-kit/preact/autocomplete"
      ]
    });

    expect(routing.owns).toEqual([
      "@leanish/search-kit",
      "@leanish/search-kit/preact/autocomplete"
    ]);
    expect(routing.exposes).toEqual([
      "@leanish/search-kit",
      "@leanish/search-kit/preact/autocomplete"
    ]);
  });
});
