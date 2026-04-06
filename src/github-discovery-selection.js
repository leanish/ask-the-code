import { createInterface } from "node:readline/promises";
import process from "node:process";

export function selectGithubDiscoveryRepos(plan, {
  addRepoNames = [],
  overrideRepoNames = []
} = {}) {
  const addableRepos = getAddableRepos(plan);
  const overridableRepos = getOverridableRepos(plan);

  return {
    reposToAdd: resolveSelectedRepos(addRepoNames, addableRepos, "--add", "new"),
    reposToOverride: resolveSelectedRepos(overrideRepoNames, overridableRepos, "--override", "configured")
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
  const readline = createInterfaceFn({
    input,
    output
  });

  try {
    return await promptForSelection(readline, {
      selectableEntries
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

function resolveSelectedRepos(requestedNames, availableRepos, flagName, selectionKind) {
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
    }))
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
    if (!selectedRepos.some(candidate => candidate.name === repo.name)) {
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
  selectableEntries
}) {
  if (selectableEntries.length === 0) {
    return {
      reposToAdd: [],
      reposToOverride: []
    };
  }

  const selectionOptions = buildRepoSelectionOptions(selectableEntries);
  const newOptions = selectionOptions
    .filter(entry => entry.status === "new")
    .map(entry => entry.label);
  const newRepos = selectionOptions
    .filter(entry => entry.status === "new")
    .map(entry => entry.repo);
  const configuredOptions = selectionOptions
    .filter(entry => entry.status === "configured")
    .map(entry => entry.label);
  const promptSections = [
    `New (${newOptions.length}): ${newOptions.join(", ") || "none"}`
  ];

  if (configuredOptions.length > 0) {
    promptSections.push(`Configured already (${configuredOptions.length}): ${configuredOptions.join(", ")}`);
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
        "selectable"
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

function buildRepoSelectionOptions(entries) {
  const sourceOwners = new Set(
    entries
      .map(entry => entry.repo.sourceOwner)
      .filter(sourceOwner => typeof sourceOwner === "string" && sourceOwner !== "")
  );
  const hasMultipleSourceOwners = sourceOwners.size > 1;
  const repoNameCounts = new Map();

  for (const entry of entries) {
    const normalizedName = entry.repo.name.toLowerCase();
    repoNameCounts.set(normalizedName, (repoNameCounts.get(normalizedName) || 0) + 1);
  }

  return entries.map(entry => {
    const repo = entry.repo;
    const hasAmbiguousName = (repoNameCounts.get(repo.name.toLowerCase()) || 0) > 1;
    const label = (hasMultipleSourceOwners || hasAmbiguousName) && repo.sourceFullName
      ? repo.sourceFullName
      : repo.name;
    const identifiers = [label];

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
