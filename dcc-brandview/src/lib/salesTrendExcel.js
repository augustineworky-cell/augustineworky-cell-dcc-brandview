/*
 * Sales report Excel in the exact layout of the boss's "SALES TREND" Google Sheet.
 * Tabs (same names and order as the sheet):
 *   Master Sale sheet · Week Wise Sales Check · Location Wise · Month Wise Data Add · Location Wise add
 * Look: Arial 11, thin borders, Google-blue headers (#4285F4, white bold), gold total rows (#FFD966),
 * light-blue month headers (#C9DAF8), Indian number format, red fill for negatives,
 * green fill for brands that are in the month's Top 10 (same conditional rules as the sheet).
 * Every brand login gets the same file with only its own rows (data comes from rpt_trend + sales_lines,
 * which are already limited to the user's brand).
 */
import * as XLSX from 'xlsx';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const INR = '[>=10000000]##\\,##\\,##\\,##0.00;[>=100000]##\\,##\\,##0.00;##,##0.00';
const BLUE = 'FF4285F4', GOLD = 'FFFFD966', LIGHT = 'FFC9DAF8', RED = 'FFFF0000', GREEN = 'FF00FF00';
const LOCS = [['Gurgaon', 'HARYANA GURGAON'], ['Okhla', 'DELHI OKHLA C 34'], ['Chattarpur', 'DELHI CHATTARPUR']];
const thin = { style: 'thin', color: { argb: 'FF000000' } };
const BORDER = { top: thin, left: thin, bottom: thin, right: thin };
const r2 = (v) => Math.round((Number(v) || 0) * 100) / 100;

function cell(ws, addr, value, o = {}) {
  const c = ws.getCell(addr);
  c.value = value;
  c.font = { name: 'Arial', size: 11, bold: o.bold ?? true, color: { argb: o.white ? 'FFFFFFFF' : 'FF000000' }, italic: !!o.italic };
  c.alignment = { horizontal: o.left ? 'left' : 'center', vertical: 'middle', wrapText: !!o.wrap };
  if (o.fill) c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: o.fill } };
  if (o.num) c.numFmt = INR;
  if (o.border !== false) c.border = BORDER;
  return c;
}
const head = (ws, addr, v) => cell(ws, addr, v, { fill: BLUE, white: true, wrap: true });
const colL = (n) => { let s = ''; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; };

function redNegatives(ws, ref) {
  ws.addConditionalFormatting({ ref, rules: [{ type: 'cellIs', operator: 'lessThan', formulae: ['0'], priority: 1,
    style: { fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: RED } }, font: { color: { argb: 'FFFFFFFF' } } } }] });
}
function greenTop(ws, ref, firstCell, topRange) {
  ws.addConditionalFormatting({ ref, rules: [{ type: 'expression', formulae: [`ISNUMBER(MATCH(${firstCell},${topRange},0))`], priority: 2,
    style: { fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: GREEN } } } }] });
}

/**
 * @param rows   rpt_trend rows: { month, week, location, item_group, taxable, total }
 * @param lines  sales_lines for the Master tab (same period, same filters)
 * @param links  document_no -> receiving copy URL
 * @param opts   { month:'YYYY-MM', measure:'taxable'|'total', brandName, buildMasterSheet }
 */
export async function downloadSalesTrendXlsx(rows, lines, links, opts) {
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = 'DCC BrandView';
  const val = (r) => Number(opts.measure === 'total' ? r.total : r.taxable) || 0;
  const mk = (r) => String(r.month).slice(0, 7);
  const [Y, M] = opts.month.split('-').map(Number);
  const amountCol = opts.measure === 'total' ? 'AI' : 'Z';           // Total Amount / Amount in the Master tab

  // ---------- aggregates ----------
  const monthsAll = [...new Set(rows.map(mk))].filter((m) => m <= opts.month).sort();
  const groupsAll = [...new Set(rows.map((r) => r.item_group))].sort((a, b) => a.localeCompare(b));
  const agg = {};   // agg[month][group] = { total, w:{}, loc:{} }
  for (const r of rows) {
    const m = mk(r); if (m > opts.month) continue;
    const g = ((agg[m] = agg[m] || {})[r.item_group] = agg[m][r.item_group] || { total: 0, w: {}, loc: {} });
    const v = val(r);
    g.total += v; g.w[r.week] = (g.w[r.week] || 0) + v; g.loc[r.location] = (g.loc[r.location] || 0) + v;
  }
  const cur = agg[opts.month] || {};
  const top10 = Object.entries(cur).filter(([, d]) => Math.abs(d.total) >= 0.005).sort((a, b) => b[1].total - a[1].total).slice(0, 10).map(([g]) => g);

  // ---------- 1) Master Sale sheet ----------
  const wsM = wb.addWorksheet('Master Sale sheet', { views: [{ state: 'frozen', ySplit: 1 }] });
  const aoa = XLSX.utils.sheet_to_json(opts.buildMasterSheet(lines, links).ws, { header: 1, raw: true, defval: '' });
  aoa.forEach((r, i) => {
    const row = wsM.addRow(r);
    if (i === 0) row.eachCell((c) => { c.font = { name: 'Arial', size: 10, bold: true, color: { argb: 'FFFFFFFF' } }; c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BLUE } }; c.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }; });
  });
  wsM.getColumn(7).numFmt = 'dd-mm-yyyy';
  wsM.columns.forEach((c, i) => { c.width = [6, 18, 11, 12, 18, 25].includes(i) ? 22 : 14; });
  wsM.autoFilter = { from: 'A1', to: `${colL(aoa[0].length)}1` };
  const mSum = (y, m) => `SUMIFS('Master Sale sheet'!${amountCol}:${amountCol},'Master Sale sheet'!G:G,">="&DATE(${y},${m},1),'Master Sale sheet'!G:G,"<="&EOMONTH(DATE(${y},${m},1),0))`;

  // ---------- 2) Week Wise Sales Check ----------
  const ws1 = wb.addWorksheet('Week Wise Sales Check');
  ws1.columns = [{ width: 28 }, { width: 8 }, { width: 30 }, { width: 16 }, ...Array(6).fill({ width: 14 }), { width: 22 }, { width: 10 }];
  cell(ws1, 'A2', 'Combined');
  head(ws1, 'A4', 'Month (Format: MMM)'); head(ws1, 'B4', 'Year');
  cell(ws1, 'A5', MONTHS[M - 1]); cell(ws1, 'B5', Y);
  head(ws1, 'A7', 'Top 10 Items');
  for (let i = 0; i < 10; i++) cell(ws1, `A${8 + i}`, top10[i] || '');
  const last1 = 2 + groupsAll.length;
  cell(ws1, 'C1', 'Total');
  head(ws1, 'C2', 'List of items/\nWeek Num#'); head(ws1, 'D2', 'Total\nAmout');
  for (let w = 1; w <= 6; w++) head(ws1, `${colL(4 + w)}2`, `Week ${w}`);
  ws1.getRow(2).height = 32;
  groupsAll.forEach((g, i) => {
    const r = 3 + i, d = cur[g] || { w: {} };
    cell(ws1, `C${r}`, g);
    cell(ws1, `D${r}`, { formula: `IF($C${r}="","",SUM(E${r}:J${r}))`, result: r2(Object.values(d.w).reduce((s, v) => s + v, 0)) }, { bold: false, num: true });
    for (let w = 1; w <= 6; w++) cell(ws1, `${colL(4 + w)}${r}`, r2(d.w[w]), { bold: false, num: true });
  });
  for (let c = 4; c <= 10; c++) { const L = colL(c); cell(ws1, `${L}1`, { formula: `SUM(${L}3:${L}${Math.max(3, last1)})` }, { num: true }); }
  cell(ws1, 'K1', 'Check vs Master (0 = OK)', { bold: false, italic: true, border: false, left: true });
  cell(ws1, 'L1', { formula: `ROUND(D1-${mSum(Y, M)},2)`, result: 0 }, { bold: false, italic: true, border: false, num: true });
  redNegatives(ws1, `D3:J${Math.max(3, last1)}`);
  greenTop(ws1, `C3:C${Math.max(3, last1)}`, '$C3', '$A$8:$A$17');

  // ---------- 3) Location Wise ----------
  const ws2 = wb.addWorksheet('Location Wise ');
  ws2.columns = [{ width: 24 }, { width: 8 }, { width: 30 }, { width: 18 }, { width: 18 }, { width: 18 }, { width: 18 }, { width: 4 }, { width: 22 }, { width: 4 }, { width: 10 }];
  head(ws2, 'A2', 'Month (Format: MMM)'); head(ws2, 'B2', 'Year');
  cell(ws2, 'A3', MONTHS[M - 1]); cell(ws2, 'B3', Y);
  cell(ws2, 'C2', 'Total', { fill: GOLD });
  head(ws2, 'C3', 'List of items/\nWeek Num#'); head(ws2, 'D3', 'Total\nAmout');
  LOCS.forEach(([, label], i) => head(ws2, `${colL(5 + i)}3`, label));
  ws2.getRow(3).height = 32;
  const last2 = 3 + groupsAll.length;
  groupsAll.forEach((g, i) => {
    const r = 4 + i, d = cur[g] || { loc: {} };
    cell(ws2, `C${r}`, g, { left: true });
    cell(ws2, `D${r}`, { formula: `SUM(E${r}:G${r})`, result: r2((d.loc.Okhla || 0) + (d.loc.Gurgaon || 0)) }, { bold: false, num: true });
    LOCS.forEach(([k], j) => cell(ws2, `${colL(5 + j)}${r}`, r2(d.loc[k]), { bold: false, num: true }));
  });
  for (let c = 4; c <= 7; c++) { const L = colL(c); cell(ws2, `${L}2`, { formula: `SUM(${L}4:${L}${Math.max(4, last2)})` }, { fill: GOLD, num: true }); }
  cell(ws2, 'I2', 'Check vs Master (0 = OK)', { bold: false, italic: true, border: false, left: true });
  cell(ws2, 'K2', { formula: `ROUND(D2-${mSum(Y, M)},2)`, result: 0 }, { bold: false, italic: true, border: false, num: true });
  redNegatives(ws2, `D4:G${Math.max(4, last2)}`);
  greenTop(ws2, `C4:C${Math.max(4, last2)}`, '$C4', "'Week Wise Sales Check'!$A$8:$A$17");

  // ---------- 4) Month Wise Data Add (one block per month: list, total, weeks 1-6) ----------
  const ws3 = wb.addWorksheet('Month Wise Data Add ');
  // ---------- 5) Location Wise add (one block per month: list, total, Gurgaon, Okhla) ----------
  const ws4 = wb.addWorksheet('Location Wise add');
  monthsAll.forEach((m, bi) => {                // oldest month on the left, like the Google Sheet
    const [y, mo] = m.split('-').map(Number);
    const data = Object.entries(agg[m] || {}).sort((a, b) => b[1].total - a[1].total);
    const label = `01/${String(mo).padStart(2, '0')}/${y}`;

    // Month Wise block: 8 columns wide (A-H, then a gap)
    const c0 = 1 + bi * 9;
    const L = (k) => colL(c0 + k);
    ws3.mergeCells(`${L(0)}2:${L(7)}2`); cell(ws3, `${L(0)}2`, label, { fill: LIGHT });
    cell(ws3, `${L(0)}3`, 'Total', { fill: GOLD });
    head(ws3, `${L(0)}4`, 'List of items/\nWeek Num#'); head(ws3, `${L(1)}4`, 'Total\nAmout');
    for (let w = 1; w <= 6; w++) head(ws3, `${L(1 + w)}4`, w);
    const lastR = Math.max(5, 4 + data.length);
    data.forEach(([g, d], i) => {
      const r = 5 + i;
      cell(ws3, `${L(0)}${r}`, g, { left: true });
      cell(ws3, `${L(1)}${r}`, { formula: `SUM(${L(2)}${r}:${L(7)}${r})`, result: r2(d.total) }, { bold: false, num: true });
      for (let w = 1; w <= 6; w++) cell(ws3, `${L(1 + w)}${r}`, r2(d.w[w]), { bold: false, num: true });
    });
    for (let k = 1; k <= 7; k++) cell(ws3, `${L(k)}3`, { formula: `SUM(${L(k)}5:${L(k)}${lastR})` }, { fill: GOLD, num: true });
    redNegatives(ws3, `${L(1)}5:${L(7)}${lastR}`);
    ws3.getColumn(c0).width = 30; for (let k = 1; k <= 7; k++) ws3.getColumn(c0 + k).width = 14; ws3.getColumn(c0 + 8).width = 3;

    // Location Wise add block: 4 columns wide (B-E, then a gap)
    const d0 = 2 + bi * 5;
    const D = (k) => colL(d0 + k);
    ws4.mergeCells(`${D(0)}1:${D(3)}1`); cell(ws4, `${D(0)}1`, label, { fill: LIGHT });
    cell(ws4, `${D(0)}2`, 'Total', { fill: GOLD });
    head(ws4, `${D(0)}3`, 'List of items/\nWeek Num#'); head(ws4, `${D(1)}3`, 'Total\nAmout');
    head(ws4, `${D(2)}3`, 'HARYANA GURGAON'); head(ws4, `${D(3)}3`, 'DELHI OKHLA C 34');
    const lastL = Math.max(4, 3 + data.length);
    data.forEach(([g, d], i) => {
      const r = 4 + i;
      cell(ws4, `${D(0)}${r}`, g, { left: true });
      cell(ws4, `${D(1)}${r}`, { formula: `SUM(${D(2)}${r}:${D(3)}${r})`, result: r2(d.total) }, { bold: false, num: true });
      cell(ws4, `${D(2)}${r}`, r2(d.loc.Gurgaon), { bold: false, num: true });
      cell(ws4, `${D(3)}${r}`, r2(d.loc.Okhla), { bold: false, num: true });
    });
    for (let k = 1; k <= 3; k++) cell(ws4, `${D(k)}2`, { formula: `SUM(${D(k)}4:${D(k)}${lastL})` }, { fill: GOLD, num: true });
    redNegatives(ws4, `${D(1)}4:${D(3)}${lastL}`);
    ws4.getColumn(d0).width = 30; for (let k = 1; k <= 3; k++) ws4.getColumn(d0 + k).width = 17; ws4.getColumn(d0 + 4).width = 3;
  });
  ws3.getRow(4).height = 32; ws4.getRow(3).height = 32; ws4.getColumn(1).width = 3;

  // order like the Google Sheet
  wb.views = [{ activeTab: 1 }];
  const buf = await wb.xlsx.writeBuffer();
  if (opts.returnBuffer) return buf;           // used by tests
  const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${opts.brandName} SALES TREND ${MONTHS[M - 1]} ${Y}.xlsx`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
