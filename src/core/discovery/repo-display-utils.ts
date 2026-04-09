import type { RepoRecord } from "../types.js";

export function getGithubRepoIdentityFromUrl(url: string | undefined): string | null {
  if (typeof url !== "string" || url.trim() === "") {
    return null;
  }

  const match = url.trim().match(/github\.com[/:]([^/]+)\/([^/]+?)(?:\.git)?$/i);
  if (!match) {
    return null;
  }

  return `${match[1]}/${match[2]}`;
}

export function getGithubRepoDisplayIdentity(
  repo: Partial<Pick<RepoRecord, "sourceFullName" | "url">> | null | undefined
): string | null {
  if (typeof repo?.sourceFullName === "string" && repo.sourceFullName.trim() !== "") {
    return repo.sourceFullName.trim();
  }

  return getGithubRepoIdentityFromUrl(repo?.url);
}

export function getDiscoveryRepoBaseName(
  repo: Partial<Pick<RepoRecord, "name" | "sourceFullName">> | null | undefined
): string {
  if (typeof repo?.sourceFullName === "string" && repo.sourceFullName.includes("/")) {
    return repo.sourceFullName.split("/").pop()?.trim() ?? "";
  }

  if (typeof repo?.name === "string" && repo.name.includes("/")) {
    return repo.name.split("/").pop()?.trim() ?? "";
  }

  return typeof repo?.name === "string" ? repo.name : "";
}

export function getDiscoveryOwnerLabel(
  repo: Partial<Pick<RepoRecord, "sourceFullName" | "sourceOwner" | "url">> | null | undefined
): string {
  if (typeof repo?.sourceOwner === "string" && repo.sourceOwner.trim() !== "") {
    return repo.sourceOwner.trim();
  }

  const githubIdentity = getGithubRepoDisplayIdentity(repo);
  if (githubIdentity?.includes("/")) {
    return githubIdentity.split("/")[0] ?? "Other";
  }

  return "Other";
}

export function compareDiscoveryOwnerLabels(left: string, right: string, primarySourceOwner: string | null): number {
  const normalizedPrimaryOwner = typeof primarySourceOwner === "string"
    ? primarySourceOwner.trim().toLowerCase()
    : "";
  const normalizedLeft = left.toLowerCase();
  const normalizedRight = right.toLowerCase();

  if (normalizedPrimaryOwner) {
    if (normalizedLeft === normalizedPrimaryOwner && normalizedRight !== normalizedPrimaryOwner) {
      return -1;
    }

    if (normalizedRight === normalizedPrimaryOwner && normalizedLeft !== normalizedPrimaryOwner) {
      return 1;
    }
  }

  return normalizedLeft.localeCompare(normalizedRight);
}

export function getPrimarySourceOwner(ownerDisplay: string | undefined): string | null {
  if (typeof ownerDisplay !== "string") {
    return null;
  }

  const [primaryOwner] = ownerDisplay.split(" + orgs");
  return primaryOwner?.trim() || null;
}

export function groupDiscoveryItemsByOwner<T>(
  items: T[],
  {
    getRepo = (item: T) => (item as { repo: RepoRecord }).repo,
  primarySourceOwner = null
  }: {
    getRepo?: (item: T) => Pick<RepoRecord, "sourceFullName" | "sourceOwner" | "url">;
    primarySourceOwner?: string | null;
  } = {}
): Array<{ ownerLabel: string; items: T[] }> {
  const groupsByOwner = new Map<string, T[]>();
  const orderedOwners: string[] = [];

  for (const item of items) {
    const ownerLabel = getDiscoveryOwnerLabel(getRepo(item));
    if (!groupsByOwner.has(ownerLabel)) {
      groupsByOwner.set(ownerLabel, []);
      orderedOwners.push(ownerLabel);
    }

    groupsByOwner.get(ownerLabel)?.push(item);
  }

  orderedOwners.sort((left, right) => compareDiscoveryOwnerLabels(left, right, primarySourceOwner));

  return orderedOwners.map(ownerLabel => ({
    ownerLabel,
    items: groupsByOwner.get(ownerLabel) ?? []
  }));
}
