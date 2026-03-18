import { useCallback } from "react";
import type { Transfer, Account } from "../types";
import { useScenarioStore } from "../store/scenario";
import { CurrencyInput } from "./CurrencyInput";

const PERIODS = ["monthly", "quarterly", "half-yearly", "yearly"] as const;
const PERIOD_LABELS: Record<typeof PERIODS[number], string> = {
  "monthly": "Monthly",
  "quarterly": "Quarterly",
  "half-yearly": "Half-Yearly",
  "yearly": "Yearly",
};

const AMOUNT_TYPES = ["fixed", "percent-balance", "gains-only"] as const;
const AMOUNT_TYPE_LABELS: Record<typeof AMOUNT_TYPES[number], string> = {
  "fixed": "Fixed",
  "percent-balance": "% of Balance",
  "gains-only": "Gains Only",
};

interface Props {
  transfer: Transfer;
  accounts: Account[];
}

export function TransferEditor({ transfer, accounts }: Props) {
  const updateTransfer = useScenarioStore(s => s.updateTransfer);
  const deleteTransfer = useScenarioStore(s => s.deleteTransfer);
  const inflationEnabled = useScenarioStore(
    s => s.activeScenarioId ? (s.scenarios[s.activeScenarioId]?.inflationEnabled ?? false) : false
  );
  const currencyLocale = useScenarioStore(
    s => s.activeScenarioId ? (s.scenarios[s.activeScenarioId]?.currencyLocale ?? "en-US") : "en-US"
  );
  const currencyCode = useScenarioStore(
    s => s.activeScenarioId ? (s.scenarios[s.activeScenarioId]?.currencySymbol ?? "USD") : "USD"
  );
  const timelineStart = useScenarioStore(
    s => s.activeScenarioId ? (s.scenarios[s.activeScenarioId]?.timelineStart ?? "") : ""
  );
  const timelineEnd = useScenarioStore(
    s => s.activeScenarioId ? (s.scenarios[s.activeScenarioId]?.timelineEnd ?? "") : ""
  );

  const update = useCallback(<K extends keyof Transfer>(key: K, value: Transfer[K]) => {
    updateTransfer(transfer.id, { [key]: value });
  }, [transfer.id, updateTransfer]);

  const isGainsOnly = transfer.amountType === "gains-only";
  const hasSource = transfer.sourceAccountId !== null;
  const hasTarget = transfer.targetAccountId !== null;

  const handleAmountTypeChange = (val: Transfer["amountType"]) => {
    const updates: Partial<Transfer> = { amountType: val };
    if (val === "gains-only") {
      updates.amount = 0;
      updates.taxBasis = "full";
    }
    updateTransfer(transfer.id, updates);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-zinc-900 dark:text-zinc-100">Transfer</h3>
        <button onClick={() => deleteTransfer(transfer.id)} className="text-xs text-red-500 hover:text-red-600 dark:hover:text-red-400 transition-colors">Delete</button>
      </div>

      <Field label="Name">
        <input type="text" value={transfer.name} onChange={e => update("name", e.target.value)} className="input" />
      </Field>

      <Field label="Source Account">
        {transfer.sourceAccountId === null ? (
          <div className="flex items-center gap-2">
            <span className="flex-1 text-sm text-zinc-400 dark:text-zinc-500">Income</span>
            <button onClick={() => update("sourceAccountId", accounts[0]?.id ?? "")} className="text-xs text-violet-600 dark:text-violet-400 hover:underline whitespace-nowrap">Account</button>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <select
              value={transfer.sourceAccountId}
              onChange={e => update("sourceAccountId", e.target.value || null)}
              className="input flex-1"
            >
              {accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
            <button onClick={() => update("sourceAccountId", null)} className="text-xs text-zinc-400 dark:text-zinc-500 hover:underline whitespace-nowrap">Clear</button>
          </div>
        )}
      </Field>

      <Field label="Target Account">
        {transfer.targetAccountId === null ? (
          <div className="flex items-center gap-2">
            <span className="flex-1 text-sm text-zinc-400 dark:text-zinc-500">Consumption</span>
            <button onClick={() => update("targetAccountId", accounts[0]?.id ?? "")} className="text-xs text-violet-600 dark:text-violet-400 hover:underline whitespace-nowrap">Account</button>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <select
              value={transfer.targetAccountId}
              onChange={e => {
                const val = e.target.value || null;
                const updates: Partial<Transfer> = { targetAccountId: val };
                if (val === null) { updates.taxRate = 0; updates.taxBasis = "full"; }
                updateTransfer(transfer.id, updates);
              }}
              className="input flex-1"
            >
              {accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
            <button onClick={() => {
              updateTransfer(transfer.id, { targetAccountId: null, taxRate: 0, taxBasis: "full" });
            }} className="text-xs text-zinc-400 dark:text-zinc-500 hover:underline whitespace-nowrap">Clear</button>
          </div>
        )}
      </Field>

      <Field label="Start Date">
        {transfer.startDate === null ? (
          <div className="flex items-center gap-2">
            <span className="flex-1 text-sm text-zinc-400 dark:text-zinc-500">Beginning</span>
            <button onClick={() => update("startDate", timelineStart)} className="text-xs text-violet-600 dark:text-violet-400 hover:underline whitespace-nowrap">Custom</button>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <input
              type="month"
              value={transfer.startDate}
              onChange={e => update("startDate", e.target.value || null)}
              className="input flex-1"
            />
            <button onClick={() => update("startDate", null)} className="text-xs text-zinc-400 dark:text-zinc-500 hover:underline whitespace-nowrap">Clear</button>
          </div>
        )}
      </Field>

      <div>
        <label className="block text-xs font-medium text-zinc-500 dark:text-zinc-400 mb-1.5">One-time Event</label>
        <label className="flex items-center gap-2 cursor-pointer">
          <input type="checkbox" checked={transfer.isOneTime} onChange={e => update("isOneTime", e.target.checked)} className="accent-violet-600" />
          <span className="text-sm text-zinc-700 dark:text-zinc-300">Fire once at start date</span>
        </label>
      </div>

      {!transfer.isOneTime && (
        <>
          <Field label="End Date">
            {transfer.endDate === null ? (
              <div className="flex items-center gap-2">
                <span className="flex-1 text-sm text-zinc-400 dark:text-zinc-500">End</span>
                <button onClick={() => update("endDate", timelineEnd)} className="text-xs text-violet-600 dark:text-violet-400 hover:underline whitespace-nowrap">Custom</button>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <input
                  type="month"
                  value={transfer.endDate}
                  onChange={e => update("endDate", e.target.value || null)}
                  className="input flex-1"
                />
                <button onClick={() => update("endDate", null)} className="text-xs text-zinc-400 dark:text-zinc-500 hover:underline whitespace-nowrap">Clear</button>
              </div>
            )}
          </Field>
          <Field label="Period">
            <select value={transfer.period} onChange={e => update("period", e.target.value as Transfer["period"])} className="input">
              {PERIODS.map(p => <option key={p} value={p}>{PERIOD_LABELS[p]}</option>)}
            </select>
          </Field>
        </>
      )}

      <Field label="Amount Type">
        <select value={transfer.amountType} onChange={e => handleAmountTypeChange(e.target.value as Transfer["amountType"])} className="input">
          {AMOUNT_TYPES.map(t => (
            <option key={t} value={t} disabled={!hasSource && t !== "fixed"}>{AMOUNT_TYPE_LABELS[t]}</option>
          ))}
        </select>
      </Field>

      {!isGainsOnly && (
        <Field label={
          transfer.amountType === "percent-balance"
            ? `Amount — ${(transfer.amount * 100).toFixed(1)}% of balance`
            : (transfer.amountType === "fixed" && (transfer.inflationHedged ?? true) === false)
              ? "Amount (today's value)"
              : "Amount"
        }>
          {transfer.amountType === "percent-balance" ? (
            <PercentSlider value={transfer.amount} min={0} max={1} step={0.001} onChange={v => update("amount", v)} />
          ) : (
            <CurrencyInput
              value={transfer.amount}
              locale={currencyLocale}
              currencyCode={currencyCode}
              onChange={v => update("amount", v)}
              className="input"
            />
          )}
        </Field>
      )}

      {transfer.amountType === "fixed" && (
        <Field label={`Inflation${!inflationEnabled ? " (applies when inflation is enabled)" : ""}`}>
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input
              type="checkbox"
              checked={transfer.inflationAdjusted ?? false}
              onChange={e => update("inflationAdjusted", e.target.checked)}
              className="accent-violet-600"
            />
            Adjust with inflation
          </label>
        </Field>
      )}

      {hasTarget && (
        <>
          <Field label={`Tax Rate — ${(transfer.taxRate * 100).toFixed(1)}%`}>
            <PercentSlider value={transfer.taxRate} min={0} max={1} step={0.005} onChange={v => update("taxRate", v)} />
          </Field>

          <Field label="Tax Basis">
            <select
              value={transfer.taxBasis}
              disabled={isGainsOnly}
              onChange={e => update("taxBasis", e.target.value as Transfer["taxBasis"])}
              className="input disabled:opacity-50"
            >
              <option value="full">Full amount</option>
              <option value="gains-fraction">Gains fraction only</option>
            </select>
          </Field>
        </>
      )}

      <Field label="Notes">
        <textarea value={transfer.notes ?? ""} onChange={e => update("notes", e.target.value)} rows={2} className="input" />
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
