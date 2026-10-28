import { useEffect, useState } from 'react';
import { rpc, logActivity } from '../supabase.js';
import { rs, inr, inWords, fmtD, fmtDY, cleanItem, cleanParty } from '../lib/format.js';
import { downloadXlsx } from '../lib/tally.js';
import { useLoad, LoadingCard, Empty, ErrorState, Skel, Icon } from '../components/ui.jsx';
import { PageHead, scopeLabel } from '../components/Parts.jsx';

const PAGE = 60;

export default function Invoices({ ctx }) {
  const [type, setType] = useState(null);
  const [q, setQ] = useState(ctx.invSearch || '');
  const [dq, setDq] = useState(q);
  const [limit, setLimit] = useState(PAGE);
  const [sel, setSel] = useState(null);

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
      <button className="btn btn-pri" onClick={() => exportList().catch((e) => ctx.notify(e.message, true))}>{Icon.download()} Export</button>
    </PageHead>
  );
  const rows = list.data ? list.data.slice(0, limit) : [];
  const more = list.data && list.data.length > limit;

  return (
    <main className="page">
      {head}
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
