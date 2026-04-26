export type MarkdownRuntime = {
  marked: { parse(input: string): string };
  DOMPurify: { sanitize(input: string, options?: unknown): string };
};
export const DEFAULT_EXPERT_VIEW: string;
export const DEFAULT_EXPERT_MODEL: string;
export const DEFAULT_EXPERT_REASONING_EFFORT: string;
export const EXPERT_VIEW_IDS: string[];
export function createAskPayload(
  question: string,
  mode: "simple" | "expert",
  options?: Record<string, unknown>,
  attachments?: Array<{ name: string; mediaType: string; contentBase64: string }>
): Record<string, unknown>;
export function escapeHtml(value: string): string;
export function getExpertViewFromHash(hash: string): string;
export function getProgressPanelSummary(pipeline: {
  stages: Record<string, {
    state: string;
    detail: string;
    timestamp: string | null;
    touched: boolean;
  }>;
}): string;
export function renderMarkdownHtml(text: string, runtime?: MarkdownRuntime | null): string;
export function renderRepositoryListHtml(
  repos: Array<{
    name: string;
    defaultBranch?: string | null;
    aliases?: string[];
    description?: string | null;
  }>,
  setupHint?: string | null
): string;
