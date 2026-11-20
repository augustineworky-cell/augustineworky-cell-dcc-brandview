/*
 * PO / appointment Excel in the PLUCK BIBLE layout:
 * 4 tabs (OPEN PO DELHI, CLOSE PO DELHI, OPEN PO GURGAON, CLOSE PO GURGAON), 12 columns,
 * and a blue TOTAL row after every PO (sums of total PO qty, dispatched qty and balance qty).
 * exceljs is loaded only when someone clicks Download, so it does not slow the app down.
 */
// same tab names and order as the PO DETAILS AND APPOINTMENT HOT DATA Google Sheet
const TABS = [
  ['OPEN PO DELHI', 'Delhi', 'open', [53.6, 11.3, 13.1, 12.9, 11.7, 14.4, 60.1, 9.3, 9, 13.9, 37.1]],
  ['OPEN PO GURGAON', 'Gurgaon', 'open', [62, 10.9, 10.1, 12.3, 9.7, 13, 62.7, 9, 13, 13.7, 22]],
  ['CLOSE PO DELHI from 2026', 'Delhi', 'closed', [59, 14.9, 9.3, 13.7, 14.4, 13.6, 47.9, 12.9, 12.3, 13.4, 57.4, 39.1]],
  ['CLOSE PO GURGAON from 2026', 'Gurgaon', 'closed', [56.4, 15.3, 14.4, 12.9, 12.7, 17, 61, 18.1, 14.4, 15.6, 45.4, 21.1]]
];
const HEAD = ['PARTY NAME PO NO AND DATE', 'PO EXPIRY DATE', 'TENTATIVE APPOINTMENT DATE', 'PO APPOINTMENT DATE', 'ITEM CODE', 'BRAND NAME',
  'DESCRIPTION', ' TOTAL PO ITEM QTY', 'DISPATCHED QTY', 'BALANCE QTY', 'REMARKS', 'REMARKS'];

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
  const font = { name: 'Calibri', size: 10 };
  const thin = { style: 'thin', color: { argb: 'FF000000' } };
  const box = { top: thin, left: thin, bottom: thin, right: thin };
  const mid = { vertical: 'middle', horizontal: 'center' };
  const DATEFMT = 'dd-mm-yyyy';

  for (const [name, loc, status, width] of TABS) {
    const ws = wb.addWorksheet(name, { views: [{ state: 'frozen', ySplit: 1 }] });
    const closed = status === 'closed';
    const cols = closed ? 12 : 11;
    width.slice(0, cols).forEach((w, i) => { ws.getColumn(i + 1).width = w; });
    const head = ws.addRow(HEAD.slice(0, cols));
    head.eachCell((c) => {
      c.font = { name: 'Calibri', size: 10, bold: true, color: { argb: 'FF000000' } };
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFED7D31' } };
      c.alignment = { ...mid, wrapText: true };
      c.border = box;
    });
    head.height = 41.25;

    const rows = lines.filter((l) => l.location === loc && l.po_status === status).sort(byKey);
    let i = 0;
    while (i < rows.length) {
      let j = i; let t1 = 0; let t2 = 0; let t3 = 0;
      const first = ws.rowCount + 1;
      while (j < rows.length && rows[j].po_key === rows[i].po_key) {
        const l = rows[j];
        const po = Number(l.po_qty) || 0, di = Number(l.dispatched_qty) || 0;
        const r = ws.addRow([poTitle(l), toDate(l.po_expiry), toDate(l.tentative_appt), toDate(l.appt_date), l.item_code, brandName(l.brand_id),
          l.item_desc, po, l.dispatched_qty === null || l.dispatched_qty === undefined || di === 0 ? null : di, null, l.remark1 || '', ...(closed ? [l.remark2 || ''] : [])]);
        r.getCell(10).value = { formula: `H${r.number}-I${r.number}`, result: po - di };
        r.eachCell({ includeEmpty: true }, (c, n) => {
          c.font = { ...font, bold: n === 1 || n === 10 }; c.alignment = mid; c.border = box;
          if (n >= 2 && n <= 4) c.numFmt = DATEFMT;
        });
        t1 += po; t2 += di; t3 += po - di;
        j++;
      }
      const last = ws.rowCount;
      const tr = ws.addRow(['', '', '', '', '', '', 'TOTAL', null, null, null, '', ...(closed ? [''] : [])]);
      tr.getCell(8).value = { formula: `SUM(H${first}:H${last})`, result: t1 };
      tr.getCell(9).value = { formula: `SUM(I${first}:I${last})`, result: t2 };
      tr.getCell(10).value = { formula: `SUM(J${first}:J${last})`, result: t3 };
      tr.eachCell({ includeEmpty: true }, (c, n) => {
        c.font = { ...font, bold: true }; c.alignment = mid; c.border = box;
        c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: n >= 8 && n <= 10 ? 'FF9CC2E5' : 'FF9FC5E8' } };
      });
      tr.height = 28.5;
      i = j;
    }
  }

  const buf = await wb.xlsx.writeBuffer();
  const url = URL.createObjectURL(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
  const a = document.createElement('a'); a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
