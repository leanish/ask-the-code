export const DEFAULT_ANSWER_AUDIENCE = "general" as const;
export const SUPPORTED_ANSWER_AUDIENCES = ["general", "codebase"] as const;

export type AnswerAudience = typeof SUPPORTED_ANSWER_AUDIENCES[number];

export function isSupportedAnswerAudience(value: string): value is AnswerAudience {
  return SUPPORTED_ANSWER_AUDIENCES.includes(value as AnswerAudience);
}

export function resolveAnswerAudience(value: string | null | undefined): AnswerAudience {
  if (typeof value === "string" && isSupportedAnswerAudience(value)) {
    return value;
  }

  return DEFAULT_ANSWER_AUDIENCE;
}
