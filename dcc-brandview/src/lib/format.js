/** Indian-style number grouping: 12037601 -> 1,20,37,601 */
export function inr(n, decimals = 0) {
  const v = Number(n) || 0;
  const neg = v < 0;
  const fixed = Math.abs(v).toFixed(decimals);
  let [ip, fp] = fixed.split('.');
  if (ip.length > 3) {
    const last3 = ip.slice(-3);
    let rest = ip.slice(0, -3);
    const parts = [];
    while (rest.length > 2) { parts.unshift(rest.slice(-2)); rest = rest.slice(0, -2); }
    if (rest) parts.unshift(rest);
    ip = parts.join(',') + ',' + last3;
  }
  return (neg ? '-' : '') + ip + (fp ? '.' + fp : '');
}
export const rs = (n, d = 0) => (Number(n) < 0 ? '-₹' + inr(Math.abs(n), d) : '₹' + inr(n, d));

/** Short rupees for chart axes: 820000 -> ₹8.2L */
export function rsShort(n) {
  const v = Math.abs(Number(n) || 0);
  const s = n < 0 ? '-' : '';
  if (v >= 1e7) return s + '₹' + (v / 1e7).toFixed(v >= 1e8 ? 0 : 1).replace(/\.0$/, '') + 'Cr';
  if (v >= 1e5) return s + '₹' + (v / 1e5).toFixed(v >= 1e6 ? 0 : 1).replace(/\.0$/, '') + 'L';
  if (v >= 1e3) return s + '₹' + (v / 1e3).toFixed(0) + 'K';
  return s + '₹' + v.toFixed(0);
}

const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve',
  'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
const two = (n) => (n < 20 ? ONES[n] : TENS[Math.floor(n / 10)] + (n % 10 ? '-' + ONES[n % 10] : ''));
const three = (n) => (n >= 100 ? ONES[Math.floor(n / 100)] + ' Hundred' + (n % 100 ? ' ' + two(n % 100) : '') : two(n));

/** Rupees in words, Indian system (Crore / Lakh). */
export function inWords(amount) {
  let v = Math.round(Math.abs(Number(amount) || 0) * 100);
  const neg = Number(amount) < 0;
  const paise = v % 100;
  v = Math.floor(v / 100);
  const parts = [];
  const crore = Math.floor(v / 1e7); v %= 1e7;
  const lakh = Math.floor(v / 1e5); v %= 1e5;
  const thousand = Math.floor(v / 1e3); v %= 1e3;
  if (crore) parts.push(three(crore) + ' Crore');
  if (lakh) parts.push(two(lakh) + ' Lakh');
  if (thousand) parts.push(two(thousand) + ' Thousand');
  if (v) parts.push(three(v));
  let s = 'Rupees ' + (parts.join(' ') || 'Zero');
  if (paise) s += ' and ' + two(paise) + ' Paise';
  return (neg ? 'Minus ' : '') + s + ' Only';
}

/* ---------- dates (local, no UTC shifts) ---------- */
export const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export const parseIso = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
export const fmtD = (s) => parseIso(s).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
export const fmtDY = (s) => parseIso(s).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
export const daysBetween = (a, b) => Math.round((parseIso(b) - parseIso(a)) / 86400000);

export function presetRange(key) {
  const t = new Date();
  const today = new Date(t.getFullYear(), t.getMonth(), t.getDate());
  if (key === 'month') return [iso(new Date(today.getFullYear(), today.getMonth(), 1)), iso(today)];
  if (key === 'lastmonth') {
    return [iso(new Date(today.getFullYear(), today.getMonth() - 1, 1)), iso(new Date(today.getFullYear(), today.getMonth(), 0))];
  }
  if (key === '7d') return [iso(new Date(today.getTime() - 6 * 86400000)), iso(today)];
  if (key === 'fy') {
    const y = today.getMonth() >= 3 ? today.getFullYear() : today.getFullYear() - 1;
    return [iso(new Date(y, 3, 1)), iso(today)];
  }
  return [iso(today), iso(today)];
}

/** Same dates one month earlier, for "vs last month" comparison. */
export function prevRange(from, to) {
  const shift = (s) => {
    const d = parseIso(s);
    const target = new Date(d.getFullYear(), d.getMonth() - 1, 1);
    const last = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
    return iso(new Date(target.getFullYear(), target.getMonth(), Math.min(d.getDate(), last)));
  };
  return [shift(from), shift(to)];
}

export function pctChange(now, prev) {
  if (!prev) return null;
  return ((now - prev) / Math.abs(prev)) * 100;
}

export const initials = (s) => (s || '?').replace(/[^A-Za-z ]/g, ' ').trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '?';

/** Removes the trailing Tally SKU code from names: "HAZELNUT CONE 110ML D3901" -> "Hazelnut Cone 110ml" */
export function cleanItem(name) {
  const s = (name || '').replace(/\s+D\d{4}\s*$/i, '').replace(/\s+/g, ' ').trim();
  return s === s.toUpperCase() ? s.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase()) : s;
}
export const cleanParty = (p) => (p || '').replace(/\s+/g, ' ').trim();
