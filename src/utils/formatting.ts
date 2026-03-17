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

export function formatCurrencyFull(value: number, locale: string, symbol: string): string {
  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency: getCurrencyCode(locale),
      maximumFractionDigits: 0,
    }).format(value);
  } catch {
    return `${symbol}${Math.round(value).toLocaleString()}`;
  }
}

export function getCurrencyCode(locale: string): string {
  const region = locale.split("-")[1]?.toUpperCase();
  const regionMap: Record<string, string> = {
    US: "USD", GB: "GBP", SE: "SEK", JP: "JPY", AU: "AUD", CA: "CAD",
    DK: "DKK", NO: "NOK", CH: "CHF", CN: "CNY", IN: "INR", BR: "BRL",
    MX: "MXN", KR: "KRW", SG: "SGD", HK: "HKD", NZ: "NZD", ZA: "ZAR",
    PL: "PLN", CZ: "CZK", HU: "HUF", RU: "RUB", TR: "TRY", IL: "ILS",
    AE: "AED", SA: "SAR", TH: "THB", MY: "MYR", ID: "IDR", PH: "PHP",
    // Eurozone
    DE: "EUR", FR: "EUR", AT: "EUR", BE: "EUR", FI: "EUR", GR: "EUR",
    IE: "EUR", IT: "EUR", LU: "EUR", NL: "EUR", PT: "EUR", ES: "EUR",
  };
  return (region && regionMap[region]) ?? "USD";
}

export function monthToLabel(month: string): string {
  const [y, m] = month.split("-").map(Number);
  const date = new Date(y, m - 1, 1);
  return date.toLocaleDateString("en-US", { month: "short", year: "numeric" });
}
