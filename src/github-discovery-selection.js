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

  const addableRepos = getAddableRepos(plan);
  const overridableRepos = getOverridableRepos(plan);
  const readline = createInterfaceFn({
    input,
    output
  });

  try {
    const reposToAdd = await promptForSelection(readline, {
      availableRepos: addableRepos,
      promptLabel: "Add repos",
      selectionKind: "new"
    });
    const reposToOverride = await promptForSelection(readline, {
      availableRepos: overridableRepos,
      promptLabel: "Override repos",
      selectionKind: "configured"
    });

    return {
      reposToAdd,
      reposToOverride
    };
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

function resolveSelectedRepos(requestedNames, availableRepos, flagName, selectionKind) {
  const normalizedNames = normalizeRequestedNames(requestedNames);
  if (normalizedNames.length === 0) {
    return [];
  }

  if (normalizedNames.length === 1 && normalizedNames[0] === "*") {
    return [...availableRepos];
  }

  const reposByName = new Map(
    availableRepos.map(repo => [repo.name.toLowerCase(), repo])
  );
  const missingNames = [];
  const selectedRepos = [];

  for (const requestedName of normalizedNames) {
    const repo = reposByName.get(requestedName.toLowerCase());
    if (!repo) {
      missingNames.push(requestedName);
      continue;
    }
    if (!selectedRepos.some(candidate => candidate.name === repo.name)) {
      selectedRepos.push(repo);
    }
  }

  if (missingNames.length > 0) {
    const availableNames = availableRepos.map(repo => repo.name).join(", ") || "none";
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
  availableRepos,
  promptLabel,
  selectionKind
}) {
  if (availableRepos.length === 0) {
    return [];
  }

  const availableNames = availableRepos.map(repo => repo.name).join(", ");

  while (true) {
    const answer = await readline.question(
      `${promptLabel} (${selectionKind}; comma-separated, "*" for all, blank for none)\n${availableNames}\n> `
    );

    try {
      return resolveSelectedRepos(answer.split(","), availableRepos, promptLabel, selectionKind);
    } catch (error) {
      readline.write(`${error.message}\n`);
    }
  }
}
