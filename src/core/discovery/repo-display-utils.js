export function getGithubRepoIdentityFromUrl(url) {
  if (typeof url !== "string" || url.trim() === "") {
    return null;
  }

  const match = url.trim().match(/github\.com[/:]([^/]+)\/([^/]+?)(?:\.git)?$/i);
  if (!match) {
    return null;
  }

  return `${match[1]}/${match[2]}`;
}

export function getGithubRepoDisplayIdentity(repo) {
  if (typeof repo?.sourceFullName === "string" && repo.sourceFullName.trim() !== "") {
    return repo.sourceFullName.trim();
  }

  return getGithubRepoIdentityFromUrl(repo?.url);
}

export function getDiscoveryRepoBaseName(repo) {
  if (typeof repo?.sourceFullName === "string" && repo.sourceFullName.includes("/")) {
    return repo.sourceFullName.split("/").pop().trim();
  }

  if (typeof repo?.name === "string" && repo.name.includes("/")) {
    return repo.name.split("/").pop().trim();
  }

  return repo?.name;
}

export function getDiscoveryOwnerLabel(repo) {
  if (typeof repo?.sourceOwner === "string" && repo.sourceOwner.trim() !== "") {
    return repo.sourceOwner.trim();
  }

  const githubIdentity = getGithubRepoDisplayIdentity(repo);
  if (githubIdentity?.includes("/")) {
    return githubIdentity.split("/")[0];
  }

  return "Other";
}

export function compareDiscoveryOwnerLabels(left, right, primarySourceOwner) {
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

export function getPrimarySourceOwner(ownerDisplay) {
  if (typeof ownerDisplay !== "string") {
    return null;
  }

  const [primaryOwner] = ownerDisplay.split(" + orgs");
  return primaryOwner?.trim() || null;
}

export function groupDiscoveryItemsByOwner(items, {
  getRepo = item => item?.repo,
  primarySourceOwner = null
} = {}) {
  const groupsByOwner = new Map();
  const orderedOwners = [];

  for (const item of items) {
    const ownerLabel = getDiscoveryOwnerLabel(getRepo(item));
    if (!groupsByOwner.has(ownerLabel)) {
      groupsByOwner.set(ownerLabel, []);
      orderedOwners.push(ownerLabel);
    }

    groupsByOwner.get(ownerLabel).push(item);
  }

  orderedOwners.sort((left, right) => compareDiscoveryOwnerLabels(left, right, primarySourceOwner));

  return orderedOwners.map(ownerLabel => ({
    ownerLabel,
    items: groupsByOwner.get(ownerLabel)
  }));
}
