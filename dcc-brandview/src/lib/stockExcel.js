/*
 * Stock Excel in the SAME layout as the "Master Stock Report" Google Sheet:
 * tab "Summary" (per-warehouse totals + check) and tab "Stock" (one row = one item in one warehouse:
 * Report From | Report To (As On) | Warehouse | Item Code | Item Name | Item Group / Brand | Opening | Inwards | Outwards | Closing).
 * exceljs is loaded only when someone clicks Download.
 */
const toDate = (s) => {
  const m = String(s || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])) : null;
};
const num = (v) => Number(v) || 0;
const NUMFMT = '#,##0;[Red]-#,##0';

export async function downloadStockXlsx(filename, rows, brandName, brandOf) {
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = 'DCC BrandView';
  const font = { name: 'Arial', size: 10 };
  const navy = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F3864' } };
  const list = [...rows].sort((a, b) => String(b.location).localeCompare(String(a.location)) || String(a.item_code).localeCompare(String(b.item_code)));

  /* ---- Summary ---- */
  const ws = wb.addWorksheet('Summary');
  const asOn = list.map((r) => r.as_on).filter(Boolean).sort().pop();
  const from = list.map((r) => r.period_from).filter(Boolean).sort()[0];
  ws.getColumn(1).width = 28; for (let c = 2; c <= 8; c++) ws.getColumn(c).width = 18;
  ws.getCell('A1').value = 'STOCK SUMMARY'; ws.getCell('A1').font = { ...font, size: 14, bold: true };
  ws.getCell('A2').value = `Brand: ${brandName}  |  calculated live from the "Stock" tab - nothing to type here`; ws.getCell('A2').font = { ...font, italic: true, color: { argb: 'FF666666' } };
  ws.getCell('A3').value = 'Stock as on'; ws.getCell('B3').value = { formula: 'MAX(Stock!$B$2:$B$2000)', result: toDate(asOn) };
  ws.getCell('A4').value = 'Period from'; ws.getCell('B4').value = { formula: 'MIN(Stock!$A$2:$A$2000)', result: toDate(from) };
  ws.getCell('B3').numFmt = ws.getCell('B4').numFmt = 'dd-mm-yyyy';
  ['A3', 'A4'].forEach((a) => { ws.getCell(a).font = { ...font, bold: true }; });
  ['B3', 'B4'].forEach((a) => { ws.getCell(a).font = font; ws.getCell(a).alignment = { horizontal: 'left' }; });
  const head = ['Warehouse', 'Items (SKUs)', 'Opening', 'Inwards (Received)', 'Outwards (Dispatched)', 'Closing', 'Items with negative closing', 'Check (should be 0)'];
  head.forEach((h, i) => { const c = ws.getCell(6, i + 1); c.value = h; c.font = { ...font, bold: true, color: { argb: 'FFFFFFFF' } }; c.fill = navy; c.alignment = { wrapText: true, vertical: 'middle' }; });
  ws.getRow(6).height = 32;
  const locs = ['Okhla', 'Gurgaon'].filter((l) => list.some((r) => r.location === l));
  const R = (col) => `Stock!$${col}$2:$${col}$2000`;
  locs.forEach((l, i) => {
    const r = 7 + i, rs = list.filter((x) => x.location === l);
    const sum = (k) => rs.reduce((a, x) => a + num(x[k]), 0);
    ws.getCell(r, 1).value = l;
    ws.getCell(r, 2).value = { formula: `COUNTIFS(${R('C')},A${r})`, result: rs.length };
    [['C', 'G', 'opening'], ['D', 'H', 'inwards'], ['E', 'I', 'outwards'], ['F', 'J', 'closing']].forEach(([out, src, k]) => {
      ws.getCell(`${out}${r}`).value = { formula: `SUMIFS(${R(src)},${R('C')},$A${r})`, result: sum(k) };
    });
    ws.getCell(r, 7).value = { formula: `COUNTIFS(${R('C')},A${r},${R('J')},"<0")`, result: rs.filter((x) => num(x.closing) < 0).length };
    ws.getCell(r, 8).value = { formula: `C${r}+D${r}-E${r}-F${r}`, result: sum('opening') + sum('inwards') - sum('outwards') - sum('closing') };
  });
  const tr = 7 + locs.length;
  ws.getCell(tr, 1).value = 'Total - all warehouses';
  for (let c = 2; c <= 8; c++) {
    const L = String.fromCharCode(64 + c);
    let result = 0; for (let r = 7; r < tr; r++) { const v = ws.getCell(r, c).value; result += (v && v.result) || 0; }
    ws.getCell(tr, c).value = { formula: `SUM(${L}7:${L}${tr - 1})`, result };
  }
  for (let r = 7; r <= tr; r++) for (let c = 1; c <= 8; c++) {
    const cell = ws.getCell(r, c); cell.font = { ...font, bold: r === tr };
    if (c > 1) cell.numFmt = NUMFMT;
    if (r === tr) cell.border = { top: { style: 'thin' } };
  }
  const notes = ['NOTES',
    'Closing = Opening + Inwards - Outwards. The Check column must show 0; if not, the stock data has a problem.',
    'Negative closing stock (red) means Tally shows minus stock. It is not hidden here - the accountant should correct it in Tally.',
    'Item-wise detail is in the "Stock" tab. Quantities are in pieces.'];
  notes.forEach((t, i) => { const c = ws.getCell(tr + 2 + i, 1); c.value = t; c.font = { ...font, bold: i === 0 }; });

  /* ---- Stock (same columns as the Google Sheet) ---- */
  const st = wb.addWorksheet('Stock', { views: [{ state: 'frozen', ySplit: 1 }] });
  const H = ['Report From', 'Report To (As On)', 'Warehouse', 'Item Code', 'Item Name', 'Item Group / Brand', 'Opening', 'Inwards', 'Outwards', 'Closing'];
  [13, 17, 12, 11, 50, 18, 12, 12, 12, 12].forEach((w, i) => { st.getColumn(i + 1).width = w; });
  const hr = st.addRow(H);
  hr.eachCell((c) => { c.font = { ...font, bold: true, color: { argb: 'FFFFFFFF' } }; c.fill = navy; c.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true }; });
  hr.height = 24;
  for (const r of list) {
    const row = st.addRow([toDate(r.period_from), toDate(r.as_on), r.location, r.item_code, r.item_name, brandOf(r.brand_id), num(r.opening), num(r.inwards), num(r.outwards), num(r.closing)]);
    row.eachCell((c, i) => { c.font = font; if (i <= 2) c.numFmt = 'dd-mm-yyyy'; if (i >= 7) c.numFmt = NUMFMT; });
  }
  st.autoFilter = { from: 'A1', to: `J${list.length + 1}` };

  const buf = await wb.xlsx.writeBuffer();
  const url = URL.createObjectURL(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
  const a = document.createElement('a'); a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
