import { useScenarioStore } from "../store/scenario";
import { AccountEditor } from "./AccountEditor";
import { TransferEditor } from "./TransferEditor";

export function EditorPanel() {
  const { selectedItemId, selectedItemType, activeScenarioId, scenarios } = useScenarioStore();
  const scenario = activeScenarioId ? scenarios[activeScenarioId] : null;

  if (!scenario || !selectedItemId) {
    return (
      <div className="p-4 text-sm text-gray-500 dark:text-gray-400 text-center mt-8">
        Select an account or transfer to edit
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
