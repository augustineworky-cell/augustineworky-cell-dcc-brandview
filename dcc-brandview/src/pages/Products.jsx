import { useState } from 'react';
import { rpc, logActivity } from '../supabase.js';
import { rs, inr, prevRange, pctChange, cleanItem } from '../lib/format.js';
import { downloadXlsx } from '../lib/tally.js';
import { useLoad, LoadingCard, Empty, ErrorState, Icon } from '../components/ui.jsx';
import { PageHead, scopeLabel } from '../components/Parts.jsx';

export default function Products({ ctx }) {
  const [tab, setTab] = useState('all');
  const [q, setQ] = useState('');
  const args = { p_from: ctx.from, p_to: ctx.to, p_location: ctx.loc, p_brand: ctx.brand };
  const [pf, pt] = prevRange(ctx.from, ctx.to);
  const { data, error, loading, reload } = useLoad(async () => {
    const [cur, prev] = await Promise.all([rpc('rpt_products', args), rpc('rpt_products', { ...args, p_from: pf, p_to: pt })]);
    const pm = Object.fromEntries(prev.map((p) => [p.item_code, Number(p.net_sales)]));
    return cur.map((p) => ({
      ...p, name: cleanItem(p.item_name), net: Number(p.net_sales), prev: pm[p.item_code] || 0,
      ch: pm[p.item_code] ? pctChange(Number(p.net_sales), pm[p.item_code]) : null,
      okw: (Number(p.okhla_sales) + Number(p.gurgaon_sales)) ? Number(p.okhla_sales) / (Number(p.okhla_sales) + Number(p.gurgaon_sales)) * 100 : 0
    }));
  }, [ctx.from, ctx.to, ctx.loc, ctx.brand]);

  const exportBtn = (
    <button className="btn btn-pri" disabled={!data || !data.length} onClick={() => {
      downloadXlsx(`${ctx.brandName} products ${ctx.from} to ${ctx.to}.xlsx`, 'Products',
        [['Item code', 'item_code'], ['Product', 'name', 'wide'], ['Qty (pcs)', 'qty'], ['Net sales', 'net'], ['Outlets', 'outlets'], ['Okhla', 'okhla_sales'], ['Gurgaon', 'gurgaon_sales'], ['Last month', 'prev']],
        data.map((p) => ({ ...p, qty: Number(p.qty), okhla_sales: Number(p.okhla_sales), gurgaon_sales: Number(p.gurgaon_sales) })));
      logActivity('export', { page: 'products', from: ctx.from, to: ctx.to });
    }}>{Icon.download()} Export</button>
  );
  const head = <PageHead ctx={ctx} crumb={scopeLabel(ctx)} title="Products">{exportBtn}</PageHead>;
  if (loading && !data) return <main className="page">{head}<LoadingCard rows={10} /></main>;
  if (error) return <main className="page">{head}<div className="card"><ErrorState message={error} onRetry={reload} /></div></main>;
  if (!data.length) return <main className="page">{head}<div className="card"><Empty /></div></main>;

  const withBase = data.filter((p) => p.prev >= 10000 && p.ch !== null);
  const best = data[0];
  const grow = [...withBase].sort((a, b) => b.ch - a.ch)[0];
  const drop = [...withBase].sort((a, b) => a.ch - b.ch)[0];
  const ql = q.trim().toLowerCase();
  const rows = data
    .filter((p) => tab === 'all' || (tab === 'up' ? p.ch !== null && p.ch >= 0 : tab === 'down' ? p.ch !== null && p.ch < 0 : p.ch === null))
    .filter((p) => !ql || p.name.toLowerCase().includes(ql) || p.item_code.toLowerCase().includes(ql));

  return (
    <main className="page">
      {head}
      <section className="kpis">
        <div className="card kpi"><span className="lbl">SKUs billed</span><span className="val">{data.length}</span><span className="sub">{inr(data.reduce((s, p) => s + Number(p.qty), 0))} pcs in total</span></div>
        <div className="card kpi glow"><span className="lbl">Best seller</span><span style={{ fontSize: 16, fontWeight: 600 }}>{best.name}</span><span className="sub">{rs(best.net)} · {best.outlets} outlets</span></div>
        <div className="card kpi"><span className="lbl">Fastest growing</span>{grow ? <><span style={{ fontSize: 16, fontWeight: 600 }}>{grow.name}</span><span className="sub pos" style={{ fontWeight: 600 }}>↑ {grow.ch.toFixed(0)}% vs last month</span></> : <span className="sub">Not enough history yet</span>}</div>
        <div className="card kpi"><span className="lbl">Biggest drop</span>{drop && drop.ch < 0 ? <><span style={{ fontSize: 16, fontWeight: 600 }}>{drop.name}</span><span className="sub neg" style={{ fontWeight: 600 }}>↓ {Math.abs(drop.ch).toFixed(0)}% vs last month</span></> : <span className="sub">No product is down</span>}</div>
      </section>
      <section className="card">
        <div className="card-h">
          <div className="chips">
            {[['all', `All ${data.length}`], ['up', 'Growing'], ['down', 'Dropping'], ['new', 'New this period']].map(([k, l]) => (
              <button key={k} className={'chip' + (tab === k ? ' on' : '')} onClick={() => setTab(k)}>{l}</button>
            ))}
          </div>
          <label className="search">{Icon.search(14)}<input placeholder="Search product or code" aria-label="Search product or code" value={q} onChange={(e) => setQ(e.target.value)} /></label>
        </div>
        <div className="tblwrap">
          <table className="tbl" style={{ minWidth: 940 }}>
            <thead><tr><th>#</th><th>Product</th><th className="r">Qty (pcs)</th><th className="r">Net sales</th><th className="r">Outlets</th><th style={{ paddingLeft: 24 }}>Okhla · Gurgaon</th><th className="r">vs last month</th></tr></thead>
            <tbody>
              {rows.map((p, i) => (
                <tr key={p.item_code} style={{ animationDelay: Math.min(i, 20) * 0.03 + 's' }}>
                  <td className="muted">{i + 1}</td>
                  <td><span style={{ fontWeight: 500 }}>{p.name}</span> <span className="mono muted" style={{ fontSize: 11, marginLeft: 6 }}>{p.item_code}</span></td>
                  <td className="r t2">{inr(p.qty)}</td>
                  <td className="r" style={{ fontWeight: 600 }}>{rs(p.net)}</td>
                  <td className="r t2">{p.outlets}</td>
                  <td style={{ paddingLeft: 24 }}><div className="split"><div style={{ width: p.okw + '%' }} /></div><span className="sub" style={{ fontSize: 11 }}>{p.okw.toFixed(0)}% Okhla</span></td>
                  <td className={'r ' + (p.ch === null ? 'muted' : p.ch >= 0 ? 'pos' : 'neg')} style={{ fontWeight: 600 }}>{p.ch === null ? 'New' : (p.ch >= 0 ? '+' : '') + p.ch.toFixed(0) + '%'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!rows.length && <Empty title="No products match" text="Clear the search or pick another filter." />}
      </section>
    </main>
  );
}
