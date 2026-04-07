import fs from "node:fs/promises";

import {
  getDiscoveryOwnerLabel,
  getDiscoveryRepoBaseName,
  getGithubRepoDisplayIdentity,
  getPrimarySourceOwner,
  groupDiscoveryItemsByOwner
} from "../core/discovery/repo-display-utils.js";

export async function renderRepoList(repos) {
  const lines = ["Managed repos:"];

  if (repos.length === 0) {
    lines.push("- none configured");
    lines.push("Run: archa config discover-github");
    return lines.join("\n");
  }

  for (const repo of repos) {
    const status = await exists(repo.directory) ? "local" : "missing";
    const aliases = repo.aliases && repo.aliases.length > 0 ? ` aliases=${repo.aliases.join(",")}` : "";
    const trackedBranch = repo.defaultBranch || repo.branch || "?";
    lines.push(`- ${repo.name} [${status}] ${trackedBranch}${aliases} ${repo.description}`);
  }

  return lines.join("\n");
}

async function exists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

export function renderSyncReport(report) {
  const lines = ["Sync report:"];

  for (const item of report) {
    const detail = item.detail ? ` (${item.detail})` : "";
    lines.push(`- ${item.name}: ${item.action}${detail}`);
  }

  return lines.join("\n");
}

export function renderRetrievalOnly(result) {
  const lines = [
    `Question: ${result.question}`,
    `Selected repos: ${result.selectedRepos.map(repo => repo.name).join(", ")}`,
    ""
  ];

  lines.push(renderSyncReport(result.syncReport));
  return lines.join("\n");
}

export function renderAnswer(result) {
  return [
    result.synthesis.text,
    "",
    `Repos used: ${result.selectedRepos.map(repo => repo.name).join(", ")}`,
    renderSyncReport(result.syncReport)
  ].join("\n");
}

export function renderGithubDiscovery(result) {
  const lines = [
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
      primarySourceOwner: getPrimarySourceOwner(result.ownerDisplay)
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

function formatDiscoveryStatus(entry) {
  if (entry.status === "conflict") {
    return `conflict:${entry.configuredRepo.name}`;
  }

  return entry.status;
}

function formatDiscoveryRepoLabel(repo, useSourceLabels) {
  if (useSourceLabels) {
    const sourceLabel = getGithubRepoDisplayIdentity(repo);
    if (sourceLabel) {
      return sourceLabel;
    }
  }

  return repo.name;
}

function formatDiscoveryEntry(entry, {
  useSourceLabels
}) {
  const status = formatDiscoveryStatus(entry);
  const classifications = entry.repo.classifications?.length > 0
    ? ` classifications=${entry.repo.classifications.join(",")}`
    : "";
  const topics = entry.repo.topics?.length > 0 ? ` topics=${entry.repo.topics.join(",")}` : "";
  const description = entry.repo.description ? ` ${entry.repo.description}` : "";
  const suggestions = entry.suggestions?.length > 0 ? ` review=${entry.suggestions.join("; ")}` : "";
  return `- ${formatDiscoveryRepoLabel(entry.repo, useSourceLabels)} [${status}]${classifications}${topics}${suggestions}${description}`;
}

function isAmbiguousDiscoveryName(repo, entries) {
  const repoBaseName = getDiscoveryRepoBaseName(repo);
  return entries.filter(entry => getDiscoveryRepoBaseName(entry.repo) === repoBaseName).length > 1;
}
