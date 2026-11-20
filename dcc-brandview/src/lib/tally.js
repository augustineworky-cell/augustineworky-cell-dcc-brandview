import * as XLSX from 'xlsx';
import { iso } from './format.js';

/** Column order of the MASTER SALES REPORT sheet (Tally "New Sales Report"). */
export const MASTER_COLS = ['Trans Type', 'Location Name', 'Location State', 'Dispatch Location Tin No', 'Invoice Type', 'Document No', 'Document Date',
  'Vehicle No', 'Additional Amount', 'Customer Code', 'Buyer Address', 'Customer Address', 'Party Name', 'Customer Group Desc', 'Customer State Desc',
  'Tin No', 'Item Group Desc', 'Item Code', 'Item Name', 'Quantity', 'UOM', 'Rate', 'Discount %', 'Discount Amount', 'Amount Less Discount', 'Amount',
  'Cst %', 'Cst', 'Vat %', 'Vat', 'GST %', 'GST', 'Sales Amount', 'Total Tax Amount', 'Total Amount', 'Sales Account', 'Po.No.', 'Way Bill No',
  'Transporter Name', 'Shipment No', 'MRP'];
const ALIAS = { 'GR No': 'Po.No.' };
const NUMERIC = new Set(['Quantity', 'Rate', 'Discount %']);

const NEED = ['Document No', 'Document Date', 'Party Name', 'Item Group Desc', 'Item Code', 'Quantity', 'Total Amount'];

const num = (v) => {
  if (v === null || v === undefined || v === '') return 0;
  if (typeof v === 'number') return v;
  const m = String(v).replace(/,/g, '').match(/-?\d+(\.\d+)?/);
  return m ? Number(m[0]) : 0;
};
const txt = (v) => (v === null || v === undefined ? '' : String(v).replace(/\s+/g, ' ').trim());

const MON = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
function toDate(v) {
  if (v instanceof Date && !isNaN(v)) return iso(new Date(v.getFullYear(), v.getMonth(), v.getDate()));
  if (typeof v === 'number') {
    if (v < 20000 || v > 80000) return null; // not a plausible Excel date serial
    const d = new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 86400000);
    return iso(new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  }
  const s = txt(v);
  let m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/);
  if (m) { const y = m[3].length === 2 ? 2000 + +m[3] : +m[3]; return iso(new Date(y, +m[2] - 1, +m[1])); }
  m = s.match(/^(\d{1,2})[-\s]([A-Za-z]{3})[A-Za-z]*[-\s](\d{2,4})/);
  if (m && MON[m[2].toLowerCase()] !== undefined) { const y = m[3].length === 2 ? 2000 + +m[3] : +m[3]; return iso(new Date(y, MON[m[2].toLowerCase()], +m[1])); }
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  return null;
}

function locationOf(name) {
  const s = txt(name).toUpperCase();
  if (s.includes('OKHLA') || s.includes('DELHI')) return 'Okhla';
  if (s.includes('GURGAON') || s.includes('GURUGRAM') || s.includes('HARYANA')) return 'Gurgaon';
  return null;
}

/**
 * Reads one Tally "New Sales Report" Excel export (or the master sheet) and returns cleaned rows
 * shaped for the sales_import table, plus counts for the preview.
 */
export async function parseTallyFile(file) {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: 'array', cellDates: false });
  let best = null;
  for (const name of wb.SheetNames) {
    const grid = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: true, defval: '' });
    const top = grid.slice(0, 15).map((r) => r.join(' ')).join(' ');
    if (/purchase report/i.test(top)) throw new Error(`"${file.name}" is a Purchase report. Please export the New Sales Report.`);
    const hi = grid.findIndex((r, i) => i < 40 && r.some((c) => txt(c) === 'Document No'));
    if (hi >= 0 && (!best || grid.length > best.grid.length)) best = { grid, hi };
  }
  if (!best) throw new Error(`"${file.name}" doesn't look like a Tally sales report (no "Document No" column found).`);

  const head = best.grid[best.hi].map(txt);
  const col = (k) => head.indexOf(k);
  const missing = NEED.filter((k) => col(k) < 0);
  if (missing.length) throw new Error(`"${file.name}" is missing columns: ${missing.join(', ')}`);

  const stats = { file: file.name, read: 0, totals: 0, dcc: 0, dupes: 0, badDate: 0, noLocation: 0 };
  const seen = new Set();
  const rows = [];
  for (const r of best.grid.slice(best.hi + 1)) {
    const doc = txt(r[col('Document No')]);
    const party = txt(r[col('Party Name')]);
    if (!doc && !party) continue;
    stats.read++;
    if (!doc || /^total/i.test(doc) || /^total/i.test(party) || !txt(r[col('Item Code')])) { stats.totals++; continue; }
    if (/DCC Supply Chain/i.test(party)) { stats.dcc++; continue; }
    const date = toDate(r[col('Document Date')]);
    if (!date) { stats.badDate++; continue; }
    const loc = locationOf(col('Location Name') >= 0 ? r[col('Location Name')] : '');
    if (!loc) { stats.noLocation++; continue; }
    const row = {
      location: loc,
      trans_type: col('Trans Type') >= 0 ? txt(r[col('Trans Type')]) : (num(r[col('Quantity')]) < 0 ? 'SR' : 'SALES'),
      document_no: doc,
      document_date: date,
      party_name: party,
      customer_code: col('Customer Code') >= 0 ? txt(r[col('Customer Code')]).replace(/\.0$/, '') : '',
      customer_group: col('Customer Group Desc') >= 0 ? txt(r[col('Customer Group Desc')]) : '',
      item_group: txt(r[col('Item Group Desc')]),
      item_code: txt(r[col('Item Code')]),
      item_name: col('Item Name') >= 0 ? txt(r[col('Item Name')]) : '',
      qty: num(r[col('Quantity')]),
      uom: col('UOM') >= 0 ? txt(r[col('UOM')]) : '',
      rate: col('Rate') >= 0 ? num(r[col('Rate')]) : 0,
      discount_pct: col('Discount %') >= 0 ? num(r[col('Discount %')]) : 0,
      amount: col('Amount') >= 0 ? Math.round(num(r[col('Amount')]) * 100) / 100 : 0,
      gst_pct: col('GST %') >= 0 ? num(r[col('GST %')]) : 0,
      gst: col('GST') >= 0 ? Math.round(num(r[col('GST')]) * 100) / 100 : 0,
      total_amount: Math.round(num(r[col('Total Amount')]) * 100) / 100
    };
    // every column of the sheet, so brands can download the full master-format report
    const raw = {};
    head.forEach((h, i) => {
      if (!h || /^qty helper$/i.test(h)) return;
      const k = ALIAS[h] || h;
      let v = r[i];
      if (v === '' || v === null || v === undefined) return;
      if (k === 'Document Date') v = date;
      else if (NUMERIC.has(k)) v = num(v);
      else if (typeof v === 'string') { v = txt(v); if (!v) return; }
      raw[k] = v;
    });
    row.raw = raw;
    const key = [row.location, row.document_no, row.item_code, row.qty, row.rate].join('|');
    if (seen.has(key)) { stats.dupes++; continue; }
    seen.add(key);
    rows.push(row);
  }
  return { rows, stats };
}

/** Summarises parsed rows for the preview card. */
export function summarise(rows, knownGroups) {
  const dates = rows.map((r) => r.document_date).sort();
  const groups = {};
  for (const r of rows) groups[r.item_group] = (groups[r.item_group] || 0) + 1;
  const unknown = Object.keys(groups).filter((g) => knownGroups && !knownGroups.has(g));
  return {
    lines: rows.length,
    from: dates[0], to: dates[dates.length - 1],
    okhla: rows.filter((r) => r.location === 'Okhla').length,
    gurgaon: rows.filter((r) => r.location === 'Gurgaon').length,
    total: rows.reduce((s, r) => s + r.total_amount, 0),
    groups, unknown
  };
}

/** Downloads rows as an .xlsx file. columns: [[header, key, type?]] */
export function downloadXlsx(filename, sheetName, columns, rows) {
  const data = [columns.map((c) => c[0]), ...rows.map((r) => columns.map((c) => r[c[1]]))];
  const ws = XLSX.utils.aoa_to_sheet(data);
  ws['!cols'] = columns.map((c) => ({ wch: Math.max(10, c[0].length + 2, c[2] === 'wide' ? 40 : 0) }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName.slice(0, 31));
  XLSX.writeFile(wb, filename);
}

const LINE_COLS = 'document_date, document_no, trans_type, is_return, location, party_name, customer_code, customer_group, item_group, item_code, item_name, qty, uom, rate, discount_pct, amount, gst_pct, gst, total_amount, brand_id, raw';

/** Reads every sales line for the filters, 1000 rows at a time. RLS limits brand users to their own brand. */
export async function fetchAllLines(supabase, { from, to, loc, brand }) {
  const all = [];
  for (let start = 0; ; start += 1000) {
    let q = supabase.from('sales_lines').select(LINE_COLS)
      .gte('document_date', from).lte('document_date', to);
    if (loc) q = q.eq('location', loc);
    if (brand) q = q.eq('brand_id', brand);
    const { data, error } = await q.order('document_date').order('document_no').range(start, start + 999);
    if (error) throw new Error(error.message);
    all.push(...data);
    if (data.length < 1000) return all;
  }
}

/** Receiving-copy PDF links for these invoice numbers (RLS: brands only get their own single-brand bills). */
export async function fetchDocLinks(supabase, docs) {
  const out = {};
  const list = [...new Set(docs)];
  for (let i = 0; i < list.length; i += 100) {
    const { data, error } = await supabase.from('invoice_documents').select('document_no, file_url').in('document_no', list.slice(i, i + 100));
    if (error) return out;
    for (const d of data) out[d.document_no] = d.file_url;
  }
  return out;
}

const FALLBACK = {
  'Trans Type': 'trans_type', 'Location Name': 'location', 'Document No': 'document_no', 'Document Date': 'document_date',
  'Customer Code': 'customer_code', 'Party Name': 'party_name', 'Customer Group Desc': 'customer_group', 'Item Group Desc': 'item_group',
  'Item Code': 'item_code', 'Item Name': 'item_name', 'Quantity': 'qty', 'UOM': 'uom', 'Rate': 'rate', 'Discount %': 'discount_pct',
  'Amount': 'amount', 'GST %': 'gst_pct', 'GST': 'gst', 'Total Amount': 'total_amount'
};
const NUM_OUT = new Set(['Quantity', 'Rate', 'Discount %', 'Discount Amount', 'Amount Less Discount', 'Amount', 'Cst %', 'Cst', 'Vat %', 'Vat',
  'GST %', 'GST', 'Sales Amount', 'Total Tax Amount', 'Total Amount', 'MRP', 'Additional Amount']);

/** Full master-format workbook: every Tally column + receiving-copy link, plus a simple sheet. */
/** The "Master Sale sheet" tab exactly as in the Google Sheet (41 Tally columns + Qty Helper + receiving link). */
export function buildMasterSheet(lines, links) {
  const cols = [...MASTER_COLS, 'Qty Helper', 'Receiving copy (PDF)'];   // Qty Helper = last column of the Google Sheet
  const toDateObj = (s) => { if (s instanceof Date) s = iso(s); const m = String(s || '').match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? (Date.UTC(+m[1], +m[2] - 1, +m[3]) - Date.UTC(1899, 11, 30)) / 86400000 : s; };
  const data = [cols];
  for (const l of lines) {
    const raw = l.raw || {};
    data.push(cols.map((c) => {
      if (c === 'Receiving copy (PDF)') return links[l.document_no] || '';
      if (c === 'Qty Helper') return Number(l.qty) || 0;
      let v = raw[c];
      if ((v === undefined || v === null || v === '') && FALLBACK[c]) v = l[FALLBACK[c]];
      if (c === 'Document Date') return toDateObj(l.document_date);
      if (NUM_OUT.has(c) && v !== undefined && v !== null && v !== '' && !isNaN(Number(v))) return Number(v);
      return v ?? '';
    }));
  }
  const ws = XLSX.utils.aoa_to_sheet(data);
  const li = cols.length - 1, di = cols.indexOf('Document Date');
  for (let r = 1; r < data.length; r++) {
    const d = ws[XLSX.utils.encode_cell({ r, c: di })]; if (d && d.t === 'n') d.z = 'dd-mm-yyyy';
    const u = data[r][li]; if (u) ws[XLSX.utils.encode_cell({ r, c: li })].l = { Target: u };
  }
  ws['!cols'] = cols.map((c) => ({ wch: /Address/.test(c) ? 45 : /Party Name|Item Name|Receiving/.test(c) ? 38 : Math.max(10, c.length + 2) }));
  ws['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: data.length - 1, c: li } }) };
  ws['!freeze'] = { xSplit: 0, ySplit: 1 };
  return { ws, toDateObj };
}

export function downloadMasterXlsx(filename, lines, links, brandNames) {
  const { ws, toDateObj } = buildMasterSheet(lines, links);
  const simpleCols = [['Date', 'document_date'], ['Invoice', 'document_no'], ['Type', 'type'], ['Warehouse', 'location'], ['Brand', 'brand'], ['Outlet', 'party_name'],
    ['Item code', 'item_code'], ['Item', 'item_name'], ['Qty', 'qty'], ['UOM', 'uom'], ['Rate', 'rate'], ['Taxable', 'amount'], ['GST', 'gst'], ['Total', 'total_amount'], ['Receiving copy (PDF)', 'pdf']];
  const sdata = [simpleCols.map((c) => c[0]), ...lines.map((l) => simpleCols.map(([, k]) => {
    if (k === 'type') return l.is_return ? 'Return' : 'Sale';
    if (k === 'brand') return brandNames[l.brand_id] || '';
    if (k === 'pdf') return links[l.document_no] || '';
    if (k === 'document_date') return toDateObj(l.document_date);
    if (['qty', 'rate', 'amount', 'gst', 'total_amount'].includes(k)) return Number(l[k]);
    return l[k] ?? '';
  }))];
  const ws2 = XLSX.utils.aoa_to_sheet(sdata);
  for (let r = 1; r < sdata.length; r++) {
    const d = ws2[XLSX.utils.encode_cell({ r, c: 0 })]; if (d && d.t === 'n') d.z = 'dd-mm-yyyy';
    const u = sdata[r][14]; if (u) ws2[XLSX.utils.encode_cell({ r, c: 14 })].l = { Target: u };
  }
  ws2['!cols'] = simpleCols.map((c) => ({ wch: /Outlet|Item$|Receiving/.test(c[0]) ? 38 : 12 }));

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, buildSummarySheet(lines, brandNames, toDateObj), 'Summary');
  XLSX.utils.book_append_sheet(wb, ws, 'Master Sale sheet');
  XLSX.utils.book_append_sheet(wb, ws2, 'Simple view');
  XLSX.writeFile(wb, filename);
}


/** "Summary" tab: key figures + by warehouse / brand / product / outlet / day. Returns are already negative in the data, so plain sums give NET. */
function buildSummarySheet(lines, brandNames, toDateObj) {
  const n = (v) => Math.round((Number(v) || 0) * 100) / 100;
  const dates = lines.map((l) => String(l.document_date).slice(0, 10)).sort();
  const brands = [...new Set(lines.map((l) => brandNames[l.brand_id] || l.item_group || '').filter(Boolean))];
  const locs = [...new Set(lines.map((l) => l.location))].filter(Boolean);
  const bills = (ls) => new Set(ls.filter((l) => !l.is_return).map((l) => l.document_no)).size;
  const sum = (ls, k) => n(ls.reduce((a, l) => a + (Number(l[k]) || 0), 0));
  const group = (keyFn) => {
    const m = new Map();
    for (const l of lines) { const k = keyFn(l) || '(blank)'; if (!m.has(k)) m.set(k, []); m.get(k).push(l); }
    return [...m.entries()].map(([k, ls]) => ({ k, ls, taxable: sum(ls, 'amount') })).sort((a, b) => b.taxable - a.taxable);
  };
  const totalTaxable = sum(lines, 'amount');
  const pct = (v) => (totalTaxable ? Math.round(v / totalTaxable * 1000) / 10 : 0);
  const retLines = lines.filter((l) => l.is_return);
  const rows = []; const dateCells = []; const bold = [];
  const push = (r, b) => { rows.push(r); if (b) bold.push(rows.length - 1); };
  push(['SALES SUMMARY'], true);
  push([`${brands.slice(0, 6).join(', ') || 'All brands'}${brands.length > 6 ? ' +' + (brands.length - 6) : ''} · ${locs.length === 1 ? locs[0] : 'Okhla + Gurgaon'} · ${dates[0] || ''} to ${dates[dates.length - 1] || ''}`]);
  push(['Net of returns · Taxable = value without GST · every figure below is calculated from the "Master Sale sheet" tab']);
  push([]);
  push(['KEY FIGURES'], true);
  push(['Taxable sales (net)', totalTaxable]);
  push(['GST', sum(lines, 'gst')]);
  push(['Total incl. GST (net)', sum(lines, 'total_amount')]);
  push(['Quantity (net)', sum(lines, 'qty')]);
  push(['Sales invoices', bills(lines)]);
  push(['Return / credit-note lines', retLines.length]);
  push(['Returns value (taxable)', sum(retLines, 'amount')]);
  push([]);
  push(['BY WAREHOUSE'], true);
  push(['Warehouse', 'Invoices', 'Qty', 'Taxable', 'GST', 'Total incl. GST', '% of taxable'], true);
  for (const g of group((l) => l.location)) push([g.k, bills(g.ls), sum(g.ls, 'qty'), g.taxable, sum(g.ls, 'gst'), sum(g.ls, 'total_amount'), pct(g.taxable)]);
  push([]);
  if (brands.length > 1) {
    push(['BY BRAND'], true);
    push(['Brand', 'Invoices', 'Qty', 'Taxable', 'GST', 'Total incl. GST', '% of taxable'], true);
    for (const g of group((l) => brandNames[l.brand_id] || l.item_group)) push([g.k, bills(g.ls), sum(g.ls, 'qty'), g.taxable, sum(g.ls, 'gst'), sum(g.ls, 'total_amount'), pct(g.taxable)]);
    push([]);
  }
  push(['BY PRODUCT'], true);
  push(['Item', 'Item code', 'Qty', 'Taxable', 'Total incl. GST', '% of taxable'], true);
  for (const g of group((l) => l.item_name)) push([g.k, g.ls[0].item_code || '', sum(g.ls, 'qty'), g.taxable, sum(g.ls, 'total_amount'), pct(g.taxable)]);
  push([]);
  const outlets = group((l) => l.party_name);
  push([`BY OUTLET (top ${Math.min(40, outlets.length)} of ${outlets.length})`], true);
  push(['Outlet', 'Invoices', 'Qty', 'Taxable', 'Total incl. GST', '% of taxable'], true);
  for (const g of outlets.slice(0, 40)) push([g.k, bills(g.ls), sum(g.ls, 'qty'), g.taxable, sum(g.ls, 'total_amount'), pct(g.taxable)]);
  push([]);
  push(['BY DAY'], true);
  push(['Date', 'Invoices', 'Qty', 'Taxable', ...locs.map((x) => x + ' taxable')], true);
  const days = group((l) => String(l.document_date).slice(0, 10)).sort((a, b) => (a.k < b.k ? -1 : 1));
  for (const g of days) { dateCells.push(rows.length); push([toDateObj(g.k), bills(g.ls), sum(g.ls, 'qty'), g.taxable, ...locs.map((x) => sum(g.ls.filter((l) => l.location === x), 'amount'))]); }
  push(['Total', bills(lines), sum(lines, 'qty'), totalTaxable, ...locs.map((x) => sum(lines.filter((l) => l.location === x), 'amount'))], true);

  const ws = XLSX.utils.aoa_to_sheet(rows);
  for (const addr of Object.keys(ws)) {
    if (addr[0] === '!') continue;
    const c = ws[addr];
    if (c.t === 'n') c.z = '#,##0.##';
  }
  for (const r of dateCells) { const c = ws[XLSX.utils.encode_cell({ r, c: 0 })]; if (c && c.t === 'n') c.z = 'dd-mm-yyyy'; }
  ws['!cols'] = [{ wch: 44 }, { wch: 14 }, { wch: 14 }, { wch: 16 }, { wch: 16 }, { wch: 18 }, { wch: 14 }];
  return ws;
}
