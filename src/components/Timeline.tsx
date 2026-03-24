import { useRef, useCallback, useState } from "react";
import type { Account, Transfer, Scenario, TimeAnchor } from "../types";
import { useScenarioStore } from "../store/scenario";
import {
  findAnchorForEdge,
  findNearestAnchor,
  findNearestEdge,
  computeAnchorDragTarget,
  computeEdgeDragTargetSimple,
  removeEdgeFromAnchor,
  addEdgeToAnchor,
  resolveEdgeDate,
  monthsBetween,
  addMonths,
  getItemMinStart,
  edgeToAnchorDate,
  anchorToEdgeDate,
} from "../utils/anchors";
import { monthToLabel, formatCurrency } from "../utils/formatting";
import { generateId } from "../utils/defaults";
import type { EdgeId } from "../types";

export interface DragCreateInfo {
  sourceAccountId: string | null;
  startDate: string;
  endDate: string | null;
  startAnchorId: string | null;
  endAnchorId: string | null;
}

interface TimelineProps {
  scenario: Scenario;
  selectedItemId: string | null;
  selectedItemType: "account" | "transfer" | null;
  viewportStart: number;
  viewportEnd: number;
  onSelectItem: (id: string | null, type: "account" | "transfer" | null) => void;
  onDragCreate: (info: DragCreateInfo) => void;
  hoveredIdx: number | null;
  onHoverIdx: (idx: number | null) => void;
  hoveredAnchorId: string | null;
  onHoverAnchorId: (id: string | null) => void;
}

type DragTarget =
  | { type: "anchor"; anchor: TimeAnchor }
  | { type: "edge"; itemId: string; edge: EdgeId; existingAnchorId: string | null };

function RowDragHandle() {
  return (
    <svg width="10" height="12" viewBox="0 0 10 12" fill="currentColor">
      <circle cx="3" cy="2" r="1.2" />
      <circle cx="7" cy="2" r="1.2" />
      <circle cx="3" cy="6" r="1.2" />
      <circle cx="7" cy="6" r="1.2" />
      <circle cx="3" cy="10" r="1.2" />
      <circle cx="7" cy="10" r="1.2" />
    </svg>
  );
}

export function Timeline({ scenario, selectedItemId, selectedItemType, viewportStart, viewportEnd, onSelectItem, onDragCreate, hoveredIdx, onHoverIdx, hoveredAnchorId, onHoverAnchorId }: TimelineProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const isDraggingAnchorRef = useRef(false);
  const applyDragUpdate = useScenarioStore(s => s.applyDragUpdate);
  const captureHistorySnapshot = useScenarioStore(s => s.captureHistorySnapshot);

  const reorderAccount = useScenarioStore(s => s.reorderAccount);
  const reorderTransferInGroup = useScenarioStore(s => s.reorderTransferInGroup);

  const [rowDragState, setRowDragState] = useState<{
    kind: "account" | "transfer";
    sourceAccountId: string | null;
    fromIdx: number;
    insertAtGap: number;
  } | null>(null);
  const [hoveredHandle, setHoveredHandle] = useState<string | null>(null);

  const [createDragPreview, setCreateDragPreview] = useState<{
    sourceAccountId: string | null;
    lane: number;
    startDate: string;
    endDate: string;
  } | null>(null);
  const [hoveredTransfer, setHoveredTransfer] = useState<{ id: string; x: number; y: number } | null>(null);
  const [hoveredAccount, setHoveredAccount] = useState<{ id: string; x: number; y: number } | null>(null);
  const tooltipDivRef = useRef<HTMLDivElement | null>(null);
  const accountTooltipDivRef = useRef<HTMLDivElement | null>(null);
  const [activeCreateRow, setActiveCreateRow] = useState<string | null>(null);
  const createRowTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isCreatingRef = useRef(false);
  const simulationResult = useScenarioStore(s => s.simulationResult);
  const anchors = scenario.anchors ?? [];

  const viewMonths = viewportEnd - viewportStart + 1;

  const lanes: { id: string; type: "account" | "transfer"; start: string; end: string; lane: number }[] = [];

  // Assign a lane within an isolated group (no cross-group contamination)
  type LaneEntry = { start: string; end: string; lane: number };
  function assignLaneIn(group: LaneEntry[], startDate: string, endDate: string, minLane = 0): number {
    for (let lane = minLane; ; lane++) {
      const overlaps = group.filter(l => l.lane === lane).some(l => startDate < l.end && endDate > l.start);
      if (!overlaps) return lane;
    }
  }

  let nextLane = 0;

  // Create rows — one per group (external source + each account); acts as group delimiter
  const createRows: { sourceAccountId: string | null; lane: number }[] = [];

  // Contributions (null source) — own isolated group at the top
  const contribGroup: LaneEntry[] = [];
  for (const t of scenario.transfers) {
    if (t.sourceAccountId !== null) continue;
    const tStart = t.startDate ?? scenario.timelineStart;
    const tEnd = t.endDate ?? scenario.timelineEnd;
    const tEndForLane = t.isOneTime ? tStart : tEnd; // one-time events occupy only their start point for stacking
    const localLane = assignLaneIn(contribGroup, tStart, tEndForLane);
    contribGroup.push({ start: tStart, end: tEndForLane, lane: localLane });
    lanes.push({ id: t.id, type: "transfer", start: tStart, end: tEnd, lane: nextLane + localLane });
  }
  // External source create row — always present, acts as group separator
  const externalCreateLane = nextLane + (contribGroup.length > 0 ? Math.max(...contribGroup.map(l => l.lane)) + 1 : 0);
  createRows.push({ sourceAccountId: null, lane: externalCreateLane });
  nextLane = externalCreateLane + 1;

  // Each account gets a dedicated lane; its transfers collapse within their own group below it
  const accountLaneMap: Record<string, number> = {};
  for (const acc of scenario.accounts) {
    accountLaneMap[acc.id] = nextLane;
    lanes.push({ id: acc.id, type: "account", start: scenario.timelineStart, end: scenario.timelineEnd, lane: nextLane });

    const transferGroup: LaneEntry[] = [];
    for (const t of scenario.transfers) {
      if (t.sourceAccountId !== acc.id) continue;
      const tStart = t.startDate ?? scenario.timelineStart;
      const tEnd = t.endDate ?? scenario.timelineEnd;
      const tEndForLane = t.isOneTime ? tStart : tEnd; // one-time events occupy only their start point for stacking
      const localLane = assignLaneIn(transferGroup, tStart, tEndForLane);
      transferGroup.push({ start: tStart, end: tEndForLane, lane: localLane });
      lanes.push({ id: t.id, type: "transfer", start: tStart, end: tEnd, lane: nextLane + 1 + localLane });
    }

    // Account create row — acts as group separator
    const accCreateLane = nextLane + 1 + (transferGroup.length > 0 ? Math.max(...transferGroup.map(l => l.lane)) + 1 : 0);
    createRows.push({ sourceAccountId: acc.id, lane: accCreateLane });
    nextLane = accCreateLane + 1;
  }

  const maxLane = Math.max(
    lanes.reduce((m, l) => Math.max(m, l.lane), 0),
    createRows.reduce((m, r) => Math.max(m, r.lane), 0),
  );
  const laneHeight = 30;
  const h = laneHeight - 4;         // bar height = 20px
  const arrowTip = h / 2;           // = 10px — width of the chevron point
  const minCompactWidth = (h + arrowTip * 2 + 8) / 2; // enough to show both color halves clearly
  // Compact create rows take only 6px; active ones take the full laneHeight
  const createRowCompactH = 14;
  const createRowLaneSet = new Map(createRows.map(cr => [cr.lane, `create-${cr.sourceAccountId ?? "external"}`]));
  function laneTopPx(targetLane: number): number {
    let px = 0;
    for (let l = 0; l < targetLane; l++) {
      const rowKey = createRowLaneSet.get(l);
      px += rowKey ? (activeCreateRow === rowKey ? laneHeight : createRowCompactH) : laneHeight;
    }
    return px;
  }
  const barsHeight = laneTopPx(maxLane + 1) + 8;

  const handleAnchorDrag = useCallback((e: React.MouseEvent, anchor: TimeAnchor) => {
    e.stopPropagation();
    captureHistorySnapshot();
    const container = containerRef.current;
    if (!container) return;
    isDraggingAnchorRef.current = true;
    onHoverIdx(null);
    const containerWidth = container.clientWidth;
    const startX = e.clientX;
    const originalDate = anchor.date;
    const ANCHOR_MAGNET_PX = 15;

    const mergeTargetRef = { current: null as TimeAnchor | null };
    let highlightedAnchorEl: HTMLElement | null = null;

    function clearAnchorHighlight() {
      if (highlightedAnchorEl) {
        highlightedAnchorEl.classList.remove("anchor-candidate-highlight");
        highlightedAnchorEl = null;
      }
    }

    const onMouseMove = (ev: MouseEvent) => {
      const dx = ev.clientX - startX;
      const monthDelta = Math.round((dx / containerWidth) * viewMonths);
      const rawDate = addMonths(originalDate, monthDelta);
      let clamped = computeAnchorDragTarget(scenario, anchor, rawDate);

      // Detect nearby anchor for merge
      clearAnchorHighlight();
      mergeTargetRef.current = null;
      const thresholdMonths = (ANCHOR_MAGNET_PX / containerWidth) * viewMonths;
      const nearestOther = findNearestAnchor(anchors, clamped, anchor.id, thresholdMonths);
      if (nearestOther) {
        mergeTargetRef.current = nearestOther;
        clamped = nearestOther.date;
        const el = document.querySelector<HTMLElement>(`[data-anchor-id="${nearestOther.id}"] > div:first-child`);
        if (el) { el.classList.add("anchor-candidate-highlight"); highlightedAnchorEl = el; }
      }

      const accountUpdates: { id: string; changes: Partial<Account> }[] = [];
      const transferUpdates: { id: string; changes: Partial<Transfer> }[] = [];

      for (const edge of anchor.edges) {
        const acc = scenario.accounts.find(a => a.id === edge.itemId);
        if (acc) {
          // accounts are omnipresent — no edge to update
        } else {
          const t = scenario.transfers.find(t => t.id === edge.itemId);
          if (t) {
            if (edge.edge === "start") {
              // anchor is at prevMonth(startDate); invert to get actual startDate
              const actualStartDate = addMonths(clamped, 1);
              const effectiveStart = t.startDate ?? scenario.timelineStart;
              if (t.startDate !== null || actualStartDate !== effectiveStart) {
                transferUpdates.push({ id: edge.itemId, changes: { startDate: actualStartDate } });
              }
            } else {
              transferUpdates.push({ id: edge.itemId, changes: { endDate: clamped } });
            }
          }
        }
      }

      applyDragUpdate(accountUpdates, transferUpdates, [], [{ ...anchor, date: clamped }], { skipHistory: true });
    };

    const onMouseUp = () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
      isDraggingAnchorRef.current = false;
      clearAnchorHighlight();

      const mergeTarget = mergeTargetRef.current;
      mergeTargetRef.current = null;
      // Never merge into fixed anchors
      if (mergeTarget && !mergeTarget.fixed) {
        const mergedEdges = [...mergeTarget.edges];
        for (const edge of anchor.edges) {
          if (!mergedEdges.some(e => e.itemId === edge.itemId && e.edge === edge.edge))
            mergedEdges.push(edge);
        }
        applyDragUpdate([], [], [anchor.id], [{ ...mergeTarget, edges: mergedEdges }], { skipHistory: true });
      }
    };

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
  }, [viewMonths, scenario, applyDragUpdate, captureHistorySnapshot, onHoverIdx]);

  const handleDrag = useCallback((
    e: React.MouseEvent,
    id: string,
    type: "account" | "transfer",
    part: "left" | "right" | "body",
    originalStart: string,
    originalEnd: string | null,
  ) => {
    e.stopPropagation();
    const container = containerRef.current;
    if (!container) return;
    captureHistorySnapshot();
    const containerWidth = container.clientWidth;
    const startX = e.clientX;

    const draggedEdge: EdgeId = part === "right" ? "end" : "start";

    // Highlight the anchor label for the dragged edge/body
    if (part !== "body") {
      onHoverAnchorId(findAnchorForEdge(anchors, id, draggedEdge)?.id ?? null);
    } else {
      onHoverAnchorId(findAnchorForEdge(anchors, id, "start")?.id ?? null);
    }

    // Minimum start for this item
    const itemMinStart = getItemMinStart(scenario, id);

    // Track drag target for edge drag
    const dragTargetRef = { current: null as DragTarget | null };
    const tempAnchorIdRef = { current: null as string | null };
    const bodyTempAnchorsRef = { current: new Map<string, string>() }; // edge → tempAnchorId
    let lastClampedDate = draggedEdge === "start" ? originalStart : (originalEnd ?? scenario.timelineEnd);
    let lastBodyDelta = 0;
    let hasDragged = false;
    const MIN_DRAG_PX = 4;
    let highlightedEl: HTMLElement | null = null;

    function clearHighlight() {
      if (highlightedEl) {
        highlightedEl.classList.remove("anchor-candidate-highlight");
        highlightedEl = null;
      }
    }

    const MAGNET_THRESHOLD_PX = 15;

    const onMouseMove = (ev: MouseEvent) => {
      const dx = ev.clientX - startX;
      if (!hasDragged && Math.abs(dx) >= MIN_DRAG_PX) hasDragged = true;
      const monthDelta = Math.round((dx / containerWidth) * viewMonths);

      let candidateDate: string;
      if (part === "left") {
        candidateDate = addMonths(originalStart, monthDelta);
      } else if (part === "right") {
        candidateDate = addMonths(originalEnd!, monthDelta);
      } else {
        candidateDate = addMonths(originalStart, monthDelta);
      }

      if (part !== "body") {
        // --- Magnet detection ---
        clearHighlight();
        dragTargetRef.current = null;

        const thresholdMonths = (MAGNET_THRESHOLD_PX / containerWidth) * viewMonths;
        const myAnchor = findAnchorForEdge(anchors, id, draggedEdge);
        // Convert candidate to anchor-date space for correct distance comparisons
        const candidateAnchorDate = edgeToAnchorDate(candidateDate, draggedEdge);
        const nearestAnchor = findNearestAnchor(anchors, candidateAnchorDate, myAnchor?.id ?? null, thresholdMonths);
        const nearestEdge = findNearestEdge(anchors, scenario, candidateAnchorDate, id, lanes, thresholdMonths);

        // Anchor wins if both in range; compare distances in anchor-date space
        const anchorDist = nearestAnchor ? Math.abs(monthsBetween(candidateAnchorDate, nearestAnchor.date)) : Infinity;
        const edgeDist = nearestEdge
          ? Math.abs(monthsBetween(candidateAnchorDate,
              edgeToAnchorDate(resolveEdgeDate(scenario, nearestEdge.itemId, nearestEdge.edge), nearestEdge.edge)))
          : Infinity;

        if (nearestAnchor && anchorDist <= edgeDist) {
          dragTargetRef.current = { type: "anchor", anchor: nearestAnchor };
          // Convert anchor date back to transfer-date space
          candidateDate = anchorToEdgeDate(nearestAnchor.date, draggedEdge);
          // Highlight anchor line
          const el = document.querySelector<HTMLElement>(`[data-anchor-id="${nearestAnchor.id}"] > div:first-child`);
          if (el) {
            el.classList.add("anchor-candidate-highlight");
            highlightedEl = el;
          }
        } else if (nearestEdge) {
          dragTargetRef.current = { type: "edge", itemId: nearestEdge.itemId, edge: nearestEdge.edge, existingAnchorId: nearestEdge.existingAnchorId };
          const snapAnchorPos = edgeToAnchorDate(resolveEdgeDate(scenario, nearestEdge.itemId, nearestEdge.edge), nearestEdge.edge);
          candidateDate = anchorToEdgeDate(snapAnchorPos, draggedEdge);
        }

        // --- Apply single-item update ---
        const clampedDate = computeEdgeDragTargetSimple(scenario, id, draggedEdge, candidateDate);
        lastClampedDate = clampedDate;
        const accountUpdates: { id: string; changes: Partial<Account> }[] = [];
        const transferUpdates: { id: string; changes: Partial<Transfer> }[] = [];

        // When clamped to a timeline boundary, clear the date to null
        const atBoundary = draggedEdge === "start"
          ? clampedDate === scenario.timelineStart
          : clampedDate === scenario.timelineEnd;

        if (type === "account") {
          // accounts are omnipresent — nothing to drag
        } else {
          if (draggedEdge === "start") {
            transferUpdates.push({ id, changes: { startDate: atBoundary ? null : clampedDate } });
          } else {
            transferUpdates.push({ id, changes: { endDate: atBoundary ? null : clampedDate } });
          }
        }

        // Move (or create) a single-edge anchor tracking this edge in real-time
        const ownAnchor = findAnchorForEdge(anchors, id, draggedEdge);
        let ownAnchorUpdates: TimeAnchor[];
        if (atBoundary) {
          // At boundary — no anchor to create; store will detach the edge automatically
          ownAnchorUpdates = [];
        } else if (ownAnchor && !ownAnchor.fixed && ownAnchor.edges.length === 1) {
          // Single-edge anchor: update in place (anchor sits at edgeToAnchorDate position)
          ownAnchorUpdates = [{ ...ownAnchor, date: edgeToAnchorDate(clampedDate, draggedEdge) }];
        } else if (hasDragged) {
          // Multi-edge or no anchor: create/update a temp single-edge anchor
          if (!tempAnchorIdRef.current) tempAnchorIdRef.current = generateId();
          ownAnchorUpdates = [{ id: tempAnchorIdRef.current, date: edgeToAnchorDate(clampedDate, draggedEdge), edges: [{ itemId: id, edge: draggedEdge }] }];
        } else {
          ownAnchorUpdates = [];
        }
        applyDragUpdate(accountUpdates, transferUpdates, [], ownAnchorUpdates, { skipHistory: true });
        // Keep hovered anchor ID current (may have switched to a temp anchor)
        onHoverAnchorId(tempAnchorIdRef.current ?? findAnchorForEdge(anchors, id, draggedEdge)?.id ?? null);
      } else {
        // --- Body drag: move this item only ---
        const currentStart = resolveEdgeDate(scenario, id, "start");
        const rawDelta = monthsBetween(currentStart, candidateDate);

        // Clamp delta: new start must be >= itemMinStart
        let delta = rawDelta;
        const newStartRaw = addMonths(currentStart, delta);
        if (newStartRaw < itemMinStart) {
          delta = monthsBetween(currentStart, itemMinStart);
        }
        // Clamp delta: new end must be <= timelineEnd (symmetric right boundary)
        if (originalEnd !== null) {
          const newEndRaw = addMonths(originalEnd, delta);
          if (newEndRaw > scenario.timelineEnd) {
            delta = Math.min(delta, monthsBetween(originalEnd, scenario.timelineEnd));
          }
        }
        lastBodyDelta = delta;

        const accountUpdates: { id: string; changes: Partial<Account> }[] = [];
        const transferUpdates: { id: string; changes: Partial<Transfer> }[] = [];

        if (type === "account") {
          // accounts are omnipresent — nothing to drag
        } else {
          const t = scenario.transfers.find(t => t.id === id);
          if (t) {
            const newStart = addMonths(resolveEdgeDate(scenario, id, "start"), delta);
            const changes: Partial<Transfer> = {};
            // Only concretize null startDate when actually moving; keep null when delta=0
            // Also clear startDate if dragged back to timeline start
            if (t.startDate !== null || delta !== 0) {
              changes.startDate = newStart <= scenario.timelineStart ? null : newStart;
            }
            if (t.endDate !== null || delta !== 0) {
              const newEnd = addMonths(t.endDate ?? scenario.timelineEnd, delta);
              changes.endDate = newEnd >= scenario.timelineEnd ? null : newEnd;
            }
            transferUpdates.push({ id, changes });
          }
        }

        // Update anchors in real-time: single-edge anchors follow directly;
        // multi-edge shared anchors get a temp single-edge anchor per connected edge
        const anchorUpdates: TimeAnchor[] = [];
        for (const anch of anchors) {
          if (anch.fixed || !anch.edges.some(e => e.itemId === id)) continue;
          const pendingChanges = transferUpdates[0]?.changes ?? {};
          if (anch.edges.length === 1) {
            const edgeId = anch.edges[0].edge;
            // Don't update anchors for edges whose dates are being cleared — let detachNullDateEdges handle removal
            if ((edgeId === "start" && pendingChanges.startDate === null) ||
                (edgeId === "end" && pendingChanges.endDate === null)) continue;
            const newEdgeDate = edgeId === "start"
              ? addMonths(originalStart, delta)
              : (originalEnd ? addMonths(originalEnd, delta) : edgeToAnchorDate(anch.date, edgeId as EdgeId) /* fallback unchanged */);
            anchorUpdates.push({ ...anch, date: edgeToAnchorDate(newEdgeDate, edgeId as EdgeId) });
          } else if (hasDragged) {
            for (const edge of anch.edges.filter(e => e.itemId === id)) {
              // Don't update anchors for edges whose dates are being cleared
              if ((edge.edge === "start" && pendingChanges.startDate === null) ||
                  (edge.edge === "end" && pendingChanges.endDate === null)) continue;
              if (!bodyTempAnchorsRef.current.has(edge.edge))
                bodyTempAnchorsRef.current.set(edge.edge, generateId());
              const tempId = bodyTempAnchorsRef.current.get(edge.edge)!;
              const newEdgeDate = edge.edge === "start"
                ? addMonths(originalStart, delta)
                : (originalEnd ? addMonths(originalEnd, delta) : anch.date);
              anchorUpdates.push({ id: tempId, date: edgeToAnchorDate(newEdgeDate, edge.edge), edges: [{ itemId: id, edge: edge.edge }] });
            }
          }
        }
        applyDragUpdate(accountUpdates, transferUpdates, [], anchorUpdates, { skipHistory: true });
      }
    };

    const onMouseUp = () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
      clearHighlight();
      onHoverAnchorId(null);

      if (!hasDragged) return;

      if (part !== "body") {
        // Handle anchor connections on mouseup
        const myAnchor = findAnchorForEdge(anchors, id, draggedEdge);
        // Never merge into fixed anchors — treat as free drop
        let snap = dragTargetRef.current;
        if (snap?.type === "anchor" && snap.anchor.fixed) snap = null;
        const tempAnchorId = tempAnchorIdRef.current;
        dragTargetRef.current = null;
        tempAnchorIdRef.current = null;

        const anchorsToRemove: string[] = [];
        const anchorsToUpdate: TimeAnchor[] = [];

        if (snap?.type === "anchor" && snap.anchor.id === myAnchor?.id) {
          // Re-connecting to same anchor — no anchor changes needed
          if (tempAnchorId) anchorsToRemove.push(tempAnchorId);
        } else if (snap?.type === "edge" && snap.existingAnchorId !== null && snap.existingAnchorId === myAnchor?.id) {
          // Snapping to an edge in the same anchor — no anchor changes needed
          if (tempAnchorId) anchorsToRemove.push(tempAnchorId);
        } else if (snap === null && tempAnchorId) {
          // Free drop with a temp anchor already in store — just disconnect from old multi-edge anchor
          if (myAnchor) {
            const stripped = removeEdgeFromAnchor(myAnchor, id, draggedEdge);
            if (!myAnchor.fixed && stripped.edges.length < 1) {
              anchorsToRemove.push(myAnchor.id);
            } else {
              anchorsToUpdate.push(stripped);
            }
          }
        } else if (snap === null && myAnchor && !myAnchor.fixed && myAnchor.edges.length === 1) {
          // Free drop with own single-edge anchor — already at correct position, nothing to do
        } else {
          // Disconnect from old anchor
          if (myAnchor) {
            const stripped = removeEdgeFromAnchor(myAnchor, id, draggedEdge);
            if (!myAnchor.fixed && stripped.edges.length < 1) {
              anchorsToRemove.push(myAnchor.id);
            } else {
              anchorsToUpdate.push(stripped);
            }
          }

          // Connect to new target
          if (snap === null) {
            // Free drop with no temp anchor — create single-edge anchor now, unless at boundary
            const atBoundary = draggedEdge === "start"
              ? lastClampedDate === scenario.timelineStart
              : lastClampedDate === scenario.timelineEnd;
            if (!atBoundary) anchorsToUpdate.push({
              id: generateId(),
              date: edgeToAnchorDate(lastClampedDate, draggedEdge),
              edges: [{ itemId: id, edge: draggedEdge }],
            });
          } else if (snap.type === "anchor") {
            if (tempAnchorId) anchorsToRemove.push(tempAnchorId);
            anchorsToUpdate.push(addEdgeToAnchor(snap.anchor, { itemId: id, edge: draggedEdge }));
          } else if (snap.existingAnchorId === null) {
            // Create new anchor from two edges — anchor date is at snap edge's anchor position
            if (tempAnchorId) anchorsToRemove.push(tempAnchorId);
            const resolvedDate = resolveEdgeDate(scenario, snap.itemId, snap.edge);
            const sharedAnchorDate = edgeToAnchorDate(resolvedDate, snap.edge);
            anchorsToUpdate.push({
              id: generateId(),
              date: sharedAnchorDate,
              edges: [{ itemId: snap.itemId, edge: snap.edge }, { itemId: id, edge: draggedEdge }],
            });
          } else {
            // Join existing anchor (different from myAnchor)
            if (tempAnchorId) anchorsToRemove.push(tempAnchorId);
            const target = anchors.find(a => a.id === snap.existingAnchorId);
            if (target) {
              anchorsToUpdate.push(addEdgeToAnchor(target, { itemId: id, edge: draggedEdge }));
            }
          }
        }

        if (anchorsToRemove.length > 0 || anchorsToUpdate.length > 0) {
          applyDragUpdate([], [], anchorsToRemove, anchorsToUpdate, { skipHistory: true });
        }
      } else {
        // Body drag mouseup — disconnect all of this item's edges from their anchors
        const anchorsToRemove: string[] = [];
        const anchorsToUpdate: TimeAnchor[] = [];

        for (const anchor of anchors) {
          if (!anchor.edges.some(e => e.itemId === id)) continue;
          if (!anchor.fixed && anchor.edges.length === 1) continue; // single-edge anchor already followed in real-time
          const disconnectedEdges = anchor.edges.filter(e => e.itemId === id);
          const newEdges = anchor.edges.filter(e => e.itemId !== id);
          if (!anchor.fixed && newEdges.length < 1) {
            anchorsToRemove.push(anchor.id);
          } else {
            anchorsToUpdate.push({ ...anchor, edges: newEdges });
          }
          // Spawn a new single-edge anchor for disconnected edges not already covered by a temp anchor
          for (const edge of disconnectedEdges) {
            if (bodyTempAnchorsRef.current.has(edge.edge)) continue; // temp anchor already in store
            const newEdgeDate = edge.edge === "start"
              ? addMonths(originalStart, lastBodyDelta)
              : (originalEnd ? addMonths(originalEnd, lastBodyDelta) : anchor.date);
            anchorsToUpdate.push({ id: generateId(), date: edgeToAnchorDate(newEdgeDate, edge.edge), edges: [{ itemId: id, edge: edge.edge }] });
          }
        }

        if (anchorsToRemove.length > 0 || anchorsToUpdate.length > 0) {
          applyDragUpdate([], [], anchorsToRemove, anchorsToUpdate, { skipHistory: true });
        }
      }
    };

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
  }, [viewMonths, scenario, applyDragUpdate, captureHistorySnapshot, onHoverAnchorId, lanes]);

  const handleCreateDrag = useCallback((
    e: React.MouseEvent,
    sourceAccountId: string | null,
    rowLane: number,
  ) => {
    e.stopPropagation();
    const container = containerRef.current;
    if (!container) return;
    const containerWidth = container.clientWidth;
    const containerLeft = container.getBoundingClientRect().left;
    const MAGNET_THRESHOLD_PX = 15;

    function xToDate(clientX: number): string {
      const pct = Math.max(0, Math.min(1, (clientX - containerLeft) / containerWidth));
      const monthIdx = Math.min(viewMonths - 1, Math.floor(pct * viewMonths)) + viewportStart;
      return addMonths(scenario.timelineStart, monthIdx);
    }

    function findSnapAnchor(date: string): TimeAnchor | null {
      const thresholdMonths = (MAGNET_THRESHOLD_PX / containerWidth) * viewMonths;
      return findNearestAnchor(anchors, date, null, thresholdMonths);
    }

    // Snap start date at mousedown — search at prevMonth(rawStartDate) since start anchors sit there
    const rawStartDate = xToDate(e.clientX);
    const startSnapAnchor = findSnapAnchor(addMonths(rawStartDate, -1));
    const dragStartDate = startSnapAnchor ? addMonths(startSnapAnchor.date, 1) : rawStartDate;
    const snapStartAnchorId: string | null = startSnapAnchor?.id ?? null;

    const startX = e.clientX;
    let hasDragged = false;
    const MIN_DRAG_PX = 4;
    let dragEndDate = dragStartDate;
    let snapEndAnchorId: string | null = null;
    let highlightedEl: HTMLElement | null = null;

    function clearHighlight() {
      if (highlightedEl) {
        highlightedEl.classList.remove("anchor-candidate-highlight");
        highlightedEl = null;
      }
    }

    function highlightAnchor(anchor: TimeAnchor) {
      const el = document.querySelector<HTMLElement>(`[data-anchor-id="${anchor.id}"] > div:first-child`);
      if (el) { el.classList.add("anchor-candidate-highlight"); highlightedEl = el; }
    }

    if (startSnapAnchor) highlightAnchor(startSnapAnchor);
    isCreatingRef.current = true;

    const onMouseMove = (ev: MouseEvent) => {
      const dx = ev.clientX - startX;
      if (!hasDragged && Math.abs(dx) >= MIN_DRAG_PX) hasDragged = true;
      if (!hasDragged) return;

      clearHighlight();
      const rawEndDate = xToDate(ev.clientX);
      const endSnapAnchor = findSnapAnchor(rawEndDate);

      if (endSnapAnchor) {
        dragEndDate = endSnapAnchor.date;
        snapEndAnchorId = endSnapAnchor.id;
        highlightAnchor(endSnapAnchor);
      } else {
        dragEndDate = rawEndDate;
        snapEndAnchorId = null;
      }

      const previewStart = dragEndDate >= dragStartDate ? dragStartDate : dragEndDate;
      const previewEnd = dragEndDate >= dragStartDate ? dragEndDate : dragStartDate;
      setCreateDragPreview({ sourceAccountId, lane: rowLane, startDate: previewStart, endDate: previewEnd });
    };

    const onMouseUp = () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
      clearHighlight();
      setCreateDragPreview(null);
      isCreatingRef.current = false;
      setActiveCreateRow(null);

      if (!hasDragged) return;

      const swapped = dragEndDate < dragStartDate;
      const previewStart = swapped ? dragEndDate : dragStartDate;
      const previewEnd = swapped ? dragStartDate : dragEndDate;

      // After a potential swap, assign snap anchors to the correct edge
      const finalStartAnchorId = swapped ? snapEndAnchorId : snapStartAnchorId;
      const finalEndAnchorId = swapped ? snapStartAnchorId : snapEndAnchorId;

      onDragCreate({
        sourceAccountId,
        startDate: previewStart,
        endDate: previewEnd === previewStart ? null : previewEnd,
        startAnchorId: finalStartAnchorId,
        endAnchorId: previewEnd === previewStart ? null : finalEndAnchorId,
      });
    };

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
  }, [viewMonths, viewportStart, scenario.timelineStart, anchors, onDragCreate]);

  const handleRowDrag = useCallback((
    e: React.MouseEvent,
    kind: "account" | "transfer",
    sourceAccountId: string | null,
    fromIdx: number,
    boundaries: number[], // top Y of each item in the group (px from container top), in visual order
    onCommit: (insertAtGap: number) => void,
  ) => {
    e.stopPropagation();
    e.preventDefault();
    captureHistorySnapshot();
    const container = containerRef.current;
    if (!container) return;

    let currentGap = fromIdx + 1; // default: same position (no-op)
    setRowDragState({ kind, sourceAccountId, fromIdx, insertAtGap: currentGap });

    const onMouseMove = (ev: MouseEvent) => {
      const rect = container.getBoundingClientRect();
      const relY = ev.clientY - rect.top;
      let gap = 0;
      for (let i = 0; i < boundaries.length; i++) {
        if (relY > boundaries[i] + 15) gap = i + 1; // 15 = laneHeight/2
      }
      currentGap = gap;
      setRowDragState(prev => prev ? { ...prev, insertAtGap: gap } : null);
    };

    const onMouseUp = () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
      setRowDragState(null);
      setHoveredHandle(null);
      if (currentGap !== fromIdx && currentGap !== fromIdx + 1) {
        onCommit(currentGap);
      }
    };

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
  }, [captureHistorySnapshot]);

  const nameMap = Object.fromEntries([
    ...scenario.accounts.map(a => [a.id, a.name]),
    ...scenario.transfers.map(t => [t.id, t.name]),
  ]);

  // Precomputed data for row reorder drag
  const externalTransfersOrdered = scenario.transfers.filter(t => t.sourceAccountId === null);
  const accountTransfersOrdered: Record<string, Transfer[]> = {};
  for (const acc of scenario.accounts) {
    accountTransfersOrdered[acc.id] = scenario.transfers.filter(t => t.sourceAccountId === acc.id);
  }
  const transferLaneY: Record<string, number> = {};
  for (const l of lanes) {
    if (l.type === "transfer") transferLaneY[l.id] = laneTopPx(l.lane);
  }
  const accountLaneTops = scenario.accounts.map(acc => laneTopPx(accountLaneMap[acc.id]));

  function sortByVisualY(group: Transfer[]): Transfer[] {
    return [...group].sort((a, b) => {
      const yDiff = (transferLaneY[a.id] ?? 0) - (transferLaneY[b.id] ?? 0);
      return yDiff !== 0 ? yDiff : group.indexOf(a) - group.indexOf(b);
    });
  }
  const sortedExternalGroup = sortByVisualY(externalTransfersOrdered);
  const sortedTransferGroups: Record<string, Transfer[]> = {};
  for (const acc of scenario.accounts) {
    sortedTransferGroups[acc.id] = sortByVisualY(accountTransfersOrdered[acc.id] ?? []);
  }

  const todayPct = (() => {
    const now = new Date();
    const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    const monthIdx = monthsBetween(scenario.timelineStart, todayStr);
    const viewIdx = monthIdx - viewportStart;
    if (viewIdx < 0 || viewIdx > viewMonths) return null;
    return (viewIdx + 0.5) / viewMonths * 100;
  })();

  return (
    <div ref={containerRef} className="relative w-full h-full select-none">
      {/* Highlight styles */}
      <style>{`
        .anchor-candidate-highlight {
          background: rgba(99,202,183,1) !important;
          opacity: 1 !important;
        }
      `}</style>
      {/* Bars */}
      <div
        className="relative"
        style={{ minHeight: barsHeight, height: "100%", transition: "min-height 150ms ease" }}
        onClick={() => onSelectItem(null, null)}
        onMouseMove={e => {
          if (isDraggingAnchorRef.current) return;
          const rect = e.currentTarget.getBoundingClientRect();
          const viewIdx = Math.min(viewMonths - 1, Math.floor(((e.clientX - rect.left) / rect.width) * viewMonths));
          onHoverIdx(Math.max(0, viewIdx) + viewportStart);
        }}
        onMouseLeave={() => onHoverIdx(null)}
      >
        {todayPct !== null && (
          <div
            className="absolute top-0 bottom-0 w-px bg-amber-400 opacity-70 pointer-events-none"
            style={{ left: `${todayPct}%` }}
          />
        )}
        {hoveredIdx !== null && hoveredAnchorId === null && (() => {
          const viewIdx = hoveredIdx - viewportStart;
          if (viewIdx < 0 || viewIdx >= viewMonths) return null;
          const pct = (viewIdx / viewMonths) * 100;
          return (
            <div
              className="absolute top-0 bottom-0 opacity-50 pointer-events-none z-10"
              style={{ left: `${pct}%`, borderLeft: "1px dashed currentColor" }}
            />
          );
        })()}

        {/* Anchor lines — rendered before bars so items appear on top */}
        {anchors.map(anchor => {
          const monthIdx = monthsBetween(scenario.timelineStart, anchor.date) - viewportStart;
          if (monthIdx < -1 || monthIdx >= viewMonths) return null;
          const pct = ((monthIdx + 1) / viewMonths) * 100;
          const isFixed = !!anchor.fixed;
          const isHovered = anchor.id === hoveredAnchorId;
          const lineColor = isHovered && !isFixed ? "var(--anchor-hover)" : "var(--anchor-line)";
          return (
            <div
              key={anchor.id}
              data-anchor-id={anchor.id}
              className={`absolute top-0 bottom-0 ${isFixed ? "cursor-default" : "cursor-ew-resize"}`}
              style={{ left: `${pct}%`, width: 9, transform: "translateX(-4px)", zIndex: 1 }}
              onMouseDown={isFixed ? undefined : e => handleAnchorDrag(e, anchor)}
              onMouseEnter={() => onHoverAnchorId(anchor.id)}
              onMouseLeave={() => onHoverAnchorId(null)}
            >
              {/* 1px visual line centered in hit area */}
              <div
                className="absolute inset-y-0 pointer-events-none"
                style={{ left: 3.5, width: 1, background: lineColor }}
              />
            </div>
          );
        })}

        {/* Create rows — drag here to add a new transfer from that source */}
        {createRows.map(({ sourceAccountId, lane }) => {
          const rowKey = `create-${sourceAccountId ?? "external"}`;
          const isActive = activeCreateRow === rowKey;
          const laneTop = laneTopPx(lane);
          const compactH = 2;
          const visualH = isActive ? h : compactH;
          const visualTop = 2;
          const srcAcc = scenario.accounts.find(a => a.id === sourceAccountId);
          const rowColor = srcAcc?.color ?? "#6b7280";
          return (
            <div
              key={rowKey}
              className={`absolute ${isActive ? "cursor-crosshair" : "cursor-default"}`}
              style={{ left: 0, right: 0, top: laneTop, height: isActive ? laneHeight : createRowCompactH, zIndex: 2, transition: "height 150ms ease" }}
              onMouseEnter={() => {
                if (createRowTimerRef.current) clearTimeout(createRowTimerRef.current);
                createRowTimerRef.current = setTimeout(() => setActiveCreateRow(rowKey), 100);
              }}
              onMouseLeave={() => {
                if (createRowTimerRef.current) clearTimeout(createRowTimerRef.current);
                if (!isCreatingRef.current) setActiveCreateRow(null);
              }}
              onMouseDown={isActive ? e => handleCreateDrag(e, sourceAccountId, lane) : undefined}
            >
              {/* Visual bar — compact line or full bar */}
              <div
                className="absolute left-0 right-0 rounded pointer-events-none"
                style={{
                  top: visualTop,
                  height: visualH,
                  border: `1px dashed ${isActive ? `${rowColor}60` : `${rowColor}00`}`,
                  background: isActive ? `${rowColor}0d` : "transparent",
                  transition: "height 150ms ease, top 150ms ease, border-color 150ms ease, background 150ms ease",
                }}
              />
              {isActive && (
                <span
                  className="absolute left-0 right-0 flex items-center justify-center pointer-events-none select-none"
                  style={{ top: 2, height: h, color: `${rowColor}80`, fontSize: 10 }}
                >
                  drag to add transfer
                </span>
              )}
            </div>
          );
        })}

        {/* Preview bar while drag-creating a new transfer */}
        {createDragPreview !== null && (() => {
          const { sourceAccountId, lane, startDate, endDate } = createDragPreview;
          const top = laneTopPx(lane) + 2;
          const startIdx = Math.max(0, monthsBetween(scenario.timelineStart, startDate) - viewportStart);
          const endIdx = Math.min(viewMonths - 1, monthsBetween(scenario.timelineStart, endDate) - viewportStart);
          const leftPct = (startIdx / viewMonths) * 100;
          const rightPct = ((endIdx + 1) / viewMonths) * 100;
          const widthPct = rightPct - leftPct;
          const srcAcc = scenario.accounts.find(a => a.id === sourceAccountId);
          const srcColor = srcAcc?.color ?? "#6b7280";
          return (
            <div
              className="absolute rounded pointer-events-none"
              style={{
                left: `calc(${leftPct}% + 1.5px)`,
                width: `calc(${widthPct}% - 3px)`,
                minWidth: `${minCompactWidth - 2}px`,
                top,
                height: h,
                background: srcColor,
                opacity: 0.45,
                zIndex: 3,
                outline: `1.5px dashed ${srcColor}`,
              }}
            />
          );
        })()}

        {lanes.map(({ id, type, start, end, lane }) => {
          const rawStartIdx = monthsBetween(scenario.timelineStart, start) - viewportStart;
          const startIdx = Math.max(0, rawStartIdx);
          const endIdx = Math.min(viewMonths - 1, monthsBetween(scenario.timelineStart, end) - viewportStart);
          const leftPct = (startIdx / viewMonths) * 100;
          const rightPct = ((endIdx + 1) / viewMonths) * 100;
          const widthPct = rightPct - leftPct;
          const stuckRight = type === "transfer" && rawStartIdx > viewMonths - 1;

          const acc = scenario.accounts.find(a => a.id === id);
          const transfer = scenario.transfers.find(t => t.id === id);
          const isOneTime = (transfer as Transfer | undefined)?.isOneTime ?? false;

          const isTransfer = type === "transfer" && !!transfer;

          const isSelected = id === selectedItemId;
          const isRelated = selectedItemType === "account" && isTransfer && transfer != null &&
            (transfer.sourceAccountId === selectedItemId || transfer.targetAccountId === selectedItemId);
          const hasSelection = selectedItemId != null;
          const top = laneTopPx(lane) + 2;

// For drag: only transfers are draggable
          const dragStart = transfer ? (transfer.startDate ?? scenario.timelineStart) : null;
          const dragEnd = transfer ? (transfer.endDate ?? scenario.timelineEnd) : null;

          let srcColor = "#6b7280";
          let tgtColor = "#6b7280";
          let srcIsNone = false;
          let tgtIsNone = false;
          let tgtName: string | undefined;
          if (type === "account" && acc) srcColor = acc.color;
          if (isTransfer) {
            const srcAcc = scenario.accounts.find(a => a.id === transfer!.sourceAccountId);
            const tgtAcc = scenario.accounts.find(a => a.id === transfer!.targetAccountId);
            srcIsNone = transfer!.sourceAccountId === null;
            tgtIsNone = transfer!.targetAccountId === null;
            srcColor = srcAcc?.color ?? "#6b7280";
            tgtColor = tgtAcc?.color ?? "#6b7280";
            tgtName = tgtAcc?.name;
          }

          return (
            <div
              key={id}
              className="absolute flex items-center rounded cursor-pointer"
              style={{
                left: stuckRight ? `calc(100% - ${minCompactWidth - 1}px)` : `calc(${leftPct}% + 1.5px)`,
                width: isTransfer ? (isOneTime ? 0 : `calc(${widthPct}% - 3px)`) : `calc(${Math.max(widthPct, 0.5)}% - 3px)`,
                minWidth: isTransfer ? `${minCompactWidth - 2}px` : undefined,
                top,
                height: h,
                overflow: "hidden",
                zIndex: 2,
                opacity: hasSelection && !isSelected && !isRelated ? 0.6 : 1,
                transition: "opacity 0.1s, top 150ms ease",
              }}
              onClick={e => { e.stopPropagation(); onSelectItem(id, type); }}
              onMouseDown={dragStart !== null ? e => handleDrag(e, id, type, "body", dragStart, dragEnd) : undefined}
              onMouseEnter={e => {
                if (isTransfer) setHoveredTransfer({ id, x: e.clientX, y: e.clientY });
                else setHoveredAccount({ id, x: e.clientX, y: e.clientY });
                setHoveredHandle(type === "account" ? `acc-${id}` : `tx-${id}`);
              }}
              onMouseMove={e => {
                if (isTransfer) setHoveredTransfer(h => h ? { ...h, x: e.clientX, y: e.clientY } : h);
                else setHoveredAccount(h => h ? { ...h, x: e.clientX, y: e.clientY } : h);
              }}
              onMouseLeave={() => {
                if (isTransfer) setHoveredTransfer(null);
                else setHoveredAccount(null);
                if (!rowDragState) setHoveredHandle(null);
              }}
            >
              {!isTransfer && (
                <>
                  <div style={{ position: "absolute", inset: 0, background: srcColor, pointerEvents: "none" }} />
                  {simulationResult && (() => {
                    const balances = simulationResult.balances[id];
                    if (!balances) return null;
                    const barMonths = endIdx - startIdx + 1;
                    const runs: { from: number; to: number }[] = [];
                    let runStart: number | null = null;
                    for (let v = startIdx; v <= endIdx; v++) {
                      const bal = balances[viewportStart + v];
                      if (bal !== null && bal !== undefined && bal < 0) {
                        if (runStart === null) runStart = v;
                      } else {
                        if (runStart !== null) { runs.push({ from: runStart, to: v - 1 }); runStart = null; }
                      }
                    }
                    if (runStart !== null) runs.push({ from: runStart, to: endIdx });
                    return runs.map(({ from, to }) => (
                      <div
                        key={from}
                        style={{
                          position: "absolute",
                          top: 0, bottom: 0,
                          left: `${((from - startIdx) / barMonths) * 100}%`,
                          width: `${((to - from + 1) / barMonths) * 100}%`,
                          backgroundImage: "linear-gradient(to right, transparent 50%, var(--timeline-bg) 50%)",
                          backgroundSize: "4px 100%",
                          pointerEvents: "none",
                        }}
                      />
                    ));
                  })()}
                </>
              )}
              {isTransfer && (
                <>
                  {/* Left (src) section */}
                  <div style={{
                    position: "absolute",
                    left: 0, top: 0, bottom: 0,
                    width: `calc(50% + ${(arrowTip - 2) / 2}px)`,
                    background: srcIsNone
                      ? "repeating-linear-gradient(-45deg, var(--none-stripe-a) 0px, var(--none-stripe-a) 12px, var(--none-stripe-b) 12px, var(--none-stripe-b) 24px)"
                      : srcColor,
                    opacity: 0.85,
                    borderRadius: srcIsNone ? "4px 0 0 4px" : undefined,
                    boxShadow: srcIsNone ? "inset 0 0 0 1px var(--none-border)" : undefined,
                    clipPath: `polygon(0% 0%, calc(100% - ${arrowTip}px) 0%, 100% 50%, calc(100% - ${arrowTip}px) 100%, 0% 100%)`,
                    pointerEvents: "none",
                  }} />
                  {/* Right (tgt) section */}
                  <div style={{
                    position: "absolute",
                    left: `calc(50% - ${(arrowTip + 2) / 2}px)`,
                    right: 0, top: 0, bottom: 0,
                    background: tgtIsNone
                      ? "repeating-linear-gradient(-45deg, var(--none-stripe-a) 0px, var(--none-stripe-a) 12px, var(--none-stripe-b) 12px, var(--none-stripe-b) 24px)"
                      : tgtColor,
                    opacity: 0.85,
                    borderRadius: tgtIsNone ? "0 4px 4px 0" : undefined,
                    boxShadow: tgtIsNone ? "inset 0 0 0 1px var(--none-border)" : undefined,
                    clipPath: `polygon(2px 0%, 100% 0%, 100% 100%, 2px 100%, ${arrowTip + 2}px 50%, 2px 0%)`,
                    pointerEvents: "none",
                  }} />
                  {/* Diagonal border for src arrow tip */}
                  {srcIsNone && (
                    <svg style={{ position: "absolute", left: `calc(50% - ${(arrowTip + 2) / 2}px)`, top: 0, width: `${arrowTip}px`, height: `${h}px`, pointerEvents: "none", zIndex: 3 }}>
                      <polyline points={`0,0.5 ${arrowTip},${h / 2} 0,${h - 0.5}`} fill="none" stroke="var(--none-border)" strokeWidth="1" />
                    </svg>
                  )}
                  {/* Diagonal border for tgt notch */}
                  {tgtIsNone && (
                    <svg style={{ position: "absolute", left: `calc(50% - ${(arrowTip - 2) / 2}px)`, top: 0, width: `${arrowTip}px`, height: `${h}px`, pointerEvents: "none", zIndex: 3 }}>
                      <polyline points={`0,0.5 ${arrowTip},${h / 2} 0,${h - 0.5}`} fill="none" stroke="var(--none-border)" strokeWidth="1" />
                    </svg>
                  )}
                </>
              )}
              {!isTransfer && !isOneTime && widthPct > 5 && (
                <span className="text-xs truncate px-1 pointer-events-none font-bold" style={{ position: "relative", zIndex: 1, color: srcIsNone ? "var(--none-label)" : "white" }}>{nameMap[id]}</span>
              )}
              {isTransfer && !isOneTime && widthPct > 5 && (
                <>
                  <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, right: `calc(50% + ${(arrowTip + 2) / 2}px)`, overflow: "hidden", display: "flex", alignItems: "center", zIndex: 1, pointerEvents: "none" }}>
                    <span className="text-xs truncate px-1" style={{ color: srcIsNone ? "var(--none-label)" : "white" }}>{nameMap[id]}</span>
                  </div>
                  {tgtName && (
                    <div style={{ position: "absolute", left: `calc(50% + ${(arrowTip + 2) / 2}px)`, top: 0, bottom: 0, right: 0, overflow: "hidden", display: "flex", alignItems: "center", justifyContent: "flex-end", zIndex: 1, pointerEvents: "none" }}>
                      <span className="text-xs truncate px-1 text-white">{tgtName}</span>
                    </div>
                  )}
                </>
              )}
              {/* Handles — transfers only */}
              {isTransfer && !isOneTime && (
                <>
                  <div
                    data-edge-id={`${id}-start`}
                    className="absolute left-0 top-0 bottom-0 w-2 cursor-ew-resize"
                    style={{ overflow: "visible" }}
                    onMouseDown={e => { e.stopPropagation(); handleDrag(e, id, type, "left", dragStart!, dragEnd); }}
                  >
                  </div>
                  <div
                    data-edge-id={`${id}-end`}
                    className="absolute right-0 top-0 bottom-0 w-2 cursor-ew-resize"
                    style={{ overflow: "visible" }}
                    onMouseDown={e => { e.stopPropagation(); handleDrag(e, id, type, "right", dragStart!, dragEnd); }}
                  >
                  </div>
                </>
              )}
            </div>
          );
        })}

        {/* Row reorder drag handles — left gutter */}
        {externalTransfersOrdered.map((t) => {
          const y = transferLaneY[t.id];
          if (y === undefined) return null;
          const handleKey = `tx-${t.id}`;
          const tgtColor = scenario.accounts.find(a => a.id === t.targetAccountId)?.color ?? "#9ca3af";
          return (
            <div
              key={handleKey}
              className="absolute flex items-center justify-center"
              style={{
                left: -18, top: y, width: 18, height: laneHeight, zIndex: 10,
                cursor: rowDragState ? "grabbing" : "grab",
                color: tgtColor,
                opacity: hoveredHandle === handleKey ? 1 : 0,
                transition: "opacity 0.15s",
              }}
              onMouseEnter={() => setHoveredHandle(handleKey)}
              onMouseLeave={() => { if (!rowDragState) setHoveredHandle(null); }}
              onMouseDown={e => {
                const fromVisualIdx = sortedExternalGroup.findIndex(tx => tx.id === t.id);
                handleRowDrag(e, "transfer", null, fromVisualIdx, sortedExternalGroup.map(tx => transferLaneY[tx.id] ?? 0),
                  (gap) => reorderTransferInGroup(t.id, sortedExternalGroup[gap]?.id ?? null));
              }}
            >
              <RowDragHandle />
            </div>
          );
        })}
        {scenario.accounts.flatMap((acc, accIdx) => {
          const accY = accountLaneTops[accIdx];
          const accHandleKey = `acc-${acc.id}`;
          const accTransfers = accountTransfersOrdered[acc.id] ?? [];
          const elements = [
            <div
              key={accHandleKey}
              className="absolute flex items-center justify-center"
              style={{
                left: -18, top: accY, width: 18, height: laneHeight, zIndex: 10,
                cursor: rowDragState ? "grabbing" : "grab",
                color: acc.color,
                opacity: hoveredHandle === accHandleKey ? 1 : 0,
                transition: "opacity 0.15s",
              }}
              onMouseEnter={() => setHoveredHandle(accHandleKey)}
              onMouseLeave={() => { if (!rowDragState) setHoveredHandle(null); }}
              onMouseDown={e => handleRowDrag(e, "account", null, accIdx, accountLaneTops, (gap) => reorderAccount(accIdx, gap))}
            >
              <RowDragHandle />
            </div>,
            ...accTransfers.map((t) => {
              const y = transferLaneY[t.id];
              if (y === undefined) return null;
              const handleKey = `tx-${t.id}`;
              return (
                <div
                  key={handleKey}
                  className="absolute flex items-center justify-center"
                  style={{
                    left: -18, top: y, width: 18, height: laneHeight, zIndex: 10,
                    cursor: rowDragState ? "grabbing" : "grab",
                    color: acc.color,
                    opacity: hoveredHandle === handleKey ? 1 : 0,
                    transition: "opacity 0.15s",
                  }}
                  onMouseEnter={() => setHoveredHandle(handleKey)}
                  onMouseLeave={() => { if (!rowDragState) setHoveredHandle(null); }}
                  onMouseDown={e => {
                    const sorted = sortedTransferGroups[acc.id] ?? [];
                    const fromVisualIdx = sorted.findIndex(tx => tx.id === t.id);
                    handleRowDrag(e, "transfer", acc.id, fromVisualIdx, sorted.map(tx => transferLaneY[tx.id] ?? 0),
                      (gap) => reorderTransferInGroup(t.id, sorted[gap]?.id ?? null));
                  }}
                >
                  <RowDragHandle />
                </div>
              );
            }).filter(Boolean),
          ];
          return elements;
        })}

        {/* Drop indicator line during row reorder drag */}
        {rowDragState !== null && (() => {
          const { kind, sourceAccountId, fromIdx, insertAtGap } = rowDragState;
          if (insertAtGap === fromIdx || insertAtGap === fromIdx + 1) return null;
          let lineY: number;
          if (kind === "account") {
            lineY = insertAtGap < accountLaneTops.length
              ? accountLaneTops[insertAtGap]
              : (accountLaneTops[accountLaneTops.length - 1] ?? 0) + laneHeight;
          } else {
            const group = sourceAccountId === null
              ? sortedExternalGroup
              : (sortedTransferGroups[sourceAccountId] ?? []);
            if (group.length === 0) return null;
            lineY = insertAtGap < group.length
              ? (transferLaneY[group[insertAtGap].id] ?? 0)
              : (transferLaneY[group[group.length - 1].id] ?? 0) + laneHeight;
          }
          const color = kind === "account" ? (scenario.accounts[fromIdx]?.color ?? "#6b7280") : "#6b7280";
          return (
            <div
              className="absolute pointer-events-none"
              style={{ left: 0, right: 0, top: lineY, height: 2, background: color, zIndex: 20, borderRadius: 1, opacity: 0.85 }}
            />
          );
        })()}
      </div>

      {/* Account hover tooltip */}
      {hoveredAccount && simulationResult && hoveredIdx !== null && (() => {
        const acc = scenario.accounts.find(a => a.id === hoveredAccount.id);
        if (!acc) return null;
        const monthStr = simulationResult.months[hoveredIdx];
        if (!monthStr) return null;
        const balance = simulationResult.balances[acc.id]?.[hoveredIdx];
        if (balance === null || balance === undefined) return null;

        const r = scenario.inflationRate;
        const inflationOn = scenario.inflationEnabled && r !== 0;
        const sym = scenario.currencySymbol;
        const symPos = scenario.currencySymbolPosition;
        const deflator = inflationOn ? Math.pow(1 + r, hoveredIdx / 12) : 1;
        const balanceReal = inflationOn ? balance / deflator : balance;

        const { x, y } = hoveredAccount;
        const tH = accountTooltipDivRef.current?.offsetHeight ?? 70;
        return (
          <div
            ref={accountTooltipDivRef}
            className="pointer-events-none fixed z-50 rounded-md px-2.5 py-1.5 text-xs shadow-lg bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900"
            style={{
              left: Math.min(x + 14, window.innerWidth - 220),
              top: Math.min(y - 10, window.innerHeight - tH - 4),
              whiteSpace: "nowrap",
            }}
          >
            <div className="font-medium mb-0.5">{acc.name}</div>
            <div className="text-gray-500 dark:text-gray-500 text-[10px] mb-1">{monthToLabel(monthStr, scenario.currencyLocale)}</div>
            {inflationOn ? (
              <>
                <div>Nominal: {formatCurrency(balance, sym, symPos)}</div>
                <div>Real: {formatCurrency(balanceReal, sym, symPos)}</div>
              </>
            ) : (
              <div>{formatCurrency(balance, sym, symPos)}</div>
            )}
          </div>
        );
      })()}

      {/* Transfer hover tooltip */}
      {hoveredTransfer && simulationResult && (() => {
        const t = scenario.transfers.find(tr => tr.id === hoveredTransfer.id);
        if (!t) return null;

        // One-time transfers: always show at startDate regardless of hoveredIdx.
        // Recurring transfers: show at the hovered month, and only when it's in range.
        let monthStr: string;
        let monthIdx: number;
        if (t.isOneTime) {
          monthStr = t.startDate ?? scenario.timelineStart;
          monthIdx = Math.max(0, simulationResult.months.indexOf(monthStr));
        } else {
          if (hoveredIdx === null) return null;
          monthStr = simulationResult.months[hoveredIdx];
          if (!monthStr) return null;
          const effectiveStart = t.startDate ?? scenario.timelineStart;
          const inRange = monthStr >= effectiveStart && (t.endDate === null || monthStr <= t.endDate);
          if (!inRange) return null;
          monthIdx = hoveredIdx;
        }

        const r = scenario.inflationRate;
        const inflationOn = scenario.inflationEnabled && r !== 0;
        const growsWithInflation = (t.inflationAdjusted ?? false) === true;
        const sym = scenario.currencySymbol;
        const symPos = scenario.currencySymbolPosition;

        let amountNominal: number | null = null;
        let amountReal: number | null = null;
        let amountLabel = "";

        if (t.amountType === "fixed") {
          const deflator = inflationOn ? Math.pow(1 + r, monthIdx / 12) : 1;
          amountNominal = inflationOn && growsWithInflation ? t.amount * deflator : t.amount;
          amountReal = inflationOn ? amountNominal / deflator : amountNominal;
        } else if (t.amountType === "percent-balance") {
          amountLabel = `${(t.amount * 100).toFixed(1)}% of balance`;
        } else {
          amountLabel = "All gains";
        }

        const lines: string[] = [];
        if (amountNominal !== null) {
          if (inflationOn) {
            lines.push(`Nominal: ${formatCurrency(amountNominal, sym, symPos)}`);
            lines.push(`Real: ${formatCurrency(amountReal!, sym, symPos)}`);
          } else {
            lines.push(formatCurrency(amountNominal, sym, symPos));
          }
        } else {
          lines.push(amountLabel);
        }

        const { x, y } = hoveredTransfer;
        const tH = tooltipDivRef.current?.offsetHeight ?? 90;
        return (
          <div
            ref={tooltipDivRef}
            className="pointer-events-none fixed z-50 rounded-md px-2.5 py-1.5 text-xs shadow-lg bg-gray-900 dark:bg-gray-100 text-white dark:text-gray-900"
            style={{
              left: Math.min(x + 14, window.innerWidth - 220),
              top: Math.min(y - 10, window.innerHeight - tH - 4),
              whiteSpace: "nowrap",
            }}
          >
            <div className="font-medium mb-0.5">{t.name}</div>
            <div className="text-gray-500 dark:text-gray-500 text-[10px] mb-1">{monthToLabel(monthStr, scenario.currencyLocale)}</div>
            {lines.map((line, i) => <div key={i}>{line}</div>)}
            {inflationOn && t.amountType === "fixed" && (
              <div className="text-gray-400 dark:text-gray-500 text-[10px] mt-1">
                {growsWithInflation ? "grows with inflation" : "fixed nominal"}
              </div>
            )}
          </div>
        );
      })()}

    </div>
  );
}
