import fs from "node:fs";

export function renderRepoList(repos) {
  const lines = ["Managed repos:"];

  if (repos.length === 0) {
    lines.push("- none configured");
    lines.push("Run: archa config discover-github --apply");
    return lines.join("\n");
  }

  for (const repo of repos) {
    const status = fs.existsSync(repo.directory) ? "local" : "missing";
    const aliases = repo.aliases && repo.aliases.length > 0 ? ` aliases=${repo.aliases.join(",")}` : "";
    lines.push(`- ${repo.name} [${status}] ${repo.defaultBranch || repo.branch}:${aliases} ${repo.description}`);
  }

  return lines.join("\n");
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
  const entries = result.applied
    ? (result.appliedEntries || [])
    : result.entries;
  const sourceOwners = new Set(
    entries
      .map(entry => getDiscoveryOwnerLabel(entry.repo))
      .filter(sourceOwner => sourceOwner !== "Other")
  );

  if (sourceOwners.size > 1) {
    const groupedEntries = groupDiscoveryEntriesByOwner(entries, getPrimarySourceOwner(result));

    for (const group of groupedEntries) {
      lines.push(`${group.ownerLabel}:`);
      for (const entry of group.entries) {
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

  if (result.applied) {
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

  lines.push("");
  lines.push(`Repos discovered: ${result.counts.discovered}`);
  lines.push(`Already configured: ${result.counts.configured}`);
  lines.push(`Ready to add: ${result.counts.new}`);
  lines.push(`Identifier conflicts: ${result.counts.conflicts}`);
  lines.push(`Configured with review suggestions: ${result.counts.withSuggestions}`);

  if (result.skippedForks > 0) {
    lines.push(`Skipped forks: ${result.skippedForks}`);
  }

  if (result.skippedArchived > 0) {
    lines.push(`Skipped archived repos: ${result.skippedArchived}`);
  }

  if (result.skippedDisabled > 0) {
    lines.push(`Skipped disabled repos: ${result.skippedDisabled}`);
  }

  if (result.counts.new > 0 || result.counts.configured > 0) {
    lines.push(`Run: archa config discover-github --owner ${result.owner} --apply`);
    lines.push("Apply mode lets you choose from the combined list of new and already configured repos. Press Enter to add all new repos, or customize the selection before only that subset is refined and saved incrementally.");
  } else {
    lines.push("No new repos to add.");
  }

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
  const topics = entry.repo.topics.length > 0 ? ` topics=${entry.repo.topics.join(",")}` : "";
  const description = entry.repo.description ? ` ${entry.repo.description}` : "";
  const suggestions = entry.suggestions.length > 0 ? ` review=${entry.suggestions.join("; ")}` : "";
  return `- ${formatDiscoveryRepoLabel(entry.repo, useSourceLabels)} [${status}]${classifications}${topics}${suggestions}${description}`;
}

function groupDiscoveryEntriesByOwner(entries, primarySourceOwner) {
  const groupsByOwner = new Map();
  const orderedOwners = [];

  for (const entry of entries) {
    const ownerLabel = getDiscoveryOwnerLabel(entry.repo);
    if (!groupsByOwner.has(ownerLabel)) {
      groupsByOwner.set(ownerLabel, []);
      orderedOwners.push(ownerLabel);
    }
    groupsByOwner.get(ownerLabel).push(entry);
  }

  orderedOwners.sort((left, right) => compareDiscoveryOwnerLabels(left, right, primarySourceOwner));

  return orderedOwners.map(ownerLabel => ({
    ownerLabel,
    entries: groupsByOwner.get(ownerLabel)
  }));
}

function getDiscoveryOwnerLabel(repo) {
  if (typeof repo.sourceOwner === "string" && repo.sourceOwner.trim() !== "") {
    return repo.sourceOwner.trim();
  }

  const githubIdentity = getGithubRepoDisplayIdentity(repo);
  if (githubIdentity?.includes("/")) {
    return githubIdentity.split("/")[0];
  }

  return "Other";
}

function compareDiscoveryOwnerLabels(left, right, primarySourceOwner) {
  const normalizedPrimaryOwner = typeof primarySourceOwner === "string"
    ? primarySourceOwner.trim().toLowerCase()
    : "";
  const normalizedLeft = left.toLowerCase();
  const normalizedRight = right.toLowerCase();

  if (normalizedPrimaryOwner) {
    if (normalizedLeft === normalizedPrimaryOwner && normalizedRight !== normalizedPrimaryOwner) {
      return -1;
    }

    if (normalizedRight === normalizedPrimaryOwner && normalizedLeft !== normalizedPrimaryOwner) {
      return 1;
    }
  }

  return normalizedLeft.localeCompare(normalizedRight);
}

function getPrimarySourceOwner(result) {
  if (typeof result.ownerDisplay !== "string") {
    return null;
  }

  const [primaryOwner] = result.ownerDisplay.split(" + orgs");
  return primaryOwner?.trim() || null;
}

function isAmbiguousDiscoveryName(repo, entries) {
  const repoBaseName = getDiscoveryRepoBaseName(repo);
  return entries.filter(entry => getDiscoveryRepoBaseName(entry.repo) === repoBaseName).length > 1;
}

function getDiscoveryRepoBaseName(repo) {
  if (typeof repo.sourceFullName === "string" && repo.sourceFullName.includes("/")) {
    return repo.sourceFullName.split("/").pop().trim();
  }

  if (typeof repo.name === "string" && repo.name.includes("/")) {
    return repo.name.split("/").pop().trim();
  }

  return repo.name;
}

function getGithubRepoDisplayIdentity(repo) {
  if (typeof repo.sourceFullName === "string" && repo.sourceFullName.trim() !== "") {
    return repo.sourceFullName.trim();
  }

  if (typeof repo.url !== "string" || repo.url.trim() === "") {
    return null;
  }

  const match = repo.url.trim().match(/github\.com[/:]([^/]+)\/([^/]+?)(?:\.git)?$/i);
  if (!match) {
    return null;
  }

  return `${match[1]}/${match[2]}`;
}
