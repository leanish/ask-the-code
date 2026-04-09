import path from "node:path";

import type { RepoRecord } from "../types.js";

type RepoPathLike = Pick<RepoRecord, "name" | "url" | "sourceFullName">;

export function getManagedRepoDirectory(managedReposRoot: string, repo: RepoPathLike): string {
  return path.join(managedReposRoot, getManagedRepoRelativePath(repo));
}

export function getManagedRepoRelativePath(repo: RepoPathLike): string {
  if (typeof repo?.sourceFullName === "string" && repo.sourceFullName.trim() !== "") {
    return repo.sourceFullName.trim();
  }

  const githubIdentity = getGithubRepoIdentityFromUrl(repo?.url);
  if (githubIdentity) {
    return githubIdentity;
  }

  return typeof repo?.name === "string" ? repo.name : "";
}

function getGithubRepoIdentityFromUrl(url: string | undefined): string | null {
  if (typeof url !== "string" || url.trim() === "") {
    return null;
  }

  const match = url.trim().match(/github\.com[/:]([^/]+)\/([^/]+?)(?:\.git)?$/i);
  if (!match) {
    return null;
  }

  return `${match[1]}/${match[2]}`;
}
