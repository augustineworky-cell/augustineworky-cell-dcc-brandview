import { rpc } from '../supabase.js';
import { rs, inr, inWords, prevRange, presetRange, pctChange, daysBetween, cleanItem, cleanParty, fmtD } from '../lib/format.js';
import { useLoad, Skel, LoadingCard, Empty, ErrorState } from '../components/ui.jsx';
import { PageHead, DailyChart, Change, scopeLabel } from '../components/Parts.jsx';

export default function Overview({ ctx }) {
  const args = { p_from: ctx.from, p_to: ctx.to, p_location: ctx.loc, p_brand: ctx.brand };
  const [pf, pt] = prevRange(ctx.from, ctx.to);
  const { data, error, loading, reload } = useLoad(async () => {
    const [cur, prev, daily, products, outlets, invoices] = await Promise.all([
      rpc('rpt_summary', args),
      rpc('rpt_summary', { ...args, p_from: pf, p_to: pt }),
      rpc('rpt_daily', args),
      rpc('rpt_products', args),
      rpc('rpt_outlets', args),
      rpc('rpt_invoices', { ...args, p_limit: 6 })
    ]);
    return { cur: cur[0], prev: prev[0], daily, products, outlets, invoices };
  }, [ctx.from, ctx.to, ctx.loc, ctx.brand]);

  const head = <PageHead ctx={ctx} crumb={<><span className="live" style={{ background: '#4cb782', color: '#4cb782', width: 6, height: 6 }} />{scopeLabel(ctx)}</>} title="Sales overview" />;

  if (loading && !data) return <main className="page">{head}<Kskel /><div className="grid"><LoadingCard rows={8} /><LoadingCard rows={8} /></div></main>;
  if (error) return <main className="page">{head}<div className="card"><ErrorState message={error} onRetry={reload} /></div></main>;

  const { cur, prev, daily, products, outlets, invoices } = data;
  const net = Number(cur.net_sales);
  if (!Number(cur.sales_bills) && !Number(cur.return_bills)) {
    return <main className="page">{head}<div className="card"><Empty action={<button className="btn btn-pri" onClick={() => { const [from, to] = presetRange('fy'); ctx.setF({ preset: 'fy', from, to, loc: null }); }}>Show this financial year</button>} /></div></main>;
  }
  const okhla = daily.filter((d) => d.location === 'Okhla').reduce((s, d) => s + Number(d.net_sales), 0);
  const gurgaon = daily.filter((d) => d.location === 'Gurgaon').reduce((s, d) => s + Number(d.net_sales), 0);
  const whTotal = Math.max(1, Math.abs(okhla) + Math.abs(gurgaon));
  const idle = outlets.filter((o) => o.last_order && daysBetween(o.last_order, ctx.to) >= 15).length;
  const outletCount = new Set(outlets.map((o) => o.party_name)).size;
  const topP = products.slice(0, 6);
  const maxP = Math.max(1, ...topP.map((p) => Number(p.net_sales)));
  const outletTotals = Object.values(outlets.reduce((m, o) => {
    const k = o.party_name;
    m[k] = m[k] || { name: k, locs: new Set(), bills: 0, net: 0 };
    m[k].locs.add(o.location); m[k].bills += Number(o.bills); m[k].net += Number(o.net_sales);
    return m;
  }, {})).sort((a, b) => b.net - a.net).slice(0, 6);
  const gross = Number(cur.gross_sales);

  return (
    <main className="page">
      {head}
      <section className="kpis">
        <div className="card kpi glow">
          <span className="lbl">Net sales</span>
          <span className="val">{rs(net)}</span>
          <Change pct={pctChange(net, Number(prev.net_sales))} />
        </div>
        <div className="card kpi">
          <span className="lbl">Invoices</span>
          <span className="val">{inr(cur.sales_bills)}</span>
          <span className="sub">{cur.sales_bills ? 'Avg ' + rs(gross / cur.sales_bills) + ' per sales bill' : '—'}</span>
        </div>
        <div className="card kpi">
          <span className="lbl">Quantity sold</span>
          <span className="val">{inr(cur.qty)} <small>pcs</small></span>
          <span className="sub">{inr(cur.skus)} SKUs billed</span>
        </div>
        <div className="card kpi">
          <span className="lbl">Active outlets</span>
          <span className="val">{inr(outletCount)}</span>
          {idle ? <span className="sub" style={{ color: 'var(--orange)', display: 'flex', alignItems: 'center', gap: 7 }}><span className="live" style={{ background: 'var(--orange)', color: 'var(--orange)', width: 6, height: 6 }} />{idle} idle 15+ days</span> : <span className="sub">All ordered recently</span>}
        </div>
        <div className="card kpi">
          <span className="lbl">Returns</span>
          <span className="val">{rs(Math.abs(cur.returns))}</span>
          <span className="sub">{gross ? (Math.abs(cur.returns) / gross * 100).toFixed(1) + '% of gross · ' : ''}{inr(cur.return_bills)} credit notes</span>
        </div>
      </section>

      <section className="grid">
        <div className="card span2">
          <div className="card-h">
            <div><h2>Daily sales</h2><span className="sub">Billed value per day, net of returns · hover a bar for amounts</span></div>
            <div className="legend">
              {ctx.loc !== 'Gurgaon' && <span><i style={{ background: 'var(--okhla)' }} />Okhla</span>}
              {ctx.loc !== 'Okhla' && <span><i style={{ background: 'var(--gurgaon)' }} />Gurgaon</span>}
            </div>
          </div>
          <DailyChart rows={daily} loc={ctx.loc} />
        </div>
        <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <h2>By warehouse</h2>
          <div style={{ display: 'flex', height: 8, borderRadius: 4, overflow: 'hidden', gap: 2 }}>
            <div style={{ width: (Math.abs(okhla) / whTotal * 100) + '%', background: 'var(--okhla)', transformOrigin: 'left', animation: 'fillx 1s var(--ease) .4s both' }} />
            <div style={{ width: (Math.abs(gurgaon) / whTotal * 100) + '%', background: 'var(--gurgaon)', transformOrigin: 'left', animation: 'fillx 1s var(--ease) .5s both' }} />
          </div>
          {[['Okhla, Delhi', okhla], ['Gurgaon, Haryana', gurgaon]].map(([n, v]) => (
            <div className="wh" key={n}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}><span style={{ fontWeight: 500, fontSize: 13 }}>{n}</span><span className="sub">{(Math.abs(v) / whTotal * 100).toFixed(1)}% of sales</span></div>
              <span style={{ fontWeight: 600, fontSize: 16, letterSpacing: '-0.03em' }}>{rs(v)}</span>
            </div>
          ))}
          <p className="sub" style={{ margin: 0, lineHeight: 1.55 }}>{inWords(net)}</p>
        </div>
      </section>

      <section className="grid">
        <div className="card">
          <div className="card-h"><h2>Top products</h2><a href="#/products" onClick={(e) => { e.preventDefault(); ctx.go('products'); }} style={{ fontSize: 12 }}>All {products.length} SKUs →</a></div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {topP.map((p, i) => (
              <div key={p.item_code} style={{ display: 'flex', flexDirection: 'column', gap: 7, animation: `rise .5s var(--ease) ${0.2 + i * 0.05}s both` }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 13 }}>
                  <span style={{ fontWeight: 500, minWidth: 0 }}>{cleanItem(p.item_name)} <span className="mono muted" style={{ fontSize: 11 }}>{p.item_code}</span></span>
                  <span style={{ fontWeight: 600 }} className="nowrap">{rs(p.net_sales)}</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div className="bar" style={{ flex: 1 }}><div style={{ width: Math.max(2, Number(p.net_sales) / maxP * 100) + '%' }} /></div>
                  <span className="sub" style={{ width: 80, textAlign: 'right' }}>{inr(p.qty)} pcs</span>
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="card">
          <div className="card-h"><h2>Top outlets</h2><a href="#/outlets" onClick={(e) => { e.preventDefault(); ctx.go('outlets'); }} style={{ fontSize: 12 }}>All {outletCount} outlets →</a></div>
          <div className="tblwrap">
            <table className="tbl" style={{ minWidth: 420 }}>
              <thead><tr><th>Outlet</th><th>Warehouse</th><th className="r">Bills</th><th className="r">Net sales</th><th className="r">Share</th></tr></thead>
              <tbody>
                {outletTotals.map((o, i) => (
                  <tr key={o.name} style={{ animationDelay: (0.2 + i * 0.05) + 's' }}>
                    <td style={{ fontWeight: 500 }}>{cleanParty(o.name)}</td>
                    <td className="t2">{o.locs.size > 1 ? 'Both' : [...o.locs][0]}</td>
                    <td className="r t2">{o.bills}</td>
                    <td className="r" style={{ fontWeight: 600 }}>{rs(o.net)}</td>
                    <td className="r muted">{net ? (o.net / net * 100).toFixed(1) + '%' : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section className="card">
        <div className="card-h"><h2>Latest invoices</h2><a href="#/invoices" onClick={(e) => { e.preventDefault(); ctx.go('invoices'); }} style={{ fontSize: 12 }}>All invoices →</a></div>
        <div className="tblwrap">
          <table className="tbl" style={{ minWidth: 720 }}>
            <thead><tr><th>Invoice</th><th>Date</th><th>Outlet</th><th>Warehouse</th><th className="r">Items</th><th className="r">Qty</th><th className="r">Amount</th></tr></thead>
            <tbody>
              {invoices.map((v, i) => (
                <tr key={v.document_no} className="click" onClick={() => ctx.go('invoices')} style={{ animationDelay: (0.2 + i * 0.04) + 's' }}>
                  <td className="mono" style={{ fontSize: 12, color: v.is_return ? 'var(--orange)' : 'var(--accent-soft)' }}>{v.document_no}</td>
                  <td className="t2">{fmtD(v.document_date)}</td>
                  <td style={{ fontWeight: 500 }}>{cleanParty(v.party_name)}</td>
                  <td className="t2">{v.location}</td>
                  <td className="r t2">{v.items}</td>
                  <td className="r t2">{inr(v.qty)}</td>
                  <td className="r" style={{ fontWeight: 600, color: v.is_return ? 'var(--orange)' : undefined }}>{rs(v.total, 2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}

function Kskel() {
  return (
    <section className="kpis">
      {[0, 1, 2, 3, 4].map((i) => (
        <div key={i} className="card kpi"><Skel h={11} w="50%" /><Skel h={26} w="80%" /><Skel h={10} w="60%" /></div>
      ))}
    </section>
  );
}
