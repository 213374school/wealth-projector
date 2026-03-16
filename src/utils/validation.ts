import type { Scenario } from "../types";

export interface ValidationResult {
  valid: boolean;
  error?: string;
}

export function validateScenario(data: unknown): ValidationResult {
  if (typeof data !== "object" || data === null) {
    return { valid: false, error: "Data is not an object" };
  }
  const d = data as Record<string, unknown>;

  const requiredStrings = ["id", "name", "createdAt", "updatedAt", "timelineStart", "timelineEnd", "currencyLocale", "currencySymbol"];
  for (const key of requiredStrings) {
    if (typeof d[key] !== "string") return { valid: false, error: `Missing or invalid field: ${key}` };
  }

  const requiredNumbers = ["inflationRate"];
  for (const key of requiredNumbers) {
    if (typeof d[key] !== "number") return { valid: false, error: `Missing or invalid field: ${key}` };
  }

  if (typeof d["inflationEnabled"] !== "boolean") {
    return { valid: false, error: "Missing or invalid field: inflationEnabled" };
  }

  if (!isValidYYYYMM(d["timelineStart"] as string)) {
    return { valid: false, error: "timelineStart must be YYYY-MM" };
  }
  if (!isValidYYYYMM(d["timelineEnd"] as string)) {
    return { valid: false, error: "timelineEnd must be YYYY-MM" };
  }

  if (!Array.isArray(d["accounts"])) return { valid: false, error: "accounts must be an array" };
  if (!Array.isArray(d["transfers"])) return { valid: false, error: "transfers must be an array" };

  const accountIds = new Set<string>();
  for (const acc of d["accounts"] as unknown[]) {
    const r = validateAccount(acc);
    if (!r.valid) return r;
    accountIds.add((acc as Record<string, unknown>)["id"] as string);
  }

  for (const t of d["transfers"] as unknown[]) {
    const r = validateTransfer(t, accountIds);
    if (!r.valid) return r;
  }

  if (d["anchors"] !== undefined) {
    if (!Array.isArray(d["anchors"])) return { valid: false, error: "anchors must be an array" };
    const allItemIds = new Set([
      ...Array.from(accountIds),
      ...(d["transfers"] as Record<string, unknown>[]).map(t => t["id"] as string),
    ]);
    for (const anchor of d["anchors"] as unknown[]) {
      const r = validateTimeAnchor(anchor, allItemIds);
      if (!r.valid) return r;
    }
  }

  return { valid: true };
}

function validateAccount(data: unknown): ValidationResult {
  if (typeof data !== "object" || data === null) return { valid: false, error: "Account is not an object" };
  const d = data as Record<string, unknown>;
  for (const k of ["id", "name", "color"]) {
    if (typeof d[k] !== "string") return { valid: false, error: `Account missing field: ${k}` };
  }
  if (typeof d["initialBalance"] !== "number") return { valid: false, error: "Account missing initialBalance" };
  if (typeof d["growthRate"] !== "number") return { valid: false, error: "Account missing growthRate" };
  return { valid: true };
}

function validateTransfer(data: unknown, accountIds: Set<string>): ValidationResult {
  if (typeof data !== "object" || data === null) return { valid: false, error: "Transfer is not an object" };
  const d = data as Record<string, unknown>;
  if (typeof d["id"] !== "string") return { valid: false, error: "Transfer missing id" };
  if (d["sourceAccountId"] !== null && (typeof d["sourceAccountId"] !== "string" || !accountIds.has(d["sourceAccountId"] as string))) {
    return { valid: false, error: `Transfer references unknown sourceAccountId: ${d["sourceAccountId"]}` };
  }
  if (d["targetAccountId"] !== null && (typeof d["targetAccountId"] !== "string" || !accountIds.has(d["targetAccountId"] as string))) {
    return { valid: false, error: `Transfer references unknown targetAccountId: ${d["targetAccountId"]}` };
  }
  if (!isValidYYYYMM(d["startDate"] as string)) return { valid: false, error: "Transfer startDate must be YYYY-MM" };
  if (d["endDate"] !== null && (typeof d["endDate"] !== "string" || !isValidYYYYMM(d["endDate"] as string))) {
    return { valid: false, error: "Transfer endDate must be YYYY-MM or null" };
  }
  if (typeof d["amount"] !== "number") return { valid: false, error: "Transfer missing amount" };
  if (typeof d["taxRate"] !== "number") return { valid: false, error: "Transfer missing taxRate" };
  if (d["inflationHedged"] !== undefined && typeof d["inflationHedged"] !== "boolean") {
    return { valid: false, error: "Transfer inflationHedged must be a boolean" };
  }
  return { valid: true };
}

function validateTimeAnchor(data: unknown, itemIds: Set<string>): ValidationResult {
  if (typeof data !== "object" || data === null) return { valid: false, error: "TimeAnchor is not an object" };
  const d = data as Record<string, unknown>;
  if (typeof d["id"] !== "string") return { valid: false, error: "TimeAnchor missing id" };
  if (typeof d["date"] !== "string" || !isValidYYYYMM(d["date"] as string)) {
    return { valid: false, error: "TimeAnchor date must be YYYY-MM" };
  }
  const isFixed = d["fixed"] === true;
  if (!Array.isArray(d["edges"]) || (!isFixed && d["edges"].length < 1)) {
    return { valid: false, error: "TimeAnchor edges must be an array with length >= 1" };
  }
  for (const edge of d["edges"] as unknown[]) {
    if (typeof edge !== "object" || edge === null) return { valid: false, error: "TimeAnchor edge is not an object" };
    const e = edge as Record<string, unknown>;
    if (typeof e["itemId"] !== "string") return { valid: false, error: "TimeAnchor edge missing itemId" };
    if (!itemIds.has(e["itemId"] as string)) return { valid: false, error: `TimeAnchor edge.itemId not found: ${e["itemId"]}` };
    if (e["edge"] !== "start" && e["edge"] !== "end") return { valid: false, error: `TimeAnchor edge.edge must be "start" or "end"` };
  }
  return { valid: true };
}

function isValidYYYYMM(s: string): boolean {
  return /^\d{4}-\d{2}$/.test(s);
}

// Suppress unused import warning - Scenario type is used in validateScenario's return context
export type { Scenario };
