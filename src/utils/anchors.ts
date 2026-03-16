import type { Scenario, TimeAnchor, ItemEdge, EdgeId } from "../types";

export function monthsBetween(a: string, b: string): number {
  const [ay, am] = a.split("-").map(Number);
  const [by, bm] = b.split("-").map(Number);
  return (by - ay) * 12 + (bm - am);
}

export function addMonths(date: string, n: number): string {
  const [y, m] = date.split("-").map(Number);
  const total = y * 12 + (m - 1) + n;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  return `${ny}-${String(nm).padStart(2, "0")}`;
}

/** Returns the resolved date for an item's edge. */
export function resolveEdgeDate(scenario: Scenario, itemId: string, edge: EdgeId): string {
  const acc = scenario.accounts.find(a => a.id === itemId);
  if (acc) {
    return edge === "start" ? scenario.timelineStart : scenario.timelineEnd;
  }
  const t = scenario.transfers.find(t => t.id === itemId);
  if (!t) return scenario.timelineStart;
  if (edge === "start") return t.startDate ?? scenario.timelineStart;
  return t.endDate ?? scenario.timelineEnd;
}

/** Returns minimum allowed start for a transfer (accounts are always omnipresent). */
export function getItemMinStart(scenario: Scenario, _itemId: string): string {
  return scenario.timelineStart;
}

/** Which anchor owns this edge (if any). */
export function findAnchorForEdge(anchors: TimeAnchor[], itemId: string, edge: EdgeId): TimeAnchor | null {
  for (const anchor of anchors) {
    if (anchor.edges.some(e => e.itemId === itemId && e.edge === edge)) return anchor;
  }
  return null;
}

/** Nearest anchor within threshold (for snap magnetism), excluding the anchor with excludeId. */
export function findNearestAnchor(
  anchors: TimeAnchor[],
  candidateDate: string,
  excludeId: string | null,
  thresholdMonths: number,
): TimeAnchor | null {
  let best: TimeAnchor | null = null;
  let bestDist = thresholdMonths;
  for (const anchor of anchors) {
    if (anchor.id === excludeId) continue;
    const dist = Math.abs(monthsBetween(anchor.date, candidateDate));
    if (dist <= bestDist) {
      bestDist = dist;
      best = anchor;
    }
  }
  return best;
}

/** Nearest other item edge within threshold (excluding the given item). */
export function findNearestEdge(
  anchors: TimeAnchor[],
  scenario: Scenario,
  candidateDate: string,
  excludeItemId: string,
  items: { id: string; type: "account" | "transfer" }[],
  thresholdMonths: number,
): { itemId: string; edge: EdgeId; existingAnchorId: string | null } | null {
  let best: { itemId: string; edge: EdgeId; existingAnchorId: string | null } | null = null;
  let bestDist = thresholdMonths;
  for (const item of items) {
    if (item.id === excludeItemId) continue;
    if (item.type === "account") continue; // accounts have no snappable edges
    const edges: EdgeId[] = ["start", "end"];
    for (const edge of edges) {
      const edgeDate = resolveEdgeDate(scenario, item.id, edge);
      const dist = Math.abs(monthsBetween(candidateDate, edgeDate));
      if (dist <= bestDist) {
        bestDist = dist;
        const existingAnchor = findAnchorForEdge(anchors, item.id, edge);
        best = { itemId: item.id, edge, existingAnchorId: existingAnchor?.id ?? null };
      }
    }
  }
  return best;
}

/** Clamped date for anchor drag (respects all connected edges' constraints). */
export function computeAnchorDragTarget(scenario: Scenario, anchor: TimeAnchor, candidateDate: string): string {
  let result = candidateDate;
  for (const e of anchor.edges) {
    if (e.edge === "start") {
      if (result < scenario.timelineStart) result = scenario.timelineStart;
      const t = scenario.transfers.find(t => t.id === e.itemId);
      if (t?.endDate && result > t.endDate) result = t.endDate;
    } else {
      if (result > scenario.timelineEnd) result = scenario.timelineEnd;
      const t = scenario.transfers.find(t => t.id === e.itemId);
      if (t) {
        const startD = resolveEdgeDate(scenario, t.id, "start");
        if (result < startD) result = startD;
      }
    }
  }
  return result;
}

/** Clamped date for a single free edge drag (no group logic). */
export function computeEdgeDragTargetSimple(
  scenario: Scenario,
  itemId: string,
  edge: EdgeId,
  candidateDate: string,
): string {
  const minStart = getItemMinStart(scenario, itemId);
  let result = candidateDate;
  if (edge === "start") {
    if (result < minStart) result = minStart;
    const t = scenario.transfers.find(t => t.id === itemId);
    if (t?.endDate && result > t.endDate) result = t.endDate;
  } else {
    if (result > scenario.timelineEnd) result = scenario.timelineEnd;
    const t = scenario.transfers.find(t => t.id === itemId);
    if (t) {
      const startD = resolveEdgeDate(scenario, t.id, "start");
      if (result < startD) result = startD;
    }
  }
  return result;
}

/** Pure: returns anchor with the given edge removed. */
export function removeEdgeFromAnchor(anchor: TimeAnchor, itemId: string, edge: EdgeId): TimeAnchor {
  return { ...anchor, edges: anchor.edges.filter(e => !(e.itemId === itemId && e.edge === edge)) };
}

/** Pure: returns anchor with edge added (no-op if already present). */
export function addEdgeToAnchor(anchor: TimeAnchor, itemEdge: ItemEdge): TimeAnchor {
  const exists = anchor.edges.some(e => e.itemId === itemEdge.itemId && e.edge === itemEdge.edge);
  if (exists) return anchor;
  return { ...anchor, edges: [...anchor.edges, itemEdge] };
}
