import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type { Scenario, Account, Transfer, TimeAnchor } from "../types";
import { makeDefaultScenario, generateId, currentMonth } from "../utils/defaults";
import { runSimulation } from "../engine/simulate";
import { resolveEdgeDate, edgeToAnchorDate, addMonths } from "../utils/anchors";
import type { SimulationResult } from "../types";

interface HistorySnapshot {
  scenarios: Record<string, Scenario>;
  activeScenarioId: string | null;
}

const HISTORY_LIMIT = 50;

interface ScenarioStore {
  scenarios: Record<string, Scenario>;
  activeScenarioId: string | null;

  // Derived simulation result (recomputed on change)
  simulationResult: SimulationResult | null;

  // UI state
  selectedItemId: string | null;
  selectedItemType: "account" | "transfer" | null;

  // History
  _undoStack: HistorySnapshot[];
  _redoStack: HistorySnapshot[];
  undo: () => void;
  redo: () => void;
  captureHistorySnapshot: () => void;

  // Actions
  createScenario: () => void;
  duplicateScenario: (id: string) => void;
  deleteScenario: (id: string) => void;
  setActiveScenario: (id: string) => void;
  updateScenario: (updates: Partial<Scenario>) => void;

  addAccount: () => void;
  updateAccount: (id: string, updates: Partial<Account>) => void;
  deleteAccount: (id: string) => void;

  addTransfer: (sourceId: string | null, targetId: string | null) => void;
  addTransferAt: (sourceId: string | null, startDate: string, endDate: string | null, snapStartAnchorId?: string | null, snapEndAnchorId?: string | null) => void;
  updateTransfer: (id: string, updates: Partial<Transfer>) => void;
  deleteTransfer: (id: string) => void;

  selectItem: (id: string | null, type: "account" | "transfer" | null) => void;

  importScenario: (scenario: Scenario) => void;

  rerunSimulation: () => void;

  addAnchor: (anchor: TimeAnchor) => void;
  updateAnchor: (anchor: TimeAnchor) => void;
  removeAnchor: (id: string) => void;
  applyDragUpdate: (
    accountUpdates: { id: string; changes: Partial<Account> }[],
    transferUpdates: { id: string; changes: Partial<Transfer> }[],
    anchorsToRemove: string[],
    anchorsToUpdate: TimeAnchor[],
    options?: { skipHistory?: boolean },
  ) => void;
}

export const FIXED_START_ID = "__start__";
export const FIXED_END_ID = "__end__";

function recompute(scenarios: Record<string, Scenario>, activeId: string | null): SimulationResult | null {
  if (!activeId || !scenarios[activeId]) return null;
  return runSimulation(scenarios[activeId]);
}

/** Ensures the two permanent fixed anchors exist and have correct dates. */
function ensureFixedAnchors(scenario: Scenario): Scenario {
  let anchors = scenario.anchors ?? [];
  const startAnchor = anchors.find(a => a.id === FIXED_START_ID);
  const endAnchor = anchors.find(a => a.id === FIXED_END_ID);

  // Fixed start anchor is stored one month before timelineStart, matching the
  // start-edge convention (edgeToAnchorDate shifts start dates back by 1 month).
  // This places the visual line at the left edge of the first month bar and
  // makes the label display timelineStart correctly via addMonths(date, 1).
  const fixedStartDate = addMonths(scenario.timelineStart, -1);

  if (startAnchor && startAnchor.date === fixedStartDate &&
      endAnchor && endAnchor.date === scenario.timelineEnd) return scenario;

  if (!startAnchor) {
    anchors = [{ id: FIXED_START_ID, date: fixedStartDate, edges: [], fixed: true }, ...anchors];
  } else if (startAnchor.date !== fixedStartDate) {
    anchors = anchors.map(a => a.id === FIXED_START_ID ? { ...a, date: fixedStartDate } : a);
  }
  if (!endAnchor) {
    anchors = [...anchors, { id: FIXED_END_ID, date: scenario.timelineEnd, edges: [], fixed: true }];
  } else if (endAnchor.date !== scenario.timelineEnd) {
    anchors = anchors.map(a => a.id === FIXED_END_ID ? { ...a, date: scenario.timelineEnd } : a);
  }
  return { ...scenario, anchors };
}

/** Removes edges whose transfer date was just cleared to null, deleting empty anchors. */
function detachNullDateEdges(
  oldTransfers: Transfer[],
  updates: { id: string; changes: Partial<Transfer> }[],
  anchors: TimeAnchor[],
): TimeAnchor[] {
  let result = anchors;
  for (const upd of updates) {
    const old = oldTransfers.find(t => t.id === upd.id);
    if (!old) continue;
    if ("startDate" in upd.changes && upd.changes.startDate === null && old.startDate !== null) {
      result = result
        .map(a => ({ ...a, edges: a.edges.filter(e => !(e.itemId === upd.id && e.edge === "start")) }))
        .filter(a => a.fixed || a.edges.length >= 1);
    }
    if ("endDate" in upd.changes && upd.changes.endDate === null && old.endDate !== null) {
      result = result
        .map(a => ({ ...a, edges: a.edges.filter(e => !(e.itemId === upd.id && e.edge === "end")) }))
        .filter(a => a.fixed || a.edges.length >= 1);
    }
  }
  return result;
}

function removeAnchorsForItem(anchors: TimeAnchor[] | undefined, itemId: string): TimeAnchor[] {
  return (anchors ?? [])
    .map(a => ({ ...a, edges: a.edges.filter(e => e.itemId !== itemId) }))
    .filter(a => a.fixed || a.edges.length >= 1);
}

/** Ensures every transfer edge (start, end) has at least one anchor. */
function ensureSingleEdgeAnchors(scenario: Scenario): Scenario {
  let anchors = scenario.anchors ?? [];
  const covered = new Set<string>();
  for (const a of anchors)
    for (const e of a.edges)
      covered.add(`${e.itemId}:${e.edge}`);

  let changed = false;
  for (const t of scenario.transfers) {
    if (t.startDate !== null && !covered.has(`${t.id}:start`)) {
      const targetDate = addMonths(t.startDate, -1);
      const existing = anchors.find(a => !a.fixed && a.date === targetDate);
      if (existing) {
        anchors = anchors.map(a => a.id === existing.id
          ? { ...a, edges: [...a.edges, { itemId: t.id, edge: "start" as const }] }
          : a);
      } else {
        anchors = [...anchors, { id: generateId(), date: targetDate, edges: [{ itemId: t.id, edge: "start" as const }] }];
      }
      changed = true;
    }
    if (t.endDate !== null && !covered.has(`${t.id}:end`)) {
      const targetDate = t.endDate;
      const existing = anchors.find(a => !a.fixed && a.date === targetDate);
      if (existing) {
        anchors = anchors.map(a => a.id === existing.id
          ? { ...a, edges: [...a.edges, { itemId: t.id, edge: "end" as const }] }
          : a);
      } else {
        anchors = [...anchors, { id: generateId(), date: targetDate, edges: [{ itemId: t.id, edge: "end" as const }] }];
      }
      changed = true;
    }
  }
  if (!changed) return scenario;
  return { ...scenario, anchors };
}

function syncAnchorDates(anchors: TimeAnchor[] | undefined, scenario: Scenario): TimeAnchor[] {
  return (anchors ?? []).map(anchor => {
    if (anchor.fixed) return anchor; // fixed anchors are managed by ensureFixedAnchors
    const firstEdge = anchor.edges[0];
    if (!firstEdge) return anchor;
    const resolved = resolveEdgeDate(scenario, firstEdge.itemId, firstEdge.edge);
    const expectedDate = edgeToAnchorDate(resolved, firstEdge.edge);
    return expectedDate !== anchor.date ? { ...anchor, date: expectedDate } : anchor;
  });
}

function captureSnapshot(state: ScenarioStore): HistorySnapshot {
  return { scenarios: state.scenarios, activeScenarioId: state.activeScenarioId };
}

function withHistory(state: ScenarioStore) {
  return {
    _undoStack: [...state._undoStack, captureSnapshot(state)].slice(-HISTORY_LIMIT),
    _redoStack: [] as HistorySnapshot[],
  };
}

export const useScenarioStore = create<ScenarioStore>()(
  persist(
    (set, get) => ({
      scenarios: {},
      activeScenarioId: null,
      simulationResult: null,
      selectedItemId: null,
      selectedItemType: null,
      _undoStack: [],
      _redoStack: [],

      captureHistorySnapshot: () => {
        set(state => ({
          _undoStack: [...state._undoStack, captureSnapshot(state)].slice(-HISTORY_LIMIT),
          _redoStack: [],
        }));
      },

      undo: () => {
        set(state => {
          if (state._undoStack.length === 0) return state;
          const prev = state._undoStack[state._undoStack.length - 1];
          return {
            scenarios: prev.scenarios,
            activeScenarioId: prev.activeScenarioId,
            simulationResult: recompute(prev.scenarios, prev.activeScenarioId),
            _undoStack: state._undoStack.slice(0, -1),
            _redoStack: [...state._redoStack, captureSnapshot(state)],
          };
        });
      },

      redo: () => {
        set(state => {
          if (state._redoStack.length === 0) return state;
          const next = state._redoStack[state._redoStack.length - 1];
          return {
            scenarios: next.scenarios,
            activeScenarioId: next.activeScenarioId,
            simulationResult: recompute(next.scenarios, next.activeScenarioId),
            _undoStack: [...state._undoStack, captureSnapshot(state)],
            _redoStack: state._redoStack.slice(0, -1),
          };
        });
      },

      createScenario: () => {
        const s = ensureFixedAnchors(makeDefaultScenario());
        set(state => {
          const scenarios = { ...state.scenarios, [s.id]: s };
          return {
            scenarios,
            activeScenarioId: s.id,
            simulationResult: recompute(scenarios, s.id),
            selectedItemId: null,
            selectedItemType: null,
          };
        });
      },

      duplicateScenario: (id) => {
        const state = get();
        const src = state.scenarios[id];
        if (!src) return;
        const copy: Scenario = ensureFixedAnchors({
          ...src,
          id: generateId(),
          name: `${src.name} (copy)`,
          createdAt: currentMonth(),
          updatedAt: currentMonth(),
          accounts: src.accounts.map(a => ({ ...a })),
          transfers: src.transfers.map(t => ({ ...t })),
        });
        set(st => {
          const scenarios = { ...st.scenarios, [copy.id]: copy };
          return { scenarios, activeScenarioId: copy.id, simulationResult: recompute(scenarios, copy.id) };
        });
      },

      deleteScenario: (id) => {
        set(state => {
          const scenarios = { ...state.scenarios };
          delete scenarios[id];
          const ids = Object.keys(scenarios);
          const activeScenarioId = ids.length > 0 ? ids[ids.length - 1] : null;
          return {
            scenarios,
            activeScenarioId,
            simulationResult: recompute(scenarios, activeScenarioId),
          };
        });
      },

      setActiveScenario: (id) => {
        set(state => ({
          activeScenarioId: id,
          simulationResult: recompute(state.scenarios, id),
          selectedItemId: null,
          selectedItemType: null,
        }));
      },

      updateScenario: (updates) => {
        set(state => {
          if (!state.activeScenarioId) return state;
          const updated = ensureFixedAnchors({
            ...state.scenarios[state.activeScenarioId],
            ...updates,
            updatedAt: currentMonth(),
          });
          const scenarios = { ...state.scenarios, [state.activeScenarioId]: updated };
          return { ...withHistory(state), scenarios, simulationResult: recompute(scenarios, state.activeScenarioId) };
        });
      },

      addAccount: () => {
        set(state => {
          if (!state.activeScenarioId) return state;
          const scenario = state.scenarios[state.activeScenarioId];
          const count = scenario.accounts.length;
          const COLORS = ["#4f46e5", "#0891b2", "#059669", "#d97706", "#dc2626", "#7c3aed", "#db2777", "#0284c7"];
          const newAcc: Account = {
            id: generateId(),
            name: `Account ${count + 1}`,
            color: COLORS[count % COLORS.length],
            initialBalance: 10000,
            initialPrincipalRatio: 1,
            growthRate: 0.04,
            growthPeriod: "yearly",
          };
          const updated: Scenario = ensureSingleEdgeAnchors({
            ...scenario,
            accounts: [...scenario.accounts, newAcc],
            updatedAt: currentMonth(),
          });
          const scenarios = { ...state.scenarios, [state.activeScenarioId]: updated };
          return {
            ...withHistory(state),
            scenarios,
            simulationResult: recompute(scenarios, state.activeScenarioId),
            selectedItemId: newAcc.id,
            selectedItemType: "account",
          };
        });
      },

      updateAccount: (id, updates) => {
        set(state => {
          if (!state.activeScenarioId) return state;
          const scenario = state.scenarios[state.activeScenarioId];
          const accounts = scenario.accounts.map(a => a.id === id ? { ...a, ...updates } : a);
          const newScenario: Scenario = { ...scenario, accounts, updatedAt: currentMonth() };
          const scenarios = { ...state.scenarios, [state.activeScenarioId]: newScenario };
          return { ...withHistory(state), scenarios, simulationResult: recompute(scenarios, state.activeScenarioId) };
        });
      },

      deleteAccount: (id) => {
        set(state => {
          if (!state.activeScenarioId) return state;
          const scenario = state.scenarios[state.activeScenarioId];
          const accounts = scenario.accounts.filter(a => a.id !== id);
          const removedTransferIds = scenario.transfers
            .filter(t => t.sourceAccountId === id || t.targetAccountId === id)
            .map(t => t.id);
          const transfers = scenario.transfers.filter(
            t => t.sourceAccountId !== id && t.targetAccountId !== id
          );
          let anchors = removeAnchorsForItem(scenario.anchors, id);
          for (const tid of removedTransferIds) anchors = removeAnchorsForItem(anchors, tid);
          const scenarios = {
            ...state.scenarios,
            [state.activeScenarioId]: { ...scenario, accounts, transfers, anchors, updatedAt: currentMonth() },
          };
          return {
            ...withHistory(state),
            scenarios,
            simulationResult: recompute(scenarios, state.activeScenarioId),
            selectedItemId: null,
            selectedItemType: null,
          };
        });
      },

      addTransfer: (sourceId: string | null, targetId: string | null) => {
        set(state => {
          if (!state.activeScenarioId) return state;
          const scenario = state.scenarios[state.activeScenarioId];
          const newT: Transfer = {
            id: generateId(),
            name: "New Transfer",
            sourceAccountId: sourceId,
            targetAccountId: targetId,
            startDate: currentMonth(),
            endDate: null,
            isOneTime: false,
            amount: 1000,
            amountType: "fixed",
            period: "monthly",
            taxRate: 0,
            taxBasis: "full",
            inflationAdjusted: false,
          };
          const updated: Scenario = ensureSingleEdgeAnchors({
            ...scenario,
            transfers: [...scenario.transfers, newT],
            updatedAt: currentMonth(),
          });
          const scenarios = { ...state.scenarios, [state.activeScenarioId]: updated };
          return {
            ...withHistory(state),
            scenarios,
            simulationResult: recompute(scenarios, state.activeScenarioId),
            selectedItemId: newT.id,
            selectedItemType: "transfer",
          };
        });
      },

      addTransferAt: (sourceId, startDate, endDate, snapStartAnchorId, snapEndAnchorId) => {
        set(state => {
          if (!state.activeScenarioId) return state;
          const scenario = state.scenarios[state.activeScenarioId];
          const newT: Transfer = {
            id: generateId(),
            name: "New Transfer",
            sourceAccountId: sourceId,
            targetAccountId: null,
            startDate,
            endDate,
            isOneTime: false,
            amount: 1000,
            amountType: "fixed",
            period: "monthly",
            taxRate: 0,
            taxBasis: "full",
            inflationAdjusted: false,
          };
          let updated: Scenario = ensureSingleEdgeAnchors({
            ...scenario,
            transfers: [...scenario.transfers, newT],
            updatedAt: currentMonth(),
          });

          // Merge edges into snapped anchors (remove the single-edge anchors just created,
          // and add the edge to the existing anchor instead)
          if (snapStartAnchorId || snapEndAnchorId) {
            let anchors = updated.anchors ?? [];
            if (snapStartAnchorId) {
              anchors = anchors.filter(a => !(
                !a.fixed && a.edges.length === 1 &&
                a.edges[0].itemId === newT.id && a.edges[0].edge === "start"
              ));
              anchors = anchors.map(a => a.id === snapStartAnchorId
                ? { ...a, edges: [...a.edges, { itemId: newT.id, edge: "start" as const }] }
                : a
              );
            }
            if (snapEndAnchorId && endDate !== null) {
              anchors = anchors.filter(a => !(
                !a.fixed && a.edges.length === 1 &&
                a.edges[0].itemId === newT.id && a.edges[0].edge === "end"
              ));
              anchors = anchors.map(a => a.id === snapEndAnchorId
                ? { ...a, edges: [...a.edges, { itemId: newT.id, edge: "end" as const }] }
                : a
              );
            }
            updated = { ...updated, anchors };
          }

          const scenarios = { ...state.scenarios, [state.activeScenarioId]: updated };
          return {
            ...withHistory(state),
            scenarios,
            simulationResult: recompute(scenarios, state.activeScenarioId),
            selectedItemId: newT.id,
            selectedItemType: "transfer",
          };
        });
      },

      updateTransfer: (id, updates) => {
        set(state => {
          if (!state.activeScenarioId) return state;
          const scenario = state.scenarios[state.activeScenarioId];
          const baseAnchors = detachNullDateEdges(scenario.transfers, [{ id, changes: updates }], scenario.anchors ?? []);
          const transfers = scenario.transfers.map(t => t.id === id ? { ...t, ...updates } : t);
          const newScenario: Scenario = { ...scenario, transfers, anchors: baseAnchors, updatedAt: currentMonth() };
          const synced = syncAnchorDates(newScenario.anchors, newScenario);
          const finalScenario = ensureSingleEdgeAnchors({ ...newScenario, anchors: synced });
          const scenarios = { ...state.scenarios, [state.activeScenarioId]: finalScenario };
          return { ...withHistory(state), scenarios, simulationResult: recompute(scenarios, state.activeScenarioId) };
        });
      },

      deleteTransfer: (id) => {
        set(state => {
          if (!state.activeScenarioId) return state;
          const scenario = state.scenarios[state.activeScenarioId];
          const transfers = scenario.transfers.filter(t => t.id !== id);
          const anchors = removeAnchorsForItem(scenario.anchors, id);
          const scenarios = {
            ...state.scenarios,
            [state.activeScenarioId]: { ...scenario, transfers, anchors, updatedAt: currentMonth() },
          };
          return {
            ...withHistory(state),
            scenarios,
            simulationResult: recompute(scenarios, state.activeScenarioId),
            selectedItemId: null,
            selectedItemType: null,
          };
        });
      },

      selectItem: (id, type) => {
        set({ selectedItemId: id, selectedItemType: type });
      },

      importScenario: (scenario) => {
        set(state => {
          const scenarios = { ...state.scenarios, [scenario.id]: ensureFixedAnchors(scenario) };
          return {
            scenarios,
            activeScenarioId: scenario.id,
            simulationResult: recompute(scenarios, scenario.id),
          };
        });
      },

      rerunSimulation: () => {
        set(state => ({
          simulationResult: recompute(state.scenarios, state.activeScenarioId),
        }));
      },

      addAnchor: (anchor) => {
        set(state => {
          if (!state.activeScenarioId) return state;
          const scenario = state.scenarios[state.activeScenarioId];
          const anchors = [...(scenario.anchors ?? []), anchor];
          const scenarios = {
            ...state.scenarios,
            [state.activeScenarioId]: { ...scenario, anchors, updatedAt: currentMonth() },
          };
          return { ...withHistory(state), scenarios, simulationResult: recompute(scenarios, state.activeScenarioId) };
        });
      },

      updateAnchor: (anchor) => {
        set(state => {
          if (!state.activeScenarioId) return state;
          const scenario = state.scenarios[state.activeScenarioId];
          const anchors = (scenario.anchors ?? []).map(a => a.id === anchor.id ? anchor : a);
          const scenarios = {
            ...state.scenarios,
            [state.activeScenarioId]: { ...scenario, anchors, updatedAt: currentMonth() },
          };
          return { ...withHistory(state), scenarios, simulationResult: recompute(scenarios, state.activeScenarioId) };
        });
      },

      removeAnchor: (id) => {
        set(state => {
          if (!state.activeScenarioId) return state;
          const scenario = state.scenarios[state.activeScenarioId];
          const anchors = (scenario.anchors ?? []).filter(a => a.id !== id);
          const scenarios = {
            ...state.scenarios,
            [state.activeScenarioId]: { ...scenario, anchors, updatedAt: currentMonth() },
          };
          return { ...withHistory(state), scenarios, simulationResult: recompute(scenarios, state.activeScenarioId) };
        });
      },

      applyDragUpdate: (accountUpdates, transferUpdates, anchorsToRemove, anchorsToUpdate, options) => {
        set(state => {
          if (!state.activeScenarioId) return state;
          const scenario = state.scenarios[state.activeScenarioId];
          const accounts = scenario.accounts.map(a => {
            const upd = accountUpdates.find(u => u.id === a.id);
            return upd ? { ...a, ...upd.changes } : a;
          });
          const transfers = scenario.transfers.map(t => {
            const upd = transferUpdates.find(u => u.id === t.id);
            return upd ? { ...t, ...upd.changes } : t;
          });
          let anchors = (scenario.anchors ?? []).filter(a => a.fixed || !anchorsToRemove.includes(a.id));
          for (const updated of anchorsToUpdate) {
            const idx = anchors.findIndex(a => a.id === updated.id);
            if (idx >= 0) {
              anchors = anchors.map(a => a.id === updated.id ? updated : a);
            } else {
              anchors = [...anchors, updated];
            }
          }
          anchors = detachNullDateEdges(scenario.transfers, transferUpdates, anchors);
          const scenarios = {
            ...state.scenarios,
            [state.activeScenarioId]: { ...scenario, accounts, transfers, anchors, updatedAt: currentMonth() },
          };
          return {
            ...(options?.skipHistory ? {} : withHistory(state)),
            scenarios,
            simulationResult: recompute(scenarios, state.activeScenarioId),
          };
        });
      },
    }),
    {
      name: "wealth-projector",
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        scenarios: state.scenarios,
        activeScenarioId: state.activeScenarioId,
      }),
      onRehydrateStorage: () => (state) => {
        if (state) {
          if (Object.keys(state.scenarios).length === 0) {
            const s = ensureFixedAnchors(makeDefaultScenario());
            state.scenarios = { [s.id]: s };
            state.activeScenarioId = s.id;
            state.simulationResult = recompute(state.scenarios, s.id);
            return;
          }
          state.scenarios = Object.fromEntries(
            Object.entries(state.scenarios).map(([id, s]) => {
              // Migration: strip account edges from anchors (accounts are now omnipresent)
              const accountIds = new Set(s.accounts.map(a => a.id));
              const migratedAnchors = (s.anchors ?? [])
                .map(a => ({ ...a, edges: a.edges.filter(e => !accountIds.has(e.itemId)) }))
                .filter(a => a.fixed || a.edges.length >= 1);
              const base = ensureFixedAnchors({ ...s, anchors: migratedAnchors });
              const synced = { ...base, anchors: syncAnchorDates(base.anchors, base) };
              return [id, ensureSingleEdgeAnchors(synced)];
            })
          );
          state.simulationResult = recompute(state.scenarios, state.activeScenarioId);
        }
      },
    }
  )
);
