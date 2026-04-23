import type { SyncReportItem } from "../types.js";

export function formatSyncFailure(item: SyncReportItem): string {
  return item.detail ? `${item.name} (${item.detail})` : item.name;
}

export function formatSyncFailures(failedSyncs: SyncReportItem[]): string {
  return failedSyncs.map(formatSyncFailure).join(", ");
}
