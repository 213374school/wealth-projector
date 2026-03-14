import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type { Scenario, Account, Transfer, TimeAnchor } from "../types";
import { makeDefaultScenario, generateId, currentMonth } from "../utils/defaults";
import { runSimulation } from "../engine/simulate";
import { resolveEdgeDate } from "../utils/anchors";
import type { SimulationResult } from "../types";

interface ScenarioStore {
  scenarios: Record<string, Scenario>;
  activeScenarioId: string | null;

  // Derived simulation result (recomputed on change)
  simulationResult: SimulationResult | null;

  // UI state
  selectedItemId: string | null;
  selectedItemType: "account" | "transfer" | null;

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

  if (startAnchor && startAnchor.date === scenario.timelineStart &&
      endAnchor && endAnchor.date === scenario.timelineEnd) return scenario;

  if (!startAnchor) {
    anchors = [{ id: FIXED_START_ID, date: scenario.timelineStart, edges: [], fixed: true }, ...anchors];
  } else if (startAnchor.date !== scenario.timelineStart) {
    anchors = anchors.map(a => a.id === FIXED_START_ID ? { ...a, date: scenario.timelineStart } : a);
  }
  if (!endAnchor) {
    anchors = [...anchors, { id: FIXED_END_ID, date: scenario.timelineEnd, edges: [], fixed: true }];
  } else if (endAnchor.date !== scenario.timelineEnd) {
    anchors = anchors.map(a => a.id === FIXED_END_ID ? { ...a, date: scenario.timelineEnd } : a);
  }
  return { ...scenario, anchors };
}

function removeAnchorsForItem(anchors: TimeAnchor[] | undefined, itemId: string): TimeAnchor[] {
  return (anchors ?? [])
    .map(a => ({ ...a, edges: a.edges.filter(e => e.itemId !== itemId) }))
    .filter(a => a.fixed || a.edges.length >= 2);
}

function syncAnchorDates(anchors: TimeAnchor[] | undefined, scenario: Scenario): TimeAnchor[] {
  return (anchors ?? []).map(anchor => {
    if (anchor.fixed) return anchor; // fixed anchors are managed by ensureFixedAnchors
    const firstEdge = anchor.edges[0];
    if (!firstEdge) return anchor;
    const resolved = resolveEdgeDate(scenario, firstEdge.itemId, firstEdge.edge);
    return resolved !== anchor.date ? { ...anchor, date: resolved } : anchor;
  });
}

export const useScenarioStore = create<ScenarioStore>()(
  persist(
    (set, get) => ({
      scenarios: {},
      activeScenarioId: null,
      simulationResult: null,
      selectedItemId: null,
      selectedItemType: null,

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
          return { scenarios, simulationResult: recompute(scenarios, state.activeScenarioId) };
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
            startDate: currentMonth(),
            initialBalance: 10000,
            growthRate: 0.04,
            growthPeriod: "yearly",
          };
          const updated: Scenario = {
            ...scenario,
            accounts: [...scenario.accounts, newAcc],
            updatedAt: currentMonth(),
          };
          const scenarios = { ...state.scenarios, [state.activeScenarioId]: updated };
          return {
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

          // Clamp literal transfer dates to their accounts' start ranges
          const transfers = scenario.transfers.map(t => {
            if (t.sourceAccountId !== id && t.targetAccountId !== id) return t;
            const srcAcc = t.sourceAccountId ? accounts.find(a => a.id === t.sourceAccountId) : null;
            const tgtAcc = t.targetAccountId ? accounts.find(a => a.id === t.targetAccountId) : null;
            const candidates = [srcAcc, tgtAcc].filter(Boolean).map(a => a!.startDate);
            const minStart = candidates.reduce((a, b) => a > b ? a : b, scenario.timelineStart);
            const clampedStart = t.startDate < minStart ? minStart : t.startDate;
            const clampedEnd = (t.endDate && t.endDate < minStart) ? minStart : t.endDate;
            return (clampedStart !== t.startDate || clampedEnd !== t.endDate)
              ? { ...t, startDate: clampedStart, endDate: clampedEnd }
              : t;
          });

          const newScenario: Scenario = { ...scenario, accounts, transfers, updatedAt: currentMonth() };
          const anchors = syncAnchorDates(newScenario.anchors, newScenario);
          const finalScenario = { ...newScenario, anchors };
          const scenarios = { ...state.scenarios, [state.activeScenarioId]: finalScenario };
          return { scenarios, simulationResult: recompute(scenarios, state.activeScenarioId) };
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
          };
          const updated: Scenario = {
            ...scenario,
            transfers: [...scenario.transfers, newT],
            updatedAt: currentMonth(),
          };
          const scenarios = { ...state.scenarios, [state.activeScenarioId]: updated };
          return {
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
          const transfers = scenario.transfers.map(t => t.id === id ? { ...t, ...updates } : t);
          const newScenario: Scenario = { ...scenario, transfers, updatedAt: currentMonth() };
          const anchors = syncAnchorDates(newScenario.anchors, newScenario);
          const finalScenario = { ...newScenario, anchors };
          const scenarios = { ...state.scenarios, [state.activeScenarioId]: finalScenario };
          return { scenarios, simulationResult: recompute(scenarios, state.activeScenarioId) };
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
          return { scenarios, simulationResult: recompute(scenarios, state.activeScenarioId) };
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
          return { scenarios, simulationResult: recompute(scenarios, state.activeScenarioId) };
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
          return { scenarios, simulationResult: recompute(scenarios, state.activeScenarioId) };
        });
      },

      applyDragUpdate: (accountUpdates, transferUpdates, anchorsToRemove, anchorsToUpdate) => {
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
          const scenarios = {
            ...state.scenarios,
            [state.activeScenarioId]: { ...scenario, accounts, transfers, anchors, updatedAt: currentMonth() },
          };
          return { scenarios, simulationResult: recompute(scenarios, state.activeScenarioId) };
        });
      },
    }),
    {
      name: "fire-tracker",
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        scenarios: state.scenarios,
        activeScenarioId: state.activeScenarioId,
      }),
      onRehydrateStorage: () => (state) => {
        if (state) {
          state.scenarios = Object.fromEntries(
            Object.entries(state.scenarios).map(([id, s]) => [id, ensureFixedAnchors(s)])
          );
          state.simulationResult = recompute(state.scenarios, state.activeScenarioId);
        }
      },
    }
  )
);
