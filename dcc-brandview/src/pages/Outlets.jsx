import { useState } from 'react';
import { rpc, logActivity } from '../supabase.js';
import { rs, inr, daysBetween, fmtD, cleanParty } from '../lib/format.js';
import { downloadXlsx } from '../lib/tally.js';
import { useLoad, LoadingCard, Empty, ErrorState, Icon } from '../components/ui.jsx';
import { PageHead, scopeLabel } from '../components/Parts.jsx';

const STATUS = {
  active: { label: 'Active', dot: '#4cb782' },
  slow: { label: 'Slowing', dot: '#f2c94c' },
  idle: { label: 'Not ordered', dot: '#f2994a' },
  ret: { label: 'Returns only', dot: '#eb5757' }
};

export default function Outlets({ ctx }) {
  const [tab, setTab] = useState('all');
  const [q, setQ] = useState('');
  const args = { p_from: ctx.from, p_to: ctx.to, p_location: ctx.loc, p_brand: ctx.brand };
  const { data, error, loading, reload } = useLoad(async () => {
    const rows = await rpc('rpt_outlets', args);
    return rows.map((o) => {
      const d = o.last_order ? daysBetween(o.last_order, ctx.to) : null;
      const st = d === null ? 'ret' : d <= 7 ? 'active' : d <= 14 ? 'slow' : 'idle';
      return { ...o, name: cleanParty(o.party_name), net: Number(o.net_sales), days: d, st };
    });
  }, [ctx.from, ctx.to, ctx.loc, ctx.brand]);

  const exportBtn = (
    <button className="btn btn-pri" disabled={!data || !data.length} onClick={() => {
      downloadXlsx(`${ctx.brandName} outlets ${ctx.from} to ${ctx.to}.xlsx`, 'Outlets',
        [['Outlet', 'name', 'wide'], ['Warehouse', 'location'], ['Bills', 'bills'], ['SKUs', 'skus'], ['Qty (pcs)', 'qty'], ['Net sales', 'net'], ['Last order', 'last_order'], ['Status', 'status']],
        data.map((o) => ({ ...o, qty: Number(o.qty), status: STATUS[o.st].label })));
      logActivity('export', { page: 'outlets', from: ctx.from, to: ctx.to });
    }}>{Icon.download()} Export</button>
  );
  const head = <PageHead ctx={ctx} crumb={scopeLabel(ctx)} title="Outlets">{exportBtn}</PageHead>;
  if (loading && !data) return <main className="page">{head}<LoadingCard rows={10} /></main>;
  if (error) return <main className="page">{head}<div className="card"><ErrorState message={error} onRetry={reload} /></div></main>;
  if (!data.length) return <main className="page">{head}<div className="card"><Empty /></div></main>;

  const count = (s) => data.filter((o) => o.st === s).length;
  const total = data.reduce((s, o) => s + o.net, 0);
  const top4 = [...data].sort((a, b) => b.net - a.net).slice(0, 4).reduce((s, o) => s + o.net, 0);
  const ql = q.trim().toLowerCase();
  const rows = data.filter((o) => (tab === 'all' || o.st === tab) && (!ql || o.name.toLowerCase().includes(ql)));

  return (
    <main className="page">
      {head}
      <section className="kpis">
        <div className="card kpi"><span className="lbl"><span className="live" style={{ background: '#4cb782', color: '#4cb782', width: 6, height: 6 }} />Ordered in last 7 days</span><span className="val">{count('active')}</span></div>
        <div className="card kpi"><span className="lbl"><span className="live" style={{ background: '#f2c94c', color: '#f2c94c', width: 6, height: 6 }} />Slowing · 8–14 days</span><span className="val">{count('slow')}</span></div>
        <div className="card kpi" style={{ backgroundImage: 'radial-gradient(ellipse at top left, rgba(242,153,74,0.12), transparent 65%)' }}><span className="lbl"><span className="live" style={{ background: '#f2994a', color: '#f2994a', width: 6, height: 6 }} />No order in 15+ days</span><span className="val">{count('idle')}</span></div>
        <div className="card kpi"><span className="lbl">Top 4 outlets' share</span><span className="val">{total ? (top4 / total * 100).toFixed(0) : 0}%</span></div>
      </section>
      <section className="card">
        <div className="card-h">
          <div className="chips">
            {[['all', `All ${data.length}`], ['active', 'Active'], ['slow', 'Slowing'], ['idle', 'Not ordering']].map(([k, l]) => (
              <button key={k} className={'chip' + (tab === k ? ' on' : '')} style={k === 'idle' && tab !== k ? { color: 'var(--orange)' } : null} onClick={() => setTab(k)}>{l}</button>
            ))}
          </div>
          <label className="search">{Icon.search(14)}<input placeholder="Search outlet" aria-label="Search outlet" value={q} onChange={(e) => setQ(e.target.value)} /></label>
        </div>
        <div className="tblwrap">
          <table className="tbl" style={{ minWidth: 900 }}>
            <thead><tr><th>Outlet</th><th>Warehouse</th><th className="r">Bills</th><th className="r">SKUs</th><th className="r">Qty (pcs)</th><th className="r">Net sales</th><th style={{ paddingLeft: 20 }}>Last order</th><th>Status</th></tr></thead>
            <tbody>
              {rows.map((o, i) => (
                <tr key={o.party_name + o.location} className="click" title="Open this outlet's invoices" onClick={() => ctx.openInvoices(o.party_name)} style={{ animationDelay: Math.min(i, 20) * 0.03 + 's' }}>
                  <td style={{ fontWeight: 500 }}>{o.name}</td>
                  <td className="t2">{o.location}</td>
                  <td className="r t2">{o.bills}</td>
                  <td className="r t2">{o.skus}</td>
                  <td className="r t2">{inr(o.qty)}</td>
                  <td className="r" style={{ fontWeight: 600 }}>{rs(o.net)}</td>
                  <td className="t2" style={{ paddingLeft: 20 }}>{o.last_order ? fmtD(o.last_order) : '—'}{o.days !== null && o.days > 7 ? <span className="muted"> · {o.days}d</span> : null}</td>
                  <td><span className="pill"><span className="dot live" style={{ background: STATUS[o.st].dot, color: STATUS[o.st].dot }} />{STATUS[o.st].label}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!rows.length && <Empty title="No outlets match" text="Clear the search or pick another filter." />}
      </section>
    </main>
  );
}
