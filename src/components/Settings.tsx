import { useState, useRef } from "react";
import { useScenarioStore } from "../store/scenario";
import { validateScenario } from "../utils/validation";
import type { Scenario } from "../types";

interface Props {
  onClose: () => void;
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div
        className="bg-white dark:bg-gray-900 rounded-xl shadow-2xl w-full max-w-md p-6 space-y-4"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Settings</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 text-xl">x</button>
        </div>

        {/* Scenario management */}
        <div>
          <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">Scenario</label>
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
                className="text-red-500 hover:text-red-700 text-xs px-2"
              >Del</button>
            )}
          </div>
        </div>

        <Field label="Scenario Name">
          <input type="text" value={scenario.name} onChange={e => updateScenario({ name: e.target.value })} className="input" />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Timeline Start">
            <input type="month" value={scenario.timelineStart} onChange={e => updateScenario({ timelineStart: e.target.value })} className="input" />
          </Field>
          <Field label="Timeline End">
            <input type="month" value={scenario.timelineEnd} onChange={e => updateScenario({ timelineEnd: e.target.value })} className="input" />
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
            <label className="flex items-center gap-1 text-sm text-gray-700 dark:text-gray-300 cursor-pointer">
              <input
                type="checkbox"
                checked={scenario.inflationEnabled}
                onChange={e => updateScenario({ inflationEnabled: e.target.checked })}
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

        <div className="flex gap-2 pt-2">
          <button onClick={handleExport} className="btn-secondary flex-1">Export JSON</button>
          <button onClick={() => fileInputRef.current?.click()} className="btn-secondary flex-1">Import JSON</button>
          <input ref={fileInputRef} type="file" accept=".json" onChange={handleImport} className="hidden" />
        </div>
        {importError && <p className="text-red-500 text-xs">{importError}</p>}
      </div>
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
