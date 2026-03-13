import type { Account } from "../types";

interface Props {
  accounts: Account[];
  visibleAccounts: Set<string>;
  onToggle: (id: string) => void;
}

export function Legend({ accounts, visibleAccounts, onToggle }: Props) {
  return (
    <div className="flex flex-wrap gap-2">
      {accounts.map(acc => {
        const visible = visibleAccounts.has(acc.id);
        return (
          <button
            key={acc.id}
            onClick={() => onToggle(acc.id)}
            className={`flex items-center gap-1.5 px-2 py-1 rounded text-xs transition-opacity ${visible ? "opacity-100" : "opacity-40"}`}
          >
            <span
              className="inline-block w-3 h-3 rounded-sm flex-shrink-0"
              style={{ background: acc.color }}
            />
            <span className="text-gray-700 dark:text-gray-300">{acc.name}</span>
          </button>
        );
      })}
      {accounts.length === 0 && (
        <span className="text-xs text-gray-400 dark:text-gray-500">No accounts yet</span>
      )}
    </div>
  );
}
