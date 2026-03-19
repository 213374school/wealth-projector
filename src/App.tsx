import { useEffect, useState, useCallback, useRef } from "react";
import { useScenarioStore } from "./store/scenario";
import { Chart, CHART_MARGIN } from "./components/Chart";
import { Timeline } from "./components/Timeline";
import { EditorPanel } from "./components/EditorPanel";
import { Settings } from "./components/Settings";
import { Legend } from "./components/Legend";
import { monthsBetween, addMonths } from "./utils/anchors";
import { monthToLabel } from "./utils/formatting";
import type { Account } from "./types";

type Theme = "light" | "dark";

function useTheme(): [Theme, () => void] {
  const [theme, setTheme] = useState<Theme>(() => {
    return (localStorage.getItem("theme") as Theme) ??
      (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  });

  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
    localStorage.setItem("theme", theme);
  }, [theme]);

  return [theme, () => setTheme(t => t === "dark" ? "light" : "dark")];
}

// ── Icons ─────────────────────────────────────────────────────────────────────

function FlameIcon() {
  return (
    <svg width="13" height="15" viewBox="0 0 13 15" fill="currentColor" className="text-white">
      <path d="M6.5 0.5C6.5 0.5 10 5 10 8C10 10.5 8.5 12.5 6.5 12.5C4.5 12.5 3 10.5 3 8C3 6.5 3.8 5.2 5 4.2C4.9 5.4 5.5 6.5 6.2 7.1C6.1 5 6.3 2.2 6.5 0.5Z"/>
    </svg>
  );
}

function UndoIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 15 15" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3.5 6L1.5 4L3.5 2"/>
      <path d="M1.5 4H9A4.5 4.5 0 0 1 9 13H6.5"/>
    </svg>
  );
}

function RedoIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 15 15" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M11.5 6L13.5 4L11.5 2"/>
      <path d="M13.5 4H6A4.5 4.5 0 0 0 6 13H8.5"/>
    </svg>
  );
}

function SunIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 15 15" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      <circle cx="7.5" cy="7.5" r="2.5"/>
      <line x1="7.5" y1="1" x2="7.5" y2="2.5"/>
      <line x1="7.5" y1="12.5" x2="7.5" y2="14"/>
      <line x1="1" y1="7.5" x2="2.5" y2="7.5"/>
      <line x1="12.5" y1="7.5" x2="14" y2="7.5"/>
      <line x1="3.1" y1="3.1" x2="4.2" y2="4.2"/>
      <line x1="10.8" y1="10.8" x2="11.9" y2="11.9"/>
      <line x1="3.1" y1="11.9" x2="4.2" y2="10.8"/>
      <line x1="10.8" y1="4.2" x2="11.9" y2="3.1"/>
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 15 15" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12.5 9.5A6 6 0 0 1 5.5 2.5a6 6 0 1 0 7 7z"/>
    </svg>
  );
}

function CogIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 15 15" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      <line x1="1.5" y1="3.5" x2="2" y2="3.5"/>
      <circle cx="4" cy="3.5" r="2"/>
      <line x1="6" y1="3.5" x2="13.5" y2="3.5"/>
      <line x1="1.5" y1="7.5" x2="8" y2="7.5"/>
      <circle cx="10" cy="7.5" r="2"/>
      <line x1="12" y1="7.5" x2="13.5" y2="7.5"/>
      <line x1="1.5" y1="11.5" x2="4" y2="11.5"/>
      <circle cx="6" cy="11.5" r="2"/>
      <line x1="8" y1="11.5" x2="13.5" y2="11.5"/>
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 13 13" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      <line x1="6.5" y1="1.5" x2="6.5" y2="11.5"/>
      <line x1="1.5" y1="6.5" x2="11.5" y2="6.5"/>
    </svg>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

export default function App() {
  const {
    scenarios,
    activeScenarioId,
    simulationResult,
    selectedItemId,
    selectedItemType,
    createScenario,
    addAccount,
    addTransfer,
    selectItem,
    undo,
    redo,
    _undoStack,
    _redoStack,
  } = useScenarioStore();

  const [theme, toggleTheme] = useTheme();
  const [showSettings, setShowSettings] = useState(false);
  const [showRealValues, setShowRealValues] = useState(true);
  const [showAddTransfer, setShowAddTransfer] = useState(false);
  const [visibleAccounts, setVisibleAccounts] = useState<Set<string>>(new Set());
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);
  const [hoveredAnchorId, setHoveredAnchorId] = useState<string | null>(null);
  const [viewportStart, setViewportStart] = useState(0);
  const [viewportEnd, setViewportEnd] = useState(0);
  const chartAreaRef = useRef<HTMLDivElement>(null);
  const timelineRef = useRef<HTMLDivElement>(null);
  const vpRef = useRef({ start: 0, end: 0, total: 1 });
  const panAccRef = useRef(0);
  const zoomWidthRef = useRef<number | null>(null);
  const touchRef = useRef<{ x: number; y: number; dist: number | null } | null>(null);

  const scenario = activeScenarioId ? scenarios[activeScenarioId] : null;

  void selectedItemType;

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (e.key === "z" && !e.shiftKey) { e.preventDefault(); undo(); }
      else if ((e.key === "z" && e.shiftKey) || e.key === "y") { e.preventDefault(); redo(); }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [undo, redo]);

  useEffect(() => {
    if (Object.keys(scenarios).length === 0) {
      createScenario();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!scenario) return;
    setVisibleAccounts(prev => {
      const next = new Set(prev);
      for (const acc of scenario.accounts) next.add(acc.id);
      for (const id of next) {
        if (!scenario.accounts.find(a => a.id === id)) next.delete(id);
      }
      return next;
    });
  }, [scenario?.accounts]);

  useEffect(() => { vpRef.current.start = viewportStart; }, [viewportStart]);
  useEffect(() => { vpRef.current.end = viewportEnd; }, [viewportEnd]);

  useEffect(() => {
    if (!simulationResult) return;
    const total = simulationResult.months.length;
    vpRef.current = { start: 0, end: total - 1, total };
    setViewportStart(0);
    setViewportEnd(total - 1);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!simulationResult]);

  useEffect(() => {
    if (simulationResult) vpRef.current.total = simulationResult.months.length;
  }, [simulationResult]);

  const applyViewport = useCallback((newStart: number, newEnd: number) => {
    const { total } = vpRef.current;
    const width = newEnd - newStart;
    const s = Math.max(0, Math.min(newStart, total - 1 - width));
    const e = Math.min(total - 1, s + width);
    vpRef.current.start = s;
    vpRef.current.end = e;
    setViewportStart(s);
    setViewportEnd(e);
  }, []);

  useEffect(() => {
    const el = chartAreaRef.current;
    if (!el) return;

    const onWheel = (e: WheelEvent) => {
      const inTimeline = timelineRef.current?.contains(e.target as Node);
      const isHorizontal = Math.abs(e.deltaX) > Math.abs(e.deltaY);
      if (inTimeline && !isHorizontal && !e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const { start, end, total } = vpRef.current;
      const viewWidth = end - start;
      const containerWidth = el.clientWidth || 800;

      if (e.ctrlKey || e.metaKey) {
        if (zoomWidthRef.current === null) zoomWidthRef.current = viewWidth;
        zoomWidthRef.current *= (1 + e.deltaY * 0.003);
        zoomWidthRef.current = Math.max(12, Math.min(total - 1, zoomWidthRef.current));
        const newWidth = Math.round(zoomWidthRef.current);
        if (newWidth !== viewWidth) {
          const centre = (start + end) / 2;
          const newStart = Math.round(centre - newWidth / 2);
          applyViewport(newStart, newStart + newWidth);
        }
      } else {
        zoomWidthRef.current = null;
        const rawDelta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
        panAccRef.current += (rawDelta / containerWidth) * viewWidth;
        const months = Math.trunc(panAccRef.current);
        if (months !== 0) {
          panAccRef.current -= months;
          applyViewport(start + months, end + months);
        }
      }
    };

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 1) {
        touchRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY, dist: null };
      } else if (e.touches.length === 2) {
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        touchRef.current = { x: 0, y: 0, dist: Math.hypot(dx, dy) };
      }
      panAccRef.current = 0;
    };

    const onTouchMove = (e: TouchEvent) => {
      e.preventDefault();
      if (!touchRef.current) return;
      const { start, end, total } = vpRef.current;
      const viewWidth = end - start;
      const containerWidth = el.clientWidth || 800;

      if (e.touches.length === 1 && touchRef.current.dist === null) {
        const dx = e.touches[0].clientX - touchRef.current.x;
        panAccRef.current += (-dx / containerWidth) * viewWidth;
        const months = Math.trunc(panAccRef.current);
        if (months !== 0) {
          panAccRef.current -= months;
          applyViewport(start + months, end + months);
        }
        touchRef.current.x = e.touches[0].clientX;
        touchRef.current.y = e.touches[0].clientY;
      } else if (e.touches.length === 2 && touchRef.current.dist !== null) {
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        const newDist = Math.hypot(dx, dy);
        const factor = touchRef.current.dist / newDist;
        const newWidth = Math.max(12, Math.min(total - 1, Math.round(viewWidth * factor)));
        const centre = (start + end) / 2;
        const newStart = Math.round(centre - newWidth / 2);
        applyViewport(newStart, newStart + newWidth);
        touchRef.current.dist = newDist;
      }
    };

    const onTouchEnd = (e: TouchEvent) => {
      if (e.touches.length === 0) {
        touchRef.current = null;
      } else if (e.touches.length === 1) {
        touchRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY, dist: null };
      }
      panAccRef.current = 0;
    };

    el.addEventListener("wheel", onWheel, { passive: false });
    el.addEventListener("touchstart", onTouchStart, { passive: true });
    el.addEventListener("touchmove", onTouchMove, { passive: false });
    el.addEventListener("touchend", onTouchEnd, { passive: true });
    return () => {
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchmove", onTouchMove);
      el.removeEventListener("touchend", onTouchEnd);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggleAccountVisibility = useCallback((id: string) => {
    setVisibleAccounts(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  if (!scenario || !simulationResult) {
    return (
      <div className="flex items-center justify-center h-screen bg-zinc-50 dark:bg-zinc-950 text-zinc-500">
        Loading...
      </div>
    );
  }

  const totalMonths = simulationResult.months.length;
  const safeViewportStart = Math.max(0, Math.min(viewportStart, totalMonths - 2));
  const safeViewportEnd = Math.max(safeViewportStart + 1, Math.min(viewportEnd, totalMonths - 1));

  return (
    <div className="flex flex-col h-screen bg-zinc-50 dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100">
      {/* Header */}
      <header className="flex items-center justify-between px-4 py-2 border-b border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 flex-shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-7 h-7 rounded-md bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center shadow-sm shadow-orange-400/30 flex-shrink-0">
            <FlameIcon />
          </div>
          <h1 className="font-semibold text-sm text-zinc-900 dark:text-zinc-100 tracking-tight">FIRE Planner</h1>
          <div className="h-4 w-px bg-zinc-200 dark:bg-zinc-700" />
          <span className="text-sm text-zinc-500 dark:text-zinc-400">{scenario.name}</span>
        </div>
        <div className="flex items-center gap-0.5">
          <button
            onClick={undo}
            disabled={_undoStack.length === 0}
            className="btn-icon disabled:opacity-30"
            title="Undo (Ctrl+Z)"
          ><UndoIcon /></button>
          <button
            onClick={redo}
            disabled={_redoStack.length === 0}
            className="btn-icon disabled:opacity-30"
            title="Redo (Ctrl+Shift+Z)"
          ><RedoIcon /></button>
          <div className="h-4 w-px bg-zinc-200 dark:bg-zinc-700 mx-1.5" />
          <button onClick={() => addAccount()} className="btn-primary text-xs">
            <PlusIcon /> Account
          </button>
          <button
            onClick={() => setShowAddTransfer(true)}
            disabled={scenario.accounts.length === 0}
            className="btn-secondary text-xs disabled:opacity-40 ml-1"
          >
            <PlusIcon /> Transfer
          </button>
          <div className="h-4 w-px bg-zinc-200 dark:bg-zinc-700 mx-1.5" />
          <button onClick={toggleTheme} className="btn-icon" title="Toggle theme">
            {theme === "dark" ? <SunIcon /> : <MoonIcon />}
          </button>
          <button onClick={() => setShowSettings(true)} className="btn-icon" title="Settings">
            <CogIcon />
          </button>
        </div>
      </header>

      {/* Main content */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left: Chart + Timeline */}
        <div ref={chartAreaRef} className="flex flex-col flex-1 overflow-hidden">
          {/* Legend */}
          <div className="px-4 py-2 flex-shrink-0 border-b border-zinc-100 dark:border-zinc-800/60 flex items-center gap-3">
            <Legend
              accounts={scenario.accounts}
              visibleAccounts={visibleAccounts}
              onToggle={toggleAccountVisibility}
            />
            {scenario.inflationEnabled && scenario.inflationRate !== 0 && (
              <div className="flex items-center ml-auto flex-shrink-0 rounded-lg border border-zinc-200 dark:border-zinc-700 overflow-hidden text-xs">
                <button
                  onClick={() => setShowRealValues(false)}
                  title="Nominal — values as actual future amounts, not adjusted for inflation"
                  className={`px-2.5 py-1 transition-colors ${!showRealValues ? "bg-zinc-100 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 font-medium" : "text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300"}`}
                >Nominal</button>
                <button
                  onClick={() => setShowRealValues(true)}
                  title="Real — values adjusted for inflation, expressed in today's purchasing power"
                  className={`px-2.5 py-1 transition-colors ${showRealValues ? "bg-zinc-100 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 font-medium" : "text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-300"}`}
                >Real</button>
              </div>
            )}
          </div>

          {/* Chart */}
          <div className="flex-1 min-h-0 p-2">
            <Chart
              result={simulationResult}
              accounts={scenario.accounts}
              scenario={scenario}
              visibleAccounts={visibleAccounts}
              viewportStart={safeViewportStart}
              viewportEnd={safeViewportEnd}
              selectedItemId={selectedItemId}
              onSelectItem={selectItem}
              hoveredIdx={hoveredIdx}
              onHoverIdx={setHoveredIdx}
              hoveredAnchorId={hoveredAnchorId}
              showRealValues={showRealValues}
            />
          </div>

          {/* Anchor labels strip — fixed below chart, aligned to chart x-axis */}
          {(() => {
            const allAnchors = scenario.anchors ?? [];
            const viewMonths = safeViewportEnd - safeViewportStart + 1;

            const positioned = allAnchors.flatMap(anchor => {
              const monthIdx = monthsBetween(scenario.timelineStart, anchor.date) - safeViewportStart;
              if (monthIdx < -1 || monthIdx >= viewMonths) return [];
              return [{ anchor, pct: ((monthIdx + 1) / viewMonths) * 100 }];
            });

            // Cursor label — only when not hovering over an existing anchor
            const cursorViewIdx = hoveredIdx !== null && hoveredAnchorId === null
              ? hoveredIdx - safeViewportStart : null;
            const cursorPct = cursorViewIdx !== null && cursorViewIdx >= 0 && cursorViewIdx <= viewMonths - 1
              ? (cursorViewIdx / viewMonths) * 100 : null;
            const cursorDate = cursorPct !== null ? addMonths(scenario.timelineStart, hoveredIdx!) : null;

            const MIN_LABEL_PX = 80;
            const innerWidth = (chartAreaRef.current?.clientWidth ?? 800) - 16 - CHART_MARGIN.left - CHART_MARGIN.right;
            const minPct = (MIN_LABEL_PX / innerWidth) * 100;
            const crowded = new Set<string>();

            // Cursor takes precedence over everything nearby
            if (cursorPct !== null) {
              for (const p of positioned) {
                if (Math.abs(p.pct - cursorPct) < minPct) crowded.add(p.anchor.id);
              }
            }

            for (let i = 0; i < positioned.length; i++) {
              for (let j = i + 1; j < positioned.length; j++) {
                if (Math.abs(positioned[j].pct - positioned[i].pct) < minPct) {
                  const iHovered = positioned[i].anchor.id === hoveredAnchorId;
                  const jHovered = positioned[j].anchor.id === hoveredAnchorId;
                  if (iHovered) {
                    crowded.add(positioned[j].anchor.id);
                  } else if (jHovered) {
                    crowded.add(positioned[i].anchor.id);
                  } else if (!positioned[i].anchor.fixed && !positioned[j].anchor.fixed) {
                    crowded.add(positioned[i].anchor.id);
                    crowded.add(positioned[j].anchor.id);
                  } else if (!positioned[i].anchor.fixed) {
                    crowded.add(positioned[i].anchor.id);
                  } else if (!positioned[j].anchor.fixed) {
                    crowded.add(positioned[j].anchor.id);
                  }
                }
              }
            }

            if (positioned.length === 0 && cursorDate === null) return null;
            return (
              <div
                className="flex-shrink-0 select-none"
                style={{ height: 20, paddingLeft: CHART_MARGIN.left + 8, paddingRight: CHART_MARGIN.right + 8 }}
              >
                <div className="relative h-full">
                {cursorDate !== null && cursorPct !== null && (
                  <div
                    className="absolute -translate-x-1/2 pointer-events-none"
                    style={{ left: `${cursorPct}%`, top: 2, fontSize: 10, whiteSpace: "nowrap", color: "var(--anchor-label)" }}
                  >
                    {monthToLabel(cursorDate)}
                  </div>
                )}
                {positioned.map(({ anchor, pct }) => {
                  const isFixed = !!anchor.fixed;
                  const isHovered = anchor.id === hoveredAnchorId;
                  if (crowded.has(anchor.id) && !isHovered) return null;
                  return (
                    <div
                      key={anchor.id}
                      className="absolute -translate-x-1/2 pointer-events-none"
                      style={{
                        left: `${pct}%`,
                        top: 2,
                        fontSize: 10,
                        whiteSpace: "nowrap",
                        color: isHovered && !isFixed
                          ? "var(--anchor-hover)"
                          : "var(--anchor-label)",
                      }}
                    >
                      {monthToLabel(addMonths(anchor.date, 1))}
                    </div>
                  );
                })}
                </div>
              </div>
            );
          })()}

          {/* Timeline */}
          <div
            ref={timelineRef}
            className="flex-shrink-0 border-t border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 py-2"
            style={{ minHeight: 80, maxHeight: "35vh", overflowY: "auto", paddingLeft: CHART_MARGIN.left + 8, paddingRight: CHART_MARGIN.right + 8 }}
          >
            <Timeline
              scenario={scenario}
              selectedItemId={selectedItemId}
              viewportStart={safeViewportStart}
              viewportEnd={safeViewportEnd}
              onSelectItem={(id, type) => selectItem(id, type)}
              hoveredIdx={hoveredIdx}
              onHoverIdx={setHoveredIdx}
              hoveredAnchorId={hoveredAnchorId}
              onHoverAnchorId={setHoveredAnchorId}
            />
          </div>
        </div>

        {/* Right: Editor Panel */}
        <div className="w-72 flex-shrink-0 border-l border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 overflow-y-auto">
          <EditorPanel />
        </div>
      </div>

      {/* Settings modal */}
      {showSettings && <Settings onClose={() => setShowSettings(false)} />}

      {/* Add Transfer modal */}
      {showAddTransfer && (
        <AddTransferModal
          accounts={scenario.accounts}
          onConfirm={(srcId, tgtId) => {
            addTransfer(srcId, tgtId);
            setShowAddTransfer(false);
          }}
          onClose={() => setShowAddTransfer(false)}
        />
      )}
    </div>
  );
}

function AddTransferModal({
  accounts,
  onConfirm,
  onClose,
}: {
  accounts: Account[];
  onConfirm: (srcId: string | null, tgtId: string | null) => void;
  onClose: () => void;
}) {
  const [srcId, setSrcId] = useState<string>(accounts[0]?.id ?? "");
  const [tgtId, setTgtId] = useState<string>(accounts[0]?.id ?? "");

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div
        className="bg-white dark:bg-zinc-900 rounded-xl shadow-2xl shadow-black/20 w-full max-w-sm p-6 space-y-4 border border-zinc-200 dark:border-zinc-800"
        onClick={e => e.stopPropagation()}
      >
        <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">Add Transfer</h2>

        <div>
          <label className="block text-xs font-medium text-zinc-500 dark:text-zinc-400 mb-1.5">From (source)</label>
          <select
            value={srcId}
            onChange={e => setSrcId(e.target.value)}
            className="input"
          >
            <option value="">None (external / contribution)</option>
            {accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </div>

        <div>
          <label className="block text-xs font-medium text-zinc-500 dark:text-zinc-400 mb-1.5">To (target)</label>
          <select
            value={tgtId}
            onChange={e => setTgtId(e.target.value)}
            className="input"
          >
            <option value="">None (external / consumption)</option>
            {accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </div>

        <p className="text-xs text-zinc-400 dark:text-zinc-500">
          Source and target can be the same account (e.g. for a gains tax event). Set one side to "None" for a contribution or consumption.
        </p>

        <div className="flex gap-2 pt-1">
          <button
            onClick={() => onConfirm(srcId || null, tgtId || null)}
            disabled={!srcId && !tgtId}
            className="btn-primary flex-1 justify-center disabled:opacity-50"
          >
            Create
          </button>
          <button onClick={onClose} className="btn-secondary flex-1 justify-center">
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
