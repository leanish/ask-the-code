const DEFAULT_LIMIT = 50;

export interface HistoryStore {
  record(jobId: string): void;
  list(): string[];
  clear(): void;
}

export function createHistoryStore(limit: number = DEFAULT_LIMIT): HistoryStore {
  const buffer: string[] = [];

  return {
    record(jobId: string): void {
      const existing = buffer.indexOf(jobId);
      if (existing !== -1) buffer.splice(existing, 1);
      buffer.unshift(jobId);
      if (buffer.length > limit) buffer.length = limit;
    },
    list(): string[] {
      return buffer.slice();
    },
    clear(): void {
      buffer.length = 0;
    }
  };
}
