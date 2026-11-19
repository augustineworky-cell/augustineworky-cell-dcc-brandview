/*
 * PO / appointment Excel in the PLUCK BIBLE layout:
 * 4 tabs (OPEN PO DELHI, CLOSE PO DELHI, OPEN PO GURGAON, CLOSE PO GURGAON), 12 columns,
 * and a blue TOTAL row after every PO (sums of total PO qty, dispatched qty and balance qty).
 * exceljs is loaded only when someone clicks Download, so it does not slow the app down.
 */
const TABS = [
  ['OPEN PO DELHI', 'Delhi', 'open'],
  ['CLOSE PO DELHI', 'Delhi', 'closed'],
  ['OPEN PO GURGAON', 'Gurgaon', 'open'],
  ['CLOSE PO GURGAON', 'Gurgaon', 'closed']
];
const HEAD = ['PARTY NAME PO NO AND DATE', 'PO EXPIRY DATE', 'TENTATIVE APPOINTMENT DATE', 'PO APPOINTMENT DATE', 'ITEM CODE', 'BRAND NAME',
  'DESCRIPTION', 'TOTAL PO ITEM QTY', 'DISPATCHED QTY', 'BALANCE QTY', 'REMARKS', 'REMARKS 2'];
const WIDTH = [52, 14, 18, 18, 11, 16, 58, 14, 14, 13, 30, 30];

/** Date-only cell: built in UTC so Excel shows exactly the same calendar day in every time zone. */
const toDate = (s) => {
  const m = String(s || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])) : null;
};
const dmy = (s) => { const d = String(s || '').slice(0, 10).split('-'); return d.length === 3 ? `${d[2]}-${d[1]}-${d[0]}` : ''; };
export const poTitle = (l) => [l.party_name, l.po_number, dmy(l.po_date)].filter(Boolean).join(' ');
const byKey = (a, b) =>
  String(a.po_expiry || '9999').localeCompare(String(b.po_expiry || '9999')) ||
  poTitle(a).localeCompare(poTitle(b)) || String(a.item_code || '').localeCompare(String(b.item_code || ''));

export async function downloadPoXlsx(filename, lines, brandName) {
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = 'DCC BrandView';
  const font = { name: 'Arial', size: 10 };

  for (const [name, loc, status] of TABS) {
    const ws = wb.addWorksheet(name, { views: [{ state: 'frozen', ySplit: 1 }] });
    const closed = status === 'closed';
    const cols = closed ? 12 : 11;
    WIDTH.slice(0, cols).forEach((w, i) => { ws.getColumn(i + 1).width = w; });
    const head = ws.addRow(HEAD.slice(0, cols));
    head.eachCell((c) => {
      c.font = { name: 'Arial', size: 10, bold: true };
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFED7D31' } };
      c.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    });
    head.height = 30;

    const rows = lines.filter((l) => l.location === loc && l.po_status === status).sort(byKey);
    let i = 0;
    while (i < rows.length) {
      let j = i; let t1 = 0; let t2 = 0; let t3 = 0;
      while (j < rows.length && rows[j].po_key === rows[i].po_key) {
        const l = rows[j];
        const r = ws.addRow([poTitle(l), toDate(l.po_expiry), toDate(l.tentative_appt), toDate(l.appt_date), l.item_code, brandName(l.brand_id),
          l.item_desc, Number(l.po_qty) || 0, Number(l.dispatched_qty) || 0, Number(l.balance_qty) || 0, l.remark1 || '', ...(closed ? [l.remark2 || ''] : [])]);
        r.eachCell({ includeEmpty: true }, (c, n) => { c.font = font; if (n >= 2 && n <= 4) c.numFmt = 'dd/mm/yyyy'; if (n >= 8 && n <= 10) c.numFmt = '#,##0'; });
        t1 += Number(l.po_qty) || 0; t2 += Number(l.dispatched_qty) || 0; t3 += Number(l.balance_qty) || 0;
        j++;
      }
      const tr = ws.addRow(['', '', '', '', '', '', 'TOTAL', t1, t2, t3, '', ...(closed ? [''] : [])]);
      tr.eachCell({ includeEmpty: true }, (c, n) => {
        c.font = { name: 'Arial', size: 10, bold: true };
        c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFCFE2F3' } };
        if (n >= 8 && n <= 10) c.numFmt = '#,##0';
        if (n === 7) c.alignment = { horizontal: 'right' };
      });
      i = j;
    }
    ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: cols } };
  }

  const buf = await wb.xlsx.writeBuffer();
  const url = URL.createObjectURL(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
  const a = document.createElement('a'); a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
