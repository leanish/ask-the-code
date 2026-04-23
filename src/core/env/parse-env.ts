type ParseOptions = {
  label: string;
  max?: number;
  allowZero?: boolean;
  rangeHint?: string;
};

export function parseEnvPositiveInteger(value: string | undefined | null, { label, max, allowZero = false, rangeHint }: ParseOptions): number | null {
  if (value == null || value === "") {
    return null;
  }

  const raw = String(value);
  const hint = rangeHint ?? (allowZero ? "Use a non-negative integer." : "Use a positive integer.");

  if (!/^\d+$/u.test(raw)) {
    throw new Error(`Invalid ${label}: ${value}. ${hint}`);
  }

  const parsed = Number.parseInt(raw, 10);
  const lowerBound = allowZero ? 0 : 1;
  const exceedsMax = typeof max === "number" && parsed > max;

  if (!Number.isInteger(parsed) || parsed < lowerBound || exceedsMax) {
    throw new Error(`Invalid ${label}: ${value}. ${hint}`);
  }

  return parsed;
}

export function parseEnvPort(value: string | undefined | null, label: string): number | null {
  return parseEnvPositiveInteger(value, {
    label,
    max: 65_535,
    allowZero: true,
    rangeHint: "Use a TCP port between 0 and 65535."
  });
}
