// Currency list for pickers: common ones first, then every ISO currency the browser knows.

const COMMON = ['INR', 'USD', 'EUR', 'GBP', 'AED', 'SGD', 'THB', 'JPY', 'AUD', 'CAD', 'MYR', 'LKR', 'NPR', 'IDR', 'CHF'];

// Fund / accounting codes nobody pays in.
const SKIP = new Set(['XDR', 'XSU', 'XUA', 'XBA', 'XBB', 'XBC', 'XBD', 'XTS', 'XXX', 'XAG', 'XAU', 'XPD', 'XPT']);

let all = COMMON;
try {
  all = Intl.supportedValuesOf('currency').filter((c) => !SKIP.has(c));
} catch {
  // older browsers: common list only
}

const names = (() => {
  try {
    return new Intl.DisplayNames(['en'], { type: 'currency' });
  } catch {
    return null;
  }
})();

export const currencyName = (code) => names?.of(code) ?? code;

export const CURRENCIES = [...COMMON, ...all.filter((c) => !COMMON.includes(c))].map((code) => ({
  code,
  label: `${code} · ${currencyName(code)}`,
}));
