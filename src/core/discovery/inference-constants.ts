const SMALL_REPO_MAX_INFERRED_TOPICS = 3;
const MEDIUM_REPO_MAX_INFERRED_TOPICS = 5;
const LARGE_REPO_MAX_INFERRED_TOPICS = 8;
const HUGE_REPO_MAX_INFERRED_TOPICS = 20;
const MASSIVE_REPO_MAX_INFERRED_TOPICS = 30;

export const EXTERNAL_FACING_PHRASES: readonly string[] = [
  "external",
  "customer-facing",
  "user-facing",
  "merchant-facing",
  "partner-facing",
  "storefront",
  "checkout",
  "onboarding",
  "pricing",
  "public api",
  "public-api",
  "public endpoint"
];

export function getMaxInferredTopics(sizeKb: number | null | undefined): number {
  if (typeof sizeKb !== "number" || Number.isNaN(sizeKb)) {
    return MEDIUM_REPO_MAX_INFERRED_TOPICS;
  }

  if (sizeKb < 512) {
    return SMALL_REPO_MAX_INFERRED_TOPICS;
  }

  if (sizeKb < 5_000) {
    return MEDIUM_REPO_MAX_INFERRED_TOPICS;
  }

  if (sizeKb < 20_000) {
    return LARGE_REPO_MAX_INFERRED_TOPICS;
  }

  if (sizeKb < 100_000) {
    return HUGE_REPO_MAX_INFERRED_TOPICS;
  }

  return MASSIVE_REPO_MAX_INFERRED_TOPICS;
}
