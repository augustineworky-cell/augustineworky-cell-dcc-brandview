import { useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
import { rpc, logActivity } from '../supabase.js';
import { rs, inr, iso } from '../lib/format.js';
import { useLoad, LoadingCard, Empty, ErrorState, Icon } from '../components/ui.jsx';

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
  const [wloc, setWloc] = useState(null);

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
    const cur = data.filter((r) => mk(r) === month);
    const prevKey = shiftMonth(month, -1);
    const prev = data.filter((r) => mk(r) === prevKey);
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
      if (!wloc || r.location === wloc) groups[g].weeks[r.week] = (groups[g].weeks[r.week] || 0) + v;
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
    for (const r of data) {
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

  function exportXlsx() {
    if (!R) return;
    const wb = XLSX.utils.book_new();
    const n = (v) => Math.round((v || 0) * 100) / 100;
    const title = [`${ctx.brandName} · Sales report · ${mLabel} · ${measureLabel}`];

    const w1 = [title, [`Week wise · ${wloc || 'Combined'}`], [],
      ['Brand', 'Total', ...R.weekNums.map((w) => `Week ${w} (${wkLabel(w)})`)],
      ['Total', n(R.weekGrand), ...R.weekNums.map((w) => n(R.weekTotals[w]))],
      ...R.rows.map((g) => [g.name, n(R.weekNums.reduce((s, w) => s + (g.weeks[w] || 0), 0)), ...R.weekNums.map((w) => n(g.weeks[w]))])];
    const s1 = XLSX.utils.aoa_to_sheet(w1); s1['!cols'] = [{ wch: 32 }, { wch: 16 }, ...R.weekNums.map(() => ({ wch: 20 }))];
    XLSX.utils.book_append_sheet(wb, s1, 'Week Wise');

    const w2 = [title, ['Location wise'], [],
      ['Brand', 'Total', 'Okhla (Delhi)', 'Gurgaon (Haryana)', 'Okhla %'],
      ['Total', n(R.total), n(R.okhla), n(R.gurgaon), R.total ? n(R.okhla / R.total * 100) : 0],
      ...R.rows.map((g) => [g.name, n(g.total), n(g.okhla), n(g.gurgaon), g.total ? n(g.okhla / g.total * 100) : 0])];
    const s2 = XLSX.utils.aoa_to_sheet(w2); s2['!cols'] = [{ wch: 32 }, { wch: 16 }, { wch: 16 }, { wch: 18 }, { wch: 10 }];
    XLSX.utils.book_append_sheet(wb, s2, 'Location Wise');

    const w3 = [title, ['Month on month'], [],
      ['Brand', ...R.shownMonths.map(monthLabel)],
      ['Total', ...R.shownMonths.map((m) => n(R.monthTotals[m]))],
      ...R.trend.map((g) => [g.name, ...R.shownMonths.map((m) => n(g.m[m]))])];
    const s3 = XLSX.utils.aoa_to_sheet(w3); s3['!cols'] = [{ wch: 32 }, ...R.shownMonths.map(() => ({ wch: 16 }))];
    XLSX.utils.book_append_sheet(wb, s3, 'Month Trend');

    XLSX.writeFile(wb, `${ctx.brandName} sales report ${mLabel}.xlsx`);
    logActivity('export', { page: 'sales-report', month });
    ctx.notify('Sales report downloaded');
  }

  const head = (
    <header className="ph">
      <div>
        <div className="crumb">{ctx.brandName} · Okhla + Gurgaon · {measureLabel}</div>
        <h1>Sales report</h1>
      </div>
      <div className="controls">
        <label className="dates" style={{ gap: 8 }}>
          <span className="muted" style={{ display: 'flex' }}>{Icon.cal()}</span>
          <select aria-label="Month" value={month} onChange={(e) => setMonth(e.target.value)} style={{ background: 'transparent', color: 'var(--text)', border: 0, outline: 'none', fontSize: 13, colorScheme: 'dark' }}>
            {monthOptions.map((m) => <option key={m} value={m} style={{ background: '#111215' }}>{monthLabel(m)}</option>)}
          </select>
        </label>
        <div className="seg" role="group" aria-label="Value">
          <button className={measure === 'taxable' ? 'on' : ''} onClick={() => setMeasure('taxable')}>Taxable</button>
          <button className={measure === 'total' ? 'on' : ''} onClick={() => setMeasure('total')}>Incl. GST</button>
        </div>
        <button className="btn btn-pri" disabled={!R || !R.rows.length} onClick={exportXlsx}>{Icon.download()} Export report</button>
      </div>
    </header>
  );

  if (loading && !data) return <main className="page">{head}<LoadingCard rows={8} /><LoadingCard rows={8} /></main>;
  if (error) return <main className="page">{head}<div className="card"><ErrorState message={error} onRetry={reload} /></div></main>;
  if (!R.rows.length) return <main className="page">{head}<div className="card"><Empty title={`No sales in ${mLabel}`} text="Pick another month from the month box." /></div></main>;

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
          <span className="val">{rs(R.total)}</span>
          {change === null ? <span className="sub">No data for {monthLabel(shiftMonth(month, -1))}</span> :
            <span className="sub"><span className={change >= 0 ? 'pos' : 'neg'} style={{ fontWeight: 600 }}>{change >= 0 ? '↑' : '↓'} {Math.abs(change).toFixed(1)}%</span> vs {monthLabel(shiftMonth(month, -1))} (full month)</span>}
        </div>
        <div className="card kpi"><span className="lbl">Best week</span><span className="val">Week {R.bestWeek}</span><span className="sub">{wkLabel(R.bestWeek)} · {rs(R.weekTotals[R.bestWeek])}</span></div>
        <div className="card kpi"><span className="lbl">Top brand</span><span style={{ fontSize: 17, fontWeight: 600 }}>{top.name}</span><span className="sub">{rs(top.total)} · {R.total ? (top.total / R.total * 100).toFixed(1) : 0}% of sales</span></div>
        <div className="card kpi"><span className="lbl">Okhla · Gurgaon</span><span style={{ fontSize: 17, fontWeight: 600 }}>{R.total ? (R.okhla / R.total * 100).toFixed(0) : 0}% · {R.total ? (R.gurgaon / R.total * 100).toFixed(0) : 0}%</span><span className="sub">{rs(R.okhla)} · {rs(R.gurgaon)}</span></div>
      </section>

      <section className="card">
        <div className="card-h">
          <div><h2>Week wise sales · {mLabel}</h2><span className="sub">Weeks run Sunday to Saturday, same as the SALES TREND sheet · darker cell = higher sales</span></div>
          <div className="seg" role="group" aria-label="Warehouse for week table">
            {[[null, 'Combined'], ['Okhla', 'Okhla'], ['Gurgaon', 'Gurgaon']].map(([v, l]) => (
              <button key={l} className={wloc === v ? 'on' : ''} onClick={() => setWloc(v)}>{l}</button>
            ))}
          </div>
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
