import type { Transfer, Account, DateSnap } from "../types";

function resolveSnap(
  snap: DateSnap,
  transfer: Transfer,
  accounts: Account[],
): string | null {
  const src = accounts.find(a => a.id === transfer.sourceAccountId);
  const tgt = accounts.find(a => a.id === transfer.targetAccountId);
  switch (snap) {
    case "source-start": return src?.startDate ?? null;
    case "target-start": return tgt?.startDate ?? null;
  }
}

/** Returns the effective startDate for a transfer, respecting any snap. */
export function resolvedStartDate(transfer: Transfer, accounts: Account[]): string {
  if (transfer.startSnap) {
    return resolveSnap(transfer.startSnap, transfer, accounts) ?? transfer.startDate;
  }
  return transfer.startDate;
}

/** Returns the effective endDate for a transfer, respecting any snap. */
export function resolvedEndDate(transfer: Transfer, accounts: Account[]): string | null {
  if (transfer.endSnap) {
    return resolveSnap(transfer.endSnap, transfer, accounts) ?? transfer.endDate;
  }
  return transfer.endDate;
}

export const SNAP_LABELS: Record<DateSnap, string> = {
  "source-start": "Source account start",
  "target-start": "Target account start",
};
