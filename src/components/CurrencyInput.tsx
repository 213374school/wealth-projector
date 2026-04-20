import { useState } from "react";
import { safeLocale } from "../utils/formatting";

interface Props {
  value: number;
  locale: string;
  currencyCode: string;
  symbolPosition?: "before" | "after";
  onChange: (v: number) => void;
  className?: string;
}

export function CurrencyInput({ value, locale, currencyCode, symbolPosition = "before", onChange, className }: Props) {
  const [focused, setFocused] = useState(false);
  const [raw, setRaw] = useState("");

  const num = new Intl.NumberFormat(safeLocale(locale), { maximumFractionDigits: 0 }).format(value);
  const formatted = symbolPosition === "after" ? `${num} ${currencyCode}` : `${currencyCode}${num}`;

  return (
    <input
      type="text"
      inputMode="numeric"
      value={focused ? raw : formatted}
      onFocus={e => {
        setRaw(String(value));
        setFocused(true);
        e.target.select();
      }}
      onChange={e => setRaw(e.target.value)}
      onBlur={() => {
        setFocused(false);
        const parsed = parseFloat(raw.replace(/[^0-9.-]/g, ""));
        onChange(isNaN(parsed) ? 0 : parsed);
      }}
      className={className}
    />
  );
}
