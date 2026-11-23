import { useEffect, useRef, useState } from 'react';
import { supabase } from '../supabase.js';

/*
 * Sync freshness + "Sync now".
 * - <Freshness source="po" />: one quiet line under a page title ("Includes sheet edits up to 23 Nov, 12:31 pm").
 * - <SyncCard ctx />: Admin card with Sync now buttons and the latest runs.
 * Both read small SQL functions from 07_sync_now_po10min.sql; if those aren't installed yet they stay hidden.
 */
const fmt = (t) => t ? new Date(t).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true }) : '';
const ago = (t) => {
  if (!t) return '';
  const m = Math.round((Date.now() - new Date(t).getTime()) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h} h ${m % 60} min ago` : fmt(t);
};
const EVERY = { po: 'checked every 10 min, 9 am – 8:30 pm', sales: 'synced manually from Admin', stock: 'synced manually from Admin' };

// one shared fetch for all badges on screen, refreshed every minute
let cache = { at: 0, data: null, p: null };
async function freshness(force) {
  if (!force && cache.data && Date.now() - cache.at < 55000) return cache.data;
  if (!force && cache.p) return cache.p;
  cache.p = supabase.rpc('sync_freshness').then(({ data, error }) => {
    cache = { at: Date.now(), data: error ? null : (data || {}), p: null };
    return cache.data;
  });
  return cache.p;
}

export function Freshness({ source, bump = 0 }) {
  const [f, setF] = useState(null);
  const [, tick] = useState(0);
  useEffect(() => {
    let live = true;
    const load = (force) => freshness(force).then((d) => live && setF(d?.[source] || null));
    load(bump > 0);
    const t = setInterval(() => { load(false); tick((x) => x + 1); }, 60000);
    return () => { live = false; clearInterval(t); };
  }, [source, bump]);
  if (!f?.sheet_edited) return null;
  return (
    <div className="fresh" title={`Loaded into BrandView ${fmt(f.loaded_at)} · ${EVERY[source] || ''}`}>
      <span className="fresh-dot" />
      Includes sheet edits up to <b>{fmt(f.sheet_edited)}</b>
      <span className="muted"> · {EVERY[source]}</span>
    </div>
  );
}

const LABEL = { sales: 'Sales', po: 'PO & appointments', stock: 'Stock' };

export function SyncCard({ ctx }) {
  const [runs, setRuns] = useState(null);
  const [busy, setBusy] = useState(null);         // source being synced
  const [msg, setMsg] = useState('');
  const [bump, setBump] = useState(0);
  const poll = useRef(null);

  const loadRuns = async () => {
    const { data, error } = await supabase.rpc('sync_recent', { p_limit: 12 });
    if (error) { setRuns(false); return []; }
    setRuns(data || []); return data || [];
  };
  useEffect(() => { loadRuns(); return () => clearInterval(poll.current); }, []);

  async function syncNow(source) {
    setBusy(source); setMsg('Starting…');
    const before = (runs || []).reduce((m, r) => Math.max(m, r.id || 0), 0);
    const { error } = await supabase.rpc('admin_sync_now', { p_source: source });
    if (error) { setBusy(null); setMsg(''); ctx.notify(error.message, true); return; }
    setMsg('Reading the Google Sheet… (about 30–60 seconds)');
    const t0 = Date.now();
    clearInterval(poll.current);
    poll.current = setInterval(async () => {
      const list = await loadRuns();
      const mine = list.filter((r) => r.id > before && (!source || r.source === source));
      const done = mine.length && mine.every((r) => r.status !== 'running');
      if (done) {
        clearInterval(poll.current); setBusy(null); setMsg('');
        const bad = mine.find((r) => r.status === 'error');
        ctx.notify(bad ? `${LABEL[bad.source] || bad.source} sync failed: ${bad.message || 'see list'}` : `${source ? LABEL[source] : 'All sheets'} synced`, !!bad);
        setBump((b) => b + 1);
      } else if (Date.now() - t0 > 180000) {
        clearInterval(poll.current); setBusy(null);
        setMsg('Still running in the background. Check the list below in a minute.');
      }
    }, 4000);
  }

  if (runs === false) return null; // SQL helpers not installed yet
  return (
    <section className="card">
      <div className="card-h">
        <div><h2>Sync from Google Sheets</h2><span className="sub">PO syncs by itself every 10 min (9 am – 8:30 pm). Sales and stock sync only when you press Sync now, so press it after you update those sheets.</span></div>
      </div>
      <div className="sync-row">
        {['po', 'sales', 'stock'].map((s) => (
          <div key={s} className="sync-box">
            <div className="sync-name">{LABEL[s]}</div>
            <Freshness source={s} bump={bump} />
            <button className="btn" disabled={!!busy} onClick={() => syncNow(s)}>{busy === s ? <span className="spinner" /> : null}{busy === s ? 'Syncing…' : 'Sync now'}</button>
          </div>
        ))}
      </div>
      {msg && <p className="sub" style={{ marginTop: 10 }}>{msg}</p>}
      {Array.isArray(runs) && runs.length > 0 && (
        <div className="tblwrap" style={{ marginTop: 14 }}>
          <table className="tbl">
            <thead><tr><th>Sheet</th><th>Started</th><th>Result</th><th>Rows</th><th>Note</th></tr></thead>
            <tbody>{runs.slice(0, 8).map((r) => (
              <tr key={r.id}>
                <td>{LABEL[r.source] || r.source}</td>
                <td>{ago(r.started_at || r.created_at)}</td>
                <td><span className="pill"><span className="dot" style={{ background: r.status === 'error' ? '#eb5757' : r.status === 'running' ? '#f2c94c' : '#4cb782' }} />{r.status}</span></td>
                <td className="mono">{r.rows_loaded ?? r.rows_read ?? '—'}</td>
                <td className="sub" style={{ maxWidth: 420, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.message || ''}>{r.message || ''}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </section>
  );
}
