import { Filters } from './Shell.jsx';
import { presetRange, rs, rsShort, fmtD, fmtDY, parseIso, iso } from '../lib/format.js';

export function PageHead({ ctx, crumb, title, children, showLoc = true }) {
  return (
    <header className="ph">
      <div>
        <div className="crumb">{crumb}</div>
        <h1>{title}</h1>
      </div>
      <div className="controls">
        <Filters f={ctx} setF={(v) => ctx.setF({ preset: v.preset, from: v.from, to: v.to, loc: v.loc })} presetRange={presetRange} showLoc={showLoc} />
        {children}
      </div>
    </header>
  );
}

export const periodLabel = (ctx) => `${fmtDY(ctx.from)} – ${fmtDY(ctx.to)}`;
export const scopeLabel = (ctx) => `${ctx.brandName} · ${ctx.loc || 'Okhla + Gurgaon'} · ${periodLabel(ctx)}`;

/** Grouped bar chart: Okhla vs Gurgaon per day (or per week when the range is long). */
export function DailyChart({ rows, loc, height = 220 }) {
  const byDay = {};
  for (const r of rows) {
    const k = r.day;
    byDay[k] = byDay[k] || { Okhla: 0, Gurgaon: 0 };
    byDay[k][r.location] += Number(r.net_sales) || 0;
  }
  let keys = Object.keys(byDay).sort();
  let label = (k) => parseIso(k).getDate();
  let tipLabel = (k) => fmtD(k);
  if (keys.length > 40) {
    const wk = {};
    for (const k of keys) {
      const d = parseIso(k);
      const mon = iso(new Date(d.getFullYear(), d.getMonth(), d.getDate() - ((d.getDay() + 6) % 7)));
      wk[mon] = wk[mon] || { Okhla: 0, Gurgaon: 0 };
      wk[mon].Okhla += byDay[k].Okhla; wk[mon].Gurgaon += byDay[k].Gurgaon;
    }
    Object.keys(byDay).forEach((k) => delete byDay[k]);
    Object.assign(byDay, wk);
    keys = Object.keys(wk).sort();
    label = (k) => fmtD(k);
    tipLabel = (k) => 'Week of ' + fmtD(k);
  }
  const max = Math.max(1, ...keys.flatMap((k) => [byDay[k].Okhla, byDay[k].Gurgaon]));
  const step = niceStep(max / 4);
  const top = step * 4;
  const px = (v) => Math.max(v > 0 ? 2 : 0, Math.round((Math.max(v, 0) / top) * (height - 2))) + 'px';
  const showEvery = keys.length > 24 ? Math.ceil(keys.length / 12) : 1;
  return (
    <div className="tblwrap">
      <div className="chart">
        <div className="yax" style={{ height }}>
          {[4, 3, 2, 1, 0].map((i) => <span key={i}>{i ? rsShort(step * i) : '0'}</span>)}
        </div>
        <div className="plot">
          <div className="bars" style={{ height, backgroundSize: `100% ${height / 4}px`, background: `repeating-linear-gradient(to top, transparent 0, transparent ${height / 4 - 1}px, var(--grid) ${height / 4 - 1}px, var(--grid) ${height / 4}px)` }}>
            {keys.map((k, i) => (
              <div className="day" key={k}>
                {loc !== 'Gurgaon' && <div className="b" style={{ height: px(byDay[k].Okhla), background: 'var(--okhla)', animationDelay: (0.3 + i * 0.025).toFixed(2) + 's' }} />}
                {loc !== 'Okhla' && <div className="b" style={{ height: px(byDay[k].Gurgaon), background: 'var(--gurgaon)', animationDelay: (0.3 + i * 0.025).toFixed(2) + 's' }} />}
                <div className="tip">
                  <div style={{ fontWeight: 600, marginBottom: 4 }}>{tipLabel(k)}</div>
                  {loc !== 'Gurgaon' && <div><span style={{ color: 'var(--accent-soft)' }}>Okhla</span> {rs(byDay[k].Okhla)}</div>}
                  {loc !== 'Okhla' && <div><span style={{ color: 'var(--gurgaon)' }}>Gurgaon</span> {rs(byDay[k].Gurgaon)}</div>}
                </div>
              </div>
            ))}
          </div>
          <div className="xax">{keys.map((k, i) => <span key={k}>{i % showEvery === 0 ? label(k) : ''}</span>)}</div>
        </div>
      </div>
    </div>
  );
}

function niceStep(v) {
  if (v <= 0) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  const n = v / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p;
}

export function Change({ pct, label = 'vs last month' }) {
  if (pct === null || pct === undefined || !isFinite(pct)) return <span className="sub">No data {label}</span>;
  const up = pct >= 0;
  return (
    <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
      <span className={up ? 'pos' : 'neg'} style={{ fontWeight: 600 }}>{up ? '↑' : '↓'} {Math.abs(pct).toFixed(1)}%</span>
      <span className="muted">{label}</span>
    </span>
  );
}
