import { useCallback, useState } from "react";
import type { Account } from "../types";
import { useScenarioStore } from "../store/scenario";

const PRESET_COLORS = [
  "#7c3aed", "#0891b2", "#059669", "#d97706",
  "#dc2626", "#4f46e5", "#db2777", "#0284c7",
];

const PERIODS = ["monthly", "quarterly", "half-yearly", "yearly"] as const;
const PERIOD_LABELS: Record<typeof PERIODS[number], string> = {
  "monthly": "Monthly",
  "quarterly": "Quarterly",
  "half-yearly": "Half-Yearly",
  "yearly": "Yearly",
};

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
        <h3 className="font-semibold text-zinc-900 dark:text-zinc-100">Account</h3>
        <button onClick={handleDelete} className="text-xs text-red-500 hover:text-red-600 dark:hover:text-red-400 transition-colors">Delete</button>
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
            className={`px-2 py-0.5 text-xs rounded-md border transition-colors ${
              showCustom
                ? "bg-zinc-200 dark:bg-zinc-600 border-zinc-400 dark:border-zinc-500 text-zinc-900 dark:text-zinc-100"
                : "border-zinc-300 dark:border-zinc-600 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-700"
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
            className="mt-2 h-8 w-16 rounded cursor-pointer border border-zinc-300 dark:border-zinc-600"
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

      <Field label={`Initial Principal/Gain Ratio — ${Math.round((account.initialPrincipalRatio ?? 1) * 100)}/${Math.round((1 - (account.initialPrincipalRatio ?? 1)) * 100)}%`}>
        <PercentSlider value={account.initialPrincipalRatio ?? 1} min={0} max={1} step={0.01} onChange={v => update("initialPrincipalRatio", v)} />
      </Field>

      <Field label={`Annual Growth Rate — ${(account.growthRate * 100).toFixed(1)}%`}>
        <PercentSlider value={account.growthRate} min={-0.5} max={0.5} step={0.001} onChange={v => update("growthRate", v)} />
      </Field>

      <Field label="Compounding Frequency">
        <select
          value={account.growthPeriod}
          onChange={e => update("growthPeriod", e.target.value as Account["growthPeriod"])}
          className="input"
        >
          {PERIODS.map(p => <option key={p} value={p}>{PERIOD_LABELS[p]}</option>)}
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

function PercentSlider({ value, min, max, step, onChange }: { value: number; min: number; max: number; step: number; onChange: (v: number) => void }) {
  const clamp = (v: number) => Math.max(min, Math.min(max, parseFloat(v.toFixed(4))));
  return (
    <div className="flex items-center gap-2">
      <button onClick={() => onChange(clamp(value - step))} className="w-7 h-7 flex items-center justify-center rounded-lg border border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-700 select-none text-sm font-medium transition-colors">−</button>
      <input type="range" min={min} max={max} step={step} value={value} onChange={e => onChange(parseFloat(e.target.value))} className="flex-1 accent-violet-600" />
      <button onClick={() => onChange(clamp(value + step))} className="w-7 h-7 flex items-center justify-center rounded-lg border border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-700 select-none text-sm font-medium transition-colors">+</button>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-medium text-zinc-500 dark:text-zinc-400 mb-1.5">{label}</label>
      {children}
    </div>
  );
}
