export const EXPERT_VIEW_IDS: readonly [
  "new-ask",
  "history",
  "repos",
  "sync-status",
  "config-path",
  "edit-config",
  "init-config",
  "discover",
  "add-repository"
];

export const DEFAULT_EXPERT_VIEW: "new-ask";

export function getExpertViewFromHash(hash: string): string;

export interface AskPayloadOptions {
  audience?: string;
  model?: string;
  reasoningEffort?: string;
  selectionMode?: string;
  noSync?: boolean;
  noSynthesis?: boolean;
  selectionShadowCompare?: boolean;
}

export function createAskPayload(
  question: string,
  mode: "simple" | "expert",
  options?: AskPayloadOptions
): Record<string, unknown>;

export interface MarkdownRuntime {
  marked: { parse(input: string): string };
  DOMPurify: { sanitize(input: string, options?: unknown): string };
}

export function renderMarkdownHtml(text: string, runtime?: MarkdownRuntime | null): string;

export function escapeHtml(value: string): string;

export interface RepoSummary {
  name: string;
  defaultBranch?: string | null;
  description?: string | null;
  aliases?: string[];
}

export function renderRepositoryListHtml(
  repos: ReadonlyArray<RepoSummary>,
  setupHint?: string | null
): string;
