import { beforeEach, describe, expect, it, vi } from "vitest";
import { createEmptyRepoRouting } from "../src/core/repos/repo-routing.ts";

const mocks = vi.hoisted(() => ({
  access: vi.fn()
}));

vi.mock("node:fs/promises", () => ({
  default: {
    access: mocks.access
  }
}));

import { renderAnswer, renderGithubDiscovery, renderRepoList, renderRetrievalOnly, renderSyncReport } from "../src/cli/render.ts";
import {
  createAnswerResult,
  createGithubDiscoveryPlanEntry,
  createManagedRepo,
  createRepoRecord,
  createRetrievalOnlyResult
} from "./test-helpers.ts";

describe("render", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders repo list entries with local state and aliases", async () => {
    mocks.access.mockResolvedValue(undefined);

    const output = await renderRepoList([
      createManagedRepo({
        name: "sqs-codec",
        directory: "/workspace/repos/sqs-codec",
        aliases: ["codec"],
        defaultBranch: "main",
        description: "SQS execution interceptor with compression and checksum metadata"
      })
    ]);

    expect(output).toContain("Managed repos:");
    expect(output).toContain("- sqs-codec [local] main aliases=codec SQS execution interceptor with compression and checksum metadata");
  });

  it("renders an unknown branch marker when a repo has no tracked branch", async () => {
    mocks.access.mockResolvedValue(undefined);

    const output = await renderRepoList([
      createManagedRepo({
        name: "broken-config-repo",
        directory: "/workspace/repos/broken-config-repo",
        aliases: [],
        defaultBranch: "",
        description: "Missing branch metadata"
      })
    ]);

    expect(output).toContain("- broken-config-repo [local] ? Missing branch metadata");
  });

  it("renders an explicit discovery hint when no repos are configured", async () => {
    expect(await renderRepoList([])).toBe([
      "Managed repos:",
      "- none configured",
      "Run: atc config discover-github"
    ].join("\n"));
  });

  it("renders retrieval-only mode with selected repos and sync report", () => {
    const output = renderRetrievalOnly(createRetrievalOnlyResult({
      question: "How does x-codec-meta work?",
      selectedRepos: [{ name: "sqs-codec" }, { name: "java-conventions" }],
      syncReport: [
        {
          name: "sqs-codec",
          action: "updated",
          detail: "main"
        }
      ]
    }));

    expect(output).toContain("Question: How does x-codec-meta work?");
    expect(output).toContain("Selected repos: sqs-codec, java-conventions");
    expect(output).toContain("Sync report:");
    expect(output).toContain("sqs-codec: updated (main)");
  });

  it("renders answer mode and sync details", () => {
    const output = renderAnswer(createAnswerResult({
      question: "ignored",
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
    }));

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
        createGithubDiscoveryPlanEntry({
          status: "new",
          repo: createRepoRecord({
            name: "ask-the-code",
            description: "Repo-aware CLI",
            routing: {
              ...createEmptyRepoRouting(),
              role: "developer-cli"
            }
          }),
          suggestions: []
        })
      ],
      selectedCount: 1,
      configPath: "/tmp/atc-config.json",
      addedCount: 1,
      overriddenCount: 2
    });

    expect(applied).toContain("ask-the-code [new]");
    expect(applied).toContain("Repos selected: 1");
    expect(applied).toContain("Config updated: /tmp/atc-config.json");
    expect(applied).toContain("Repos overridden: 2");
  });

  it("renders applied discovery entries even when fallback repos omit topics", () => {
    const applied = renderGithubDiscovery({
      owner: "leanish",
      ownerType: "User",
      appliedEntries: [
        createGithubDiscoveryPlanEntry({
          status: "new",
          repo: createRepoRecord({
            name: "ask-the-code",
            description: "Repo-aware CLI"
          }),
          suggestions: []
        })
      ],
      selectedCount: 1,
      configPath: "/tmp/atc-config.json",
      addedCount: 1,
      overriddenCount: 0
    });

    expect(applied).toContain("ask-the-code [new]");
    expect(applied).toContain("Repo-aware CLI");
  });

  it("renders owner-grouped sections for accessible discovery summaries", () => {
    const summary = renderGithubDiscovery({
      owner: "@accessible",
      ownerDisplay: "leanish + orgs",
      ownerType: "Accessible",
      appliedEntries: [
        createGithubDiscoveryPlanEntry({
          status: "new",
          repo: createRepoRecord({
            name: "ask-the-code",
            sourceOwner: "leanish",
            sourceFullName: "leanish/ask-the-code",
            description: "Repo-aware CLI",
            routing: {
              ...createEmptyRepoRouting(),
              role: "developer-cli"
            }
          }),
          suggestions: []
        }),
        createGithubDiscoveryPlanEntry({
          status: "new",
          repo: createRepoRecord({
            name: "dtv",
            sourceOwner: "OtherCo",
            sourceFullName: "OtherCo/dtv",
            description: "Storefront backend",
            routing: {
              ...createEmptyRepoRouting(),
              role: "service-application"
            }
          }),
          suggestions: []
        })
      ],
      selectedCount: 2,
      configPath: "/tmp/atc-config.json",
      addedCount: 2,
      overriddenCount: 0
    });

    expect(summary).toContain("GitHub repo discovery for leanish + orgs (Accessible):");
    expect(summary).toContain("leanish:\n- ask-the-code [new]");
    expect(summary).toContain("OtherCo:\n- dtv [new]");
    expect(summary).toContain("Config updated: /tmp/atc-config.json");
  });

  it("falls back to owner-qualified labels inside grouped summaries when names collide", () => {
    const summary = renderGithubDiscovery({
      owner: "@accessible",
      ownerDisplay: "leanish + orgs",
      ownerType: "Accessible",
      appliedEntries: [
        createGithubDiscoveryPlanEntry({
          status: "new",
          repo: createRepoRecord({
            name: "shared",
            sourceOwner: "leanish",
            sourceFullName: "leanish/shared",
            description: "",
            routing: createEmptyRepoRouting()
          }),
          suggestions: []
        }),
        createGithubDiscoveryPlanEntry({
          status: "new",
          repo: createRepoRecord({
            name: "shared",
            sourceOwner: "OtherCo",
            sourceFullName: "OtherCo/shared",
            description: "",
            routing: createEmptyRepoRouting()
          }),
          suggestions: []
        })
      ],
      selectedCount: 2,
      configPath: "/tmp/atc-config.json",
      addedCount: 2,
      overriddenCount: 0
    });

    expect(summary).toContain("leanish:\n- leanish/shared [new]");
    expect(summary).toContain("OtherCo:\n- OtherCo/shared [new]");
  });

  it("derives owner-qualified labels from the GitHub URL when source metadata is missing", () => {
    const summary = renderGithubDiscovery({
      owner: "@accessible",
      ownerDisplay: "leanish + orgs",
      ownerType: "Accessible",
      appliedEntries: [
        createGithubDiscoveryPlanEntry({
          status: "configured",
          repo: createRepoRecord({
            name: "nullability",
            url: "https://github.com/leanish/nullability.git",
            description: "",
            routing: createEmptyRepoRouting()
          }),
          suggestions: []
        }),
        createGithubDiscoveryPlanEntry({
          status: "new",
          repo: createRepoRecord({
            name: "otherco/nullability",
            sourceOwner: "OtherCo",
            sourceFullName: "OtherCo/nullability",
            url: "https://github.com/OtherCo/nullability.git",
            description: "",
            routing: createEmptyRepoRouting()
          }),
          suggestions: []
        })
      ],
      selectedCount: 2,
      configPath: "/tmp/atc-config.json",
      addedCount: 1,
      overriddenCount: 1
    });

    expect(summary).toContain("- leanish/nullability [configured]");
    expect(summary).toContain("- OtherCo/nullability [new]");
  });
});
