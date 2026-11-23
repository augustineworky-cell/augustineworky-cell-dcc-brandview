import { useMemo, useState } from 'react';
import { supabase, logActivity } from '../supabase.js';
import { inr, iso, daysBetween } from '../lib/format.js';
import { downloadPoXlsx, poTitle } from '../lib/poExcel.js';
import { useLoad, LoadingCard, Empty, ErrorState, Icon, Count } from '../components/ui.jsx';
import { Freshness } from '../components/SyncInfo.jsx';
import { trackDownload } from '../components/DownloadProgress.jsx';

/*
 * PO & Appointments: the PO appointment sheet, synced into the database every 10 minutes in office hours.
 * Brand logins see only their own brand's POs (row level security); admins can pick a brand.
 */
const COLS = 'brand_id, location, po_status, party_name, po_number, po_date, po_expiry, tentative_appt, appt_date, item_code, item_desc, po_qty, dispatched_qty, balance_qty, remark1, remark2, po_key';
const dmy = (s) => { const d = String(s || '').slice(0, 10).split('-'); return d.length === 3 ? `${d[2]}-${d[1]}-${d[0]}` : '—'; };

// Loads only what is on screen (status + warehouse filtered in the database) and pulls the pages in parallel.
async function fetchPo(brand, status, loc, onProgress) {
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
  let got = first.data.length;
  onProgress?.(got, total);
  const rest = await Promise.all(starts.map((s) => page(s, false).then((r) => { got += r.data?.length || 0; onProgress?.(got, total); return r; })));
  const out = [...first.data];
  for (const r of rest) { if (r.error) throw new Error(r.error.message); out.push(...r.data); }
  return out;
}

export default function Appointments({ ctx }) {
  const [status, setStatus] = useState('open');
  const [loc, setLoc] = useState(null);
  const [q, setQ] = useState('');
  const [sort, setSort] = useState('soon');
  const [openKeys, setOpenKeys] = useState(() => new Set());
  const [limit, setLimit] = useState(40);
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

  const today = iso(new Date());
  const groups = useMemo(() => {
    const m = new Map();
    for (const l of shown) { const k = l.po_key + '|' + l.location + '|' + l.po_status; if (!m.has(k)) m.set(k, { key: k, lines: [] }); m.get(k).lines.push(l); }
    const arr = [...m.values()].map((g) => {
      const f = g.lines[0];
      const qty = g.lines.reduce((a, l) => a + (Number(l.po_qty) || 0), 0);
      const disp = g.lines.reduce((a, l) => a + (Number(l.dispatched_qty) || 0), 0);
      const bal = g.lines.reduce((a, l) => a + (Number(l.balance_qty) || 0), 0);
      const exp = f.po_expiry ? String(f.po_expiry).slice(0, 10) : null;
      return { ...g, f, qty, disp, bal, exp, days: exp ? daysBetween(today, exp) : null };
    });
    const far = '9999-12-31';
    if (sort === 'soon') arr.sort((a, b) => (a.exp || far).localeCompare(b.exp || far));
    else if (sort === 'new') arr.sort((a, b) => (b.exp || '').localeCompare(a.exp || ''));
    else arr.sort((a, b) => b.bal - a.bal);
    return arr;
  }, [shown, sort, today]);

  const toggle = (k) => setOpenKeys((o) => { const n = new Set(o); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  const allOpen = groups.length > 0 && groups.slice(0, limit).every((g) => openKeys.has(g.key));
  const toggleAll = () => setOpenKeys(allOpen ? new Set() : new Set(groups.slice(0, limit).map((g) => g.key)));

  const [dlBusy, setDlBusy] = useState(false);
  async function download() {
    setDlBusy(true);
    await trackDownload('PO & Appointments', async (job) => {
      job.step('load', 'Loading every PO line (Open + Closed, Delhi + Gurgaon)');
      const full = await fetchPo(ctx.brand, null, null, (d, t) => job.progress(d, t));   // the Excel always has every tab
      job.step('build', `Building Excel · 4 tabs · ${full.length.toLocaleString('en-IN')} lines`); await job.paint();
      await downloadPoXlsx(`${ctx.brandName} PO appointments.xlsx`, full, brandName);
      job.step('save', 'Saving file'); await job.paint();
      logActivity('export', { page: 'po-appointments' });
      return `${new Set(full.map((r) => r.po_key)).size.toLocaleString('en-IN')} POs · ${full.length.toLocaleString('en-IN')} lines`;
    });
    setDlBusy(false);
  }

  const head = (
    <header className="ph">
      <div>
        <div className="crumb">{ctx.brandName} · Delhi + Gurgaon · PO appointments</div>
        <h1>PO &amp; Appointments</h1>
        <Freshness source="po" />
      </div>
      <div className="controls">
        <div className="seg" role="group" aria-label="PO status">
          {[['open', 'Open'], ['closed', 'Closed'], [null, 'All']].map(([v, l]) => <button key={l} className={status === v ? 'on' : ''} onClick={() => setStatus(v)}>{l}</button>)}
        </div>
        <div className="seg" role="group" aria-label="Warehouse">
          {[[null, 'All'], ['Delhi', 'Delhi'], ['Gurgaon', 'Gurgaon']].map(([v, l]) => <button key={l} className={loc === v ? 'on' : ''} onClick={() => setLoc(v)}>{l}</button>)}
        </div>
        <button className="btn btn-pri" disabled={dlBusy} onClick={download}>{dlBusy ? <span className="spinner" /> : Icon.download()} {dlBusy ? 'Preparing…' : 'Download Excel'}</button>
      </div>
    </header>
  );

  if (loading && !data) return <main className="page">{head}<LoadingCard rows={8} /></main>;
  if (error) return <main className="page">{head}<div className="card"><ErrorState message={error} onRetry={reload} /></div></main>;
  if (!data.length) return <main className="page">{head}<div className="card"><Empty title="No POs here" text="Nothing for these filters. PO data syncs from the appointment sheet every 10 minutes in office hours." /></div></main>;

  const expTag = (g) => {
    if (g.days == null) return <span className="tag">No expiry date</span>;
    if (g.f.po_status === 'closed') return <span className="tag">Expiry {dmy(g.exp)}</span>;
    if (g.days < 0) return <span className="tag red">Expired {Math.abs(g.days)}d ago · {dmy(g.exp)}</span>;
    if (g.days <= 3) return <span className="tag red">Expires in {g.days}d · {dmy(g.exp)}</span>;
    if (g.days <= 7) return <span className="tag amber">Expires in {g.days}d · {dmy(g.exp)}</span>;
    return <span className="tag">Expires {dmy(g.exp)} · {g.days}d left</span>;
  };
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
          <div><h2>Purchase orders</h2><span className="sub">Tap a PO to open its items · the Excel has all four tabs (Open/Close, Delhi/Gurgaon)</span></div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <div className="seg" role="group" aria-label="Sort POs">
              {[['soon', 'Expiring soon'], ['new', 'Newest expiry'], ['bal', 'Biggest balance']].map(([v, l]) => <button key={v} className={sort === v ? 'on' : ''} onClick={() => setSort(v)}>{l}</button>)}
            </div>
            <button className="btn" onClick={toggleAll}>{allOpen ? 'Collapse all' : 'Expand all'}</button>
            <input aria-label="Search POs" placeholder="Search party, PO no, item or remark" value={q} onChange={(e) => setQ(e.target.value)}
              style={{ minWidth: 240, padding: '8px 12px', border: '1px solid var(--line)', borderRadius: 10, background: 'transparent', color: 'var(--text)' }} />
          </div>
        </div>
        {!groups.length ? <Empty title="No POs match" text="Change the filters or the search." /> : (
          <div className="polist">
            {groups.slice(0, limit).map((g, gi) => {
              const open = openKeys.has(g.key);
              const pct = g.qty ? Math.min(100, g.disp / g.qty * 100) : 0;
              return (
                <article key={g.key} className={'pocard' + (open ? ' open' : '')} style={{ animationDelay: Math.min(gi, 12) * 30 + 'ms' }}>
                  <button className="pohead" aria-expanded={open} onClick={() => toggle(g.key)}>
                    <div className="po-id">
                      <div className="po-title">{g.f.party_name || '—'}</div>
                      <div className="po-sub">PO {g.f.po_number || '—'} · {dmy(g.f.po_date)}</div>
                      <div className="po-tags">
                        <span className="tag">{g.f.location}</span>
                        {g.f.po_status === 'closed' && <span className="tag">Closed</span>}
                        {expTag(g)}
                        {(g.f.appt_date || g.f.tentative_appt) && <span className="tag accent">Appointment {dmy(g.f.appt_date || g.f.tentative_appt)}</span>}
                        {g.f.remark1 && <span className="tag note" title={g.f.remark1}>Remark</span>}
                      </div>
                    </div>
                    <div className="po-nums">
                      <div><span className="lbl">PO qty</span><b>{inr(g.qty)}</b></div>
                      <div><span className="lbl">Dispatched</span><b>{inr(g.disp)}</b></div>
                      <div><span className="lbl">Balance</span><b className={g.bal > 0 ? 'bal' : ''}>{inr(g.bal)}</b></div>
                    </div>
                    <div className="po-prog">
                      <div className="bar"><i style={{ width: pct + '%' }} /></div>
                      <span className="sub">{pct.toFixed(0)}% dispatched · {g.lines.length} item{g.lines.length > 1 ? 's' : ''}</span>
                    </div>
                    <span className="chev" aria-hidden="true" />
                  </button>
                  <div className="pobody"><div>
                    <div className="tblwrap" style={{ padding: '0 16px 14px' }}>
                      <table className="tbl" style={{ minWidth: 640 }}>
                        <thead><tr><th>Item</th><th className="r">PO qty</th><th className="r">Dispatched</th><th className="r">Balance</th><th>Remarks</th></tr></thead>
                        <tbody>
                          {g.lines.map((l, i) => (
                            <tr key={l.item_code + i}>
                              <td>{l.item_desc}<span className="sub" style={{ marginLeft: 6 }}>{l.item_code}</span></td>
                              <td className="r">{inr(l.po_qty)}</td><td className="r">{inr(l.dispatched_qty)}</td>
                              <td className="r" style={{ fontWeight: 600 }}>{inr(l.balance_qty)}</td>
                              <td className="t2">{[l.remark1, l.remark2].filter(Boolean).join(' · ')}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div></div>
                </article>
              );
            })}
          </div>
        )}
        {groups.length > limit && (
          <div style={{ padding: '14px 4px 4px', display: 'flex', gap: 12, alignItems: 'center' }}>
            <button className="btn" onClick={() => setLimit(limit + 40)}>Show 40 more</button>
            <span className="sub">Showing {limit} of {groups.length} POs. Use search or download the Excel for everything.</span>
          </div>
        )}
      </section>
    </main>
  );
}
