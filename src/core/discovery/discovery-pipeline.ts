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
  let configPath = config.configPath;
  let addedCount = 0;
  let overriddenCount = 0;
  let appliedEntries = buildAppliedGithubDiscoveryEntriesFn(plan, selection);
  let reposToAdd = selection.reposToAdd;
  let reposToOverride = selection.reposToOverride;

  if (selectedRepoNames.length > 0) {
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
    const refinedReposByKey = new Map(
      refinedPlan.entries.map(entry => [getGithubDiscoveryRepoKeyFn(entry.repo), entry.repo])
    );

    reposToAdd = selection.reposToAdd.map(
      repo => refinedReposByKey.get(getGithubDiscoveryRepoKeyFn(repo)) || repo
    );
    reposToOverride = selection.reposToOverride.map(
      repo => refinedReposByKey.get(getGithubDiscoveryRepoKeyFn(repo)) || repo
    );
    appliedEntries = buildAppliedGithubDiscoveryEntriesFn(refinedPlan, {
      reposToAdd,
      reposToOverride
    });

    const applyResult = await applyGithubDiscoveryToConfigFn({
      env,
      reposToAdd,
      reposToOverride
    });
    configPath = applyResult.configPath;
    addedCount = applyResult.addedCount;
    overriddenCount = applyResult.overriddenCount ?? 0;
  }

  return {
    plan,
    appliedEntries,
    selectedCount: selectedRepoNames.length,
    configPath,
    addedCount,
    overriddenCount
  };
}

export function collectSelectedRepoNames(selection: GithubDiscoverySelection): string[] {
  return [...new Set([
    ...selection.reposToAdd.map(repo => repo.sourceFullName || repo.name),
    ...selection.reposToOverride.map(repo => repo.sourceFullName || repo.name)
  ])];
}
