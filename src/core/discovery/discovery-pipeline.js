import { applyGithubDiscoveryToConfig } from "../config/config.js";
import {
  buildAppliedGithubDiscoveryEntries,
  discoverGithubOwnerRepos,
  getGithubDiscoveryRepoKey,
  planGithubRepoDiscovery,
  refineDiscoveredGithubRepos
} from "./github-catalog.js";

export async function runGithubDiscoveryPipeline({
  config,
  owner,
  env,
  includeForks = true,
  includeArchived = false,
  resolveSelectionFn = null,
  onProgress = null,
  applyGithubDiscoveryToConfigFn = applyGithubDiscoveryToConfig,
  discoverGithubOwnerReposFn = discoverGithubOwnerRepos,
  planGithubRepoDiscoveryFn = planGithubRepoDiscovery,
  refineDiscoveredGithubReposFn = refineDiscoveredGithubRepos,
  buildAppliedGithubDiscoveryEntriesFn = buildAppliedGithubDiscoveryEntries,
  getGithubDiscoveryRepoKeyFn = getGithubDiscoveryRepoKey
}) {
  if (typeof resolveSelectionFn !== "function") {
    throw new Error("GitHub discovery requires a selection resolver.");
  }

  const discovery = await discoverGithubOwnerReposFn({
    owner,
    env,
    curateWithCodex: false,
    inspectRepos: false,
    hydrateMetadata: false,
    onProgress,
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
      onProgress,
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
    overriddenCount = applyResult.overriddenCount;
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

export function collectSelectedRepoNames(selection) {
  return [...new Set([
    ...selection.reposToAdd.map(repo => repo.sourceFullName || repo.name),
    ...selection.reposToOverride.map(repo => repo.sourceFullName || repo.name)
  ])];
}
