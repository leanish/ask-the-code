import fs from "node:fs";

export function renderRepoList(repos) {
  const lines = ["Managed repos:"];

  if (repos.length === 0) {
    lines.push("- none configured");
    lines.push('Run: archa config discover-github --owner <github-user-or-org> --apply');
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
    `GitHub repo discovery for ${result.owner} (${result.ownerType}):`
  ];

  for (const entry of result.entries) {
    const status = formatDiscoveryStatus(entry);
    const topics = entry.repo.topics.length > 0 ? ` topics=${entry.repo.topics.join(",")}` : "";
    const description = entry.repo.description ? ` ${entry.repo.description}` : "";
    const suggestions = entry.suggestions.length > 0 ? ` review=${entry.suggestions.join("; ")}` : "";
    lines.push(`- ${entry.repo.name} [${status}]${topics}${suggestions}${description}`);
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

  if (result.applied) {
    const hasChanges = result.addedCount > 0 || (result.overriddenCount || 0) > 0;
    lines.push(`${hasChanges ? "Config updated" : "Config unchanged"}: ${result.configPath}`);
    lines.push(`Repos added: ${result.addedCount}`);
    lines.push(`Repos overridden: ${result.overriddenCount || 0}`);
    return lines.join("\n");
  }

  if (result.counts.new > 0 || result.counts.configured > 0) {
    lines.push(`Run: archa config discover-github --owner ${result.owner} --apply`);
    lines.push("Apply mode lets you choose which repos to add and which configured repos to override.");
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
