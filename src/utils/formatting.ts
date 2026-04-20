export function safeLocale(locale: string | undefined, fallback = "en-US"): string {
  try {
    Intl.getCanonicalLocales(locale ?? "");
    return locale || fallback;
  } catch {
    return fallback;
  }
}

export function formatCurrency(value: number, symbol: string, symbolPosition: "before" | "after" = "before"): string {
  const abs = Math.abs(value);
  const sign = value < 0 ? "-" : "";
  let number: string;
  if (abs >= 1_000_000) {
    number = `${(abs / 1_000_000).toFixed(2)}M`;
  } else if (abs >= 1_000) {
    number = `${(abs / 1_000).toFixed(1)}k`;
  } else {
    number = abs.toFixed(0);
  }
  return symbolPosition === "after" ? `${sign}${number} ${symbol}` : `${sign}${symbol}${number}`;
}

export function monthToLabel(month: string, locale = "en-US"): string {
  const [y, m] = month.split("-").map(Number);
  const date = new Date(y, m - 1, 1);
  return date.toLocaleDateString(safeLocale(locale), { month: "short", year: "numeric" });
}
