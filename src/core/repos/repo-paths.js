import path from "node:path";

export function getManagedRepoDirectory(managedReposRoot, repo) {
  return path.join(managedReposRoot, getManagedRepoRelativePath(repo));
}

export function getManagedRepoRelativePath(repo) {
  if (typeof repo?.sourceFullName === "string" && repo.sourceFullName.trim() !== "") {
    return repo.sourceFullName.trim();
  }

  const githubIdentity = getGithubRepoIdentityFromUrl(repo?.url);
  if (githubIdentity) {
    return githubIdentity;
  }

  return typeof repo?.name === "string" ? repo.name : "";
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
