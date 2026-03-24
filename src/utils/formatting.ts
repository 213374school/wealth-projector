export function formatCurrency(value: number, _locale: string, symbol: string): string {
  const abs = Math.abs(value);
  let formatted: string;
  if (abs >= 1_000_000) {
    formatted = `${symbol}${(value / 1_000_000).toFixed(2)}M`;
  } else if (abs >= 1_000) {
    formatted = `${symbol}${(value / 1_000).toFixed(1)}k`;
  } else {
    formatted = `${symbol}${value.toFixed(0)}`;
  }
  return formatted;
}

export function monthToLabel(month: string): string {
  const [y, m] = month.split("-").map(Number);
  const date = new Date(y, m - 1, 1);
  return date.toLocaleDateString("en-US", { month: "short", year: "numeric" });
}
