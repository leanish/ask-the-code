import path from "node:path";

import { getGithubRepoIdentityFromUrl } from "./repo-identifiers.ts";
import type { RepoRecord } from "../types.ts";

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
