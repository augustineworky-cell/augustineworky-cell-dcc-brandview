import { useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
import { supabase, rpc, logActivity } from '../supabase.js';
import { rs, inr, iso, presetRange, fmtD, daysBetween } from '../lib/format.js';
import { fetchAllLines, fetchDocLinks, downloadMasterXlsx, buildMasterSheet } from '../lib/tally.js';
import { downloadSalesTrendXlsx } from '../lib/salesTrendExcel.js';
import { useLoad, LoadingCard, Empty, ErrorState, Icon, Count } from '../components/ui.jsx';

/*
 * Sales report – same concept as the "SALES TREND" Google Sheet:
 *  1. Week-wise sales per brand (weeks start on Sunday, like WEEKNUM(date,1))
 *  2. Location-wise sales per brand (Okhla vs Gurgaon)
 *  3. Top brands
 *  4. Month-on-month trend (last 6 months)
 * Data comes from the rpt_trend() database function, so brand logins only see their own brand.
 */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const ym = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
const monthLabel = (key) => { const [y, m] = key.split('-').map(Number); return `${MONTHS[m - 1]} ${y}`; };
const monthStart = (key) => { const [y, m] = key.split('-').map(Number); return new Date(y, m - 1, 1); };
const shiftMonth = (key, n) => { const d = monthStart(key); return ym(new Date(d.getFullYear(), d.getMonth() + n, 1)); };

/** Week-of-month ranges for a month, Sunday-start (matches WEEKNUM(d,1) - WEEKNUM(1st,1) + 1). */
function weekRanges(key) {
  const first = monthStart(key);
  const days = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
  const out = {};
  for (let d = 1; d <= days; d++) {
    const w = Math.floor((d - 1 + first.getDay()) / 7) + 1;
    out[w] = out[w] || { from: d, to: d };
    out[w].to = d;
  }
  return out;
}

export default function SalesReport({ ctx }) {
  const now = new Date();
  const [month, setMonth] = useState(ym(now));
  const [measure, setMeasure] = useState('taxable');
  const [wloc, setWloc] = useState(null); // warehouse filter for the whole report (null = both)
  const [dFrom, setDFrom] = useState(() => presetRange('month')[0]);
  const [dTo, setDTo] = useState(() => presetRange('month')[1]);
  const [prod, setProd] = useState('');
  const [busy, setBusy] = useState(false);

  const monthOptions = Array.from({ length: 18 }, (_, i) => ym(new Date(now.getFullYear(), now.getMonth() - i, 1)));
  const from = iso(monthStart(shiftMonth(month, -5)));
  const to = iso(new Date(monthStart(month).getFullYear(), monthStart(month).getMonth() + 1, 0));

  const { data, error, loading, reload } = useLoad(
    () => rpc('rpt_trend', { p_from: from, p_to: to, p_brand: ctx.brand }),
    [from, to, ctx.brand]
  );

  const brandColor = useMemo(() => Object.fromEntries((ctx.brands || []).map((b) => [b.id, b.color])), [ctx.brands]);

  const R = useMemo(() => {
    if (!data) return null;
    const val = (r) => Number(measure === 'taxable' ? r.taxable : r.total) || 0;
    const mk = (r) => String(r.month).slice(0, 7);
    const dataF = wloc ? data.filter((r) => r.location === wloc) : data;
    const cur = dataF.filter((r) => mk(r) === month);
    const prevKey = shiftMonth(month, -1);
    const prev = dataF.filter((r) => mk(r) === prevKey);
    const weeks = weekRanges(month);
    const weekNums = Object.keys(weeks).map(Number);

    const groups = {};
    const color = {};
    for (const r of cur) {
      const g = r.item_group;
      color[g] = brandColor[r.brand_id] || '#5e6ad2';
      groups[g] = groups[g] || { name: g, total: 0, okhla: 0, gurgaon: 0, weeks: {}, wloc: {} };
      const v = val(r);
      groups[g].total += v;
      if (r.location === 'Okhla') groups[g].okhla += v; else groups[g].gurgaon += v;
      groups[g].weeks[r.week] = (groups[g].weeks[r.week] || 0) + v;
    }
    const rows = Object.values(groups).sort((a, b) => b.total - a.total);
    const weekTotals = Object.fromEntries(weekNums.map((w) => [w, rows.reduce((s, g) => s + (g.weeks[w] || 0), 0)]));
    const weekGrand = Object.values(weekTotals).reduce((s, v) => s + v, 0);
    const total = rows.reduce((s, g) => s + g.total, 0);
    const okhla = rows.reduce((s, g) => s + g.okhla, 0);
    const gurgaon = rows.reduce((s, g) => s + g.gurgaon, 0);
    const prevTotal = prev.reduce((s, r) => s + val(r), 0);
    const maxCell = Math.max(1, ...rows.flatMap((g) => weekNums.map((w) => g.weeks[w] || 0)));
    const bestWeek = weekNums.reduce((b, w) => (weekTotals[w] > (weekTotals[b] || -Infinity) ? w : b), weekNums[0]);

    // 6-month trend
    const months = Array.from({ length: 6 }, (_, i) => shiftMonth(month, i - 5));
    const tg = {};
    for (const r of dataF) {
      const g = r.item_group;
      color[g] = color[g] || brandColor[r.brand_id] || '#5e6ad2';
      tg[g] = tg[g] || { name: g, m: {} };
      tg[g].m[mk(r)] = (tg[g].m[mk(r)] || 0) + val(r);
    }
    const trend = Object.values(tg).sort((a, b) => (b.m[month] || 0) - (a.m[month] || 0));
    const monthTotals = Object.fromEntries(months.map((m) => [m, trend.reduce((s, g) => s + (g.m[m] || 0), 0)]));
    const shownMonths = months.filter((m) => monthTotals[m] !== 0 || m === month);

    return { rows, weeks, weekNums, weekTotals, weekGrand, total, okhla, gurgaon, prevTotal, maxCell, bestWeek, color, trend, monthTotals, shownMonths };
  }, [data, month, measure, wloc, brandColor]);

  const mLabel = monthLabel(month);
  const mShort = MONTHS[monthStart(month).getMonth()];
  const measureLabel = measure === 'taxable' ? 'Taxable value (ex-GST)' : 'Total incl. GST';
  const wkLabel = (w) => R && R.weeks[w] ? `${R.weeks[w].from}${R.weeks[w].to !== R.weeks[w].from ? '–' + R.weeks[w].to : ''} ${mShort}` : '';

  async function exportXlsx() {
    if (!R) return;
    setBusy(true);
    try {
      // Same layout as the boss's SALES TREND Google Sheet; brand logins only get their own rows.
      const end = iso(new Date(monthStart(month).getFullYear(), monthStart(month).getMonth() + 1, 0));
      const all = await rpc('rpt_trend', { p_from: '2000-01-01', p_to: end, p_brand: ctx.brand });
      const rows = wloc ? all.filter((r) => r.location === wloc) : all;
      const first = rows.reduce((m, r) => (String(r.month).slice(0, 10) < m ? String(r.month).slice(0, 10) : m), iso(monthStart(month)));
      const lines = await fetchAllLines(supabase, { from: first, to: end, loc: wloc, brand: ctx.brand });
      const links = await fetchDocLinks(supabase, lines.filter((l) => !l.is_return).map((l) => l.document_no));
      await downloadSalesTrendXlsx(rows, lines, links, { month, measure, brandName: ctx.brandName, buildMasterSheet });
      logActivity('export', { page: 'sales-report', month });
      ctx.notify('Sales report downloaded');
    } catch (e) { ctx.notify(e.message || 'Download failed', true); } finally { setBusy(false); }
  }

  const pickRange = (key) => {
    if (key === 'sel') { setDFrom(iso(monthStart(month))); setDTo(iso(new Date(monthStart(month).getFullYear(), monthStart(month).getMonth() + 1, 0))); return; }
    const [f, t] = presetRange(key); setDFrom(f); setDTo(t);
  };
  async function downloadLines() {
    if (!dFrom || !dTo || dFrom > dTo) { ctx.notify('Pick a valid From and To date', true); return; }
    setBusy(true);
    try {
      let lines = await fetchAllLines(supabase, { from: dFrom, to: dTo, loc: wloc, brand: ctx.brand });
      const q = prod.trim().toLowerCase();
      if (q) lines = lines.filter((l) => [l.item_name, l.item_code, l.item_group].some((x) => String(x || '').toLowerCase().includes(q)));
      if (!lines.length) { ctx.notify('No sales lines for these filters', true); return; }
      const brandNames = Object.fromEntries((ctx.brands || []).map((b) => [b.id, b.name]));
      const links = await fetchDocLinks(supabase, lines.filter((l) => !l.is_return).map((l) => l.document_no));
      downloadMasterXlsx(`${ctx.brandName} sales ${wloc || 'all'}${q ? ' ' + q : ''} ${dFrom} to ${dTo}.xlsx`, lines, links, brandNames);
      logActivity('export', { page: 'sales-report-lines', from: dFrom, to: dTo, loc: wloc, product: q || null });
      ctx.notify(`Downloaded ${lines.length} lines`);
    } catch (e) {
      ctx.notify(e.message, true);
    } finally {
      setBusy(false);
    }
  }
  const dl = (
    <section className="card">
      <div className="card-h">
        <div><h2>Download sales data</h2><span className="sub">Line-wise Excel in the master format · pick any dates, product and warehouse (warehouse follows the filter at the top)</span></div>
      </div>
      <div className="controls" style={{ alignItems: 'flex-end' }}>
        <label className="dates"><span className="muted">From</span><input type="date" value={dFrom} max={dTo} onChange={(e) => setDFrom(e.target.value)} /></label>
        <label className="dates"><span className="muted">To</span><input type="date" value={dTo} min={dFrom} onChange={(e) => setDTo(e.target.value)} /></label>
        <div className="chips">
          <button className="chip" onClick={() => pickRange('sel')}>Selected month</button>
          <button className="chip" onClick={() => pickRange('month')}>This month</button>
          <button className="chip" onClick={() => pickRange('lastmonth')}>Last month</button>
          <button className="chip" onClick={() => pickRange('7d')}>Last 7 days</button>
        </div>
        <label className="search"><span style={{ display: 'flex' }}>{Icon.search ? Icon.search() : null}</span><input placeholder="Product name or code (optional)" value={prod} onChange={(e) => setProd(e.target.value)} /></label>
        <button className="btn btn-pri" disabled={busy} onClick={downloadLines}>{busy ? <span className="spinner" /> : Icon.download()} Download line-wise data</button>
      </div>
    </section>
  );

  const head = (
    <header className="ph">
      <div>
        <div className="crumb">{ctx.brandName} · {wloc || 'Okhla + Gurgaon'} · {measureLabel}</div>
        <h1>Sales report</h1>
      </div>
      <div className="controls">
        <label className="dates" style={{ gap: 8 }}>
          <span className="muted" style={{ display: 'flex' }}>{Icon.cal()}</span>
          <select aria-label="Month" value={month} onChange={(e) => setMonth(e.target.value)} style={{ background: 'transparent', color: 'var(--text)', border: 0, outline: 'none', fontSize: 13 }}>
            {monthOptions.map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}
          </select>
        </label>
        <div className="seg" role="group" aria-label="Warehouse">
          {[[null, 'All'], ['Okhla', 'Okhla'], ['Gurgaon', 'Gurgaon']].map(([v, l]) => (
            <button key={l} className={wloc === v ? 'on' : ''} onClick={() => setWloc(v)}>{l}</button>
          ))}
        </div>
        <div className="seg" role="group" aria-label="Value">
          <button className={measure === 'taxable' ? 'on' : ''} onClick={() => setMeasure('taxable')}>Taxable</button>
          <button className={measure === 'total' ? 'on' : ''} onClick={() => setMeasure('total')}>Incl. GST</button>
        </div>
        <button className="btn btn-pri" disabled={busy || !R || !R.rows.length} onClick={exportXlsx}>{busy ? <span className="spinner" /> : Icon.download()} Export report</button>
      </div>
    </header>
  );

  if (loading && !data) return <main className="page">{head}<LoadingCard rows={8} /><LoadingCard rows={8} /></main>;
  if (error) return <main className="page">{head}<div className="card"><ErrorState message={error} onRetry={reload} /></div></main>;
  if (!R.rows.length) return <main className="page">{head}<div className="card"><Empty title={`No sales in ${mLabel}${wloc ? ' · ' + wloc : ''}`} text="Pick another month or warehouse above." /></div><DaysReport ctx={ctx} wloc={wloc} measure={measure} measureLabel={measureLabel} />{dl}</main>;

  const change = R.prevTotal ? (R.total - R.prevTotal) / Math.abs(R.prevTotal) * 100 : null;
  const top = R.rows[0];
  const top10 = R.rows.slice(0, 10);
  const topMax = Math.max(1, ...top10.map((g) => g.total));
  const heat = (v) => (v > 0 ? `rgba(94,106,210,${(0.06 + 0.34 * v / R.maxCell).toFixed(3)})` : v < 0 ? 'rgba(242,153,74,0.12)' : 'transparent');

  return (
    <main className="page">
      {head}

      <section className="kpis">
        <div className="card kpi glow">
          <span className="lbl">{mLabel} sales</span>
          <span className="val"><Count v={rs(R.total)} /></span>
          {change === null ? <span className="sub">No data for {monthLabel(shiftMonth(month, -1))}</span> :
            <span className="sub"><span className={change >= 0 ? 'pos' : 'neg'} style={{ fontWeight: 600 }}>{change >= 0 ? '↑' : '↓'} {Math.abs(change).toFixed(1)}%</span> vs {monthLabel(shiftMonth(month, -1))} (full month)</span>}
        </div>
        <div className="card kpi"><span className="lbl">Best week</span><span className="val">Week {R.bestWeek}</span><span className="sub">{wkLabel(R.bestWeek)} · {rs(R.weekTotals[R.bestWeek])}</span></div>
        <div className="card kpi"><span className="lbl">Top brand</span><span style={{ fontSize: 17, fontWeight: 600 }}>{top.name}</span><span className="sub">{rs(top.total)} · {R.total ? (top.total / R.total * 100).toFixed(1) : 0}% of sales</span></div>
        <div className="card kpi"><span className="lbl">Okhla · Gurgaon</span><span style={{ fontSize: 17, fontWeight: 600 }}>{R.total ? (R.okhla / R.total * 100).toFixed(0) : 0}% · {R.total ? (R.gurgaon / R.total * 100).toFixed(0) : 0}%</span><span className="sub">{rs(R.okhla)} · {rs(R.gurgaon)}</span></div>
      </section>

      <DaysReport ctx={ctx} wloc={wloc} measure={measure} measureLabel={measureLabel} />

      {dl}

      <section className="card">
        <div className="card-h">
          <div><h2>Week wise sales · {mLabel}</h2><span className="sub">Weeks run Sunday to Saturday, same as the SALES TREND sheet · darker cell = higher sales · warehouse filter is at the top</span></div>
        </div>
        <div className="tblwrap">
          <table className="tbl" style={{ minWidth: 760 }}>
            <thead>
              <tr>
                <th>Brand</th><th className="r">Total</th>
                {R.weekNums.map((w) => <th key={w} className="r">Week {w}<div className="sub" style={{ fontWeight: 400 }}>{wkLabel(w)}</div></th>)}
              </tr>
            </thead>
            <tbody>
              <tr style={{ background: 'var(--card-2)' }}>
                <td style={{ fontWeight: 700 }}>Total</td>
                <td className="r" style={{ fontWeight: 700 }}>{rs(R.weekGrand)}</td>
                {R.weekNums.map((w) => <td key={w} className="r" style={{ fontWeight: 700 }}>{R.weekTotals[w] ? rs(R.weekTotals[w]) : '—'}</td>)}
              </tr>
              {R.rows.map((g, i) => {
                const t = R.weekNums.reduce((s, w) => s + (g.weeks[w] || 0), 0);
                return (
                  <tr key={g.name} style={{ animationDelay: (0.1 + i * 0.03) + 's' }}>
                    <td style={{ fontWeight: 500 }}><span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 2, background: R.color[g.name], marginRight: 8 }} />{g.name}</td>
                    <td className="r" style={{ fontWeight: 600 }}>{rs(t)}</td>
                    {R.weekNums.map((w) => (
                      <td key={w} className="r" style={{ background: heat(g.weeks[w] || 0), color: (g.weeks[w] || 0) < 0 ? 'var(--orange)' : undefined }}>{g.weeks[w] ? rs(g.weeks[w]) : <span className="muted">—</span>}</td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="grid">
        <div className="card span2">
          <div className="card-h"><h2>Location wise · {mLabel}</h2></div>
          <div className="tblwrap">
            <table className="tbl" style={{ minWidth: 640 }}>
              <thead><tr><th>Brand</th><th className="r">Total</th><th className="r">Okhla (Delhi)</th><th className="r">Gurgaon (Haryana)</th><th style={{ paddingLeft: 24 }}>Split</th></tr></thead>
              <tbody>
                <tr style={{ background: 'var(--card-2)' }}>
                  <td style={{ fontWeight: 700 }}>Total</td>
                  <td className="r" style={{ fontWeight: 700 }}>{rs(R.total)}</td>
                  <td className="r" style={{ fontWeight: 700 }}>{rs(R.okhla)}</td>
                  <td className="r" style={{ fontWeight: 700 }}>{rs(R.gurgaon)}</td>
                  <td style={{ paddingLeft: 24 }}><div className="split"><div style={{ width: (R.total ? Math.max(0, Math.min(100, R.okhla / R.total * 100)) : 0) + '%' }} /></div></td>
                </tr>
                {R.rows.map((g, i) => {
                  const pct = g.total ? Math.max(0, Math.min(100, g.okhla / g.total * 100)) : 0;
                  return (
                    <tr key={g.name} style={{ animationDelay: (0.1 + i * 0.03) + 's' }}>
                      <td style={{ fontWeight: 500 }}>{g.name}</td>
                      <td className="r" style={{ fontWeight: 600 }}>{rs(g.total)}</td>
                      <td className="r t2">{g.okhla ? rs(g.okhla) : '—'}</td>
                      <td className="r t2">{g.gurgaon ? rs(g.gurgaon) : '—'}</td>
                      <td style={{ paddingLeft: 24 }}><div className="split"><div style={{ width: pct + '%' }} /></div><span className="sub" style={{ fontSize: 11 }}>{pct.toFixed(0)}% Okhla</span></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
        <div className="card">
          <div className="card-h"><h2>Top brands</h2><span className="sub">{mLabel}</span></div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {top10.map((g, i) => (
              <div key={g.name} style={{ display: 'flex', flexDirection: 'column', gap: 6, animation: `rise .5s var(--ease) ${0.15 + i * 0.05}s both` }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: 13 }}>
                  <span style={{ fontWeight: 500 }}><span className="muted" style={{ marginRight: 8 }}>{i + 1}</span>{g.name}</span>
                  <span style={{ fontWeight: 600 }} className="nowrap">{rs(g.total)}</span>
                </div>
                <div className="bar"><div style={{ width: Math.max(2, g.total / topMax * 100) + '%', background: R.color[g.name] }} /></div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="card">
        <div className="card-h"><div><h2>Month on month</h2><span className="sub">{measureLabel} · months with data up to {mLabel}</span></div></div>
        <div className="tblwrap">
          <table className="tbl" style={{ minWidth: 640 }}>
            <thead><tr><th>Brand</th>{R.shownMonths.map((m) => <th key={m} className="r">{monthLabel(m)}</th>)}<th className="r">Change</th></tr></thead>
            <tbody>
              <tr style={{ background: 'var(--card-2)' }}>
                <td style={{ fontWeight: 700 }}>Total</td>
                {R.shownMonths.map((m) => <td key={m} className="r" style={{ fontWeight: 700 }}>{rs(R.monthTotals[m])}</td>)}
                <td className="r">{pctCell(R.monthTotals[month], R.monthTotals[shiftMonth(month, -1)])}</td>
              </tr>
              {R.trend.map((g, i) => (
                <tr key={g.name} style={{ animationDelay: (0.1 + i * 0.03) + 's' }}>
                  <td style={{ fontWeight: 500 }}>{g.name}</td>
                  {R.shownMonths.map((m) => <td key={m} className="r t2">{g.m[m] ? rs(g.m[m]) : <span className="muted">—</span>}</td>)}
                  <td className="r">{pctCell(g.m[month], g.m[shiftMonth(month, -1)])}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="sub" style={{ margin: '12px 0 0' }}>The current month is month-to-date, so its change vs last month will rise as the month goes on.</p>
      </section>
    </main>
  );
}

function pctCell(now, prev) {
  if (!prev) return <span className="muted">—</span>;
  const p = ((now || 0) - prev) / Math.abs(prev) * 100;
  return <span className={p >= 0 ? 'pos' : 'neg'} style={{ fontWeight: 600 }}>{p >= 0 ? '+' : ''}{p.toFixed(0)}%</span>;
}

/* ---------- Sales for selected days: any 1 day up to 62 days, brand x day, Okhla / Gurgaon ---------- */
function DaysReport({ ctx, wloc, measure, measureLabel }) {
  const today = presetRange('today')[0];
  const shift = (d, n) => { const x = new Date(d + 'T00:00:00'); x.setDate(x.getDate() + n); return iso(x); };
  const [from, setFrom] = useState(shift(today, -1));
  const [to, setTo] = useState(today);
  const bad = !from || !to || from > to || daysBetween(from, to) > 61;
  const { data, error, loading, reload } = useLoad(
    () => (bad ? Promise.resolve([]) : fetchAllLines(supabase, { from, to, loc: wloc, brand: ctx.brand })),
    [from, to, wloc, ctx.brand]
  );
  const pick = (k) => {
    if (k === 'today') { setFrom(today); setTo(today); }
    if (k === 'yday') { setFrom(shift(today, -1)); setTo(shift(today, -1)); }
    if (k === '2d') { setFrom(shift(today, -1)); setTo(today); }
    if (k === '3d') { setFrom(shift(today, -2)); setTo(today); }
    if (k === '7d') { setFrom(shift(today, -6)); setTo(today); }
  };
  const D = useMemo(() => {
    if (!data || bad) return null;
    const v = (l) => Number(measure === 'total' ? l.total_amount : l.amount) || 0;
    const days = []; for (let d = from; d <= to; d = shift(d, 1)) days.push(d);
    const g = {};
    for (const l of data) {
      const k = l.item_group || 'Other';
      const r = (g[k] = g[k] || { name: k, total: 0, okhla: 0, gurgaon: 0, d: {}, bills: new Set() });
      const x = v(l); const day = String(l.document_date).slice(0, 10);
      r.total += x; r.d[day] = (r.d[day] || 0) + x; r.bills.add(l.document_no);
      if (l.location === 'Okhla') r.okhla += x; else r.gurgaon += x;
    }
    const rows = Object.values(g).sort((a, b) => b.total - a.total);
    const sum = (f) => rows.reduce((s, r) => s + f(r), 0);
    return { days, rows, total: sum((r) => r.total), okhla: sum((r) => r.okhla), gurgaon: sum((r) => r.gurgaon),
      dayTot: Object.fromEntries(days.map((d) => [d, sum((r) => r.d[d] || 0)])), bills: new Set(data.map((l) => l.document_no)).size };
  }, [data, from, to, measure, bad]);
  const label = from === to ? fmtD(from) : `${fmtD(from)} – ${fmtD(to)}`;

  return (
    <section className="card">
      <div className="card-h">
        <div><h2>Sales for selected days · {label}</h2><span className="sub">Pick any 1 day to 2 months · {measureLabel} · net of returns · warehouse follows the filter at the top</span></div>
      </div>
      <div className="controls" style={{ alignItems: 'flex-end', marginBottom: 14 }}>
        <label className="dates"><span className="muted">From</span><input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} /></label>
        <label className="dates"><span className="muted">To</span><input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} /></label>
        <div className="chips">
          <button className="chip" onClick={() => pick('today')}>Today</button>
          <button className="chip" onClick={() => pick('yday')}>Yesterday</button>
          <button className="chip" onClick={() => pick('2d')}>Last 2 days</button>
          <button className="chip" onClick={() => pick('3d')}>Last 3 days</button>
          <button className="chip" onClick={() => pick('7d')}>Last 7 days</button>
        </div>
      </div>
      {bad ? <p className="sub">Pick a From date before the To date, at most 2 months apart.</p>
        : error ? <ErrorState message={error} onRetry={reload} />
        : loading || !D ? <LoadingCard rows={4} />
        : !D.rows.length ? <Empty title={`No sales on ${label}`} text="Bills for today show up after the sheet syncs (every 30 min, 9 AM to 8:30 PM)." />
        : <>
          <div className="kpis" style={{ marginBottom: 14 }}>
            <div className="card kpi"><span className="lbl">Sales · {label}</span><span className="val"><Count v={rs(D.total)} /></span><span className="sub">{inr(D.bills)} bills</span></div>
            <div className="card kpi"><span className="lbl">Okhla (Delhi)</span><span className="val">{rs(D.okhla)}</span><span className="sub">{D.total ? (D.okhla / D.total * 100).toFixed(0) : 0}% of sales</span></div>
            <div className="card kpi"><span className="lbl">Gurgaon (Haryana)</span><span className="val">{rs(D.gurgaon)}</span><span className="sub">{D.total ? (D.gurgaon / D.total * 100).toFixed(0) : 0}% of sales</span></div>
          </div>
          <div className="tblwrap">
            <table className="tbl" style={{ minWidth: 560 + D.days.length * 90 }}>
              <thead><tr><th>Brand</th><th className="r">Total</th><th className="r">Okhla</th><th className="r">Gurgaon</th>{D.days.length > 1 && D.days.map((d) => <th key={d} className="r">{fmtD(d)}</th>)}</tr></thead>
              <tbody>
                <tr style={{ background: 'var(--card-2)' }}>
                  <td style={{ fontWeight: 700 }}>Total</td>
                  <td className="r" style={{ fontWeight: 700 }}>{rs(D.total)}</td>
                  <td className="r" style={{ fontWeight: 700 }}>{rs(D.okhla)}</td>
                  <td className="r" style={{ fontWeight: 700 }}>{rs(D.gurgaon)}</td>
                  {D.days.length > 1 && D.days.map((d) => <td key={d} className="r" style={{ fontWeight: 700 }}>{D.dayTot[d] ? rs(D.dayTot[d]) : '—'}</td>)}
                </tr>
                {D.rows.map((r) => (
                  <tr key={r.name}>
                    <td style={{ fontWeight: 500 }}>{r.name}</td>
                    <td className="r" style={{ fontWeight: 600 }}>{rs(r.total)}</td>
                    <td className="r t2">{r.okhla ? rs(r.okhla) : '—'}</td>
                    <td className="r t2">{r.gurgaon ? rs(r.gurgaon) : '—'}</td>
                    {D.days.length > 1 && D.days.map((d) => <td key={d} className="r t2" style={{ color: (r.d[d] || 0) < 0 ? 'var(--orange)' : undefined }}>{r.d[d] ? rs(r.d[d]) : <span className="muted">—</span>}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>}
    </section>
  );
}
