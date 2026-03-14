import { useRef, useCallback } from "react";
import type { Transfer, Scenario } from "../types";
import { useScenarioStore } from "../store/scenario";
import { resolvedStartDate, resolvedEndDate, resolvedAccountStartDate } from "../utils/snapDates";

interface TimelineProps {
  scenario: Scenario;
  selectedItemId: string | null;
  viewportStart: number;
  viewportEnd: number;
  onSelectItem: (id: string, type: "account" | "transfer") => void;
  hoveredIdx: number | null;
  onHoverIdx: (idx: number | null) => void;
}

function monthsBetween(a: string, b: string): number {
  const [ay, am] = a.split("-").map(Number);
  const [by, bm] = b.split("-").map(Number);
  return (by - ay) * 12 + (bm - am);
}

function addMonths(date: string, n: number): string {
  const [y, m] = date.split("-").map(Number);
  const total = y * 12 + (m - 1) + n;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  return `${ny}-${String(nm).padStart(2, "0")}`;
}


export function Timeline({ scenario, selectedItemId, viewportStart, viewportEnd, onSelectItem, hoveredIdx, onHoverIdx }: TimelineProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const updateAccount = useScenarioStore(s => s.updateAccount);
  const updateTransfer = useScenarioStore(s => s.updateTransfer);

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

  // Contributions (null source) — own isolated group at the top
  const contribGroup: LaneEntry[] = [];
  for (const t of scenario.transfers) {
    if (t.sourceAccountId !== null) continue;
    const tStart = resolvedStartDate(t, scenario.accounts);
    const tEnd = resolvedEndDate(t, scenario.accounts) ?? scenario.timelineEnd;
    const localLane = assignLaneIn(contribGroup, tStart, tEnd);
    contribGroup.push({ start: tStart, end: tEnd, lane: localLane });
    lanes.push({ id: t.id, type: "transfer", start: tStart, end: tEnd, lane: nextLane + localLane });
  }
  if (contribGroup.length > 0) nextLane += Math.max(...contribGroup.map(l => l.lane)) + 1;

  // Each account gets a dedicated lane; its transfers collapse within their own group below it
  const accountLaneMap: Record<string, number> = {};
  for (const acc of scenario.accounts) {
    const accStart = resolvedAccountStartDate(acc, scenario.timelineStart);
    accountLaneMap[acc.id] = nextLane;
    lanes.push({ id: acc.id, type: "account", start: accStart, end: scenario.timelineEnd, lane: nextLane });

    const transferGroup: LaneEntry[] = [];
    for (const t of scenario.transfers) {
      if (t.sourceAccountId !== acc.id) continue;
      const tStart = resolvedStartDate(t, scenario.accounts);
      const tEnd = resolvedEndDate(t, scenario.accounts) ?? scenario.timelineEnd;
      const localLane = assignLaneIn(transferGroup, tStart, tEnd);
      transferGroup.push({ start: tStart, end: tEnd, lane: localLane });
      lanes.push({ id: t.id, type: "transfer", start: tStart, end: tEnd, lane: nextLane + 1 + localLane });
    }

    nextLane += 1 + (transferGroup.length > 0 ? Math.max(...transferGroup.map(l => l.lane)) + 1 : 0);
  }

  const maxLane = lanes.reduce((m, l) => Math.max(m, l.lane), 0);
  const laneHeight = 24;
  const h = laneHeight - 4;         // bar height = 20px
  const arrowTip = h / 2;           // = 10px — width of the chevron point
  const minCompactWidth = (h + arrowTip * 2 + 8) / 2; // enough to show both color halves clearly
  const barsHeight = (maxLane + 1) * laneHeight + 8;

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
    const containerWidth = container.clientWidth;
    const startX = e.clientX;

    // For transfers, compute the earliest allowed start date from source/target accounts
    const transferMinStart = (() => {
      if (type !== "transfer") return scenario.timelineStart;
      const t = scenario.transfers.find(t => t.id === id);
      if (!t) return scenario.timelineStart;
      const dates: string[] = [];
      if (t.sourceAccountId) {
        const a = scenario.accounts.find(a => a.id === t.sourceAccountId);
        if (a) dates.push(resolvedAccountStartDate(a, scenario.timelineStart));
      }
      if (t.targetAccountId) {
        const a = scenario.accounts.find(a => a.id === t.targetAccountId);
        if (a) dates.push(resolvedAccountStartDate(a, scenario.timelineStart));
      }
      return dates.reduce((a, b) => a > b ? a : b, scenario.timelineStart);
    })();

    const onMouseMove = (ev: MouseEvent) => {
      const dx = ev.clientX - startX;
      const monthDelta = Math.round((dx / containerWidth) * viewMonths);

      let newStart = originalStart;
      let newEnd = originalEnd;

      if (part === "left") {
        newStart = addMonths(originalStart, monthDelta);
        if (newStart > (newEnd ?? scenario.timelineEnd)) newStart = newEnd ?? scenario.timelineEnd;
        if (newStart < transferMinStart) newStart = transferMinStart;
      } else if (part === "right" && newEnd !== null) {
        newEnd = addMonths(originalEnd!, monthDelta);
        if (newEnd < newStart) newEnd = newStart;
        if (newEnd > scenario.timelineEnd) newEnd = scenario.timelineEnd;
      } else if (part === "body") {
        newStart = addMonths(originalStart, monthDelta);
        if (newEnd !== null) newEnd = addMonths(originalEnd!, monthDelta);
        if (newStart < transferMinStart) {
          const shift = monthsBetween(newStart, transferMinStart);
          newStart = transferMinStart;
          if (newEnd !== null) newEnd = addMonths(newEnd, shift);
        }
      }

      if (type === "account") {
        updateAccount(id, { startDate: newStart });
      } else {
        updateTransfer(id, {
          startDate: newStart,
          ...(part !== "left" && newEnd !== null ? { endDate: newEnd } : {}),
        });
      }
    };

    const onMouseUp = () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
  }, [viewMonths, scenario, updateAccount, updateTransfer]);

  const nameMap = Object.fromEntries([
    ...scenario.accounts.map(a => [a.id, a.name]),
    ...scenario.transfers.map(t => [t.id, t.name]),
  ]);

  const todayPct = (() => {
    const now = new Date();
    const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    const monthIdx = monthsBetween(scenario.timelineStart, todayStr);
    const viewIdx = monthIdx - viewportStart;
    if (viewIdx < 0 || viewIdx > viewMonths) return null;
    return (viewIdx / (viewMonths - 1)) * 100;
  })();

  return (
    <div ref={containerRef} className="relative w-full select-none">
      {/* Bars */}
      <div
        className="relative overflow-x-hidden"
        style={{ height: barsHeight }}
        onMouseMove={e => {
          const rect = e.currentTarget.getBoundingClientRect();
          const viewIdx = Math.round(((e.clientX - rect.left) / rect.width) * (viewMonths - 1));
          onHoverIdx(Math.max(0, Math.min(viewMonths - 1, viewIdx)) + viewportStart);
        }}
        onMouseLeave={() => onHoverIdx(null)}
      >
        {todayPct !== null && (
          <div
            className="absolute top-0 bottom-0 w-px bg-amber-400 opacity-70 pointer-events-none"
            style={{ left: `${todayPct}%` }}
          />
        )}
        {hoveredIdx !== null && (() => {
          const viewIdx = hoveredIdx - viewportStart;
          if (viewIdx < 0 || viewIdx >= viewMonths) return null;
          const pct = (viewIdx / (viewMonths - 1)) * 100;
          return (
            <div
              className="absolute top-0 bottom-0 opacity-50 pointer-events-none z-10"
              style={{ left: `${pct}%`, borderLeft: "1px dashed currentColor" }}
            />
          );
        })()}
      {lanes.map(({ id, type, start, end, lane }) => {
        const rawStartIdx = monthsBetween(scenario.timelineStart, start) - viewportStart;
        const startIdx = Math.max(0, rawStartIdx);
        const endIdx = Math.min(viewMonths - 1, monthsBetween(scenario.timelineStart, end) - viewportStart);
        const leftPct = (startIdx / (viewMonths - 1)) * 100;
        const rightPct = (endIdx / (viewMonths - 1)) * 100;
        const widthPct = rightPct - leftPct;
        const stuckRight = type === "transfer" && rawStartIdx > viewMonths - 1;

        const acc = scenario.accounts.find(a => a.id === id);
        const transfer = scenario.transfers.find(t => t.id === id);
        const isOneTime = (transfer as Transfer | undefined)?.isOneTime ?? false;

        const isSelected = id === selectedItemId;
        const top = lane * laneHeight + 2;

        // Snap state — locked handles show a different cursor
        const startSnapped = type === "transfer" ? !!transfer?.startSnap : !!acc?.startSnap;
        const endSnapped = type === "transfer" && !!transfer?.endSnap;

        // For drag: pass literal dates (not resolved) so the handler writes back correctly
        const dragStart = transfer ? transfer.startDate : acc!.startDate;
        const dragEnd = transfer ? transfer.endDate : null;

        const isTransfer = type === "transfer" && !!transfer;

        let srcColor = "#6b7280";
        let tgtColor = "#6b7280";
        let tgtName: string | undefined;
        if (type === "account" && acc) srcColor = acc.color;
        if (isTransfer) {
          const srcAcc = scenario.accounts.find(a => a.id === transfer!.sourceAccountId);
          const tgtAcc = scenario.accounts.find(a => a.id === transfer!.targetAccountId);
          srcColor = srcAcc?.color ?? "#6b7280";
          tgtColor = tgtAcc?.color ?? "#6b7280";
          tgtName = tgtAcc?.name;
        }

        return (
          <div
            key={id}
            className={`absolute flex items-center rounded cursor-pointer ${isSelected ? "ring-2 ring-white ring-offset-1" : ""}`}
            style={{
              left: stuckRight ? `calc(100% - ${minCompactWidth - 1}px)` : `calc(${leftPct}% + 1px)`,
              width: isTransfer ? (isOneTime ? 0 : `calc(${widthPct}% - 2px)`) : `calc(${Math.max(widthPct, 0.5)}% - 2px)`,
              minWidth: isTransfer ? `${minCompactWidth - 2}px` : undefined,
              top,
              height: h,
              background: isTransfer ? "transparent" : srcColor,
              opacity: isTransfer ? 0.6 : 0.85,
              overflow: "hidden",
            }}
            onClick={() => onSelectItem(id, type)}
            onMouseDown={e => !startSnapped && handleDrag(e, id, type, "body", dragStart, dragEnd)}
          >
            {isTransfer && (
              <>
                {/* Left (src) section: tip at splitOffset past center, making straight src = straight tgt */}
                <div style={{
                  position: "absolute",
                  left: 0, top: 0, bottom: 0,
                  width: `calc(50% + ${(arrowTip - 2) / 2}px)`,
                  background: srcColor,
                  clipPath: `polygon(0% 0%, calc(100% - ${arrowTip}px) 0%, 100% 50%, calc(100% - ${arrowTip}px) 100%, 0% 100%)`,
                  pointerEvents: "none",
                }} />
                {/* Right (tgt) section: notch aligns with the src tip */}
                <div style={{
                  position: "absolute",
                  left: `calc(50% - ${(arrowTip + 2) / 2}px)`,
                  right: 0, top: 0, bottom: 0,
                  background: tgtColor,
                  clipPath: `polygon(2px 0%, 100% 0%, 100% 100%, 2px 100%, ${arrowTip + 2}px 50%, 2px 0%)`,
                  pointerEvents: "none",
                }} />
              </>
            )}
            {!isOneTime && widthPct > 5 && (
              <span className={`text-xs text-white truncate px-1 pointer-events-none ${!isTransfer ? "font-bold" : ""}`} style={{ position: "relative", zIndex: 1 }}>{nameMap[id]}</span>
            )}
            {isTransfer && !isOneTime && widthPct > 5 && tgtName && (
              <span className="absolute right-1 text-xs text-white pointer-events-none" style={{ zIndex: 1 }}>{tgtName}</span>
            )}
            {/* Handles — hidden/locked when snapped */}
            {!isOneTime && (
              <>
                <div
                  className={`absolute left-0 top-0 bottom-0 w-2 ${startSnapped ? "cursor-not-allowed opacity-40" : "cursor-ew-resize"}`}
                  onMouseDown={e => { e.stopPropagation(); if (!startSnapped) handleDrag(e, id, type, "left", dragStart, dragEnd); }}
                />
                {(type === "transfer" && (transfer?.endDate !== null || endSnapped)) && (
                  <div
                    className={`absolute right-0 top-0 bottom-0 w-2 ${endSnapped ? "cursor-not-allowed opacity-40" : "cursor-ew-resize"}`}
                    onMouseDown={e => { e.stopPropagation(); if (!endSnapped) handleDrag(e, id, type, "right", dragStart, dragEnd); }}
                  />
                )}
              </>
            )}
          </div>
        );
      })}
      </div>
    </div>
  );
}
