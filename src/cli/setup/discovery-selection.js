import { createInterface } from "node:readline/promises";
import process from "node:process";

export function selectGithubDiscoveryRepos(plan, {
  addRepoNames = [],
  overrideRepoNames = []
} = {}) {
  const addableRepos = getAddableRepos(plan);
  const overridableRepos = getOverridableRepos(plan);
  const defaultSourceOwner = getDefaultSourceOwner(plan);

  return {
    reposToAdd: resolveSelectedRepos(addRepoNames, addableRepos, "--add", "new", {
      defaultSourceOwner
    }),
    reposToOverride: resolveSelectedRepos(overrideRepoNames, overridableRepos, "--override", "configured", {
      defaultSourceOwner
    })
  };
}

export async function promptGithubDiscoverySelection(plan, {
  input = process.stdin,
  output = process.stdout,
  createInterfaceFn = createInterface
} = {}) {
  if (!input.isTTY || !output.isTTY) {
    throw new Error(
      'Interactive GitHub discovery requires a TTY. Re-run with --apply in a terminal, or pass explicit --add/--override selections.'
    );
  }

  const selectableEntries = getSelectableEntries(plan);
  const conflictEntries = getConflictEntries(plan);
  const readline = createInterfaceFn({
    input,
    output
  });

  try {
    return await promptForSelection(readline, {
      selectableEntries,
      conflictEntries,
      primarySourceOwner: getPrimarySourceOwner(plan),
      defaultSourceOwner: getDefaultSourceOwner(plan)
    });
  } finally {
    readline.close();
  }
}

function getAddableRepos(plan) {
  return plan.entries
    .filter(entry => entry.status === "new")
    .map(entry => entry.repo);
}

function getOverridableRepos(plan) {
  return plan.entries
    .filter(entry => entry.status === "configured")
    .map(entry => entry.repo);
}

function getSelectableEntries(plan) {
  return plan.entries
    .filter(entry => entry.status === "new" || entry.status === "configured")
    .map(entry => ({
      status: entry.status,
      repo: entry.repo
    }));
}

function getConflictEntries(plan) {
  return plan.entries
    .filter(entry => entry.status === "conflict")
    .map(entry => ({
      status: entry.status,
      repo: entry.repo,
      configuredRepo: entry.configuredRepo
    }));
}

function resolveSelectedRepos(requestedNames, availableRepos, flagName, selectionKind, {
  defaultSourceOwner = null
} = {}) {
  const normalizedNames = normalizeRequestedNames(requestedNames);
  if (normalizedNames.length === 0) {
    return [];
  }

  if (normalizedNames.length === 1 && normalizedNames[0] === "*") {
    return [...availableRepos];
  }

  const selectionOptions = buildRepoSelectionOptions(
    availableRepos.map(repo => ({
      repo
    })),
    {
      defaultSourceOwner
    }
  );
  const reposByIdentifier = new Map();

  for (const option of selectionOptions) {
    for (const identifier of option.identifiers) {
      reposByIdentifier.set(identifier.toLowerCase(), option.repo);
    }
  }
  const missingNames = [];
  const selectedRepos = [];

  for (const requestedName of normalizedNames) {
    const repo = reposByIdentifier.get(requestedName.toLowerCase());
    if (!repo) {
      missingNames.push(requestedName);
      continue;
    }
    if (!selectedRepos.some(candidate => getRepoSelectionKey(candidate) === getRepoSelectionKey(repo))) {
      selectedRepos.push(repo);
    }
  }

  if (missingNames.length > 0) {
    const availableNames = selectionOptions.map(option => option.label).join(", ") || "none";
    throw new Error(
      `Unknown ${selectionKind} repo(s) for ${flagName}: ${missingNames.join(", ")}. Available: ${availableNames}.`
    );
  }

  return selectedRepos;
}

function normalizeRequestedNames(requestedNames) {
  return requestedNames
    .map(name => name.trim())
    .filter(Boolean);
}

async function promptForSelection(readline, {
  selectableEntries,
  conflictEntries = [],
  primarySourceOwner = null,
  defaultSourceOwner = null
}) {
  if (selectableEntries.length === 0) {
    return {
      reposToAdd: [],
      reposToOverride: []
    };
  }

  const allDisplayEntries = [
    ...selectableEntries,
    ...conflictEntries
  ];
  const selectionOptions = buildRepoSelectionOptions(selectableEntries, {
    defaultSourceOwner,
    allEntries: allDisplayEntries
  });
  const newOptions = selectionOptions
    .filter(entry => entry.status === "new")
    .map(entry => entry.label);
  const newRepos = selectionOptions
    .filter(entry => entry.status === "new")
    .map(entry => entry.repo);
  const configuredOptions = selectionOptions
    .filter(entry => entry.status === "configured")
    .map(entry => entry.label);
  const promptSections = formatSelectionSectionLines({
    title: `New (${newOptions.length})`,
    options: selectionOptions.filter(entry => entry.status === "new"),
    primarySourceOwner
  });

  if (configuredOptions.length > 0) {
    promptSections.push(...formatSelectionSectionLines({
      title: `Configured already (${configuredOptions.length})`,
      options: selectionOptions.filter(entry => entry.status === "configured"),
      primarySourceOwner
    }));
  }

  if (conflictEntries.length > 0) {
    promptSections.push(...formatSelectionSectionLines({
      title: `Name conflicts (${conflictEntries.length})`,
      options: buildRepoSelectionOptions(conflictEntries, {
        defaultSourceOwner,
        allEntries: allDisplayEntries
      }),
      primarySourceOwner
    }));
  }
  const newRepoSet = new Set(newRepos);
  const configuredRepoSet = new Set(
    selectionOptions
      .filter(entry => entry.status === "configured")
      .map(entry => entry.repo)
  );
  const selectionPrompt = newOptions.length > 0
    ? 'Select repos to add or override (comma-separated, "*" for all)\nPress Enter to add all new repos, or type repo names to customize.'
    : 'Select repos to add or override (comma-separated, "*" for all)\nPress Enter to keep the current config unchanged, or type repo names to customize.';

  while (true) {
    const answer = await readline.question(`${selectionPrompt}\n${promptSections.join("\n")}\n> `);

    let rawSelection = answer;
    if (answer.trim() === "") {
      if (newRepos.length === 0) {
        return {
          reposToAdd: [],
          reposToOverride: []
        };
      }

      const confirmation = await readline.question(
        `Add all ${newRepos.length} new repo(s)? Press Enter to confirm, or type repo names to customize.\n> `
      );

      if (confirmation.trim() === "") {
        return {
          reposToAdd: newRepos,
          reposToOverride: []
        };
      }

      rawSelection = confirmation;
    }

    try {
      const selectedRepos = resolveSelectedRepos(
        rawSelection.split(","),
        selectionOptions.map(entry => entry.repo),
        "selection",
        "selectable",
        {
          defaultSourceOwner
        }
      );

      return {
        reposToAdd: selectedRepos
          .filter(repo => newRepoSet.has(repo)),
        reposToOverride: selectedRepos
          .filter(repo => configuredRepoSet.has(repo))
      };
    } catch (error) {
      readline.write(`${error.message}\n`);
    }
  }
}

function buildRepoSelectionOptions(entries, {
  defaultSourceOwner = null,
  allEntries = entries
} = {}) {
  const repoNameCounts = buildRepoNameCounts(allEntries);

  return entries.map(entry => {
    const repo = entry.repo;
    const hasAmbiguousName = (repoNameCounts.get(getDiscoveryRepoBaseName(repo).toLowerCase()) || 0) > 1;
    const qualifiedLabel = getQualifiedRepoLabel(repo, defaultSourceOwner);
    const label = hasAmbiguousName && qualifiedLabel
      ? qualifiedLabel
      : repo.name;
    const identifiers = [label];

    if (qualifiedLabel && qualifiedLabel.toLowerCase() !== label.toLowerCase()) {
      identifiers.push(qualifiedLabel);
    }

    if (!hasAmbiguousName && label.toLowerCase() !== repo.name.toLowerCase()) {
      identifiers.push(repo.name);
    }

    return {
      ...entry,
      label,
      identifiers
    };
  });
}

function buildRepoNameCounts(entries) {
  const repoNameCounts = new Map();

  for (const entry of entries) {
    const normalizedName = getDiscoveryRepoBaseName(entry.repo).toLowerCase();
    repoNameCounts.set(normalizedName, (repoNameCounts.get(normalizedName) || 0) + 1);
  }

  return repoNameCounts;
}

function formatSelectionSectionLines({
  title,
  options,
  primarySourceOwner
}) {
  if (options.length === 0) {
    return [`${title}: none`];
  }

  const sourceOwners = new Set(
    options
      .map(option => getOwnerLabel(option.repo))
      .filter(sourceOwner => sourceOwner !== "Other")
  );

  if (sourceOwners.size <= 1) {
    return [`${title}: ${options.map(formatSelectionOptionLabel).join(", ")}`];
  }

  const groupedOptions = groupSelectionOptionsByOwner(options, primarySourceOwner);

  return [
    `${title}:`,
    ...groupedOptions.map(group => `${group.ownerLabel}: ${group.options.map(formatSelectionOptionLabel).join(", ")}`)
  ];
}

function formatSelectionOptionLabel(option) {
  if (option.status !== "conflict" || !option.configuredRepo) {
    return option.label;
  }

  return `${option.label} -> ${formatConfiguredRepoLabel(option.configuredRepo)}`;
}

function formatConfiguredRepoLabel(repo) {
  if (typeof repo.sourceFullName === "string" && repo.sourceFullName.trim() !== "") {
    return repo.sourceFullName.trim();
  }

  if (typeof repo.url === "string" && repo.url.trim() !== "") {
    const match = repo.url.trim().match(/github\.com[/:]([^/]+)\/([^/]+?)(?:\.git)?$/i);
    if (match) {
      return `${match[1]}/${match[2]}`;
    }
  }

  return repo.name;
}

function groupSelectionOptionsByOwner(options, primarySourceOwner) {
  const groupsByOwner = new Map();
  const orderedOwners = [];

  for (const option of options) {
    const ownerLabel = getOwnerLabel(option.repo);
    if (!groupsByOwner.has(ownerLabel)) {
      groupsByOwner.set(ownerLabel, []);
      orderedOwners.push(ownerLabel);
    }

    groupsByOwner.get(ownerLabel).push(option);
  }

  orderedOwners.sort((left, right) => compareOwnerLabels(left, right, primarySourceOwner));

  return orderedOwners.map(ownerLabel => ({
    ownerLabel,
    options: groupsByOwner.get(ownerLabel)
  }));
}

function getOwnerLabel(repo) {
  if (typeof repo.sourceOwner === "string" && repo.sourceOwner.trim() !== "") {
    return repo.sourceOwner.trim();
  }

  const githubIdentity = getGithubRepoIdentityFromUrl(repo.url);
  if (githubIdentity?.includes("/")) {
    return githubIdentity.split("/")[0];
  }

  return "Other";
}

function compareOwnerLabels(left, right, primarySourceOwner) {
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

function getPrimarySourceOwner(plan) {
  if (typeof plan.ownerDisplay !== "string") {
    return null;
  }

  const [primaryOwner] = plan.ownerDisplay.split(" + orgs");
  return primaryOwner?.trim() || null;
}

function getDefaultSourceOwner(plan) {
  const primarySourceOwner = getPrimarySourceOwner(plan);
  if (primarySourceOwner) {
    return primarySourceOwner;
  }

  return typeof plan.owner === "string" && plan.owner !== "@accessible"
    ? plan.owner
    : null;
}

function getRepoSelectionKey(repo) {
  return typeof repo.sourceFullName === "string" && repo.sourceFullName.trim() !== ""
    ? repo.sourceFullName.trim().toLowerCase()
    : repo.name.toLowerCase();
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

function getQualifiedRepoLabel(repo, defaultSourceOwner) {
  if (typeof repo.sourceFullName === "string" && repo.sourceFullName.trim() !== "") {
    return repo.sourceFullName.trim();
  }

  const githubIdentity = getGithubRepoIdentityFromUrl(repo.url);
  if (githubIdentity) {
    return githubIdentity;
  }

  if (typeof defaultSourceOwner === "string" && defaultSourceOwner.trim() !== "") {
    return `${defaultSourceOwner.trim()}/${repo.name}`;
  }

  return null;
}

function getGithubRepoIdentityFromUrl(url) {
  if (typeof url !== "string" || url.trim() === "") {
    return null;
  }

  const match = url.trim().match(/github\.com[/:]([^/]+)\/([^/]+?)(?:\.git)?$/i);
  if (!match) {
    return null;
  }

  return `${match[1]}/${match[2]}`;
}
