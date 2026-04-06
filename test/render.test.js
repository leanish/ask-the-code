import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  existsSync: vi.fn()
}));

vi.mock("node:fs", () => ({
  default: {
    existsSync: mocks.existsSync
  }
}));

import { renderAnswer, renderGithubDiscovery, renderRepoList, renderRetrievalOnly, renderSyncReport } from "../src/render.js";

describe("render", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders repo list entries with local state and aliases", () => {
    mocks.existsSync.mockReturnValue(true);

    const output = renderRepoList([
      {
        name: "sqs-codec",
        directory: "/workspace/repos/sqs-codec",
        aliases: ["codec"],
        defaultBranch: "main",
        description: "SQS execution interceptor with compression and checksum metadata"
      }
    ]);

    expect(output).toContain("Managed repos:");
    expect(output).toContain("- sqs-codec [local] main: aliases=codec SQS execution interceptor with compression and checksum metadata");
  });

  it("renders an explicit discovery hint when no repos are configured", () => {
    expect(renderRepoList([])).toBe([
      "Managed repos:",
      "- none configured",
      "Run: archa config discover-github --apply"
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

  it("renders GitHub discovery preview and applied summaries", () => {
    const preview = renderGithubDiscovery({
      owner: "leanish",
      ownerType: "User",
      entries: [
        {
          status: "new",
          repo: {
            name: "archa",
            description: "Repo-aware CLI",
            topics: ["cli"],
            classifications: ["cli"]
          },
          suggestions: []
        },
        {
          status: "configured",
          repo: {
            name: "foundation",
            description: "Shared base",
            topics: ["java"],
            classifications: ["infra"]
          },
          suggestions: ["review description"]
        }
      ],
      counts: {
        discovered: 2,
        configured: 1,
        new: 1,
        conflicts: 0,
        withSuggestions: 1
      },
      skippedForks: 0,
      skippedArchived: 0,
      applied: false
    });

    expect(preview).toContain("Configured with review suggestions: 1");
    expect(preview).toContain("classifications=cli topics=cli");
    expect(preview).toContain("classifications=infra topics=java");
    expect(preview).toContain("Apply mode lets you choose from the combined list of new and already configured repos. Press Enter to add all new repos, or customize the selection before only that subset is refined and saved incrementally.");

    const applied = renderGithubDiscovery({
      owner: "leanish",
      ownerType: "User",
      entries: [
        {
          status: "new",
          repo: {
            name: "ignored-repo",
            description: "",
            topics: [],
            classifications: []
          },
          suggestions: []
        }
      ],
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
      counts: {
        discovered: 2,
        configured: 0,
        new: 2,
        conflicts: 0,
        withSuggestions: 0
      },
      skippedForks: 0,
      skippedArchived: 0,
      applied: true,
      selectedCount: 1,
      configPath: "/tmp/archa-config.json",
      addedCount: 1,
      overriddenCount: 2
    });

    expect(applied).toContain("archa [new]");
    expect(applied).not.toContain("ignored-repo");
    expect(applied).toContain("Repos selected: 1");
    expect(applied).not.toContain("Repos discovered:");
    expect(applied).toContain("Config updated: /tmp/archa-config.json");
    expect(applied).toContain("Repos overridden: 2");
  });

  it("renders skipped disabled repos in discovery previews", () => {
    const preview = renderGithubDiscovery({
      owner: "leanish",
      ownerType: "User",
      entries: [],
      counts: {
        discovered: 3,
        configured: 0,
        new: 1,
        conflicts: 0,
        withSuggestions: 0
      },
      skippedForks: 0,
      skippedArchived: 1,
      skippedDisabled: 2,
      applied: false
    });

    expect(preview).toContain("Skipped archived repos: 1");
    expect(preview).toContain("Skipped disabled repos: 2");
  });

  it("renders owner-grouped sections for accessible discovery previews", () => {
    const preview = renderGithubDiscovery({
      owner: "@accessible",
      ownerDisplay: "leanish + orgs",
      ownerType: "Accessible",
      entries: [
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
      counts: {
        discovered: 2,
        configured: 0,
        new: 2,
        conflicts: 0,
        withSuggestions: 0
      },
      skippedForks: 0,
      skippedArchived: 0,
      applied: false
    });

    expect(preview).toContain("GitHub repo discovery for leanish + orgs (Accessible):");
    expect(preview).toContain("leanish:\n- archa [new]");
    expect(preview).toContain("Nosto:\n- playcart [new]");
    expect(preview).toContain("Run: archa config discover-github --owner @accessible --apply");
  });

  it("falls back to owner-qualified labels inside grouped previews when names collide", () => {
    const preview = renderGithubDiscovery({
      owner: "@accessible",
      ownerDisplay: "leanish + orgs",
      ownerType: "Accessible",
      entries: [
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
      counts: {
        discovered: 2,
        configured: 0,
        new: 2,
        conflicts: 0,
        withSuggestions: 0
      },
      skippedForks: 0,
      skippedArchived: 0,
      applied: false
    });

    expect(preview).toContain("leanish:\n- leanish/shared [new]");
    expect(preview).toContain("Nosto:\n- Nosto/shared [new]");
  });
});
