import { useState, useRef } from 'react';
import { supabase, rpc, logActivity } from '../supabase.js';
import { rs, inr, inWords, prevRange, presetRange, pctChange, daysBetween, cleanItem, cleanParty, fmtD } from '../lib/format.js';
import { fetchAllLines, fetchDocLinks, downloadMasterXlsx } from '../lib/tally.js';
import { useLoad, Skel, LoadingCard, Empty, ErrorState, Icon, Count } from '../components/ui.jsx';
import { PageHead, DailyChart, Change, scopeLabel } from '../components/Parts.jsx';

export default function Overview({ ctx }) {
  const args = { p_from: ctx.from, p_to: ctx.to, p_location: ctx.loc, p_brand: ctx.brand };
  const [pf, pt] = prevRange(ctx.from, ctx.to);
  const { data, error, loading, reload } = useLoad(async () => {
    const [cur, prev, daily, prevDaily, products, outlets, invoices] = await Promise.all([
      rpc('rpt_summary', args),
      rpc('rpt_summary', { ...args, p_from: pf, p_to: pt }),
      rpc('rpt_daily', args),
      rpc('rpt_daily', { ...args, p_from: pf, p_to: pt }),
      rpc('rpt_products', args),
      rpc('rpt_outlets', args),
      rpc('rpt_invoices', { ...args, p_limit: 6 })
    ]);
    return { cur: cur[0], prev: prev[0], daily, prevDaily, products, outlets, invoices };
  }, [ctx.from, ctx.to, ctx.loc, ctx.brand]);

  const [busy, setBusy] = useState(false);
  const downloadAll = async () => {
    setBusy(true);
    try {
      const lines = await fetchAllLines(supabase, { from: ctx.from, to: ctx.to, loc: ctx.loc, brand: ctx.brand });
      const brandNames = Object.fromEntries(ctx.brands.map((b) => [b.id, b.name]));
      const links = await fetchDocLinks(supabase, lines.filter((l) => !l.is_return).map((l) => l.document_no));
      downloadMasterXlsx(`${ctx.brandName} sales ${ctx.from} to ${ctx.to}.xlsx`, lines, links, brandNames);
      const rows = lines;
      logActivity('export', { page: 'all-lines', from: ctx.from, to: ctx.to });
      ctx.notify(`Downloaded ${rows.length} lines`);
    } catch (e) {
      ctx.notify(e.message, true);
    } finally {
      setBusy(false);
    }
  };
  const downloadBtn = (
    <button className="btn btn-pri" disabled={busy} onClick={downloadAll}>
      {busy ? <span className="spinner" /> : Icon.download()} Download everything
    </button>
  );

  const head = <PageHead ctx={ctx} crumb={<><span className="live" style={{ background: '#4cb782', color: '#4cb782', width: 6, height: 6 }} />{scopeLabel(ctx)}</>} title={greet(ctx.userName)}>{downloadBtn}</PageHead>;

  if (loading && !data) return <main className="page">{head}<Kskel /><div className="grid"><LoadingCard rows={8} /><LoadingCard rows={8} /></div></main>;
  if (error) return <main className="page">{head}<div className="card"><ErrorState message={error} onRetry={reload} /></div></main>;

  const { cur, prev, daily, prevDaily, products, outlets, invoices } = data;
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
  const lastBill = daily.reduce((m, d) => (Number(d.net_sales) && d.day > m ? d.day : m), '');
  const retPct = gross ? Math.abs(cur.returns) / gross * 100 : 0;
  const attn = [
    idle ? { t: 'Outlets with no order in 15+ days', n: idle, go: () => ctx.go('outlets') } : null,
    retPct >= 3 ? { t: 'Returns at ' + retPct.toFixed(1) + '% of gross', n: inr(cur.return_bills) + ' CNs', go: () => ctx.go('invoices') } : null,
    Number(cur.return_bills) && retPct < 3 ? { t: 'Credit notes this period', n: inr(cur.return_bills), go: () => ctx.go('invoices') } : null
  ].filter(Boolean);

  return (
    <main className="page">
      {head}
      <section className="hero-grid">
        <div className="card hero click" onClick={() => ctx.go('report')}>
          <div className="hero-top"><span className="lbl">Net sales · {periodShort(ctx)}</span><span className="hero-link">Open sales report →</span></div>
          <div className="hero-num"><span className="val"><Count v={rs(net)} /></span><Change pct={pctChange(net, Number(prev.net_sales))} label="vs previous period" /></div>
          <TrendChart cur={daily} prev={prevDaily} />
          <div className="hero-foot">
            <span><i style={{ background: 'var(--accent)' }} />This period</span>
            <span><i className="dash" />Previous period</span>
            {lastBill && <span className="muted" style={{ marginLeft: 'auto' }}>Latest bill {fmtD(lastBill)}</span>}
          </div>
        </div>
        <div className="wh-stack">
          {[['Okhla', 'Okhla, Delhi', okhla, 'var(--okhla)'], ['Gurgaon', 'Gurgaon, Haryana', gurgaon, 'var(--gurgaon)']].filter(([k]) => !ctx.loc || ctx.loc === k).map(([k, n, v, c], i) => (
            <div key={k} className="card whc click" style={{ animationDelay: (0.08 + i * 0.06) + 's' }} onClick={() => ctx.setF({ preset: ctx.preset, from: ctx.from, to: ctx.to, loc: k })} title={'Show only ' + k}>
              <span className="ic" style={{ color: c, background: `color-mix(in srgb, ${c} 12%, transparent)` }}>{Icon.store(17)}</span>
              <div className="whc-b"><span className="lbl">{n}</span><span className="val2"><Count v={rs(v)} /></span></div>
              <span className="muted">{(Math.abs(v) / whTotal * 100).toFixed(0)}%</span>
            </div>
          ))}
          <p className="sub words">{inWords(net)}</p>
        </div>
      </section>

      <section className="mini-grid">
        <div className="card attn">
          <div className="card-h" style={{ marginBottom: 6 }}><h2><span className="ic sm" style={{ color: 'var(--orange)', background: 'color-mix(in srgb, var(--orange) 14%, transparent)' }}>!</span>Needs attention</h2>{attn.length > 0 && <span className="pillc warn">{attn.length}</span>}</div>
          {attn.length ? attn.map((a) => (
            <button key={a.t} className="attn-row" onClick={a.go}><span>{a.t}</span><span className="attn-n">{a.n} →</span></button>
          )) : <p className="sub" style={{ margin: '6px 0 0' }}>Nothing to flag for this period.</p>}
        </div>
        <div className="card kpi click" onClick={() => ctx.go('invoices')}>
          <span className="lbl">Invoices</span>
          <span className="val"><Count v={inr(cur.sales_bills)} /></span>
          <span className="sub">{cur.sales_bills ? 'Avg ' + rs(gross / cur.sales_bills) + ' per bill' : '—'}</span>
        </div>
        <div className="card kpi click" onClick={() => ctx.go('products')}>
          <span className="lbl">Quantity sold</span>
          <span className="val">{inr(cur.qty)} <small>pcs</small></span>
          <span className="sub">{inr(cur.skus)} SKUs billed</span>
        </div>
        <div className="card kpi click" onClick={() => ctx.go('outlets')}>
          <span className="lbl">Active outlets</span>
          <span className="val"><Count v={inr(outletCount)} /></span>
          <span className="sub">{idle ? idle + ' idle 15+ days' : 'All ordered recently'}</span>
        </div>
      </section>

      <section className="card">
        <div className="card-h">
          <div><h2>Daily sales by warehouse</h2><span className="sub">Billed value per day, net of returns · hover a bar for amounts</span></div>
          <div className="legend">
            {ctx.loc !== 'Gurgaon' && <span><i style={{ background: 'var(--okhla)' }} />Okhla</span>}
            {ctx.loc !== 'Okhla' && <span><i style={{ background: 'var(--gurgaon)' }} />Gurgaon</span>}
          </div>
        </div>
        <DailyChart rows={daily} loc={ctx.loc} />
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

function greet(name) {
  const h = new Date().getHours();
  const g = h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
  const first = (name || '').trim().split(/\s+/)[0];
  return first ? `${g}, ${first}` : 'Sales overview';
}

function periodShort(ctx) {
  return fmtD(ctx.from) + ' – ' + fmtD(ctx.to);
}

/** Smooth line: this period's daily net sales vs the previous period, aligned by day number. Hover shows the day's value. */
function TrendChart({ cur, prev }) {
  const sum = (rows) => {
    const m = {};
    for (const r of rows) m[r.day] = (m[r.day] || 0) + (Number(r.net_sales) || 0);
    return Object.keys(m).sort().map((k) => ({ day: k, v: m[k] }));
  };
  const a = sum(cur), b = sum(prev);
  const [hov, setHov] = useState(null);
  const ref = useRef(null);
  if (a.length < 2) return <div style={{ height: 110 }} />;
  const W = 600, H = 110, P = 6;
  const n = Math.max(a.length, b.length);
  const max = Math.max(1, ...a.map((d) => d.v), ...b.map((d) => d.v));
  const x = (i) => (i / (n - 1)) * W;
  const y = (v) => H - P - (Math.max(v, 0) / max) * (H - 2 * P);
  const line = (arr) => arr.map((d, i) => (i ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(d.v).toFixed(1)).join(' ');
  const move = (e) => {
    const r = ref.current.getBoundingClientRect();
    const i = Math.round(((e.clientX - r.left) / r.width) * (n - 1));
    setHov(Math.max(0, Math.min(a.length - 1, i)));
  };
  const h = hov !== null ? a[hov] : null;
  return (
    <div className="trend" ref={ref} onMouseMove={move} onMouseLeave={() => setHov(null)} onClick={(e) => e.stopPropagation()}>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" width="100%" height={H} aria-label="Daily net sales, this period vs previous" role="img">
        {[0.25, 0.5, 0.75].map((f) => <line key={f} x1="0" x2={W} y1={H * f} y2={H * f} stroke="var(--grid)" vectorEffect="non-scaling-stroke" />)}
        {b.length > 1 && <path d={line(b)} fill="none" stroke="var(--muted)" strokeOpacity=".55" strokeWidth="1.5" strokeDasharray="4 4" vectorEffect="non-scaling-stroke" />}
        <path d={line(a) + ` L${x(a.length - 1)} ${H} L0 ${H}Z`} fill="var(--accent)" opacity=".08" />
        <path className="trend-line" d={line(a)} fill="none" stroke="var(--accent)" strokeWidth="2.5" strokeLinejoin="round" vectorEffect="non-scaling-stroke" pathLength="1" />
        {h && <line x1={x(hov)} x2={x(hov)} y1="0" y2={H} stroke="var(--accent)" strokeOpacity=".3" vectorEffect="non-scaling-stroke" />}
      </svg>
      {h && <span className="trend-dot" style={{ left: (x(hov) / W * 100) + '%', top: y(h.v) }} />}
      {h && <div className="trend-tip" style={{ left: `clamp(0px, calc(${x(hov) / W * 100}% - 70px), calc(100% - 140px))` }}><b>{fmtD(h.day)}</b> · {rs(h.v)}{b[hov] ? <span className="muted"> · prev {rs(b[hov].v)}</span> : null}</div>}
      <div className="trend-ax"><span>{fmtD(a[0].day)}</span><span>{fmtD(a[a.length - 1].day)}</span></div>
    </div>
  );
}
