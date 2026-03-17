import type { Account } from "../types";

interface Props {
  accounts: Account[];
  visibleAccounts: Set<string>;
  onToggle: (id: string) => void;
}

export function Legend({ accounts, visibleAccounts, onToggle }: Props) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {accounts.map(acc => {
        const visible = visibleAccounts.has(acc.id);
        return (
          <button
            key={acc.id}
            onClick={() => onToggle(acc.id)}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium border transition-all duration-150 ${
              visible
                ? "opacity-100 bg-white dark:bg-zinc-900 border-zinc-200 dark:border-zinc-700 text-zinc-700 dark:text-zinc-300 shadow-sm"
                : "opacity-40 bg-transparent border-transparent text-zinc-600 dark:text-zinc-400 hover:opacity-60"
            }`}
          >
            <span
              className="inline-block w-2.5 h-2.5 rounded-full flex-shrink-0"
              style={{ background: acc.color }}
            />
            <span>{acc.name}</span>
          </button>
        );
      })}
      {accounts.length === 0 && (
        <span className="text-xs text-zinc-400 dark:text-zinc-500">No accounts yet</span>
      )}
    </div>
  );
}
