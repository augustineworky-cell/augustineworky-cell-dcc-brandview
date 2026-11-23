import { useMemo, useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import { supabase, rpc, logActivity } from '../supabase.js';
import { rs, inr, fmtD } from '../lib/format.js';
import { parseTallyFile, summarise } from '../lib/tally.js';
import { downloadSalesTemplate, downloadReceivingTemplate, parseReceivingFile } from '../lib/templates.js';
import { useLoad, LoadingCard, ErrorState, Icon } from '../components/ui.jsx';
import { PageHead } from '../components/Parts.jsx';
import { SyncCard } from '../components/SyncInfo.jsx';

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
          <button className="btn" style={{ alignSelf: 'flex-start' }} onClick={() => downloadSalesTemplate(meta.data ? [...new Set(meta.data.groups.map((g) => g.item_group))].sort() : [])}>
            {Icon.download()} Download Excel format
          </button>
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
                {result.filled > 0 && <div className="stat"><span className="sub">Old lines given full columns</span><b>{inr(result.filled)}</b></div>}
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

      <ReceivingCard ctx={ctx} />

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

          <section>
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
          </section>

          <SyncCard ctx={ctx} />
          <LoginsCard ctx={ctx} profiles={meta.data.profiles} reload={meta.reload} />
          <ActivityCard />
        </>
      )}
    </main>
  );
}

/* ---------- Receiving copies (stamped invoice PDFs from the FMS) ---------- */
function ReceivingCard({ ctx }) {
  const [parsed, setParsed] = useState(null);
  const [busy, setBusy] = useState('');
  const [progress, setProgress] = useState(0);
  const [done, setDone] = useState(null);
  const [over, setOver] = useState(false);

  const info = useLoad(async () => {
    const { count, error } = await supabase.from('invoice_documents').select('document_no', { count: 'exact', head: true });
    if (error) return { missing: true, message: error.message };
    const last = await supabase.from('invoice_documents').select('updated_at').order('updated_at', { ascending: false }).limit(1);
    return { count, last: last.data?.[0]?.updated_at };
  }, [done]);

  async function onFiles(list) {
    const files = [...list];
    if (!files.length) return;
    setDone(null); setBusy('Reading ' + files.map((f) => f.name).join(', ') + '…');
    try {
      const all = new Map(); const stats = [];
      for (const f of files) {
        const { rows, stats: st } = await parseReceivingFile(f);
        rows.forEach((r) => all.set(r.document_no, r));
        stats.push({ ...st, links: rows.length });
      }
      const rows = [...all.values()];
      setParsed({ rows, stats, okhla: rows.filter((r) => r.location === 'Okhla').length, gurgaon: rows.filter((r) => r.location === 'Gurgaon').length });
    } catch (e) { ctx.notify(e.message, true); setParsed(null); }
    finally { setBusy(''); }
  }

  async function save() {
    setBusy('Saving…'); setProgress(0);
    try {
      const rows = parsed.rows;
      for (let i = 0; i < rows.length; i += 1000) {
        const { error } = await supabase.from('invoice_documents').upsert(rows.slice(i, i + 1000), { onConflict: 'document_no' });
        if (error) throw new Error(error.message);
        setProgress(Math.round(Math.min(1, (i + 1000) / rows.length) * 100));
      }
      logActivity('receiving_upload', { links: rows.length });
      ctx.notify(`Saved ${inr(rows.length)} receiving copies`);
      setDone({ saved: rows.length }); setParsed(null);
    } catch (e) { ctx.notify('Save failed: ' + e.message, true); }
    finally { setBusy(''); }
  }

  return (
    <section className="grid">
      <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div className="card-h" style={{ marginBottom: 0 }}><h2>Receiving copies</h2>
          {info.data && !info.data.missing && <span className="pill"><span className="dot" style={{ background: '#4cb782' }} />{inr(info.data.count)} invoices</span>}
        </div>
        <label className={'drop' + (over ? ' over' : '')}
          onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
          onDrop={(e) => { e.preventDefault(); setOver(false); onFiles(e.dataTransfer.files); }}>
          <span className="upic" style={{ color: 'var(--accent-soft)' }}>{busy ? <span className="spinner" /> : Icon.upload()}</span>
          <span style={{ fontWeight: 600 }}>{busy || 'Drop FMS Order to Despatch files'}</span>
          <span className="sub">Okhla + Gurgaon FMS (.xlsx or .csv of the main tab) · or click to browse</span>
          <input type="file" accept=".xlsx,.xls,.csv" multiple style={{ display: 'none' }} onChange={(e) => { onFiles(e.target.files); e.target.value = ''; }} />
        </label>
        <button className="btn" style={{ alignSelf: 'flex-start' }} onClick={downloadReceivingTemplate}>{Icon.download()} Download Excel format</button>
        <p className="sub" style={{ lineHeight: 1.6, margin: 0 }}>
          Reads <b>Invoice Number</b> and <b>Photograph of the receiving invoice copy</b>. Brands then get a “Receiving copy” button on each invoice. Drive files must be shared “Anyone with the link”.
        </p>
      </div>
      <div className="card span2" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {info.data?.missing && (
          <div className="state" style={{ padding: 24 }}><h3>Setup needed</h3><p>The <span className="mono">invoice_documents</span> table is not in Supabase yet. Run the receiving-copies SQL once, then refresh.</p></div>
        )}
        {!info.data?.missing && !parsed && (
          <div className="state" style={{ padding: 24 }}>
            <h3>{done ? `Saved ${inr(done.saved)} receiving copies` : 'Preview appears here'}</h3>
            <p>{info.data?.last ? 'Last updated ' + new Date(info.data.last).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) + '. ' : ''}Upload the FMS again any time – new invoices are added and changed links replaced.</p>
          </div>
        )}
        {parsed && (
          <>
            <div className="card-h" style={{ marginBottom: 0 }}><h2>Preview</h2><span className="pill"><span className="dot live" style={{ background: '#9ba3f5', color: '#9ba3f5' }} />Ready to save</span></div>
            {busy === 'Saving…' && <div className="bar" style={{ height: 3 }}><div style={{ width: progress + '%', height: 3, animation: 'none', transition: 'width .3s' }} /></div>}
            <div className="stats">
              <div className="stat"><span className="sub">Invoices with PDF</span><b>{inr(parsed.rows.length)}</b></div>
              <div className="stat"><span className="sub">Okhla · Gurgaon</span><b>{inr(parsed.okhla)} · {inr(parsed.gurgaon)}</b></div>
              <div className="stat"><span className="sub">No PDF yet</span><b>{inr(parsed.stats.reduce((a, x) => a + x.noLink, 0))}</b></div>
            </div>
            <div className="tblwrap">
              <table className="tbl" style={{ minWidth: 420 }}>
                <thead><tr><th>File</th><th className="r">Invoices</th><th className="r">With PDF</th><th className="r">No PDF</th></tr></thead>
                <tbody>{parsed.stats.map((f) => <tr key={f.file}><td className="mono" style={{ fontSize: 12 }}>{f.file}</td><td className="r">{inr(f.read)}</td><td className="r">{inr(f.links)}</td><td className="r t2">{inr(f.noLink + f.badLink)}</td></tr>)}</tbody>
              </table>
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button className="btn" onClick={() => setParsed(null)} disabled={!!busy}>Cancel</button>
              <button className="btn btn-pri" onClick={save} disabled={!!busy || !parsed.rows.length}>{busy === 'Saving…' ? <><span className="spinner" /> {progress}%</> : 'Save receiving copies'}</button>
            </div>
          </>
        )}
      </div>
    </section>
  );
}

/* ---------- Logins: create brand accounts from the app (via the admin-users Edge Function) ---------- */
async function adminUsers(body) {
  const { data, error } = await supabase.functions.invoke('admin-users', { body });
  if (error) {
    let msg = error.message;
    try { const j = await error.context.json(); if (j?.error) msg = j.error; } catch { /* keep msg */ }
    if (/failed to send|not found|404/i.test(msg)) msg = 'The admin-users function is not deployed in Supabase yet.';
    throw new Error(msg);
  }
  if (data?.error) throw new Error(data.error);
  return data;
}
function makePassword() {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ', a = 'abcdefghijkmnpqrstuvwxyz', d = '23456789';
  const pick = (s) => s[crypto.getRandomValues(new Uint32Array(1))[0] % s.length];
  return pick(A) + Array.from({ length: 5 }, () => pick(a)).join('') + '@' + Array.from({ length: 4 }, () => pick(d)).join('');
}
const APP_URL = 'https://dcc-brandview.vercel.app';

function LoginsCard({ ctx, profiles, reload }) {
  const blank = { full_name: '', email: '', brand_id: '', role: 'brand', password: makePassword() };
  const [f, setF] = useState(null);
  const [busy, setBusy] = useState('');
  const [made, setMade] = useState(null);
  const emails = useLoad(() => adminUsers({ action: 'list' }).then((r) => Object.fromEntries(r.users.map((u) => [u.id, u]))).catch(() => ({})), [profiles.length, made]);
  const brandName = (id) => ctx.brands.find((b) => b.id === id)?.name || '—';
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  const msgFor = (m) => `Hello ${m.full_name.split(' ')[0]},\n\nYour DCC BrandView login for ${m.brand} sales:\n\nLink: ${APP_URL}\nEmail: ${m.email}\nPassword: ${m.password}\n\nYou can see daily sales, outlets, products, invoices and receiving copies, and download Excel any time.\n\n– DCC MIS`;

  async function create(e) {
    e.preventDefault(); setBusy('create');
    try {
      await adminUsers({ action: 'create', ...f });
      const m = { ...f, brand: f.role === 'admin' ? 'all brands' : brandName(f.brand_id) };
      setMade(m); setF(null); reload();
      ctx.notify('Login created for ' + f.email);
    } catch (err) { ctx.notify(err.message, true); } finally { setBusy(''); }
  }
  async function resetPw(p) {
    const pw = makePassword();
    if (!window.confirm(`Set a new password for ${p.full_name}?\n\nNew password: ${pw}`)) return;
    setBusy(p.user_id);
    try { await adminUsers({ action: 'set_password', user_id: p.user_id, password: pw }); setMade({ full_name: p.full_name, email: emails.data?.[p.user_id]?.email || '', password: pw, brand: p.role === 'admin' ? 'all brands' : brandName(p.brand_id) }); ctx.notify('Password changed'); }
    catch (err) { ctx.notify(err.message, true); } finally { setBusy(''); }
  }
  async function toggle(p) {
    if (p.active && !window.confirm(`Disable ${p.full_name}? They will not be able to sign in.`)) return;
    setBusy(p.user_id);
    try { await adminUsers({ action: 'set_active', user_id: p.user_id, active: !p.active }); reload(); ctx.notify(p.active ? 'Login disabled' : 'Login enabled'); }
    catch (err) { ctx.notify(err.message, true); } finally { setBusy(''); }
  }
  function copy(text) { navigator.clipboard?.writeText(text).then(() => ctx.notify('Copied – paste it in WhatsApp'), () => ctx.notify('Copy failed', true)); }

  return (
    <section className="card">
      <div className="card-h">
        <div><h2>Logins</h2><span className="sub">{profiles.length} people</span></div>
        {!f && <button className="btn btn-pri" onClick={() => { setF(blank); setMade(null); }}>+ Add login</button>}
      </div>

      {f && (
        <form onSubmit={create} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 12, padding: 16, border: '1px solid var(--line-2)', borderRadius: 12, marginBottom: 16 }}>
          <label className="fld"><span className="sub">Person name</span><input className="btn" style={{ textAlign: 'left' }} required value={f.full_name} onChange={set('full_name')} placeholder="Arun Kumar" /></label>
          <label className="fld"><span className="sub">Email (their login)</span><input className="btn" style={{ textAlign: 'left' }} type="email" required value={f.email} onChange={set('email')} placeholder="arun@londondairy.in" /></label>
          <label className="fld"><span className="sub">Access</span>
            <select className="btn" value={f.role === 'admin' ? '__admin' : f.brand_id} onChange={(e) => setF({ ...f, role: e.target.value === '__admin' ? 'admin' : 'brand', brand_id: e.target.value === '__admin' ? '' : e.target.value })} required>
              <option value="">Pick a brand…</option>
              {ctx.brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              <option value="__admin">DCC admin (all brands)</option>
            </select>
          </label>
          <label className="fld"><span className="sub">Password</span>
            <span style={{ display: 'flex', gap: 6 }}><input className="btn mono" style={{ textAlign: 'left', flex: 1, minWidth: 0 }} required minLength={8} value={f.password} onChange={set('password')} />
              <button type="button" className="btn" onClick={() => setF({ ...f, password: makePassword() })} title="New password">{Icon.retry()}</button></span>
          </label>
          <div style={{ gridColumn: '1 / -1', display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button type="button" className="btn" onClick={() => setF(null)} disabled={!!busy}>Cancel</button>
            <button className="btn btn-pri" disabled={!!busy}>{busy === 'create' ? <><span className="spinner" /> Creating…</> : 'Create login'}</button>
          </div>
        </form>
      )}

      {made && (
        <div style={{ border: '1px solid rgba(76,183,130,0.35)', background: 'rgba(76,183,130,0.06)', borderRadius: 12, padding: 16, marginBottom: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <span style={{ fontWeight: 600, display: 'flex', gap: 8, alignItems: 'center' }}>{Icon.check()} Send this to {made.full_name}</span>
          <pre className="mono" style={{ margin: 0, whiteSpace: 'pre-wrap', fontSize: 12.5, lineHeight: 1.6 }}>{msgFor(made)}</pre>
          <span style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button className="btn btn-pri" onClick={() => copy(msgFor(made))}>Copy message</button>
            <a className="btn" href={'https://wa.me/?text=' + encodeURIComponent(msgFor(made))} target="_blank" rel="noopener noreferrer">Open WhatsApp</a>
            <button className="btn" onClick={() => setMade(null)}>Done</button>
          </span>
          <span className="sub">The password is shown only now. If it's lost, use Reset password.</span>
        </div>
      )}

      <div className="tblwrap">
        <table className="tbl" style={{ minWidth: 720 }}>
          <thead><tr><th>Name</th><th>Email</th><th>Access</th><th>Last sign-in</th><th>Status</th><th className="r">Actions</th></tr></thead>
          <tbody>{profiles.map((p) => {
            const u = emails.data?.[p.user_id];
            return (
              <tr key={p.user_id}>
                <td style={{ fontWeight: 500 }}>{p.full_name || '—'}</td>
                <td className="t2 mono" style={{ fontSize: 12 }}>{u?.email || '—'}</td>
                <td className="t2">{p.role === 'admin' ? 'Admin · all brands' : brandName(p.brand_id)}</td>
                <td className="t2 nowrap">{u?.last_sign_in_at ? new Date(u.last_sign_in_at).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : <span className="muted">never</span>}</td>
                <td>{p.active ? <span className="pos">Active</span> : <span className="muted">Disabled</span>}</td>
                <td className="r nowrap">
                  {busy === p.user_id ? <span className="spinner" /> : (
                    <>
                      <a href="#" onClick={(e) => { e.preventDefault(); resetPw(p); }} style={{ fontSize: 12 }}>Reset password</a>
                      <span className="muted"> · </span>
                      <a href="#" onClick={(e) => { e.preventDefault(); toggle(p); }} style={{ fontSize: 12, color: p.active ? 'var(--orange)' : undefined }}>{p.active ? 'Disable' : 'Enable'}</a>
                    </>
                  )}
                </td>
              </tr>
            );
          })}</tbody>
        </table>
      </div>
    </section>
  );
}


/* ---------- Activity: who signed in, which tabs they opened, what they downloaded ---------- */
const PAGE_NAME = { report: 'Sales report', po: 'PO & Appointments', stock: 'Stock', overview: 'Overview', products: 'Products', outlets: 'Outlets', invoices: 'Invoices', downloads: 'Downloads', admin: 'Admin' };
const EXPORT_NAME = { 'sales-report': 'Sales report (month)', 'sales-report-lines': 'Sales report (line-wise)', 'po-appointments': 'PO & Appointments', stock: 'Stock', products: 'Products', outlets: 'Outlets', invoices: 'Invoices', 'all-lines': 'All sales lines' };
const rangeTxt = (d) => (d && d.from && d.to ? ` · ${d.from} to ${d.to}` : d && d.month ? ` · ${d.month}` : '');
function describe(a) {
  const d = a.detail || {};
  switch (a.action) {
    case 'login': return 'Signed in';
    case 'view': return 'Opened ' + (PAGE_NAME[d.page] || d.page || 'a page');
    case 'export': return 'Downloaded ' + (EXPORT_NAME[d.page] || d.page || 'a report') + rangeTxt(d) + (d.product ? ` · product "${d.product}"` : '') + (d.loc ? ` · ${d.loc}` : '');
    case 'upload': return 'Uploaded sales file';
    case 'receiving_view': return 'Viewed a receiving copy' + (d.doc ? ' · ' + d.doc : '');
    case 'receiving_download': return 'Downloaded a receiving copy' + (d.doc ? ' · ' + d.doc : '');
    case 'bulk_find': return `Bulk invoice search (${d.count || 0})`;
    case 'bulk_zip': return `Downloaded invoices ZIP (${d.count || 0})`;
    case 'bulk_excel': return `Downloaded bulk invoice Excel (${d.count || 0})`;
    case 'login_created': return 'Created a login' + (d.email ? ' · ' + d.email : '');
    default: return a.action;
  }
}
const TYPE_OF = { login: 'login', view: 'view', export: 'download', receiving_download: 'download', bulk_zip: 'download', bulk_excel: 'download' };
const stamp = (t) => new Date(t).toLocaleString('en-GB', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: true });
const stampFull = (t) => new Date(t).toLocaleString('en-GB', { timeZone: 'Asia/Kolkata', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });

function ActivityCard() {
  const [days, setDays] = useState(7);
  const [who, setWho] = useState('');
  const [type, setType] = useState('');
  const [admins, setAdmins] = useState(false);
  const [limit, setLimit] = useState(100);
  const { data, error, loading, reload } = useLoad(() => rpc('admin_activity', { p_days: days, p_limit: 3000 }), [days]);

  const rows = useMemo(() => (data || []).filter((a) => (admins || a.role !== 'admin') && (!who || a.user_id === who) && (!type || (TYPE_OF[a.action] || 'other') === type)), [data, admins, who, type]);
  const people = useMemo(() => {
    const m = new Map();
    for (const a of data || []) {
      if (!a.user_id || (!admins && a.role === 'admin')) continue;
      const p = m.get(a.user_id) || { id: a.user_id, name: a.name || a.email, email: a.email, brand: a.role === 'admin' ? 'Admin' : a.brand, last: a.ts, logins: 0, downloads: 0, views: 0 };
      if (a.ts > p.last) p.last = a.ts;
      const t = TYPE_OF[a.action];
      if (t === 'login') p.logins += 1; else if (t === 'download') p.downloads += 1; else if (t === 'view') p.views += 1;
      m.set(a.user_id, p);
    }
    return [...m.values()].sort((x, y) => (y.last || '').localeCompare(x.last || ''));
  }, [data, admins]);

  function download() {
    const head = ['When (IST)', 'Name', 'Email', 'Brand', 'Action'];
    const aoa = [head, ...rows.map((a) => [stampFull(a.ts), a.name || '', a.email || '', a.role === 'admin' ? 'Admin' : (a.brand || ''), describe(a)])];
    const ws = XLSX.utils.aoa_to_sheet(aoa); ws['!cols'] = [{ wch: 20 }, { wch: 22 }, { wch: 32 }, { wch: 16 }, { wch: 70 }];
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Activity');
    XLSX.writeFile(wb, `BrandView activity last ${days} days.xlsx`);
  }

  return (
    <section className="card">
      <div className="card-h">
        <div><h2>Activity</h2><span className="sub">Who signed in, which tabs they opened and what they downloaded. Times in IST.</span></div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <div className="seg" role="group" aria-label="Period">
            {[[1, 'Today'], [7, '7 days'], [30, '30 days']].map(([v, l]) => <button key={v} className={days === v ? 'on' : ''} onClick={() => setDays(v)}>{l}</button>)}
          </div>
          <button className="btn" onClick={reload}>Refresh</button>
          <button className="btn" disabled={!rows.length} onClick={download}>{Icon.download()} Excel</button>
        </div>
      </div>
      {loading && !data ? <LoadingCard rows={4} /> : error ? (
        <ErrorState message={/admin_activity|function/i.test(String(error)) ? 'Activity is not set up yet. Run 03_activity.sql in the Supabase SQL Editor, then refresh.' : String(error)} onRetry={reload} />
      ) : (
        <>
          <div className="tblwrap">
            <table className="tbl" style={{ minWidth: 640 }}>
              <thead><tr><th>Person</th><th>Brand</th><th>Last active</th><th className="r">Sign-ins</th><th className="r">Tabs opened</th><th className="r">Downloads</th></tr></thead>
              <tbody>
                {!people.length && <tr><td colSpan={6} className="t2">No activity in this period.</td></tr>}
                {people.map((p) => (
                  <tr key={p.id} style={{ cursor: 'pointer', background: who === p.id ? 'var(--card-2)' : undefined }} onClick={() => { setWho(who === p.id ? '' : p.id); setLimit(100); }}>
                    <td>{p.name}<span className="sub" style={{ marginLeft: 6 }}>{p.email}</span></td>
                    <td>{p.brand || '—'}</td><td className="nowrap">{stamp(p.last)}</td>
                    <td className="r">{inr(p.logins)}</td><td className="r">{inr(p.views)}</td><td className="r" style={{ fontWeight: 600 }}>{inr(p.downloads)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', padding: '16px 4px 8px' }}>
            <div className="seg" role="group" aria-label="Type">
              {[['', 'Everything'], ['login', 'Sign-ins'], ['view', 'Tabs opened'], ['download', 'Downloads']].map(([v, l]) => <button key={l} className={type === v ? 'on' : ''} onClick={() => { setType(v); setLimit(100); }}>{l}</button>)}
            </div>
            <label className="sub" style={{ display: 'flex', gap: 6, alignItems: 'center' }}><input type="checkbox" checked={admins} onChange={(e) => setAdmins(e.target.checked)} /> Include admins</label>
            {who && <button className="btn" onClick={() => setWho('')}>Showing one person · show all</button>}
          </div>
          <div className="tblwrap">
            <table className="tbl" style={{ minWidth: 640 }}>
              <thead><tr><th>When</th><th>Who</th><th>Brand</th><th>What</th></tr></thead>
              <tbody>
                {!rows.length && <tr><td colSpan={4} className="t2">Nothing to show for these filters.</td></tr>}
                {rows.slice(0, limit).map((a, i) => (
                  <tr key={a.ts + i}>
                    <td className="nowrap">{stamp(a.ts)}</td>
                    <td>{a.name || a.email || 'Unknown'}</td>
                    <td>{a.role === 'admin' ? 'Admin' : (a.brand || '—')}</td>
                    <td style={(TYPE_OF[a.action] === 'download') ? { fontWeight: 600 } : undefined}>{describe(a)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {rows.length > limit && <div style={{ padding: '12px 4px' }}><button className="btn" onClick={() => setLimit(limit + 100)}>Show 100 more</button> <span className="sub">{limit} of {inr(rows.length)}</span></div>}
        </>
      )}
    </section>
  );
}
