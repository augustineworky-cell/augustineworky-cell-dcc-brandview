import { useRef, useState } from 'react';
import { supabase, rpc, logActivity } from '../supabase.js';
import { rs, inr, fmtD } from '../lib/format.js';
import { parseTallyFile, summarise } from '../lib/tally.js';
import { useLoad, LoadingCard, ErrorState, Icon } from '../components/ui.jsx';
import { PageHead } from '../components/Parts.jsx';

const CHUNK = 500;

export default function Admin({ ctx }) {
  const [parsed, setParsed] = useState(null);   // { rows, files: [stats], summary }
  const [busy, setBusy] = useState('');
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState(null);
  const [mapTo, setMapTo] = useState({});
  const [over, setOver] = useState(false);
  const input = useRef(null);

  const meta = useLoad(async () => {
    const [groups, uploads, profiles] = await Promise.all([
      supabase.from('brand_item_groups').select('item_group, brand_id'),
      supabase.from('uploads').select('*').order('created_at', { ascending: false }).limit(12),
      supabase.from('profiles').select('user_id, full_name, role, brand_id, active, created_at').order('created_at')
    ]);
    for (const r of [groups, uploads, profiles]) if (r.error) throw new Error(r.error.message);
    const perBrand = await Promise.all(ctx.brands.map((b) => rpc('rpt_summary', { p_from: ctx.from, p_to: ctx.to, p_location: null, p_brand: b.id }).then((r) => [b.id, r[0]])));
    return { groups: groups.data, uploads: uploads.data, profiles: profiles.data, perBrand: Object.fromEntries(perBrand) };
  }, [ctx.from, ctx.to, ctx.brands.length, result]);

  async function onFiles(list) {
    const files = [...list];
    if (!files.length) return;
    setResult(null); setBusy('Reading files…');
    try {
      const all = []; const stats = []; const seen = new Set(); let crossDupes = 0;
      for (const f of files) {
        const { rows, stats: s } = await parseTallyFile(f);
        for (const r of rows) {
          const k = [r.location, r.document_no, r.item_code, r.qty, r.rate].join('|');
          if (seen.has(k)) { crossDupes++; continue; }
          seen.add(k); all.push(r);
        }
        stats.push({ ...s, kept: rows.length });
      }
      const known = meta.data ? new Set(meta.data.groups.map((g) => g.item_group)) : null;
      const summary = summarise(all, known);
      setParsed({ rows: all, files: stats, summary, crossDupes, name: files.map((f) => f.name).join(', ') });
      setMapTo({});
    } catch (e) {
      ctx.notify(e.message, true);
      setParsed(null);
    } finally { setBusy(''); }
  }

  async function publish() {
    if (!parsed) return;
    const unknown = parsed.summary.unknown;
    const unmapped = unknown.filter((g) => !mapTo[g]);
    if (unmapped.length && !window.confirm(`${unmapped.length} item group(s) have no brand and will be skipped:\n\n${unmapped.join('\n')}\n\nPublish anyway?`)) return;
    setBusy('Publishing…'); setProgress(0);
    try {
      const maps = unknown.filter((g) => mapTo[g]).map((g) => ({ item_group: g, brand_id: mapTo[g] }));
      if (maps.length) { const { error } = await supabase.from('brand_item_groups').insert(maps); if (error) throw new Error(error.message); }
      const clear = await supabase.from('sales_import').delete().not('document_no', 'is', null);
      if (clear.error) throw new Error(clear.error.message);
      const rows = parsed.rows;
      for (let i = 0; i < rows.length; i += CHUNK) {
        const { error } = await supabase.from('sales_import').insert(rows.slice(i, i + CHUNK));
        if (error) throw new Error(error.message);
        setProgress(Math.round(Math.min(1, (i + CHUNK) / rows.length) * 90));
      }
      const { data, error } = await supabase.rpc('process_import', { p_file_name: parsed.name.slice(0, 200) });
      if (error) throw new Error(error.message);
      setProgress(100);
      setResult(data);
      setParsed(null);
      logActivity('upload', data);
      ctx.notify(`Published ${inr(data.added)} new lines`);
    } catch (e) {
      ctx.notify('Publish failed: ' + e.message, true);
    } finally { setBusy(''); }
  }

  const brandName = (id) => ctx.brands.find((b) => b.id === id)?.name || '—';
  const s = parsed?.summary;

  return (
    <main className="page">
      <PageHead ctx={ctx} crumb="Admin · DCC MIS only" title="Upload & brands" showLoc={false} />

      <section className="grid">
        <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <h2>New upload</h2>
          <label className={'drop' + (over ? ' over' : '')}
            onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
            onDrop={(e) => { e.preventDefault(); setOver(false); onFiles(e.dataTransfer.files); }}>
            <span className="upic" style={{ color: 'var(--accent-soft)' }}>{busy ? <span className="spinner" /> : Icon.upload()}</span>
            <span style={{ fontWeight: 600 }}>{busy || 'Drop Tally Excel files here'}</span>
            <span className="sub">Okhla and Gurgaon "New Sales Report" .xlsx · or click to browse</span>
            <input ref={input} type="file" accept=".xlsx,.xls,.csv" multiple style={{ display: 'none' }} onChange={(e) => { onFiles(e.target.files); e.target.value = ''; }} />
          </label>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 9, fontSize: 13 }} className="t2">
            {['Header and Total rows removed', 'DCC internal transfers removed', 'Duplicate invoice lines skipped', 'Each line tagged to its brand'].map((t) => (
              <span key={t} style={{ display: 'flex', gap: 9, alignItems: 'center' }}>{Icon.check()}{t}</span>
            ))}
          </div>
        </div>

        <div className="card span2" style={{ display: 'flex', flexDirection: 'column', gap: 16, backgroundImage: 'radial-gradient(ellipse at top right, rgba(94,106,210,0.12), transparent 60%)' }}>
          {!parsed && !result && (
            <div className="state" style={{ padding: 30 }}>
              <h3>Preview appears here</h3>
              <p>Drop today's Tally exports. You'll see what will be added before anything is published to brands.</p>
            </div>
          )}
          {result && (
            <>
              <div className="card-h" style={{ marginBottom: 0 }}><h2>Published</h2><span className="pill"><span className="dot" style={{ background: '#4cb782' }} />Live for brands</span></div>
              <div className="stats">
                <div className="stat"><span className="sub">New lines added</span><b>{inr(result.added)}</b></div>
                <div className="stat"><span className="sub">Already there (skipped)</span><b>{inr(result.duplicates)}</b></div>
                <div className="stat"><span className="sub">Dates</span><b>{result.from ? fmtD(result.from) + ' – ' + fmtD(result.to) : '—'}</b></div>
                <div className="stat"><span className="sub">No brand (skipped)</span><b>{inr(result.unmapped)}</b></div>
              </div>
            </>
          )}
          {parsed && (
            <>
              <div className="card-h" style={{ marginBottom: 0 }}>
                <div><h2>Preview before publishing</h2><span className="mono sub">{parsed.name}</span></div>
                <span className="pill"><span className="dot live" style={{ background: '#9ba3f5', color: '#9ba3f5' }} />Ready to publish</span>
              </div>
              {busy === 'Publishing…' && <div className="bar" style={{ height: 3 }}><div style={{ width: progress + '%', height: 3, animation: 'none', transition: 'width .3s' }} /></div>}
              <div className="stats">
                <div className="stat"><span className="sub">Lines</span><b>{inr(s.lines)}</b></div>
                <div className="stat"><span className="sub">Dates</span><b>{s.from ? fmtD(s.from) + ' – ' + fmtD(s.to) : '—'}</b></div>
                <div className="stat"><span className="sub">Okhla · Gurgaon</span><b>{inr(s.okhla)} · {inr(s.gurgaon)}</b></div>
                <div className="stat"><span className="sub">Value</span><b>{rs(s.total)}</b></div>
              </div>
              <div className="tblwrap">
                <table className="tbl" style={{ minWidth: 520 }}>
                  <thead><tr><th>File</th><th className="r">Kept</th><th className="r">Totals/blank</th><th className="r">DCC rows</th><th className="r">Duplicates</th></tr></thead>
                  <tbody>{parsed.files.map((f) => <tr key={f.file}><td className="mono" style={{ fontSize: 12 }}>{f.file}</td><td className="r">{inr(f.kept)}</td><td className="r t2">{f.totals}</td><td className="r t2">{f.dcc}</td><td className="r t2">{f.dupes}</td></tr>)}</tbody>
                </table>
              </div>
              {s.unknown.length > 0 && (
                <div style={{ border: '1px solid rgba(242,153,74,0.35)', background: 'rgba(242,153,74,0.06)', borderRadius: 10, padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <span style={{ color: 'var(--orange)', fontWeight: 600 }}>New Tally item groups – pick a brand for each</span>
                  {s.unknown.map((g) => (
                    <label key={g} style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                      <span style={{ minWidth: 220 }}>{g} <span className="sub">({s.groups[g]} lines)</span></span>
                      <select className="btn" value={mapTo[g] || ''} onChange={(e) => setMapTo({ ...mapTo, [g]: e.target.value })}>
                        <option value="">Skip these lines</option>
                        {ctx.brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                      </select>
                    </label>
                  ))}
                </div>
              )}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'flex-end' }}>
                <button className="btn" onClick={() => setParsed(null)} disabled={!!busy}>Cancel</button>
                <button className="btn btn-pri" onClick={publish} disabled={!!busy || !s.lines}>{busy === 'Publishing…' ? <><span className="spinner" /> {progress}%</> : 'Publish to brands'}</button>
              </div>
            </>
          )}
        </div>
      </section>

      {meta.error ? <div className="card"><ErrorState message={meta.error} onRetry={meta.reload} /></div> : !meta.data ? <LoadingCard rows={8} /> : (
        <>
          <section className="card">
            <div className="card-h"><h2>Brands · {fmtD(ctx.from)} – {fmtD(ctx.to)}</h2></div>
            <div className="tblwrap">
              <table className="tbl" style={{ minWidth: 860 }}>
                <thead><tr><th>Brand</th><th>Tally item groups</th><th className="r">Net sales</th><th className="r">Outlets</th><th className="r">Logins</th><th className="r">Actions</th></tr></thead>
                <tbody>
                  {ctx.brands.map((b, i) => {
                    const sm = meta.data.perBrand[b.id];
                    const groups = meta.data.groups.filter((g) => g.brand_id === b.id).map((g) => g.item_group).join(' + ');
                    const logins = meta.data.profiles.filter((p) => p.brand_id === b.id && p.active).length;
                    return (
                      <tr key={b.id} style={{ animationDelay: i * 0.04 + 's' }}>
                        <td style={{ fontWeight: 500 }}><span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 2, background: b.color, marginRight: 8 }} />{b.name}</td>
                        <td className="muted" style={{ fontSize: 12 }}>{groups || '—'}</td>
                        <td className="r" style={{ fontWeight: 600 }}>{sm && (Number(sm.sales_bills) || Number(sm.return_bills)) ? rs(sm.net_sales) : '—'}</td>
                        <td className="r t2">{sm ? sm.outlets : '—'}</td>
                        <td className="r t2">{logins || <span className="muted">none yet</span>}</td>
                        <td className="r"><a href="#/overview" onClick={(e) => { e.preventDefault(); ctx.viewAs(b.id); }} style={{ fontSize: 12 }}>View as brand</a></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>

          <section className="grid">
            <div className="card">
              <div className="card-h"><h2>Upload history</h2></div>
              <div className="tblwrap">
                <table className="tbl" style={{ minWidth: 520 }}>
                  <thead><tr><th>When</th><th>File</th><th className="r">Added</th><th className="r">Skipped</th><th>Dates</th></tr></thead>
                  <tbody>{meta.data.uploads.map((u) => (
                    <tr key={u.id}>
                      <td className="t2 nowrap">{new Date(u.created_at).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</td>
                      <td className="mono" style={{ fontSize: 11, maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{u.file_name}</td>
                      <td className="r">{inr(u.rows_added)}</td>
                      <td className="r t2">{inr((u.rows_duplicate || 0) + (u.rows_unmapped || 0) + (u.rows_dcc_removed || 0))}</td>
                      <td className="t2 nowrap">{u.date_from ? fmtD(u.date_from) + ' – ' + fmtD(u.date_to) : '—'}</td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            </div>
            <div className="card">
              <div className="card-h"><h2>Logins</h2><span className="sub">{meta.data.profiles.length} people</span></div>
              <div className="tblwrap">
                <table className="tbl" style={{ minWidth: 420 }}>
                  <thead><tr><th>Name</th><th>Role</th><th>Brand</th><th>Status</th></tr></thead>
                  <tbody>{meta.data.profiles.map((p) => (
                    <tr key={p.user_id}><td style={{ fontWeight: 500 }}>{p.full_name || '—'}</td><td className="t2">{p.role === 'admin' ? 'Admin' : 'Brand'}</td><td className="t2">{p.role === 'admin' ? 'All brands' : brandName(p.brand_id)}</td><td>{p.active ? <span className="pos">Active</span> : <span className="muted">Disabled</span>}</td></tr>
                  ))}</tbody>
                </table>
              </div>
              <p className="sub" style={{ marginTop: 14, lineHeight: 1.6 }}>
                To add a brand login: Supabase → Authentication → Add user (tick Auto Confirm), then ask Claude to link that email to the brand in <span className="mono">profiles</span>.
              </p>
            </div>
          </section>
        </>
      )}
    </main>
  );
}
