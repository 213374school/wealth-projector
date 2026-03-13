import { useEffect, useState, useCallback, useRef } from "react";
import { useScenarioStore } from "./store/scenario";
import { Chart, CHART_MARGIN } from "./components/Chart";
import { Timeline } from "./components/Timeline";
import { EditorPanel } from "./components/EditorPanel";
import { Settings } from "./components/Settings";
import { Legend } from "./components/Legend";
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
  } = useScenarioStore();

  const [theme, toggleTheme] = useTheme();
  const [showSettings, setShowSettings] = useState(false);
  const [showAddTransfer, setShowAddTransfer] = useState(false);
  const [visibleAccounts, setVisibleAccounts] = useState<Set<string>>(new Set());
  const [viewportStart, setViewportStart] = useState(0);
  const [viewportEnd, setViewportEnd] = useState(0);
  const chartAreaRef = useRef<HTMLDivElement>(null);
  // Refs so event handlers always see current values without being re-attached
  const vpRef = useRef({ start: 0, end: 0, total: 1 });
  const panAccRef = useRef(0);      // fractional month accumulator for smooth panning
  const zoomWidthRef = useRef<number | null>(null); // fractional viewport width for smooth zoom
  const touchRef = useRef<{ x: number; y: number; dist: number | null } | null>(null);

  const scenario = activeScenarioId ? scenarios[activeScenarioId] : null;

  // Suppress unused variable warning
  void selectedItemType;

  // Initialize scenario if none exists
  useEffect(() => {
    if (Object.keys(scenarios).length === 0) {
      createScenario();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sync visible accounts when accounts change
  useEffect(() => {
    if (!scenario) return;
    setVisibleAccounts(prev => {
      const next = new Set(prev);
      for (const acc of scenario.accounts) next.add(acc.id);
      // Remove accounts that no longer exist
      for (const id of next) {
        if (!scenario.accounts.find(a => a.id === id)) next.delete(id);
      }
      return next;
    });
  }, [scenario?.accounts]);

  // Keep vpRef in sync with state
  useEffect(() => { vpRef.current.start = viewportStart; }, [viewportStart]);
  useEffect(() => { vpRef.current.end = viewportEnd; }, [viewportEnd]);

  // Initialize viewport once simulation is available
  useEffect(() => {
    if (!simulationResult) return;
    const total = simulationResult.months.length;
    vpRef.current = { start: 0, end: total - 1, total };
    setViewportStart(0);
    setViewportEnd(total - 1);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!simulationResult]);

  // Keep total in sync
  useEffect(() => {
    if (simulationResult) vpRef.current.total = simulationResult.months.length;
  }, [simulationResult]);

  // Commit a new viewport (clamped, width-preserving for pan)
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

  // Attach wheel + touch listeners once; read/write through refs so no re-attachment needed
  useEffect(() => {
    const el = chartAreaRef.current;
    if (!el) return;

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const { start, end, total } = vpRef.current;
      const viewWidth = end - start;
      const containerWidth = el.clientWidth || 800;

      if (e.ctrlKey || e.metaKey) {
        // Accumulate fractional width so tiny trackpad-pinch deltas aren't lost to rounding.
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
        // Leaving zoom mode — reset accumulator so next zoom starts fresh
        zoomWidthRef.current = null;
        // Pan: accumulate fractional months so slow scrolls aren't dropped
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
  // Intentionally empty deps: handlers read everything through refs
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
      <div className="flex items-center justify-center h-screen bg-gray-100 dark:bg-gray-900 text-gray-500">
        Loading...
      </div>
    );
  }

  const totalMonths = simulationResult.months.length;
  const safeViewportStart = Math.max(0, Math.min(viewportStart, totalMonths - 2));
  const safeViewportEnd = Math.max(safeViewportStart + 1, Math.min(viewportEnd, totalMonths - 1));

  return (
    <div className="flex flex-col h-screen bg-gray-50 dark:bg-gray-950 text-gray-900 dark:text-gray-100">
      {/* Header */}
      <header className="flex items-center justify-between px-4 py-2 border-b border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 flex-shrink-0">
        <div className="flex items-center gap-3">
          <h1 className="font-bold text-lg text-indigo-600 dark:text-indigo-400">FIRE Planner</h1>
          <span className="text-sm text-gray-500 dark:text-gray-400">{scenario.name}</span>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => addAccount()} className="btn-primary text-sm">
            + Account
          </button>
          <button
            onClick={() => setShowAddTransfer(true)}
            disabled={scenario.accounts.length === 0}
            className="btn-secondary text-sm disabled:opacity-40"
          >
            + Transfer
          </button>
          <button onClick={toggleTheme} className="p-1.5 rounded hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-500" title="Toggle theme">
            {theme === "dark" ? "Sun" : "Moon"}
          </button>
          <button onClick={() => setShowSettings(true)} className="p-1.5 rounded hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-500" title="Settings">
            Settings
          </button>
        </div>
      </header>

      {/* Main content */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left: Chart + Timeline */}
        <div ref={chartAreaRef} className="flex flex-col flex-1 overflow-hidden">
          {/* Legend */}
          <div className="px-4 py-2 flex-shrink-0 border-b border-gray-100 dark:border-gray-800">
            <Legend
              accounts={scenario.accounts}
              visibleAccounts={visibleAccounts}
              onToggle={toggleAccountVisibility}
            />
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
            />
          </div>

          {/* Timeline */}
          <div
            className="flex-shrink-0 border-t border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 py-2"
            style={{ minHeight: 80, maxHeight: "35vh", overflowY: "auto", paddingLeft: CHART_MARGIN.left + 8, paddingRight: CHART_MARGIN.right + 8 }}
          >
            <Timeline
              scenario={scenario}
              selectedItemId={selectedItemId}
              viewportStart={safeViewportStart}
              viewportEnd={safeViewportEnd}
              onSelectItem={(id, type) => selectItem(id, type)}
            />
          </div>
        </div>

        {/* Right: Editor Panel */}
        <div className="w-72 flex-shrink-0 border-l border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 overflow-y-auto">
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
  onConfirm: (srcId: string, tgtId: string) => void;
  onClose: () => void;
}) {
  const [srcId, setSrcId] = useState(accounts[0]?.id ?? "");
  const [tgtId, setTgtId] = useState(accounts[0]?.id ?? "");

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div
        className="bg-white dark:bg-gray-900 rounded-xl shadow-2xl w-full max-w-sm p-6 space-y-4"
        onClick={e => e.stopPropagation()}
      >
        <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Add Transfer</h2>

        <div>
          <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">From (source)</label>
          <select
            value={srcId}
            onChange={e => setSrcId(e.target.value)}
            className="input"
          >
            {accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </div>

        <div>
          <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">To (target)</label>
          <select
            value={tgtId}
            onChange={e => setTgtId(e.target.value)}
            className="input"
          >
            {accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </div>

        <p className="text-xs text-gray-400 dark:text-gray-500">
          Source and target can be the same account (e.g. for a gains tax event).
        </p>

        <div className="flex gap-2 pt-1">
          <button onClick={() => onConfirm(srcId, tgtId)} className="btn-primary flex-1">
            Create
          </button>
          <button onClick={onClose} className="btn-secondary flex-1">
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
