import { useRef, useCallback } from "react";
import type { Transfer, Scenario } from "../types";
import { useScenarioStore } from "../store/scenario";
import { resolvedStartDate, resolvedEndDate } from "../utils/snapDates";

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

  // Assign lanes to avoid overlap, with an optional minimum lane
  const lanes: { id: string; type: "account" | "transfer"; start: string; end: string; lane: number }[] = [];

  function assignLane(startDate: string, endDate: string, minLane = 0): number {
    for (let lane = minLane; ; lane++) {
      const occupied = lanes.filter(l => l.lane === lane);
      const overlaps = occupied.some(l => startDate <= l.end && endDate >= l.start);
      if (!overlaps) return lane;
    }
  }

  // For each account, assign its lane then immediately assign its transfers below it
  const accountLaneMap: Record<string, number> = {};
  for (const acc of scenario.accounts) {
    const lane = assignLane(acc.startDate, scenario.timelineEnd);
    accountLaneMap[acc.id] = lane;
    lanes.push({ id: acc.id, type: "account", start: acc.startDate, end: scenario.timelineEnd, lane });

    for (const t of scenario.transfers) {
      if (t.sourceAccountId !== acc.id) continue;
      const tStart = resolvedStartDate(t, scenario.accounts);
      const tEnd = resolvedEndDate(t, scenario.accounts) ?? scenario.timelineEnd;
      const tLane = assignLane(tStart, tEnd, lane + 1);
      lanes.push({ id: t.id, type: "transfer", start: tStart, end: tEnd, lane: tLane });
    }
  }

  // Any transfers whose source account doesn't exist (shouldn't happen, but be safe)
  const assigned = new Set(lanes.map(l => l.id));
  for (const t of scenario.transfers) {
    if (assigned.has(t.id)) continue;
    const tStart = resolvedStartDate(t, scenario.accounts);
    const tEnd = resolvedEndDate(t, scenario.accounts) ?? scenario.timelineEnd;
    lanes.push({ id: t.id, type: "transfer", start: tStart, end: tEnd, lane: assignLane(tStart, tEnd) });
  }

  const maxLane = lanes.reduce((m, l) => Math.max(m, l.lane), 0);
  const laneHeight = 24;
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

    const onMouseMove = (ev: MouseEvent) => {
      const dx = ev.clientX - startX;
      const monthDelta = Math.round((dx / containerWidth) * viewMonths);

      let newStart = originalStart;
      let newEnd = originalEnd;

      if (part === "left") {
        newStart = addMonths(originalStart, monthDelta);
        if (newStart > (newEnd ?? scenario.timelineEnd)) newStart = newEnd ?? scenario.timelineEnd;
        if (newStart < scenario.timelineStart) newStart = scenario.timelineStart;
      } else if (part === "right" && newEnd !== null) {
        newEnd = addMonths(originalEnd!, monthDelta);
        if (newEnd < newStart) newEnd = newStart;
        if (newEnd > scenario.timelineEnd) newEnd = scenario.timelineEnd;
      } else if (part === "body") {
        newStart = addMonths(originalStart, monthDelta);
        if (newEnd !== null) newEnd = addMonths(originalEnd!, monthDelta);
        if (newStart < scenario.timelineStart) {
          const shift = monthsBetween(newStart, scenario.timelineStart);
          newStart = scenario.timelineStart;
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
        const startIdx = Math.max(0, monthsBetween(scenario.timelineStart, start) - viewportStart);
        const endIdx = Math.min(viewMonths - 1, monthsBetween(scenario.timelineStart, end) - viewportStart);
        const leftPct = (startIdx / (viewMonths - 1)) * 100;
        const rightPct = (endIdx / (viewMonths - 1)) * 100;
        const widthPct = rightPct - leftPct;

        const acc = scenario.accounts.find(a => a.id === id);
        const transfer = scenario.transfers.find(t => t.id === id);
        const isOneTime = (transfer as Transfer | undefined)?.isOneTime ?? false;

        const isSelected = id === selectedItemId;
        const top = lane * laneHeight + 2;

        // Snap state — locked handles show a different cursor
        const startSnapped = type === "transfer" && !!transfer?.startSnap;
        const endSnapped = type === "transfer" && !!transfer?.endSnap;

        // For drag: pass literal dates (not resolved) so the handler writes back correctly
        const dragStart = transfer ? transfer.startDate : start;
        const dragEnd = transfer ? transfer.endDate : null;

        // Find source account color for transfers
        let barColor = "#6b7280";
        if (type === "account" && acc) barColor = acc.color;
        if (type === "transfer" && transfer) {
          const srcAcc = scenario.accounts.find(a => a.id === transfer.sourceAccountId);
          barColor = srcAcc?.color ?? "#6b7280";
        }

        return (
          <div
            key={id}
            className={`absolute flex items-center rounded cursor-pointer ${isSelected ? "ring-2 ring-white ring-offset-1" : ""}`}
            style={{
              left: `${leftPct}%`,
              width: isOneTime ? "8px" : `${Math.max(widthPct, 0.5)}%`,
              top,
              height: laneHeight - 4,
              background: barColor,
              opacity: 0.85,
            }}
            onClick={() => onSelectItem(id, type)}
            onMouseDown={e => !startSnapped && handleDrag(e, id, type, "body", dragStart, dragEnd)}
          >
            {!isOneTime && widthPct > 5 && (
              <span className="text-xs text-white truncate px-1 pointer-events-none">{nameMap[id]}</span>
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
