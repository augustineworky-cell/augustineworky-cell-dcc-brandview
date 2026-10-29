import { useEffect, useState } from 'react';
import { supabase, rpc, logActivity } from '../supabase.js';
import { rs, inr, inWords, fmtD, fmtDY, cleanItem, cleanParty } from '../lib/format.js';
import { downloadXlsx, fetchDocLinks, downloadMasterXlsx } from '../lib/tally.js';
import { useLoad, LoadingCard, Empty, ErrorState, Skel, Icon } from '../components/ui.jsx';
import { PageHead, scopeLabel } from '../components/Parts.jsx';

const PAGE = 60;

export default function Invoices({ ctx }) {
  const [type, setType] = useState(null);
  const [q, setQ] = useState(ctx.invSearch || '');
  const [dq, setDq] = useState(q);
  const [limit, setLimit] = useState(PAGE);
  const [sel, setSel] = useState(null);
  const [bulk, setBulk] = useState(false);

  useEffect(() => { const t = setTimeout(() => setDq(q.trim()), 300); return () => clearTimeout(t); }, [q]);
  useEffect(() => { setLimit(PAGE); }, [dq, type, ctx.from, ctx.to, ctx.loc, ctx.brand]);
  useEffect(() => () => ctx.setInvSearch(''), []); // eslint-disable-line react-hooks/exhaustive-deps

  const args = { p_from: ctx.from, p_to: ctx.to, p_location: ctx.loc, p_brand: ctx.brand };
  const counts = useLoad(() => rpc('rpt_summary', args).then((r) => r[0]), [ctx.from, ctx.to, ctx.loc, ctx.brand]);
  const list = useLoad(() => rpc('rpt_invoices', { ...args, p_type: type, p_search: dq || null, p_limit: limit + 1, p_offset: 0 }),
    [ctx.from, ctx.to, ctx.loc, ctx.brand, type, dq, limit]);

  useEffect(() => {
    if (list.data && list.data.length && (!sel || !list.data.some((v) => v.document_no === sel.document_no))) setSel(list.data[0]);
    if (list.data && !list.data.length) setSel(null);
  }, [list.data]); // eslint-disable-line react-hooks/exhaustive-deps

  async function exportList() {
    const rows = await rpc('rpt_invoices', { ...args, p_type: type, p_search: dq || null, p_limit: 20000, p_offset: 0 });
    downloadXlsx(`${ctx.brandName} invoices ${ctx.from} to ${ctx.to}.xlsx`, 'Invoices',
      [['Invoice', 'document_no'], ['Date', 'document_date'], ['Outlet', 'party_name', 'wide'], ['Warehouse', 'location'], ['Type', 'kind'], ['Items', 'items'], ['Qty', 'qty'], ['Taxable', 'taxable'], ['GST', 'gst'], ['Total', 'total']],
      rows.map((v) => ({ ...v, kind: v.is_return ? 'Return' : 'Sale', qty: Number(v.qty), taxable: Number(v.taxable), gst: Number(v.gst), total: Number(v.total) })));
    logActivity('export', { page: 'invoices', from: ctx.from, to: ctx.to });
  }

  const c = counts.data;
  const head = (
    <PageHead ctx={ctx} crumb={scopeLabel(ctx)} title="Invoices">
      <button className={'btn' + (bulk ? ' on' : '')} onClick={() => setBulk(!bulk)} aria-expanded={bulk}>{Icon.stack()} Bulk download</button>
      <button className="btn btn-pri" onClick={() => exportList().catch((e) => ctx.notify(e.message, true))}>{Icon.download()} Export</button>
    </PageHead>
  );
  const rows = list.data ? list.data.slice(0, limit) : [];
  const more = list.data && list.data.length > limit;

  return (
    <main className="page">
      {head}
      {bulk && <Bulk ctx={ctx} onClose={() => setBulk(false)} />}
      <div className="controls" style={{ justifyContent: 'space-between' }}>
        <div className="seg" role="group" aria-label="Invoice type">
          <button className={type === null ? 'on' : ''} onClick={() => setType(null)}>All{c ? ` · ${Number(c.sales_bills) + Number(c.return_bills)}` : ''}</button>
          <button className={type === 'sale' ? 'on' : ''} onClick={() => setType('sale')}>Sales{c ? ` · ${c.sales_bills}` : ''}</button>
          <button className={type === 'return' ? 'on' : ''} onClick={() => setType('return')}>Returns{c ? ` · ${c.return_bills}` : ''}</button>
        </div>
        <label className="search" style={{ background: 'var(--card)' }}>{Icon.search(14)}<input placeholder="Search invoice no. or outlet" aria-label="Search invoice number or outlet" value={q} onChange={(e) => setQ(e.target.value)} />
          {q && <button className="eye" aria-label="Clear search" onClick={() => setQ('')} style={{ width: 26, height: 26 }}>{Icon.close(13)}</button>}
        </label>
      </div>

      {list.error ? <div className="card"><ErrorState message={list.error} onRetry={list.reload} /></div> :
        list.loading && !list.data ? <LoadingCard rows={10} /> :
        !rows.length ? <div className="card"><Empty title={dq ? 'No invoices match your search' : undefined} /></div> : (
        <section className="inv-layout">
          <div className="card inv-list">
            {rows.map((v, i) => (
              <button key={v.document_no} className={'inv-row' + (sel && sel.document_no === v.document_no ? ' sel' : '')} onClick={() => setSel(v)} style={{ animationDelay: Math.min(i, 15) * 0.03 + 's' }}>
                <span className="tag" style={{ background: v.is_return ? 'rgba(242,153,74,0.12)' : 'rgba(94,106,210,0.14)', color: v.is_return ? 'var(--orange)' : 'var(--accent-soft)' }}>{v.is_return ? 'CN' : 'INV'}</span>
                <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0, flex: 1 }}>
                  <span style={{ fontWeight: 500, fontSize: 13, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{cleanParty(v.party_name)}</span>
                  <span className="mono muted" style={{ fontSize: 11 }}>{v.document_no} · {fmtD(v.document_date)} · {v.location}</span>
                </span>
                <span style={{ fontWeight: 600, fontSize: 13, color: v.is_return ? 'var(--orange)' : undefined }} className="nowrap">{rs(v.total, 2)}</span>
              </button>
            ))}
            {more && <button className="btn" style={{ margin: 8, justifyContent: 'center' }} onClick={() => setLimit(limit + PAGE)} disabled={list.loading}>{list.loading ? <span className="spinner" /> : null} Load more</button>}
          </div>
          {sel && <Detail key={sel.document_no} inv={sel} brand={ctx.brand} brandName={ctx.brandName} notify={ctx.notify} />}
        </section>
      )}
    </main>
  );
}

function Detail({ inv, brand, brandName, notify }) {
  const { data, error, loading } = useLoad(() => rpc('rpt_invoice_lines', { p_document_no: inv.document_no, p_brand: brand }), [inv.document_no, brand]);
  const [all, setAll] = useState(false);
  const lines = data || [];
  const shown = all ? lines : lines.slice(0, 10);
  return (
    <aside className="drawer" aria-label="Invoice detail">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>
          <span className="mono" style={{ fontSize: 13, color: inv.is_return ? 'var(--orange)' : 'var(--accent-soft)' }}>{inv.document_no}{inv.is_return ? ' · credit note' : ''}</span>
          <span style={{ fontSize: 20, fontWeight: 600, letterSpacing: '-0.03em' }}>{cleanParty(inv.party_name)}</span>
          <span className="sub" style={{ fontSize: 13 }}>{fmtDY(inv.document_date)} · {inv.location} warehouse · {inv.items} items · {inr(inv.qty)} pcs</span>
        </div>
        <button className="iconbtn" aria-label="Download this invoice" disabled={!lines.length} onClick={() => {
          downloadXlsx(`${inv.document_no.replace(/\//g, '-')}.xlsx`, 'Invoice', [['Item code', 'item_code'], ['Item', 'item_name', 'wide'], ['Qty', 'qty'], ['Rate', 'rate'], ['Taxable', 'amount'], ['GST', 'gst'], ['Total', 'total_amount']],
            lines.map((l) => ({ ...l, qty: Number(l.qty), rate: Number(l.rate), amount: Number(l.amount), gst: Number(l.gst), total_amount: Number(l.total_amount) })));
          notify('Invoice downloaded');
        }}>{Icon.download()}</button>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 8 }}>
        <div className="mini"><span className="sub">Taxable</span><span style={{ fontWeight: 600 }}>{rs(inv.taxable, 2)}</span></div>
        <div className="mini"><span className="sub">GST</span><span style={{ fontWeight: 600 }}>{rs(inv.gst, 2)}</span></div>
        <div className="mini hl"><span className="sub">Invoice total</span><span style={{ fontWeight: 600 }}>{rs(inv.total, 2)}</span></div>
      </div>
      <Receiving inv={inv} />
      {error ? <span className="lerr">{Icon.alert(14)}{error}</span> : loading ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>{[0, 1, 2, 3, 4].map((i) => <Skel key={i} h={14} w={`${95 - i * 8}%`} />)}</div>
      ) : (
        <div className="tblwrap">
          <table className="tbl" style={{ minWidth: 460 }}>
            <thead><tr><th>Item</th><th className="r">Qty</th><th className="r">Rate</th><th className="r">Amount</th></tr></thead>
            <tbody>
              {shown.map((l, i) => (
                <tr key={l.item_code + i} style={{ animationDelay: (0.1 + i * 0.04) + 's' }}>
                  <td><span style={{ fontWeight: 500 }}>{cleanItem(l.item_name)}</span> <span className="mono muted" style={{ fontSize: 11 }}>{l.item_code}</span></td>
                  <td className="r t2">{inr(l.qty)}</td>
                  <td className="r t2">{inr(l.rate, 2)}</td>
                  <td className="r" style={{ fontWeight: 600 }}>{rs(l.total_amount, 2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {lines.length > 10 && <span className="sub">Showing {shown.length} of {lines.length} items · <a href="#" onClick={(e) => { e.preventDefault(); setAll(!all); }}>{all ? 'show less' : 'show all'}</a></span>}
      <p className="sub" style={{ margin: 0, borderTop: '1px solid var(--line-2)', paddingTop: 12 }}>{inWords(inv.total)}</p>
      <span className="sub" style={{ marginTop: -8 }}>{brandName}</span>
    </aside>
  );
}

const driveId = (u) => (u.match(/[?&]id=([\w-]{10,})/) || u.match(/\/d\/([\w-]{10,})/) || [])[1];

function Receiving({ inv }) {
  const { data, loading } = useLoad(async () => {
    const { data: d, error } = await supabase.from('invoice_documents').select('file_url, received_on').eq('document_no', inv.document_no).maybeSingle();
    return error ? null : d;
  }, [inv.document_no]);
  if (inv.is_return) return null;
  if (loading) return <Skel h={44} />;
  if (!data) {
    const subj = encodeURIComponent(`Receiving copy for ${inv.document_no}`);
    return (
      <div className="mini" style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
        <span className="sub">Receiving copy not uploaded yet</span>
        <a href={`mailto:info@dccorp.in?subject=${subj}`} style={{ fontSize: 12 }}>Request it</a>
      </div>
    );
  }
  const id = driveId(data.file_url);
  const view = id ? `https://drive.google.com/file/d/${id}/view` : data.file_url;
  const dl = id ? `https://drive.google.com/uc?export=download&id=${id}` : data.file_url;
  return (
    <div className="mini hl" style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
      <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ color: 'var(--accent-soft)' }}>{Icon.doc(18)}</span>
        <span style={{ display: 'flex', flexDirection: 'column' }}>
          <span style={{ fontWeight: 600 }}>Receiving copy (stamped)</span>
          <span className="sub">{data.received_on ? 'Received ' + fmtDY(data.received_on) : 'Signed & stamped by outlet'}</span>
        </span>
      </span>
      <span style={{ display: 'flex', gap: 8 }}>
        <a className="btn" href={view} target="_blank" rel="noopener noreferrer" onClick={() => logActivity('receiving_view', { doc: inv.document_no })}>{Icon.eye(14)} View</a>
        <a className="btn btn-pri" href={dl} target="_blank" rel="noopener noreferrer" onClick={() => logActivity('receiving_download', { doc: inv.document_no })}>{Icon.download(14)} Download</a>
      </span>
    </div>
  );
}

/* ---------- Bulk: paste many invoice numbers, download all receiving copies + details ---------- */
const BULK_COLS = 'document_date, document_no, trans_type, is_return, location, party_name, customer_code, customer_group, item_group, item_code, item_name, qty, uom, rate, discount_pct, amount, gst_pct, gst, total_amount, brand_id, raw';
const ZIP_BATCH = 40;

function Bulk({ ctx, onClose }) {
  const [text, setText] = useState('');
  const [res, setRes] = useState(null);
  const [busy, setBusy] = useState('');
  const wanted = [...new Set(text.toUpperCase().split(/[\s,;]+/).map((x) => x.trim()).filter((x) => /\d/.test(x) && x.includes('/')))];

  async function find() {
    if (!wanted.length) { ctx.notify('Paste at least one invoice number, e.g. DOC/26-27/3535', true); return; }
    if (wanted.length > 500) { ctx.notify('Up to 500 invoices at a time', true); return; }
    setBusy('find'); setRes(null);
    try {
      const lines = [];
      for (let i = 0; i < wanted.length; i += 80) {
        let q = supabase.from('sales_lines').select(BULK_COLS).in('document_no', wanted.slice(i, i + 80));
        if (ctx.brand) q = q.eq('brand_id', ctx.brand);
        const { data, error } = await q.order('document_no').limit(20000);
        if (error) throw new Error(error.message);
        lines.push(...data);
      }
      const links = await fetchDocLinks(supabase, lines.map((l) => l.document_no));
      const by = new Map();
      for (const l of lines) {
        const o = by.get(l.document_no) || { document_no: l.document_no, date: l.document_date, party: l.party_name, location: l.location, is_return: l.is_return, total: 0, items: 0 };
        o.total += Number(l.total_amount); o.items++; by.set(l.document_no, o);
      }
      const found = wanted.filter((d) => by.has(d)).map((d) => ({ ...by.get(d), pdf: links[d] || null }));
      setRes({ found, missing: wanted.filter((d) => !by.has(d)), lines, links });
      logActivity('bulk_find', { count: wanted.length });
    } catch (e) { ctx.notify(e.message, true); } finally { setBusy(''); }
  }

  async function zip() {
    const docs = res.found.filter((r) => r.pdf).map((r) => r.document_no);
    const parts = Math.ceil(docs.length / ZIP_BATCH);
    try {
      for (let p = 0; p < parts; p++) {
        setBusy(`Preparing ZIP ${parts > 1 ? `${p + 1} of ${parts}` : ''}…`);
        const { data, error } = await supabase.functions.invoke('receiving-zip', { body: { docs: docs.slice(p * ZIP_BATCH, (p + 1) * ZIP_BATCH) } });
        if (error) {
          let msg = error.message;
          try { const j = await error.context.json(); if (j?.error) msg = j.error; } catch { /* keep */ }
          if (/failed to send|not found|404/i.test(msg)) msg = 'ZIP download is not set up in Supabase yet (receiving-zip function).';
          throw new Error(msg);
        }
        const blob = data instanceof Blob ? data : new Blob([data], { type: 'application/zip' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `${ctx.brandName} receiving copies${parts > 1 ? ` (${p + 1} of ${parts})` : ''}.zip`;
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      }
      logActivity('bulk_zip', { count: docs.length });
      ctx.notify(`Downloaded ${docs.length} receiving copies`);
    } catch (e) { ctx.notify(e.message, true); } finally { setBusy(''); }
  }

  function excel() {
    const brandNames = Object.fromEntries(ctx.brands.map((b) => [b.id, b.name]));
    downloadMasterXlsx(`${ctx.brandName} selected invoices.xlsx`, res.lines, res.links, brandNames);
    logActivity('bulk_excel', { count: res.found.length });
    ctx.notify(`Downloaded ${res.found.length} invoices`);
  }

  const withPdf = res ? res.found.filter((r) => r.pdf).length : 0;
  return (
    <section className="card bulk" style={{ display: 'flex', flexDirection: 'column', gap: 14, backgroundImage: 'radial-gradient(ellipse at top left, rgba(94,106,210,0.10), transparent 60%)' }}>
      <div className="card-h" style={{ marginBottom: 0 }}>
        <div><h2>Bulk download</h2><span className="sub">Paste invoice numbers – one per line, or separated by commas/spaces. Any dates.</span></div>
        <button className="iconbtn" onClick={onClose} aria-label="Close bulk download">{Icon.close()}</button>
      </div>
      <textarea value={text} onChange={(e) => setText(e.target.value)} placeholder={'DOC/26-27/3535\nDOC/26-27/3540\nHR/26-27/2804'} aria-label="Invoice numbers" />
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', justifyContent: 'space-between' }}>
        <span className="sub">{wanted.length ? `${wanted.length} invoice number${wanted.length > 1 ? 's' : ''} pasted` : 'Up to 500 at a time'}</span>
        <span style={{ display: 'flex', gap: 8 }}>
          {text && <button className="btn" onClick={() => { setText(''); setRes(null); }} disabled={!!busy}>Clear</button>}
          <button className="btn btn-pri" onClick={find} disabled={!!busy || !wanted.length}>{busy === 'find' ? <><span className="spinner" /> Finding…</> : <>{Icon.search(14)} Find invoices</>}</button>
        </span>
      </div>

      {res && (
        <>
          <div className="stats">
            <div className="stat"><span className="sub">Found</span><b>{res.found.length}</b></div>
            <div className="stat"><span className="sub">With receiving copy</span><b className="pos">{withPdf}</b></div>
            <div className="stat"><span className="sub">No receiving copy yet</span><b>{res.found.length - withPdf}</b></div>
            <div className="stat"><span className="sub">Not found</span><b className={res.missing.length ? 'neg' : ''}>{res.missing.length}</b></div>
          </div>
          {res.missing.length > 0 && (
            <div className="sub" style={{ lineHeight: 1.7 }}>Not found {ctx.isAdmin ? '' : 'for your brand'}: <span className="mono">{res.missing.join(', ')}</span></div>
          )}
          {res.found.length > 0 && (
            <>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                <button className="btn btn-pri" onClick={zip} disabled={!!busy || !withPdf}>{busy.startsWith('Preparing') ? <><span className="spinner" /> {busy}</> : <>{Icon.download()} Download {withPdf} receiving copies (ZIP)</>}</button>
                <button className="btn" onClick={excel} disabled={!!busy}>{Icon.download()} Download details (Excel)</button>
              </div>
              <div className="tblwrap" style={{ maxHeight: 360, overflowY: 'auto' }}>
                <table className="tbl" style={{ minWidth: 640 }}>
                  <thead><tr><th>Invoice</th><th>Date</th><th>Outlet</th><th className="r">Total</th><th>Receiving copy</th></tr></thead>
                  <tbody>{res.found.map((r) => (
                    <tr key={r.document_no}>
                      <td className="mono" style={{ fontSize: 12 }}>{r.document_no}</td>
                      <td className="t2 nowrap">{fmtD(r.date)}</td>
                      <td style={{ maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{cleanParty(r.party)}</td>
                      <td className="r" style={{ fontWeight: 600 }}>{rs(r.total, 2)}</td>
                      <td>{r.pdf ? <a href={viewUrl(r.pdf)} target="_blank" rel="noopener noreferrer">View</a> : <span className="muted">{r.is_return ? 'credit note' : 'not yet'}</span>}</td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            </>
          )}
        </>
      )}
    </section>
  );
}
const viewUrl = (u) => { const id = driveId(u); return id ? `https://drive.google.com/file/d/${id}/view` : u; };
