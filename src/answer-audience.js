export const DEFAULT_ANSWER_AUDIENCE = "general";
export const SUPPORTED_ANSWER_AUDIENCES = ["general", "codebase"];

export function isSupportedAnswerAudience(value) {
  return SUPPORTED_ANSWER_AUDIENCES.includes(value);
}

export function resolveAnswerAudience(value) {
  return value ?? DEFAULT_ANSWER_AUDIENCE;
}
