import { useScenarioStore } from "../store/scenario";
import { AccountEditor } from "./AccountEditor";
import { TransferEditor } from "./TransferEditor";

export function EditorPanel() {
  const { selectedItemId, selectedItemType, activeScenarioId, scenarios } = useScenarioStore();
  const scenario = activeScenarioId ? scenarios[activeScenarioId] : null;

  if (!scenario || !selectedItemId) {
    return (
      <div className="flex flex-col items-center gap-3 p-6 mt-12 text-center">
        <div className="w-12 h-12 rounded-2xl bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center">
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-zinc-400">
            <rect x="2" y="2" width="16" height="16" rx="3"/>
            <line x1="6" y1="7" x2="14" y2="7"/>
            <line x1="6" y1="10" x2="14" y2="10"/>
            <line x1="6" y1="13" x2="10" y2="13"/>
          </svg>
        </div>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">Select an account or transfer to edit</p>
      </div>
    );
  }

  if (selectedItemType === "account") {
    const acc = scenario.accounts.find(a => a.id === selectedItemId);
    if (!acc) return null;
    return (
      <div className="p-4 overflow-y-auto h-full">
        <AccountEditor account={acc} />
      </div>
    );
  }

  if (selectedItemType === "transfer") {
    const t = scenario.transfers.find(tr => tr.id === selectedItemId);
    if (!t) return null;
    return (
      <div className="p-4 overflow-y-auto h-full">
        <TransferEditor transfer={t} accounts={scenario.accounts} />
      </div>
    );
  }

  return null;
}
