import { StepButton } from "./StepButton";

export const PERIODS = ["monthly", "quarterly", "half-yearly", "yearly"] as const;
export const PERIOD_LABELS: Record<typeof PERIODS[number], string> = {
  "monthly": "Monthly",
  "quarterly": "Quarterly",
  "half-yearly": "Half-Yearly",
  "yearly": "Yearly",
};

export function PercentSlider({ value, min, max, step, onChange }: { value: number; min: number; max: number; step: number; onChange: (v: number) => void }) {
  const clamp = (v: number) => Math.max(min, Math.min(max, parseFloat(v.toFixed(4))));
  return (
    <div className="flex items-center gap-2">
      <StepButton onClick={() => onChange(clamp(value - step))} className="w-7 h-7 flex items-center justify-center rounded-lg border border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-700 select-none text-sm font-medium transition-colors">−</StepButton>
      <input type="range" min={min} max={max} step={step} value={value} onChange={e => onChange(parseFloat(e.target.value))} className="flex-1 accent-violet-600" />
      <StepButton onClick={() => onChange(clamp(value + step))} className="w-7 h-7 flex items-center justify-center rounded-lg border border-zinc-200 dark:border-zinc-700 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-700 select-none text-sm font-medium transition-colors">+</StepButton>
    </div>
  );
}

export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-medium text-zinc-500 dark:text-zinc-400 mb-1.5">{label}</label>
      {children}
    </div>
  );
}
