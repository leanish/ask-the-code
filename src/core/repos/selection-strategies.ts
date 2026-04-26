import type { RepoSelectionStrategy } from "../types.ts";

export const SUPPORTED_SELECTION_STRATEGIES = ["single", "cascade"] as const;

export function isSelectionStrategy(value: unknown): value is RepoSelectionStrategy {
  return value === "single" || value === "cascade";
}
