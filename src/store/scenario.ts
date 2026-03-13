import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type { Scenario, Account, Transfer } from "../types";
import { makeDefaultScenario, generateId, currentMonth } from "../utils/defaults";
import { runSimulation } from "../engine/simulate";
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

  addTransfer: (sourceId: string, targetId: string) => void;
  updateTransfer: (id: string, updates: Partial<Transfer>) => void;
  deleteTransfer: (id: string) => void;

  selectItem: (id: string | null, type: "account" | "transfer" | null) => void;

  importScenario: (scenario: Scenario) => void;

  rerunSimulation: () => void;
}

function recompute(scenarios: Record<string, Scenario>, activeId: string | null): SimulationResult | null {
  if (!activeId || !scenarios[activeId]) return null;
  return runSimulation(scenarios[activeId]);
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
        const s = makeDefaultScenario();
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
        const copy: Scenario = {
          ...src,
          id: generateId(),
          name: `${src.name} (copy)`,
          createdAt: currentMonth(),
          updatedAt: currentMonth(),
          accounts: src.accounts.map(a => ({ ...a })),
          transfers: src.transfers.map(t => ({ ...t })),
        };
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
          const scenarios = {
            ...state.scenarios,
            [state.activeScenarioId]: {
              ...state.scenarios[state.activeScenarioId],
              ...updates,
              updatedAt: currentMonth(),
            },
          };
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
          const scenarios = {
            ...state.scenarios,
            [state.activeScenarioId]: { ...scenario, accounts, updatedAt: currentMonth() },
          };
          return { scenarios, simulationResult: recompute(scenarios, state.activeScenarioId) };
        });
      },

      deleteAccount: (id) => {
        set(state => {
          if (!state.activeScenarioId) return state;
          const scenario = state.scenarios[state.activeScenarioId];
          const accounts = scenario.accounts.filter(a => a.id !== id);
          const transfers = scenario.transfers.filter(
            t => t.sourceAccountId !== id && t.targetAccountId !== id
          );
          const scenarios = {
            ...state.scenarios,
            [state.activeScenarioId]: { ...scenario, accounts, transfers, updatedAt: currentMonth() },
          };
          return {
            scenarios,
            simulationResult: recompute(scenarios, state.activeScenarioId),
            selectedItemId: null,
            selectedItemType: null,
          };
        });
      },

      addTransfer: (sourceId, targetId) => {
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
          const scenarios = {
            ...state.scenarios,
            [state.activeScenarioId]: { ...scenario, transfers, updatedAt: currentMonth() },
          };
          return { scenarios, simulationResult: recompute(scenarios, state.activeScenarioId) };
        });
      },

      deleteTransfer: (id) => {
        set(state => {
          if (!state.activeScenarioId) return state;
          const scenario = state.scenarios[state.activeScenarioId];
          const transfers = scenario.transfers.filter(t => t.id !== id);
          const scenarios = {
            ...state.scenarios,
            [state.activeScenarioId]: { ...scenario, transfers, updatedAt: currentMonth() },
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
          const scenarios = { ...state.scenarios, [scenario.id]: scenario };
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
          state.simulationResult = recompute(state.scenarios, state.activeScenarioId);
        }
      },
    }
  )
);
