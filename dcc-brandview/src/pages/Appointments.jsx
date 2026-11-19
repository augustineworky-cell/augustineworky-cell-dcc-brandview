import { Fragment, useMemo, useState } from 'react';
import { supabase, logActivity } from '../supabase.js';
import { inr } from '../lib/format.js';
import { downloadPoXlsx, poTitle } from '../lib/poExcel.js';
import { useLoad, LoadingCard, Empty, ErrorState, Icon, Count } from '../components/ui.jsx';

/*
 * PO & Appointments: the PO appointment sheet, synced into the database every 30 minutes.
 * Brand logins see only their own brand's POs (row level security); admins can pick a brand.
 */
const COLS = 'brand_id, location, po_status, party_name, po_number, po_date, po_expiry, tentative_appt, appt_date, item_code, item_desc, po_qty, dispatched_qty, balance_qty, remark1, remark2, po_key';
const dmy = (s) => { const d = String(s || '').slice(0, 10).split('-'); return d.length === 3 ? `${d[2]}-${d[1]}-${d[0]}` : '—'; };

// Loads only what is on screen (status + warehouse filtered in the database) and pulls the pages in parallel.
async function fetchPo(brand, status, loc) {
  const page = (start, withCount) => {
    let q = supabase.from('po_lines').select(COLS, withCount ? { count: 'exact' } : undefined);
    if (brand) q = q.eq('brand_id', brand);
    if (status) q = q.eq('po_status', status);
    if (loc) q = q.eq('location', loc);
    return q.order('po_expiry', { ascending: false }).order('po_key').order('item_code').range(start, start + 999);
  };
  const first = await page(0, true);
  if (first.error) throw new Error(first.error.message);
  const total = first.count || first.data.length;
  if (total <= 1000) return first.data;
  const starts = [];
  for (let s = 1000; s < total; s += 1000) starts.push(s);
  const rest = await Promise.all(starts.map((s) => page(s, false)));
  const out = [...first.data];
  for (const r of rest) { if (r.error) throw new Error(r.error.message); out.push(...r.data); }
  return out;
}

export default function Appointments({ ctx }) {
  const [status, setStatus] = useState('open');
  const [loc, setLoc] = useState(null);
  const [q, setQ] = useState('');
  const { data, error, loading, reload } = useLoad(() => fetchPo(ctx.brand, status, loc), [ctx.brand, status, loc]);

  const names = useMemo(() => Object.fromEntries((ctx.brands || []).map((b) => [b.id, b.name])), [ctx.brands]);
  const brandName = (id) => names[id] || ctx.brandName;

  const shown = useMemo(() => {
    if (!data) return [];
    const s = q.trim().toLowerCase();
    return data.filter((l) => (!status || l.po_status === status) && (!loc || l.location === loc) &&
      (!s || `${poTitle(l)} ${l.item_code} ${l.item_desc} ${l.remark1 || ''}`.toLowerCase().includes(s)));
  }, [data, status, loc, q]);

  const T = useMemo(() => {
    const pos = new Set(shown.map((l) => l.po_key));
    const sum = (k) => shown.reduce((a, l) => a + (Number(l[k]) || 0), 0);
    return { pos: pos.size, lines: shown.length, qty: sum('po_qty'), disp: sum('dispatched_qty'), bal: sum('balance_qty') };
  }, [shown]);

  const groups = useMemo(() => {
    const m = new Map();
    for (const l of shown) { if (!m.has(l.po_key)) m.set(l.po_key, []); m.get(l.po_key).push(l); }
    return [...m.values()];
  }, [shown]);

  async function download() {
    try {
      ctx.notify('Preparing the full PO Excel…');
      const full = await fetchPo(ctx.brand, null, null);   // the Excel always has every tab
      await downloadPoXlsx(`${ctx.brandName} PO appointments.xlsx`, full, brandName);
      logActivity('export', { page: 'po-appointments' });
      ctx.notify('PO Excel downloaded');
    } catch (e) { ctx.notify(e.message || 'Download failed', true); }
  }

  const head = (
    <header className="ph">
      <div>
        <div className="crumb">{ctx.brandName} · Delhi + Gurgaon · PO appointments</div>
        <h1>PO &amp; Appointments</h1>
      </div>
      <div className="controls">
        <div className="seg" role="group" aria-label="PO status">
          {[['open', 'Open'], ['closed', 'Closed'], [null, 'All']].map(([v, l]) => <button key={l} className={status === v ? 'on' : ''} onClick={() => setStatus(v)}>{l}</button>)}
        </div>
        <div className="seg" role="group" aria-label="Warehouse">
          {[[null, 'All'], ['Delhi', 'Delhi'], ['Gurgaon', 'Gurgaon']].map(([v, l]) => <button key={l} className={loc === v ? 'on' : ''} onClick={() => setLoc(v)}>{l}</button>)}
        </div>
        <button className="btn btn-pri" onClick={download}>{Icon.download()} Download Excel</button>
      </div>
    </header>
  );

  if (loading && !data) return <main className="page">{head}<LoadingCard rows={8} /></main>;
  if (error) return <main className="page">{head}<div className="card"><ErrorState message={error} onRetry={reload} /></div></main>;
  if (!data.length) return <main className="page">{head}<div className="card"><Empty title="No POs here" text="Nothing for these filters. PO data syncs from the appointment sheet every 30 minutes." /></div></main>;

  const LIMIT = 60;
  return (
    <main className="page">
      {head}
      <section className="kpis">
        <div className="card kpi"><span className="lbl">POs</span><span className="val"><Count v={inr(T.pos)} /></span><span className="sub">{inr(T.lines)} item lines</span></div>
        <div className="card kpi"><span className="lbl">Total PO qty</span><span className="val"><Count v={inr(T.qty)} /></span><span className="sub">pcs ordered</span></div>
        <div className="card kpi"><span className="lbl">Dispatched</span><span className="val"><Count v={inr(T.disp)} /></span><span className="sub">{T.qty ? (T.disp / T.qty * 100).toFixed(1) : 0}% of PO qty</span></div>
        <div className="card kpi"><span className="lbl">Balance</span><span className="val"><Count v={inr(T.bal)} /></span><span className="sub">still to dispatch</span></div>
      </section>
      <section className="card">
        <div className="card-h">
          <div><h2>PO lines</h2><span className="sub">Newest expiry first · the Excel has all four tabs (Open/Close, Delhi/Gurgaon)</span></div>
          <input aria-label="Search POs" placeholder="Search party, PO no, item or remark" value={q} onChange={(e) => setQ(e.target.value)}
            style={{ minWidth: 240, padding: '8px 12px', border: '1px solid var(--line)', borderRadius: 10, background: 'transparent', color: 'var(--text)' }} />
        </div>
        {!groups.length ? <Empty title="No POs match" text="Change the filters or the search." /> : (
          <div className="tblwrap">
            <table className="tbl" style={{ minWidth: 980 }}>
              <thead><tr><th>PO</th><th>Expiry</th><th>Appointment</th><th>Item</th><th className="r">PO qty</th><th className="r">Dispatched</th><th className="r">Balance</th><th>Remarks</th></tr></thead>
              <tbody>
                {groups.slice(0, LIMIT).map((g) => (
                  <Fragment key={g[0].po_key + g[0].location + g[0].po_status}>
                    {g.map((l, i) => (
                      <tr key={l.po_key + l.item_code + i}>
                        <td style={{ fontWeight: i ? 400 : 600 }}>{i ? '' : poTitle(l)}{!i && <div className="sub" style={{ fontWeight: 400 }}>{l.location} · {l.po_status}</div>}</td>
                        <td>{i ? '' : dmy(l.po_expiry)}</td>
                        <td>{i ? '' : dmy(l.appt_date || l.tentative_appt)}</td>
                        <td>{l.item_desc}<span className="sub" style={{ marginLeft: 6 }}>{l.item_code}</span></td>
                        <td className="r">{inr(l.po_qty)}</td><td className="r">{inr(l.dispatched_qty)}</td>
                        <td className="r" style={{ fontWeight: 600 }}>{inr(l.balance_qty)}</td>
                        <td className="t2">{i ? '' : (l.remark1 || '')}</td>
                      </tr>
                    ))}
                    <tr style={{ background: 'var(--card-2)' }}>
                      <td colSpan={4} className="r" style={{ fontWeight: 700 }}>TOTAL</td>
                      <td className="r" style={{ fontWeight: 700 }}>{inr(g.reduce((a, l) => a + (Number(l.po_qty) || 0), 0))}</td>
                      <td className="r" style={{ fontWeight: 700 }}>{inr(g.reduce((a, l) => a + (Number(l.dispatched_qty) || 0), 0))}</td>
                      <td className="r" style={{ fontWeight: 700 }}>{inr(g.reduce((a, l) => a + (Number(l.balance_qty) || 0), 0))}</td><td />
                    </tr>
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {groups.length > LIMIT && <div className="sub" style={{ padding: '12px 4px' }}>Showing the first {LIMIT} of {groups.length} POs. Use search or download the Excel for everything.</div>}
      </section>
    </main>
  );
}
