import { applyGithubDiscoveryToConfig, loadConfig } from "../config/config.js";
import {
  buildAppliedGithubDiscoveryEntries,
  discoverGithubOwnerRepos,
  getGithubDiscoveryRepoKey,
  mergeGithubDiscoveryPlan,
  planGithubRepoDiscovery,
  refineDiscoveredGithubRepos
} from "./github-catalog.js";

export async function runGithubDiscoveryPipeline({
  config,
  owner,
  env,
  apply = false,
  hydrateMetadata = true,
  includeForks = true,
  includeArchived = false,
  resolveSelectionFn = null,
  onProgress = null,
  loadConfigFn = loadConfig,
  applyGithubDiscoveryToConfigFn = applyGithubDiscoveryToConfig,
  discoverGithubOwnerReposFn = discoverGithubOwnerRepos,
  planGithubRepoDiscoveryFn = planGithubRepoDiscovery,
  refineDiscoveredGithubReposFn = refineDiscoveredGithubRepos,
  mergeGithubDiscoveryPlanFn = mergeGithubDiscoveryPlan,
  buildAppliedGithubDiscoveryEntriesFn = buildAppliedGithubDiscoveryEntries,
  getGithubDiscoveryRepoKeyFn = getGithubDiscoveryRepoKey
}) {
  const discovery = await discoverGithubOwnerReposFn({
    owner,
    env,
    curateWithCodex: false,
    inspectRepos: false,
    hydrateMetadata,
    onProgress,
    includeForks,
    includeArchived
  });
  let plan = planGithubRepoDiscoveryFn(config, discovery);

  if (!apply) {
    return {
      applied: false,
      plan
    };
  }

  if (typeof resolveSelectionFn !== "function") {
    throw new Error("GitHub discovery apply requires a selection resolver.");
  }

  let selection = await resolveSelectionFn(plan);
  const selectedRepoNames = collectSelectedRepoNames(selection);
  let configPath = config.configPath;
  let addedCount = 0;
  let overriddenCount = 0;

  if (selectedRepoNames.length > 0) {
    const selectedRepoActions = buildSelectedRepoActions(selection, getGithubDiscoveryRepoKeyFn);
    const refinedDiscovery = await refineDiscoveredGithubReposFn({
      discovery,
      env,
      curateWithCodex: true,
      inspectRepos: true,
      selectedRepoNames,
      onHydratedRepo: async repo => {
        const action = selectedRepoActions.get(getGithubDiscoveryRepoKeyFn(repo));
        if (!action) {
          return;
        }

        const applyResult = await applyGithubDiscoveryToConfigFn({
          env,
          reposToAdd: action === "add" ? [repo] : [],
          reposToOverride: action === "override" ? [repo] : []
        });
        configPath = applyResult.configPath;
        if (action === "add") {
          addedCount += 1;
        } else {
          overriddenCount += 1;
        }

        onProgress?.({
          type: "repo-applied",
          repoName: repo.name,
          processedCount: addedCount + overriddenCount,
          totalCount: selectedRepoNames.length
        });
      },
      onProgress,
      includeForks,
      includeArchived
    });
    const refreshedConfig = await loadConfigFn(env);
    const refinedPlan = planGithubRepoDiscoveryFn(refreshedConfig, refinedDiscovery);
    const refinedReposByKey = new Map(
      refinedPlan.entries.map(entry => [getGithubDiscoveryRepoKeyFn(entry.repo), entry.repo])
    );

    plan = mergeGithubDiscoveryPlanFn(plan, refinedPlan);
    selection = {
      reposToAdd: selection.reposToAdd.map(
        repo => refinedReposByKey.get(getGithubDiscoveryRepoKeyFn(repo)) || repo
      ),
      reposToOverride: selection.reposToOverride.map(
        repo => refinedReposByKey.get(getGithubDiscoveryRepoKeyFn(repo)) || repo
      )
    };
  }

  return {
    applied: true,
    plan,
    selection,
    appliedEntries: buildAppliedGithubDiscoveryEntriesFn(plan, selection),
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

export function buildSelectedRepoActions(selection, getGithubDiscoveryRepoKeyFn = getGithubDiscoveryRepoKey) {
  return new Map([
    ...selection.reposToAdd.map(repo => [getGithubDiscoveryRepoKeyFn(repo), "add"]),
    ...selection.reposToOverride.map(repo => [getGithubDiscoveryRepoKeyFn(repo), "override"])
  ]);
}
