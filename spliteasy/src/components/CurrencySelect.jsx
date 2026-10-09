import { CURRENCIES } from '../lib/currencies';

export default function CurrencySelect({ value, onChange, id, compact }) {
  return (
    <select id={id} className={compact ? 'currency-compact' : undefined} value={value} onChange={(e) => onChange(e.target.value)}>
      {!CURRENCIES.some((c) => c.code === value) && <option value={value}>{value}</option>}
      {CURRENCIES.map((c) => (
        <option key={c.code} value={c.code}>
          {compact ? c.code : c.label}
        </option>
      ))}
    </select>
  );
}
