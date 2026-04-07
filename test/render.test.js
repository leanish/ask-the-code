import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  access: vi.fn()
}));

vi.mock("node:fs/promises", () => ({
  default: {
    access: mocks.access
  }
}));

import { renderAnswer, renderGithubDiscovery, renderRepoList, renderRetrievalOnly, renderSyncReport } from "../src/cli/render.js";

describe("render", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders repo list entries with local state and aliases", async () => {
    mocks.access.mockResolvedValue(undefined);

    const output = await renderRepoList([
      {
        name: "sqs-codec",
        directory: "/workspace/repos/sqs-codec",
        aliases: ["codec"],
        defaultBranch: "main",
        description: "SQS execution interceptor with compression and checksum metadata"
      }
    ]);

    expect(output).toContain("Managed repos:");
    expect(output).toContain("- sqs-codec [local] main aliases=codec SQS execution interceptor with compression and checksum metadata");
  });

  it("renders an unknown branch marker when a repo has no tracked branch", async () => {
    mocks.access.mockResolvedValue(undefined);

    const output = await renderRepoList([
      {
        name: "broken-config-repo",
        directory: "/workspace/repos/broken-config-repo",
        aliases: [],
        description: "Missing branch metadata"
      }
    ]);

    expect(output).toContain("- broken-config-repo [local] ? Missing branch metadata");
  });

  it("renders an explicit discovery hint when no repos are configured", async () => {
    expect(await renderRepoList([])).toBe([
      "Managed repos:",
      "- none configured",
      "Run: archa config discover-github"
    ].join("\n"));
  });

  it("renders retrieval-only mode with selected repos and sync report", () => {
    const output = renderRetrievalOnly({
      question: "How does x-codec-meta work?",
      selectedRepos: [{ name: "sqs-codec" }, { name: "java-conventions" }],
      syncReport: [
        {
          name: "sqs-codec",
          action: "updated",
          detail: "main"
        }
      ]
    });

    expect(output).toContain("Question: How does x-codec-meta work?");
    expect(output).toContain("Selected repos: sqs-codec, java-conventions");
    expect(output).toContain("Sync report:");
    expect(output).toContain("sqs-codec: updated (main)");
  });

  it("renders answer mode and sync details", () => {
    const output = renderAnswer({
      synthesis: {
        text: "Final answer"
      },
      selectedRepos: [{ name: "sqs-codec" }],
      syncReport: [
        {
          name: "sqs-codec",
          action: "skipped"
        }
      ]
    });

    expect(output).toContain("Final answer");
    expect(output).toContain("Repos used: sqs-codec");
    expect(output).toContain("sqs-codec: skipped");
  });

  it("renders sync report details only when present", () => {
    expect(renderSyncReport([
      { name: "sqs-codec", action: "updated", detail: "main" },
      { name: "java-conventions", action: "skipped" }
    ])).toBe([
      "Sync report:",
      "- sqs-codec: updated (main)",
      "- java-conventions: skipped"
    ].join("\n"));
  });

  it("renders applied GitHub discovery summaries", () => {
    const applied = renderGithubDiscovery({
      owner: "leanish",
      ownerType: "User",
      appliedEntries: [
        {
          status: "new",
          repo: {
            name: "archa",
            description: "Repo-aware CLI",
            topics: ["cli"],
            classifications: ["cli"]
          },
          suggestions: []
        }
      ],
      selectedCount: 1,
      configPath: "/tmp/archa-config.json",
      addedCount: 1,
      overriddenCount: 2
    });

    expect(applied).toContain("archa [new]");
    expect(applied).toContain("Repos selected: 1");
    expect(applied).toContain("Config updated: /tmp/archa-config.json");
    expect(applied).toContain("Repos overridden: 2");
  });

  it("renders applied discovery entries even when fallback repos omit topics", () => {
    const applied = renderGithubDiscovery({
      owner: "leanish",
      ownerType: "User",
      appliedEntries: [
        {
          status: "new",
          repo: {
            name: "archa",
            description: "Repo-aware CLI"
          },
          suggestions: []
        }
      ],
      selectedCount: 1,
      configPath: "/tmp/archa-config.json",
      addedCount: 1,
      overriddenCount: 0
    });

    expect(applied).toContain("archa [new]");
    expect(applied).toContain("Repo-aware CLI");
  });

  it("renders owner-grouped sections for accessible discovery summaries", () => {
    const summary = renderGithubDiscovery({
      owner: "@accessible",
      ownerDisplay: "leanish + orgs",
      ownerType: "Accessible",
      appliedEntries: [
        {
          status: "new",
          repo: {
            name: "archa",
            sourceOwner: "leanish",
            sourceFullName: "leanish/archa",
            description: "Repo-aware CLI",
            topics: ["cli"],
            classifications: ["cli"]
          },
          suggestions: []
        },
        {
          status: "new",
          repo: {
            name: "playcart",
            sourceOwner: "Nosto",
            sourceFullName: "Nosto/playcart",
            description: "Storefront backend",
            topics: ["play"],
            classifications: ["backend", "external"]
          },
          suggestions: []
        }
      ],
      selectedCount: 2,
      configPath: "/tmp/archa-config.json",
      addedCount: 2,
      overriddenCount: 0
    });

    expect(summary).toContain("GitHub repo discovery for leanish + orgs (Accessible):");
    expect(summary).toContain("leanish:\n- archa [new]");
    expect(summary).toContain("Nosto:\n- playcart [new]");
    expect(summary).toContain("Config updated: /tmp/archa-config.json");
  });

  it("falls back to owner-qualified labels inside grouped summaries when names collide", () => {
    const summary = renderGithubDiscovery({
      owner: "@accessible",
      ownerDisplay: "leanish + orgs",
      ownerType: "Accessible",
      appliedEntries: [
        {
          status: "new",
          repo: {
            name: "shared",
            sourceOwner: "leanish",
            sourceFullName: "leanish/shared",
            description: "",
            topics: [],
            classifications: []
          },
          suggestions: []
        },
        {
          status: "new",
          repo: {
            name: "shared",
            sourceOwner: "Nosto",
            sourceFullName: "Nosto/shared",
            description: "",
            topics: [],
            classifications: []
          },
          suggestions: []
        }
      ],
      selectedCount: 2,
      configPath: "/tmp/archa-config.json",
      addedCount: 2,
      overriddenCount: 0
    });

    expect(summary).toContain("leanish:\n- leanish/shared [new]");
    expect(summary).toContain("Nosto:\n- Nosto/shared [new]");
  });

  it("derives owner-qualified labels from the GitHub URL when source metadata is missing", () => {
    const summary = renderGithubDiscovery({
      owner: "@accessible",
      ownerDisplay: "leanish + orgs",
      ownerType: "Accessible",
      appliedEntries: [
        {
          status: "configured",
          repo: {
            name: "nullability",
            url: "https://github.com/leanish/nullability.git",
            description: "",
            topics: [],
            classifications: []
          },
          suggestions: []
        },
        {
          status: "new",
          repo: {
            name: "nosto/nullability",
            sourceOwner: "Nosto",
            sourceFullName: "Nosto/nullability",
            url: "https://github.com/Nosto/nullability.git",
            description: "",
            topics: [],
            classifications: []
          },
          suggestions: []
        }
      ],
      selectedCount: 2,
      configPath: "/tmp/archa-config.json",
      addedCount: 1,
      overriddenCount: 1
    });

    expect(summary).toContain("- leanish/nullability [configured]");
    expect(summary).toContain("- Nosto/nullability [new]");
  });
});
