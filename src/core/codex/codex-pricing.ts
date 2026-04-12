import type { CodexUsage } from "../types.js";

type ModelUsdRates = {
  inputPerMillion: number;
  outputPerMillion: number;
};

const USD_RATES_BY_MODEL: Record<string, ModelUsdRates> = {
  "gpt-5.4": {
    inputPerMillion: 2.5,
    outputPerMillion: 15
  },
  "gpt-5.4-mini": {
    inputPerMillion: 0.75,
    outputPerMillion: 4.5
  },
  "gpt-5.4-nano": {
    inputPerMillion: 0.2,
    outputPerMillion: 1.25
  }
};

export function estimateCodexUsd(model: string, usage: CodexUsage | null | undefined): number | null {
  if (!usage) {
    return null;
  }

  const rates = USD_RATES_BY_MODEL[model.toLowerCase()];
  if (!rates) {
    return null;
  }

  return (
    usage.inputTokens * rates.inputPerMillion
    + usage.outputTokens * rates.outputPerMillion
  ) / 1_000_000;
}

export function formatEstimatedCodexUsd(model: string, usage: CodexUsage | null | undefined): string | null {
  const estimatedUsd = estimateCodexUsd(model, usage);
  if (estimatedUsd == null) {
    return null;
  }

  return formatEstimatedUsdValue(estimatedUsd);
}

function formatEstimatedUsdValue(value: number): string {
  if (value >= 1) {
    return trimTrailingZeros(value.toFixed(4));
  }

  if (value >= 0.01) {
    return trimTrailingZeros(value.toFixed(5));
  }

  return trimTrailingZeros(value.toFixed(6));
}

function trimTrailingZeros(value: string): string {
  return value.replace(/(\.\d*?[1-9])0+$/u, "$1").replace(/\.0+$/u, "");
}
