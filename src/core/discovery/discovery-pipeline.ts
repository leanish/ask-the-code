import { applyGithubDiscoveryToConfig } from "../config/config.js";
import {
  buildAppliedGithubDiscoveryEntries,
  discoverGithubOwnerRepos,
  getGithubDiscoveryRepoKey,
  planGithubRepoDiscovery,
  refineDiscoveredGithubRepos
} from "./github-catalog.js";
import type {
  Environment,
  GithubDiscoveryPipelineResult,
  GithubDiscoveryPlan,
  GithubDiscoveryProgressEvent,
  GithubDiscoverySelection,
  LoadedConfig
} from "../types.js";

type DiscoveryRunOptions = {
  config: LoadedConfig;
  owner: string;
  env: Environment;
  includeForks?: boolean;
  includeArchived?: boolean;
  resolveSelectionFn: (plan: GithubDiscoveryPlan) => Promise<GithubDiscoverySelection> | GithubDiscoverySelection;
  onProgress?: (event: GithubDiscoveryProgressEvent) => void;
  applyGithubDiscoveryToConfigFn?: typeof applyGithubDiscoveryToConfig;
  discoverGithubOwnerReposFn?: typeof discoverGithubOwnerRepos;
  planGithubRepoDiscoveryFn?: typeof planGithubRepoDiscovery;
  refineDiscoveredGithubReposFn?: typeof refineDiscoveredGithubRepos;
  buildAppliedGithubDiscoveryEntriesFn?: typeof buildAppliedGithubDiscoveryEntries;
  getGithubDiscoveryRepoKeyFn?: typeof getGithubDiscoveryRepoKey;
};
type SelectedGithubDiscoveryRepos = Pick<GithubDiscoverySelection, "reposToAdd" | "reposToOverride">;

export async function runGithubDiscoveryPipeline({
  config,
  owner,
  env,
  includeForks = true,
  includeArchived = false,
  resolveSelectionFn,
  onProgress,
  applyGithubDiscoveryToConfigFn = applyGithubDiscoveryToConfig,
  discoverGithubOwnerReposFn = discoverGithubOwnerRepos,
  planGithubRepoDiscoveryFn = planGithubRepoDiscovery,
  refineDiscoveredGithubReposFn = refineDiscoveredGithubRepos,
  buildAppliedGithubDiscoveryEntriesFn = buildAppliedGithubDiscoveryEntries,
  getGithubDiscoveryRepoKeyFn = getGithubDiscoveryRepoKey
}: DiscoveryRunOptions): Promise<GithubDiscoveryPipelineResult> {
  if (typeof resolveSelectionFn !== "function") {
    throw new Error("GitHub discovery requires a selection resolver.");
  }

  const discovery = await discoverGithubOwnerReposFn({
    owner,
    env,
    curateWithCodex: false,
    inspectRepos: false,
    hydrateMetadata: false,
    onProgress: onProgress ?? null,
    includeForks,
    includeArchived
  });
  const plan = planGithubRepoDiscoveryFn(config, discovery);

  const selection = await resolveSelectionFn(plan);
  const selectedRepoNames = collectSelectedRepoNames(selection);
  const selectedCount = selectedRepoNames.length;
  const appliedEntries = buildAppliedGithubDiscoveryEntriesFn(plan, selection);

  if (selectedCount === 0) {
    return {
      plan,
      appliedEntries,
      selectedCount,
      configPath: config.configPath,
      addedCount: 0,
      overriddenCount: 0
    };
  }

  const refinedDiscovery = await refineDiscoveredGithubReposFn({
    discovery,
    env,
    curateWithCodex: true,
    inspectRepos: true,
    selectedRepoNames,
    onProgress: onProgress ?? null,
    includeForks,
    includeArchived
  });
  const refinedPlan = planGithubRepoDiscoveryFn(config, refinedDiscovery);
  const refinedSelection = refineGithubDiscoverySelection(
    selection,
    refinedPlan,
    getGithubDiscoveryRepoKeyFn
  );
  const applyResult = await applyGithubDiscoveryToConfigFn({
    env,
    reposToAdd: refinedSelection.reposToAdd,
    reposToOverride: refinedSelection.reposToOverride
  });

  return {
    plan,
    appliedEntries: buildAppliedGithubDiscoveryEntriesFn(refinedPlan, refinedSelection),
    selectedCount,
    configPath: applyResult.configPath,
    addedCount: applyResult.addedCount,
    overriddenCount: applyResult.overriddenCount ?? 0
  };
}

export function collectSelectedRepoNames(selection: GithubDiscoverySelection): string[] {
  return [...new Set([
    ...selection.reposToAdd.map(repo => repo.sourceFullName || repo.name),
    ...selection.reposToOverride.map(repo => repo.sourceFullName || repo.name)
  ])];
}

function refineGithubDiscoverySelection(
  selection: GithubDiscoverySelection,
  refinedPlan: GithubDiscoveryPlan,
  getGithubDiscoveryRepoKeyFn: typeof getGithubDiscoveryRepoKey
): SelectedGithubDiscoveryRepos {
  const refinedReposByKey = new Map(
    refinedPlan.entries.map(entry => [getGithubDiscoveryRepoKeyFn(entry.repo), entry.repo])
  );

  return {
    reposToAdd: replaceWithRefinedRepos(selection.reposToAdd, refinedReposByKey, getGithubDiscoveryRepoKeyFn),
    reposToOverride: replaceWithRefinedRepos(
      selection.reposToOverride,
      refinedReposByKey,
      getGithubDiscoveryRepoKeyFn
    )
  };
}

function replaceWithRefinedRepos(
  repos: GithubDiscoverySelection["reposToAdd"],
  refinedReposByKey: Map<string, GithubDiscoverySelection["reposToAdd"][number]>,
  getGithubDiscoveryRepoKeyFn: typeof getGithubDiscoveryRepoKey
): GithubDiscoverySelection["reposToAdd"] {
  return repos.map(repo => refinedReposByKey.get(getGithubDiscoveryRepoKeyFn(repo)) || repo);
}
