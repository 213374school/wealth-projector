import { useState, useRef } from "react";
import { useScenarioStore } from "../store/scenario";
import { validateScenario } from "../utils/validation";
import { MonthPicker } from "./MonthPicker";
import { Field } from "./EditorShared";
import type { Scenario } from "../types";

interface Props {
  onClose: () => void;
}

function CloseIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      <path d="M4 4l8 8M12 4l-8 8"/>
    </svg>
  );
}

// Normalize YYYY-M dates (single-digit month) to YYYY-MM, in-place.
function padDate(s: unknown): unknown {
  if (typeof s !== "string") return s;
  return s.replace(/^(\d{4})-(\d)$/, (_, y, m) => `${y}-0${m}`);
}
function padDates(data: Record<string, unknown>) {
  for (const key of ["timelineStart", "timelineEnd", "createdAt", "updatedAt"]) {
    data[key] = padDate(data[key]);
  }
  for (const t of (data.transfers ?? []) as Record<string, unknown>[]) {
    t.startDate = padDate(t.startDate);
    t.endDate = padDate(t.endDate);
  }
  for (const a of (data.anchors ?? []) as Record<string, unknown>[]) {
    a.date = padDate(a.date);
  }
}

export function Settings({ onClose }: Props) {
  const { activeScenarioId, scenarios, updateScenario, createScenario, duplicateScenario, deleteScenario, setActiveScenario, importScenario } = useScenarioStore();
  const scenario = activeScenarioId ? scenarios[activeScenarioId] : null;
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importError, setImportError] = useState<string | null>(null);

  if (!scenario) return null;

  const handleExport = () => {
    const json = JSON.stringify(scenario, null, 2);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${scenario.name.replace(/\s+/g, "-")}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    setImportError(null);
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const data = JSON.parse(ev.target?.result as string);
        padDates(data);
        const result = validateScenario(data);
        if (!result.valid) {
          setImportError(result.error ?? "Invalid file");
          return;
        }
        importScenario(data as Scenario);
        onClose();
      } catch {
        setImportError("Failed to parse JSON file");
      }
    };
    reader.readAsText(file);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div
        className="bg-white dark:bg-zinc-900 rounded-xl shadow-2xl shadow-black/20 w-full max-w-md p-6 space-y-4 border border-zinc-200 dark:border-zinc-800"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">Settings</h2>
          <button onClick={onClose} className="btn-icon -mr-1">
            <CloseIcon />
          </button>
        </div>

        {/* Scenario management */}
        <div>
          <label className="block text-xs font-medium text-zinc-500 dark:text-zinc-400 mb-1.5">Scenario</label>
          <div className="flex gap-2">
            <select
              value={activeScenarioId ?? ""}
              onChange={e => setActiveScenario(e.target.value)}
              className="input flex-1"
            >
              {Object.values(scenarios).map(s => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
            <button onClick={() => createScenario()} className="btn-secondary text-xs px-2">New</button>
            <button onClick={() => activeScenarioId && duplicateScenario(activeScenarioId)} className="btn-secondary text-xs px-2">Dup</button>
            {Object.keys(scenarios).length > 1 && (
              <button
                onClick={() => {
                  if (confirm("Delete this scenario?") && activeScenarioId) deleteScenario(activeScenarioId);
                }}
                className="px-2 text-xs text-red-500 hover:text-red-600 dark:hover:text-red-400 transition-colors"
              >Del</button>
            )}
          </div>
        </div>

        <Field label="Scenario Name">
          <input type="text" value={scenario.name} onChange={e => updateScenario({ name: e.target.value })} className="input" />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Timeline Start">
            <MonthPicker value={scenario.timelineStart} onChange={v => updateScenario({ timelineStart: v })} />
          </Field>
          <Field label="Timeline End">
            <MonthPicker value={scenario.timelineEnd} onChange={v => updateScenario({ timelineEnd: v })} />
          </Field>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex-1">
            <Field label="Inflation Rate (%)">
              <input
                type="number"
                value={(scenario.inflationRate * 100).toFixed(1)}
                step="0.1"
                onChange={e => updateScenario({ inflationRate: (parseFloat(e.target.value) || 0) / 100 })}
                className="input"
              />
            </Field>
          </div>
          <div className="pt-4">
            <label className="flex items-center gap-1.5 text-sm text-zinc-700 dark:text-zinc-300 cursor-pointer">
              <input
                type="checkbox"
                checked={scenario.inflationEnabled}
                onChange={e => updateScenario({ inflationEnabled: e.target.checked })}
                className="accent-violet-600"
              />
              Enabled
            </label>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Currency Symbol">
            <input type="text" value={scenario.currencySymbol} onChange={e => updateScenario({ currencySymbol: e.target.value })} className="input" />
          </Field>
          <Field label="Locale (BCP 47)">
            <input type="text" value={scenario.currencyLocale} onChange={e => updateScenario({ currencyLocale: e.target.value })} className="input" />
          </Field>
        </div>
        <div>
          <label className="flex items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300 cursor-pointer">
            <input
              type="checkbox"
              checked={(scenario.currencySymbolPosition ?? "before") === "after"}
              onChange={e => updateScenario({ currencySymbolPosition: e.target.checked ? "after" : "before" })}
              className="accent-violet-600"
            />
            Show currency symbol after amount
          </label>
        </div>

        <div className="flex gap-2 pt-2">
          <button onClick={handleExport} className="btn-secondary flex-1 justify-center">Export JSON</button>
          <button onClick={() => fileInputRef.current?.click()} className="btn-secondary flex-1 justify-center">Import JSON</button>
          <input ref={fileInputRef} type="file" accept=".json" onChange={handleImport} className="hidden" />
        </div>
        {importError && <p className="text-red-500 text-xs">{importError}</p>}
      </div>
    </div>
  );
}
