import { useCallback, useState } from "react";
import type { Account } from "../types";
import { useScenarioStore } from "../store/scenario";

const PRESET_COLORS = [
  "#4f46e5", "#0891b2", "#059669", "#d97706",
  "#dc2626", "#7c3aed", "#db2777", "#0284c7",
];

const PERIODS = ["monthly", "quarterly", "half-yearly", "yearly"] as const;

interface Props {
  account: Account;
}

export function AccountEditor({ account }: Props) {
  const isCustomColor = !PRESET_COLORS.includes(account.color);
  const [showCustom, setShowCustom] = useState(isCustomColor);
  const updateAccount = useScenarioStore(s => s.updateAccount);
  const deleteAccount = useScenarioStore(s => s.deleteAccount);
  const transfers = useScenarioStore(s =>
    s.activeScenarioId ? s.scenarios[s.activeScenarioId]?.transfers ?? [] : []
  );

  const update = useCallback(<K extends keyof Account>(key: K, value: Account[K]) => {
    updateAccount(account.id, { [key]: value });
  }, [account.id, updateAccount]);

  const referencedTransfers = transfers.filter(
    t => t.sourceAccountId === account.id || t.targetAccountId === account.id
  );

  const handleDelete = () => {
    if (referencedTransfers.length > 0) {
      if (!confirm(`Deleting "${account.name}" will also delete ${referencedTransfers.length} transfer(s). Continue?`)) return;
    }
    deleteAccount(account.id);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-gray-900 dark:text-gray-100">Account</h3>
        <button onClick={handleDelete} className="text-red-500 hover:text-red-700 text-sm">Delete</button>
      </div>

      <Field label="Name">
        <input
          type="text"
          value={account.name}
          onChange={e => update("name", e.target.value)}
          className="input"
        />
      </Field>

      <Field label="Color">
        <div className="flex flex-wrap gap-2 items-center">
          {PRESET_COLORS.map(c => (
            <button
              key={c}
              onClick={() => { update("color", c); setShowCustom(false); }}
              className="w-6 h-6 rounded-full border-2 transition-transform hover:scale-110"
              style={{
                background: c,
                borderColor: account.color === c && !showCustom ? "white" : "transparent",
                outline: account.color === c && !showCustom ? `2px solid ${c}` : "none",
              }}
            />
          ))}
          <button
            onClick={() => setShowCustom(v => !v)}
            className={`px-2 py-0.5 text-xs rounded border transition-colors ${
              showCustom
                ? "bg-gray-200 dark:bg-gray-600 border-gray-400 dark:border-gray-500 text-gray-900 dark:text-gray-100"
                : "border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700"
            }`}
          >
            Other
          </button>
        </div>
        {showCustom && (
          <input
            type="color"
            value={account.color}
            onChange={e => update("color", e.target.value)}
            className="mt-2 h-8 w-16 rounded cursor-pointer border border-gray-300 dark:border-gray-600"
          />
        )}
      </Field>

      <Field label="Initial Balance">
        <input
          type="number"
          value={account.initialBalance}
          onChange={e => update("initialBalance", parseFloat(e.target.value) || 0)}
          className="input"
        />
      </Field>

      <Field label="Annual Growth Rate (%)">
        <input
          type="number"
          value={(account.growthRate * 100).toFixed(2)}
          step="0.1"
          onChange={e => update("growthRate", (parseFloat(e.target.value) || 0) / 100)}
          className="input"
        />
      </Field>

      <Field label="Compounding Frequency">
        <select
          value={account.growthPeriod}
          onChange={e => update("growthPeriod", e.target.value as Account["growthPeriod"])}
          className="input"
        >
          {PERIODS.map(p => <option key={p} value={p}>{p}</option>)}
        </select>
      </Field>

      <Field label="Notes">
        <textarea
          value={account.notes ?? ""}
          onChange={e => update("notes", e.target.value)}
          rows={2}
          className="input"
        />
      </Field>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">{label}</label>
      {children}
    </div>
  );
}
