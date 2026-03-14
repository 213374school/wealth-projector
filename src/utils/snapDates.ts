import type { Transfer, Account } from "../types";

/** Returns the effective startDate for a transfer. */
export function resolvedStartDate(transfer: Transfer, _accounts: Account[]): string {
  return transfer.startDate;
}

/** Returns the effective endDate for a transfer. */
export function resolvedEndDate(transfer: Transfer, _accounts: Account[]): string | null {
  return transfer.endDate;
}

/** Returns the effective startDate for an account. */
export function resolvedAccountStartDate(account: Account, _timelineStart: string): string {
  return account.startDate;
}
