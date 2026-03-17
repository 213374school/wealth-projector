import { useState } from "react";

interface Props {
  value: number;
  locale: string;
  currencyCode: string;
  onChange: (v: number) => void;
  className?: string;
}

export function CurrencyInput({ value, locale, currencyCode, onChange, className }: Props) {
  const [focused, setFocused] = useState(false);
  const [raw, setRaw] = useState("");

  let formatted: string;
  try {
    formatted = new Intl.NumberFormat(locale, {
      style: "currency",
      currency: currencyCode,
      currencyDisplay: "code",
      maximumFractionDigits: 0,
    }).format(value);
  } catch {
    formatted = `${new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(value)} ${currencyCode}`;
  }

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
