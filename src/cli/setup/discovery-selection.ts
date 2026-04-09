import { createInterface } from "node:readline/promises";
import process from "node:process";

import {
  getDiscoveryOwnerLabel,
  getDiscoveryRepoBaseName,
  getGithubRepoDisplayIdentity,
  getGithubRepoIdentityFromUrl,
  getPrimarySourceOwner,
  groupDiscoveryItemsByOwner
} from "../../core/discovery/repo-display-utils.js";
import {
  canPromptInteractively,
  defaultCreateInterface,
  promptLineOrCancel,
  type CreateInterfaceFn,
  type PromptInput,
  type PromptOutput
} from "./interactive-prompts.js";
import type {
  GithubDiscoveryPlan,
  GithubDiscoveryPlanEntry,
  GithubDiscoverySelection,
  ManagedRepoDefinition,
  RepoRecord
} from "../../core/types.js";

type GithubDiscoverySelectionPlan = Pick<GithubDiscoveryPlan, "entries"> & Partial<Pick<GithubDiscoveryPlan, "owner" | "ownerDisplay">>;
type SelectableEntry = Pick<GithubDiscoveryPlanEntry, "status" | "repo">;
type ConflictEntry = Pick<GithubDiscoveryPlanEntry, "status" | "repo" | "configuredRepo">;
type DisplayEntry = SelectableEntry | ConflictEntry;
type SelectionOption = DisplayEntry & {
  label: string;
  identifiers: string[];
  configuredRepo?: ManagedRepoDefinition | null;
};
type AddAllPromptResult =
  | { type: "cancel" }
  | { type: "confirm" }
  | { type: "customize"; value: string };

export function selectGithubDiscoveryRepos(plan: GithubDiscoverySelectionPlan, {
  addRepoNames = [],
  overrideRepoNames = []
}: {
  addRepoNames?: string[];
  overrideRepoNames?: string[];
} = {}): GithubDiscoverySelection {
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

export async function promptGithubDiscoverySelection(plan: GithubDiscoverySelectionPlan, {
  input = process.stdin,
  output = process.stdout,
  createInterfaceFn = defaultCreateInterface
}: {
  input?: PromptInput;
  output?: PromptOutput;
  createInterfaceFn?: CreateInterfaceFn;
} = {}): Promise<GithubDiscoverySelection> {
  if (!canPromptInteractively({ input, output })) {
    throw new Error(
      'Interactive GitHub discovery requires a TTY. Re-run in a terminal, or pass explicit --add/--override selections.'
    );
  }

  const selectableEntries = getSelectableEntries(plan);
  const conflictEntries = getConflictEntries(plan);
  return await promptForSelection({
    input,
    output,
    createInterfaceFn,
    selectableEntries,
    conflictEntries,
    primarySourceOwner: getPrimarySourceOwner(plan.ownerDisplay ?? undefined),
    defaultSourceOwner: getDefaultSourceOwner(plan)
  });
}

function getAddableRepos(plan: GithubDiscoverySelectionPlan): RepoRecord[] {
  return plan.entries
    .filter(entry => entry.status === "new")
    .map(entry => entry.repo);
}

function getOverridableRepos(plan: GithubDiscoverySelectionPlan): RepoRecord[] {
  return plan.entries
    .filter(entry => entry.status === "configured")
    .map(entry => entry.repo);
}

function getSelectableEntries(plan: GithubDiscoverySelectionPlan): SelectableEntry[] {
  return plan.entries
    .filter(entry => entry.status === "new" || entry.status === "configured")
    .map(entry => ({
      status: entry.status,
      repo: entry.repo
    }));
}

function getConflictEntries(plan: GithubDiscoverySelectionPlan): ConflictEntry[] {
  return plan.entries
    .filter(entry => entry.status === "conflict")
    .map(entry => ({
      status: entry.status,
      repo: entry.repo,
      configuredRepo: entry.configuredRepo
    }));
}

function resolveSelectedRepos(
  requestedNames: string[],
  availableRepos: RepoRecord[],
  flagName: string,
  selectionKind: string,
  {
  defaultSourceOwner = null
  }: {
    defaultSourceOwner?: string | null;
  } = {}
): RepoRecord[] {
  const normalizedNames = normalizeRequestedNames(requestedNames);
  if (normalizedNames.length === 0) {
    return [];
  }

  if (normalizedNames.length === 1 && normalizedNames[0] === "*") {
    return [...availableRepos];
  }

  const selectionOptions = buildRepoSelectionOptions(
    availableRepos.map(repo => ({
      status: "new" as const,
      repo
    })),
    {
      defaultSourceOwner
    }
  );
  const reposByIdentifier = new Map<string, RepoRecord>();

  for (const option of selectionOptions) {
    for (const identifier of option.identifiers) {
      reposByIdentifier.set(identifier.toLowerCase(), option.repo);
    }
  }
  const missingNames: string[] = [];
  const selectedRepos: RepoRecord[] = [];

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

function normalizeRequestedNames(requestedNames: string[]): string[] {
  return requestedNames
    .map(name => name.trim())
    .filter(Boolean);
}

async function promptForSelection({
  input,
  output,
  createInterfaceFn,
  selectableEntries,
  conflictEntries = [],
  primarySourceOwner = null,
  defaultSourceOwner = null
}: {
  input: PromptInput;
  output: PromptOutput;
  createInterfaceFn: CreateInterfaceFn;
  selectableEntries: SelectableEntry[];
  conflictEntries?: ConflictEntry[];
  primarySourceOwner?: string | null;
  defaultSourceOwner?: string | null;
}): Promise<GithubDiscoverySelection> {
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
    ? 'Select repos to add or override (comma-separated, "*" for all)\nPress Enter to add all new repos, press Esc to cancel, or type repo names to customize.'
    : 'Select repos to add or override (comma-separated, "*" for all)\nPress Enter to keep the current config unchanged, press Esc to cancel, or type repo names to customize.';

  while (true) {
    const answer = await promptLineOrCancel({
      input,
      output,
      createInterfaceFn,
      prompt: `${selectionPrompt}\n${promptSections.join("\n")}\n> `,
      nonInteractiveError: 'Interactive GitHub discovery requires a TTY. Re-run in a terminal, or pass explicit --add/--override selections.'
    });

    if (answer === null) {
      return {
        reposToAdd: [],
        reposToOverride: []
      };
    }

    let rawSelection = answer;
    if (answer.trim() === "") {
      if (newRepos.length === 0) {
        return {
          reposToAdd: [],
          reposToOverride: []
        };
      }

      const confirmation = await promptAddAllOrCustomize({
        input,
        output,
        createInterfaceFn,
        newRepoCount: newRepos.length
      });

      if (confirmation.type === "cancel") {
        return {
          reposToAdd: [],
          reposToOverride: []
        };
      }

      if (confirmation.type === "confirm") {
        return {
          reposToAdd: newRepos,
          reposToOverride: []
        };
      }

      rawSelection = confirmation.value;
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
      const message = error instanceof Error ? error.message : String(error);
      output.write?.(`${message}\n`);
    }
  }
}

async function promptAddAllOrCustomize({
  input,
  output,
  createInterfaceFn,
  newRepoCount
}: {
  input: PromptInput;
  output: PromptOutput;
  createInterfaceFn: CreateInterfaceFn;
  newRepoCount: number;
}): Promise<AddAllPromptResult> {
  const prompt = `Add all ${newRepoCount} new repo(s)? Press Enter to confirm, or type repo names to customize.\n> `;

  const answer = await promptLineOrCancel({
    input,
    output,
    createInterfaceFn,
    prompt,
    nonInteractiveError: 'Interactive GitHub discovery requires a TTY. Re-run in a terminal, or pass explicit --add/--override selections.'
  });

  if (answer === null) {
    return {
      type: "cancel"
    };
  }

  if (answer.trim() === "") {
    return {
      type: "confirm"
    };
  }

  return {
    type: "customize",
    value: answer
  };
}

function buildRepoSelectionOptions<T extends DisplayEntry>(entries: T[], {
  defaultSourceOwner = null,
  allEntries = entries
}: {
  defaultSourceOwner?: string | null;
  allEntries?: DisplayEntry[];
} = {}): Array<T & Pick<SelectionOption, "label" | "identifiers">> {
  const repoNameCounts = buildRepoNameCounts(allEntries);

  return entries.map(entry => {
    const repo = entry.repo;
    const hasAmbiguousName = (repoNameCounts.get(getDiscoveryRepoBaseName(repo).toLowerCase()) || 0) > 1;
    const qualifiedLabel = getQualifiedRepoLabel(repo, defaultSourceOwner);
    const label = hasAmbiguousName && qualifiedLabel
      ? qualifiedLabel
      : repo.name;
    const identifiers: string[] = [label];

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

function buildRepoNameCounts(entries: DisplayEntry[]): Map<string, number> {
  const repoNameCounts = new Map<string, number>();

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
}: {
  title: string;
  options: SelectionOption[];
  primarySourceOwner?: string | null;
}): string[] {
  if (options.length === 0) {
    return [`${title}: none`];
  }

  const sourceOwners = new Set(
    options
      .map(option => getDiscoveryOwnerLabel(option.repo))
      .filter(sourceOwner => sourceOwner !== "Other")
  );

  if (sourceOwners.size <= 1) {
    return [`${title}: ${options.map(formatSelectionOptionLabel).join(", ")}`];
  }

  const groupedOptions = groupDiscoveryItemsByOwner(options, {
    getRepo: option => option.repo,
    primarySourceOwner: primarySourceOwner ?? null
  });

  return [
    `${title}:`,
    ...groupedOptions.map(group => `${group.ownerLabel}: ${group.items.map(formatSelectionOptionLabel).join(", ")}`)
  ];
}

function formatSelectionOptionLabel(option: SelectionOption): string {
  if (option.status !== "conflict" || !option.configuredRepo) {
    return option.label;
  }

  return `${option.label} -> ${formatConfiguredRepoLabel(option.configuredRepo)}`;
}

function formatConfiguredRepoLabel(repo: ManagedRepoDefinition): string {
  const githubIdentity = getGithubRepoDisplayIdentity(repo);
  if (githubIdentity) {
    return githubIdentity;
  }

  return repo.name;
}

function getDefaultSourceOwner(plan: GithubDiscoverySelectionPlan): string | null {
  const primarySourceOwner = getPrimarySourceOwner(plan.ownerDisplay ?? undefined);
  if (primarySourceOwner) {
    return primarySourceOwner;
  }

  return typeof plan.owner === "string" && plan.owner !== "@accessible"
    ? plan.owner
    : null;
}

function getRepoSelectionKey(repo: RepoRecord): string {
  return typeof repo.sourceFullName === "string" && repo.sourceFullName.trim() !== ""
    ? repo.sourceFullName.trim().toLowerCase()
    : repo.name.toLowerCase();
}

function getQualifiedRepoLabel(repo: RepoRecord, defaultSourceOwner: string | null): string | null {
  const githubIdentity = getGithubRepoDisplayIdentity(repo) || getGithubRepoIdentityFromUrl(repo.url);
  if (githubIdentity) {
    return githubIdentity;
  }

  if (typeof defaultSourceOwner === "string" && defaultSourceOwner.trim() !== "") {
    return `${defaultSourceOwner.trim()}/${repo.name}`;
  }

  return null;
}
