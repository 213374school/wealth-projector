import { useCallback } from "react";
import type { Transfer, Account, DateSnap } from "../types";
import { useScenarioStore } from "../store/scenario";
import { resolvedStartDate, resolvedEndDate, SNAP_LABELS } from "../utils/snapDates";

const PERIODS = ["monthly", "quarterly", "half-yearly", "yearly"] as const;
const AMOUNT_TYPES = ["fixed", "percent-balance", "gains-only"] as const;

interface Props {
  transfer: Transfer;
  accounts: Account[];
}

export function TransferEditor({ transfer, accounts }: Props) {
  const updateTransfer = useScenarioStore(s => s.updateTransfer);
  const deleteTransfer = useScenarioStore(s => s.deleteTransfer);

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
        <h3 className="font-semibold text-gray-900 dark:text-gray-100">Transfer</h3>
        <button onClick={() => deleteTransfer(transfer.id)} className="text-red-500 hover:text-red-700 text-sm">Delete</button>
      </div>

      <Field label="Name">
        <input type="text" value={transfer.name} onChange={e => update("name", e.target.value)} className="input" />
      </Field>

      <Field label="Source Account">
        <select
          value={transfer.sourceAccountId ?? ""}
          onChange={e => update("sourceAccountId", e.target.value || null)}
          className="input"
        >
          <option value="">None (external / contribution)</option>
          {accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
      </Field>

      <Field label="Target Account">
        <select
          value={transfer.targetAccountId ?? ""}
          onChange={e => {
            const val = e.target.value || null;
            const updates: Partial<Transfer> = { targetAccountId: val };
            if (val === null) { updates.taxRate = 0; updates.taxBasis = "full"; }
            updateTransfer(transfer.id, updates);
          }}
          className="input"
        >
          <option value="">None (external / consumption)</option>
          {accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
      </Field>

      <DateField
        label="Start Date"
        literalValue={transfer.startDate}
        snap={transfer.startSnap ?? null}
        resolvedValue={resolvedStartDate(transfer, accounts)}
        onLiteralChange={v => update("startDate", v)}
        onSnapChange={v => updateTransfer(transfer.id, { startSnap: v })}
      />

      <div>
        <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">One-time Event</label>
        <input type="checkbox" checked={transfer.isOneTime} onChange={e => update("isOneTime", e.target.checked)} className="mr-1" />
        <span className="text-sm text-gray-700 dark:text-gray-300">Fire once at start date</span>
      </div>

      {!transfer.isOneTime && (
        <>
          <DateField
            label="End Date"
            literalValue={transfer.endDate ?? ""}
            snap={transfer.endSnap ?? null}
            resolvedValue={resolvedEndDate(transfer, accounts) ?? ""}
            onLiteralChange={v => update("endDate", v || null)}
            onSnapChange={v => updateTransfer(transfer.id, { endSnap: v })}
            allowEmpty
          />
          <Field label="Period">
            <select value={transfer.period} onChange={e => update("period", e.target.value as Transfer["period"])} className="input">
              {PERIODS.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
          </Field>
        </>
      )}

      <Field label="Amount Type">
        <select value={transfer.amountType} onChange={e => handleAmountTypeChange(e.target.value as Transfer["amountType"])} className="input">
          {AMOUNT_TYPES.map(t => (
            <option key={t} value={t} disabled={!hasSource && t !== "fixed"}>{t}</option>
          ))}
        </select>
      </Field>

      {!isGainsOnly && (
        <Field label={transfer.amountType === "percent-balance" ? "Amount (% of balance)" : "Amount"}>
          <input
            type="number"
            value={transfer.amountType === "percent-balance" ? (transfer.amount * 100).toFixed(2) : transfer.amount}
            step={transfer.amountType === "percent-balance" ? "0.1" : "100"}
            onChange={e => {
              const v = parseFloat(e.target.value) || 0;
              update("amount", transfer.amountType === "percent-balance" ? v / 100 : v);
            }}
            className="input"
          />
        </Field>
      )}

      {hasTarget && (
        <>
          <Field label="Tax Rate (%)">
            <input
              type="number"
              value={(transfer.taxRate * 100).toFixed(1)}
              step="0.5"
              min="0"
              max="100"
              onChange={e => update("taxRate", (parseFloat(e.target.value) || 0) / 100)}
              className="input"
            />
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

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">{label}</label>
      {children}
    </div>
  );
}

function DateField({
  label,
  literalValue,
  snap,
  resolvedValue,
  onLiteralChange,
  onSnapChange,
}: {
  label: string;
  literalValue: string;
  snap: DateSnap | null;
  resolvedValue: string;
  onLiteralChange: (v: string) => void;
  onSnapChange: (v: DateSnap | null) => void;
  allowEmpty?: boolean;
}) {
  return (
    <div>
      <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">{label}</label>
      <select
        value={snap ?? ""}
        onChange={e => onSnapChange((e.target.value as DateSnap) || null)}
        className="input mb-1"
      >
        <option value="">Fixed date</option>
        {(Object.keys(SNAP_LABELS) as DateSnap[]).map(k => (
          <option key={k} value={k}>{SNAP_LABELS[k]}</option>
        ))}
      </select>
      {snap ? (
        <p className="text-xs text-gray-400 dark:text-gray-500 pl-1">
          Resolves to: <span className="font-medium text-gray-600 dark:text-gray-300">{resolvedValue || "—"}</span>
        </p>
      ) : (
        <input
          type="month"
          value={literalValue}
          onChange={e => onLiteralChange(e.target.value)}
          className="input"
        />
      )}
    </div>
  );
}
