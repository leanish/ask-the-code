export type MarkdownRuntime = {
  marked: { parse(input: string): string };
  DOMPurify: { sanitize(input: string, options?: unknown): string };
};
export const DEFAULT_ADVANCED_VIEW: string;
export const DEFAULT_ADVANCED_MODEL: string;
export const DEFAULT_ADVANCED_REASONING_EFFORT: string;
export const MODE_COOKIE_MAX_AGE_SECONDS: number;
export const ADVANCED_VIEW_IDS: string[];
export function createAskPayload(
  question: string,
  mode: "simple" | "advanced",
  options?: Record<string, unknown>,
  attachments?: Array<{ name: string; mediaType: string; contentBase64: string }>
): Record<string, unknown>;
export function createAskFormData(payload: Record<string, unknown>, files: File[]): FormData;
export function escapeHtml(value: string): string;
export function formatModeCookie(mode: "simple" | "advanced"): string;
export function getAdvancedViewFromHash(hash: string): string;
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
export function summarizeRun(input: {
  pipeline: {
    stages: Record<string, {
      state: string;
      timestamp: string | null;
    }>;
  };
  repos: Array<{ name?: string }>;
  status?: string;
}): { badge: string; summary: string };
