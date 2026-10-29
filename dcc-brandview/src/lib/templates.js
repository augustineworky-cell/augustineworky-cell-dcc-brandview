import * as XLSX from 'xlsx';
import { iso } from './format.js';

/* ---------- Sales upload format ---------- */
export const SALES_COLUMNS = [
  'Location Name', 'Trans Type', 'Document No', 'Document Date', 'Party Name', 'Customer Code', 'Customer Group Desc',
  'Item Group Desc', 'Item Code', 'Item Name', 'Quantity', 'UOM', 'Rate', 'Discount %', 'Amount', 'GST %', 'GST', 'Total Amount'
];

function sheetFrom(rows, widths) {
  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws['!cols'] = widths.map((w) => ({ wch: w }));
  return ws;
}

/** Blank sales format with two example rows and a "How to fill" sheet. */
export function downloadSalesTemplate(groups = []) {
  const wb = XLSX.utils.book_new();
  const data = [
    SALES_COLUMNS,
    ['Okhla', 'SALES', 'DOC/26-27/9999', '27-10-2026', 'Example Outlet Pvt Ltd 12345', '12345', 'RETAIL', 'Baskin Robbins', 'D3884', 'Bavarian chocolate cone 110 ml D3884', 24, 'PCS', 58.29, 0, 1398.96, 5, 69.95, 1468.91],
    ['Gurgaon', 'SR', 'SR/HR/26-27/999', '27-10-2026', 'Example Outlet Pvt Ltd 12345', '12345', 'RETAIL', 'Baskin Robbins', 'D3884', 'Bavarian chocolate cone 110 ml D3884', -2, 'PCS', 58.29, 0, -116.58, 5, -5.83, -122.41]
  ];
  XLSX.utils.book_append_sheet(wb, sheetFrom(data, [14, 12, 18, 14, 34, 14, 18, 26, 12, 40, 10, 8, 10, 11, 12, 8, 10, 13]), 'Sales data');
  const help = [
    ['How to fill the BrandView sales format'],
    [],
    ['1', 'Keep the first row (column names) exactly as it is. Delete the 2 example rows before uploading.'],
    ['2', 'One row = one item on one bill. A bill with 10 items has 10 rows with the same Document No.'],
    ['3', 'Location Name: write Okhla or Gurgaon.'],
    ['4', 'Trans Type: SALES for a sale, SR for a return / credit note. Returns have minus Quantity and minus amounts.'],
    ['5', 'Document Date: DD-MM-YYYY (e.g. 27-10-2026) or an Excel date.'],
    ['6', 'Item Group Desc: the Tally item group = brand name, exactly as in Tally (list below).'],
    ['7', 'Amount = taxable value before GST. GST = tax amount. Total Amount = Amount + GST.'],
    ['8', 'Rows for "DCC Supply Chain" (internal transfers) are removed automatically. Duplicate rows are skipped, so uploading the same day twice is safe.'],
    ['9', 'You can also upload the Tally "New Sales Report" export directly - it is read the same way.'],
    [],
    ['Tally item groups BrandView knows'],
    ...groups.map((g) => ['', g])
  ];
  XLSX.utils.book_append_sheet(wb, sheetFrom(help, [6, 110]), 'How to fill');
  XLSX.writeFile(wb, 'BrandView sales upload format.xlsx');
}

/* ---------- Receiving copy (stamped invoice PDF) links ---------- */
export const RECEIVING_COLUMNS = ['Invoice No', 'Location', 'Receiving PDF link', 'Received date', 'Remarks'];

export function downloadReceivingTemplate() {
  const wb = XLSX.utils.book_new();
  const data = [
    RECEIVING_COLUMNS,
    ['DOC/26-27/9999', 'Okhla', 'https://drive.google.com/file/d/XXXXXXXX/view', '28-10-2026', 'Example – delete this row'],
    ['HR/26-27/9999', 'Gurgaon', 'https://drive.google.com/file/d/YYYYYYYY/view', '', '']
  ];
  XLSX.utils.book_append_sheet(wb, sheetFrom(data, [18, 10, 60, 14, 30]), 'Receiving links');
  const help = [
    ['How to fill the receiving-copy format'],
    [],
    ['1', 'One row per invoice. Invoice No must match the Tally bill number exactly (e.g. DOC/26-27/3535, HR/26-27/2804).'],
    ['2', 'Receiving PDF link: copy it from the FMS / Receiving-with-Stamp sheet. Pasting cells that already contain a hyperlink also works.'],
    ['3', 'In Google Drive the PDF must be shared as "Anyone with the link – Viewer", otherwise brands cannot open it.'],
    ['4', 'Uploading the same invoice again replaces its old link. Rows without a link are skipped.'],
    ['5', 'Brands only see the receiving copy of bills that contain only their own brand.']
  ];
  XLSX.utils.book_append_sheet(wb, sheetFrom(help, [6, 110]), 'How to fill');
  XLSX.writeFile(wb, 'BrandView receiving links format.xlsx');
}

const txt = (v) => (v === null || v === undefined ? '' : String(v).replace(/\s+/g, ' ').trim());
function toIsoDate(v) {
  if (typeof v === 'number' && v > 20000 && v < 80000) {
    const d = new Date(Date.UTC(1899, 11, 30) + Math.floor(v + 1e-6) * 86400000);
    return iso(new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  }
  const m = txt(v).match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/);
  if (m) { const y = m[3].length === 2 ? 2000 + +m[3] : +m[3]; return iso(new Date(y, +m[2] - 1, +m[1])); }
  return null;
}

const normInv = (v) => txt(v).toUpperCase().replace(/\s+/g, '');
const locFromInv = (inv) => (/^DOC\//.test(inv) ? 'Okhla' : /^HR\//.test(inv) ? 'Gurgaon' : null);

function findHeader(ws) {
  const range = XLSX.utils.decode_range(ws['!ref']);
  const cell = (r, c) => ws[XLSX.utils.encode_cell({ r, c })];
  for (let r = range.s.r; r <= Math.min(range.e.r, range.s.r + 30); r++) {
    const h = {};
    for (let c = range.s.c; c <= Math.min(range.e.c, 120); c++) {
      const x = cell(r, c); if (!x) continue;
      const t = txt(x.v).toLowerCase();
      if (h.inv === undefined && /^(invoice|bill|document)\s*(no|number|#)?\.?$/.test(t)) h.inv = c;
      if (h.link === undefined && (/photograph of the receiving/.test(t) || (/(link|url|pdf)/.test(t) && !/date/.test(t)))) {
        h.link = c; if (/photograph/.test(t)) h.fms = true;
      }
      if (h.loc === undefined && /^location/.test(t)) h.loc = c;
      if (h.date === undefined && /date/.test(t)) h.date = c;
      if (h.rem === undefined && /^remark/.test(t)) h.rem = c;
    }
    if (h.inv !== undefined && h.link !== undefined) {
      if (h.fms && h.date === undefined && h.link > 0) h.date = h.link - 1;   // FMS: "Actual" receiving time sits just left of the photo link
      return { r, h, range, cell };
    }
  }
  return null;
}

/** Reads the FMS "Order to Despatch" export (Okhla / Gurgaon) or our receiving-links format. */
export async function parseReceivingFile(file) {
  const buf = await file.arrayBuffer();
  let wb = XLSX.read(buf, { type: 'array', sheets: 0 });
  let found = wb.SheetNames.length && wb.Sheets[wb.SheetNames[0]]?.['!ref'] ? findHeader(wb.Sheets[wb.SheetNames[0]]) : null;
  if (!found) {
    wb = XLSX.read(buf, { type: 'array' });
    for (const n of wb.SheetNames) { const ws = wb.Sheets[n]; if (ws?.['!ref'] && (found = findHeader(ws))) break; }
  }
  if (!found) throw new Error(`"${file.name}" needs an "Invoice Number" column and a "Photograph of the receiving invoice copy" (or "Receiving PDF link") column. Upload the FMS sheet or the format from this page.`);
  const { r: head, h, range, cell } = found;

  const out = new Map();
  const stats = { file: file.name, read: 0, noLink: 0, badLink: 0, fms: !!h.fms };
  for (let r = head + 1; r <= range.e.r; r++) {
    const ic = cell(r, h.inv);
    const inv = ic ? normInv(ic.v) : '';
    if (!inv || !/\d/.test(inv)) continue;
    stats.read++;
    const lc = cell(r, h.link);
    const url = lc ? txt((lc.l && lc.l.Target) || lc.v) : '';
    if (!url) { stats.noLink++; continue; }
    if (!/^https?:\/\//i.test(url)) { stats.badLink++; continue; }
    const locTxt = h.loc !== undefined ? txt(cell(r, h.loc)?.v) : '';
    const dc = h.date !== undefined ? cell(r, h.date) : null;
    out.set(inv, {
      document_no: inv,
      location: /okhla|delhi/i.test(locTxt) ? 'Okhla' : /gurgaon|gurugram|haryana/i.test(locTxt) ? 'Gurgaon' : locFromInv(inv),
      file_url: url,
      received_on: dc ? toIsoDate(dc.v) : null,
      remarks: h.rem !== undefined ? txt(cell(r, h.rem)?.v) || null : null
    });
  }
  return { rows: [...out.values()], stats };
}
