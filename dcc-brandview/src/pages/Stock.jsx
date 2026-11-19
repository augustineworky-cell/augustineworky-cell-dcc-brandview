import { useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
import { supabase, logActivity } from '../supabase.js';
import { inr, fmtDY } from '../lib/format.js';
import { useLoad, LoadingCard, Empty, ErrorState, Icon, Count } from '../components/ui.jsx';

/*
 * Stock: closing stock per item and warehouse, synced from the Stock sheet (Tally stock summary).
 * Brand logins see only their own brand (row level security); admins can pick a brand.
 * Shows the latest "as on" date in the data; negative closing stock is flagged red.
 */
const COLS = 'as_on, period_from, location, item_code, item_name, brand_id, opening, inwards, outwards, closing';
const n = (v) => Number(v) || 0;

async function fetchStock(brand) {
  // latest snapshot date first, then only that day's rows
  let d = supabase.from('stock_snapshots').select('as_on').order('as_on', { ascending: false }).limit(1);
  if (brand) d = d.eq('brand_id', brand);
  const { data: top, error: e1 } = await d;
  if (e1) throw new Error(e1.message);
  if (!top.length) return { asOn: null, rows: [] };
  const asOn = top[0].as_on;
  const all = [];
  for (let start = 0; ; start += 1000) {
    let q = supabase.from('stock_snapshots').select(COLS).eq('as_on', asOn);
    if (brand) q = q.eq('brand_id', brand);
    const { data, error } = await q.order('location').order('item_name').range(start, start + 999);
    if (error) throw new Error(error.message);
    all.push(...data);
    if (data.length < 1000) break;
  }
  return { asOn, rows: all };
}

const sumBy = (rows, k) => rows.reduce((a, r) => a + n(r[k]), 0);

export default function Stock({ ctx }) {
  const [loc, setLoc] = useState(null);
  const [q, setQ] = useState('');
  const [negOnly, setNegOnly] = useState(false);
  const { data, error, loading, reload } = useLoad(() => fetchStock(ctx.brand), [ctx.brand]);

  const shown = useMemo(() => {
    if (!data) return [];
    const s = q.trim().toLowerCase();
    return data.rows.filter((r) => (!loc || r.location === loc) && (!negOnly || n(r.closing) < 0) &&
      (!s || `${r.item_name} ${r.item_code}`.toLowerCase().includes(s)));
  }, [data, loc, q, negOnly]);

  const T = useMemo(() => ({
    items: new Set(shown.map((r) => r.item_code)).size,
    opening: sumBy(shown, 'opening'), inwards: sumBy(shown, 'inwards'), outwards: sumBy(shown, 'outwards'), closing: sumBy(shown, 'closing'),
    neg: shown.filter((r) => n(r.closing) < 0).length
  }), [shown]);

  const byLoc = useMemo(() => ['Okhla', 'Gurgaon'].map((l) => {
    const rs = (data ? data.rows : []).filter((r) => r.location === l);
    return { loc: l, items: rs.length, opening: sumBy(rs, 'opening'), inwards: sumBy(rs, 'inwards'), outwards: sumBy(rs, 'outwards'), closing: sumBy(rs, 'closing'), neg: rs.filter((r) => n(r.closing) < 0).length };
  }).filter((x) => x.items), [data]);

  function download() {
    try {
      const rows = data.rows;
      const head = ['Warehouse', 'Items (SKUs)', 'Opening', 'Inwards (Received)', 'Outwards (Dispatched)', 'Closing', 'Items with negative closing'];
      const sum = [[`Stock summary - ${ctx.brandName}`], [`Stock as on ${fmtDY(data.asOn)}`], [], head];
      for (const b of byLoc) sum.push([b.loc, b.items, b.opening, b.inwards, b.outwards, b.closing, b.neg]);
      sum.push(['Total', rows.length, sumBy(rows, 'opening'), sumBy(rows, 'inwards'), sumBy(rows, 'outwards'), sumBy(rows, 'closing'), rows.filter((r) => n(r.closing) < 0).length]);
      sum.push([], ['Closing = Opening + Inwards - Outwards. Negative closing means Tally shows minus stock.']);
      const det = [['Warehouse', 'Item Code', 'Item Name', 'Opening', 'Inwards', 'Outwards', 'Closing']];
      for (const r of rows) det.push([r.location, r.item_code, r.item_name, n(r.opening), n(r.inwards), n(r.outwards), n(r.closing)]);
      const wb = XLSX.utils.book_new();
      const w1 = XLSX.utils.aoa_to_sheet(sum); w1['!cols'] = [{ wch: 22 }, { wch: 14 }, { wch: 12 }, { wch: 18 }, { wch: 20 }, { wch: 12 }, { wch: 26 }];
      const w2 = XLSX.utils.aoa_to_sheet(det); w2['!cols'] = [{ wch: 12 }, { wch: 12 }, { wch: 52 }, { wch: 11 }, { wch: 11 }, { wch: 11 }, { wch: 11 }];
      XLSX.utils.book_append_sheet(wb, w1, 'Summary');
      XLSX.utils.book_append_sheet(wb, w2, 'Item detail');
      XLSX.writeFile(wb, `${ctx.brandName} stock as on ${data.asOn}.xlsx`);
      logActivity('export', { page: 'stock' });
      ctx.notify('Stock Excel downloaded');
    } catch (e) { ctx.notify(e.message || 'Download failed', true); }
  }

  const head = (
    <header className="ph">
      <div>
        <div className="crumb">{ctx.brandName} · Okhla + Gurgaon · {data && data.asOn ? `Stock as on ${fmtDY(data.asOn)}` : 'Stock'}</div>
        <h1>Stock</h1>
      </div>
      <div className="controls">
        <div className="seg" role="group" aria-label="Warehouse">
          {[[null, 'All'], ['Okhla', 'Okhla'], ['Gurgaon', 'Gurgaon']].map(([v, l]) => <button key={l} className={loc === v ? 'on' : ''} onClick={() => setLoc(v)}>{l}</button>)}
        </div>
        <button className="btn btn-pri" disabled={!data || !data.rows.length} onClick={download}>{Icon.download()} Download Excel</button>
      </div>
    </header>
  );

  if (loading && !data) return <main className="page">{head}<LoadingCard rows={8} /></main>;
  if (error) return <main className="page">{head}<div className="card"><ErrorState message={error} onRetry={reload} /></div></main>;
  if (!data.rows.length) return <main className="page">{head}<div className="card"><Empty title="No stock yet" text="Stock syncs from the stock sheet every 30 minutes. It will appear here after the next sync." /></div></main>;

  const red = { color: '#c4314b', fontWeight: 600 };
  return (
    <main className="page">
      {head}
      <section className="kpis">
        <div className="card kpi"><span className="lbl">Closing stock</span><span className="val"><Count v={inr(T.closing)} /></span><span className="sub">pcs · {inr(T.items)} items</span></div>
        <div className="card kpi"><span className="lbl">Opening</span><span className="val"><Count v={inr(T.opening)} /></span><span className="sub">start of period</span></div>
        <div className="card kpi"><span className="lbl">Inwards</span><span className="val"><Count v={inr(T.inwards)} /></span><span className="sub">received</span></div>
        <div className="card kpi"><span className="lbl">Outwards</span><span className="val"><Count v={inr(T.outwards)} /></span><span className="sub">dispatched</span></div>
        <div className="card kpi"><span className="lbl">Negative stock</span><span className="val" style={T.neg ? red : undefined}><Count v={inr(T.neg)} /></span><span className="sub">items below zero</span></div>
      </section>

      {!loc && byLoc.length > 0 && (
        <section className="card">
          <div className="card-h"><div><h2>By warehouse</h2><span className="sub">Closing = Opening + Inwards − Outwards</span></div></div>
          <div className="tblwrap">
            <table className="tbl">
              <thead><tr><th>Warehouse</th><th className="r">Items</th><th className="r">Opening</th><th className="r">Inwards</th><th className="r">Outwards</th><th className="r">Closing</th><th className="r">Negative</th></tr></thead>
              <tbody>
                {byLoc.map((b) => (
                  <tr key={b.loc}><td style={{ fontWeight: 600 }}>{b.loc}</td><td className="r">{inr(b.items)}</td><td className="r">{inr(b.opening)}</td><td className="r">{inr(b.inwards)}</td><td className="r">{inr(b.outwards)}</td>
                    <td className="r" style={{ fontWeight: 600 }}>{inr(b.closing)}</td><td className="r" style={b.neg ? red : undefined}>{inr(b.neg)}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section className="card">
        <div className="card-h">
          <div><h2>Item detail</h2><span className="sub">{inr(shown.length)} rows · negative closing in red</span></div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <div className="seg" role="group" aria-label="Stock filter">
              <button className={!negOnly ? 'on' : ''} onClick={() => setNegOnly(false)}>All</button>
              <button className={negOnly ? 'on' : ''} onClick={() => setNegOnly(true)}>Negative only</button>
            </div>
            <input aria-label="Search items" placeholder="Search item or code" value={q} onChange={(e) => setQ(e.target.value)}
              style={{ minWidth: 220, padding: '8px 12px', border: '1px solid var(--line)', borderRadius: 10, background: 'transparent', color: 'var(--text)' }} />
          </div>
        </div>
        {!shown.length ? <Empty title="No items match" text="Change the filters or the search." /> : (
          <div className="tblwrap">
            <table className="tbl" style={{ minWidth: 760 }}>
              <thead><tr><th>Item</th><th>Warehouse</th><th className="r">Opening</th><th className="r">Inwards</th><th className="r">Outwards</th><th className="r">Closing</th></tr></thead>
              <tbody>
                {shown.map((r) => (
                  <tr key={r.location + r.item_code}>
                    <td>{r.item_name}<span className="sub" style={{ marginLeft: 6 }}>{r.item_code}</span></td>
                    <td>{r.location}</td>
                    <td className="r">{inr(r.opening)}</td><td className="r">{inr(r.inwards)}</td><td className="r">{inr(r.outwards)}</td>
                    <td className="r" style={n(r.closing) < 0 ? red : { fontWeight: 600 }}>{inr(r.closing)}</td>
                  </tr>
                ))}
                <tr style={{ background: 'var(--card-2)' }}>
                  <td style={{ fontWeight: 700 }}>TOTAL</td><td />
                  <td className="r" style={{ fontWeight: 700 }}>{inr(T.opening)}</td><td className="r" style={{ fontWeight: 700 }}>{inr(T.inwards)}</td>
                  <td className="r" style={{ fontWeight: 700 }}>{inr(T.outwards)}</td><td className="r" style={{ fontWeight: 700 }}>{inr(T.closing)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}
