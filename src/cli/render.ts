import {
  getDiscoveryOwnerLabel,
  getDiscoveryRepoBaseName,
  getGithubRepoDisplayIdentity,
  getPrimarySourceOwner,
  groupDiscoveryItemsByOwner
} from "../core/discovery/repo-display-utils.ts";
import { pathExists } from "../core/fs/path-exists.ts";
import { summarizeRepoRouting } from "../core/repos/repo-routing.ts";
import type {
  AnswerResult,
  GithubDiscoveryPlanEntry,
  ManagedRepo,
  RetrievalOnlyResult,
  SyncReportItem
} from "../core/types.ts";

type GithubDiscoveryRenderResult = {
  owner: string;
  ownerDisplay?: string;
  ownerType: string;
  appliedEntries?: GithubDiscoveryPlanEntry[];
  selectedCount?: number;
  configPath: string | null;
  addedCount: number;
  overriddenCount?: number;
};

export async function renderRepoList(repos: ManagedRepo[]): Promise<string> {
  const lines: string[] = ["Managed repos:"];

  if (repos.length === 0) {
    lines.push("- none configured");
    lines.push("Run: atc config discover-github");
    return lines.join("\n");
  }

  for (const repo of repos) {
    const status = await pathExists(repo.directory) ? "local" : "missing";
    const aliases = repo.aliases && repo.aliases.length > 0 ? ` aliases=${repo.aliases.join(",")}` : "";
    const trackedBranch = repo.defaultBranch || repo.branch || "?";
    lines.push(`- ${repo.name} [${status}] ${trackedBranch}${aliases} ${repo.description}`);
  }

  return lines.join("\n");
}

export function renderSyncReport(report: SyncReportItem[]): string {
  const lines: string[] = ["Sync report:"];

  for (const item of report) {
    const detail = item.detail ? ` (${item.detail})` : "";
    lines.push(`- ${item.name}: ${item.action}${detail}`);
  }

  return lines.join("\n");
}

export function renderRetrievalOnly(result: RetrievalOnlyResult): string {
  const lines: string[] = [
    `Question: ${result.question}`,
    `Selected repos: ${result.selectedRepos.map(repo => repo.name).join(", ")}`,
    ""
  ];

  lines.push(renderSyncReport(result.syncReport));
  return lines.join("\n");
}

export function renderAnswer(result: AnswerResult): string {
  return [
    result.synthesis.text,
    "",
    `Repos used: ${result.selectedRepos.map(repo => repo.name).join(", ")}`,
    renderSyncReport(result.syncReport)
  ].join("\n");
}

export function renderGithubDiscovery(result: GithubDiscoveryRenderResult): string {
  const lines: string[] = [
    `GitHub repo discovery for ${result.ownerDisplay || result.owner} (${result.ownerType}):`
  ];
  const entries = result.appliedEntries || [];
  const sourceOwners = new Set(
    entries
      .map(entry => getDiscoveryOwnerLabel(entry.repo))
      .filter(sourceOwner => sourceOwner !== "Other")
  );

  if (sourceOwners.size > 1) {
    const groupedEntries = groupDiscoveryItemsByOwner(entries, {
      primarySourceOwner: getPrimarySourceOwner(result.ownerDisplay ?? undefined)
    });

    for (const group of groupedEntries) {
      lines.push(`${group.ownerLabel}:`);
      for (const entry of group.items) {
        lines.push(formatDiscoveryEntry(entry, {
          useSourceLabels: isAmbiguousDiscoveryName(entry.repo, entries)
        }));
      }
    }
  } else {
    for (const entry of entries) {
      lines.push(formatDiscoveryEntry(entry, {
        useSourceLabels: false
      }));
    }
  }

  lines.push("");
  if (typeof result.selectedCount === "number") {
    lines.push(`Repos selected: ${result.selectedCount}`);
  }
  const hasChanges = result.addedCount > 0 || (result.overriddenCount || 0) > 0;
  lines.push(`${hasChanges ? "Config updated" : "Config unchanged"}: ${result.configPath}`);
  lines.push(`Repos added: ${result.addedCount}`);
  lines.push(`Repos overridden: ${result.overriddenCount || 0}`);

  return lines.join("\n");
}

function formatDiscoveryStatus(entry: GithubDiscoveryPlanEntry): string {
  if (entry.status === "conflict" && entry.configuredRepo) {
    return `conflict:${entry.configuredRepo.name}`;
  }

  return entry.status;
}

function formatDiscoveryRepoLabel(repo: GithubDiscoveryPlanEntry["repo"], useSourceLabels: boolean): string {
  if (useSourceLabels) {
    const sourceLabel = getGithubRepoDisplayIdentity(repo);
    if (sourceLabel) {
      return sourceLabel;
    }
  }

  return repo.name;
}

function formatDiscoveryEntry(entry: GithubDiscoveryPlanEntry, {
  useSourceLabels
}: {
  useSourceLabels: boolean;
}): string {
  const status = formatDiscoveryStatus(entry);
  const routing = entry.repo.routing ? summarizeRepoRouting(entry.repo.routing) : "";
  const routingText = routing ? ` ${routing}` : "";
  const description = entry.repo.description ? ` ${entry.repo.description}` : "";
  const suggestions = entry.suggestions?.length > 0 ? ` review=${entry.suggestions.join("; ")}` : "";
  return `- ${formatDiscoveryRepoLabel(entry.repo, useSourceLabels)} [${status}]${routingText}${suggestions}${description}`;
}

function isAmbiguousDiscoveryName(repo: GithubDiscoveryPlanEntry["repo"], entries: GithubDiscoveryPlanEntry[]): boolean {
  const repoBaseName = getDiscoveryRepoBaseName(repo);
  return entries.filter(entry => getDiscoveryRepoBaseName(entry.repo) === repoBaseName).length > 1;
}
