import { useEffect, useState } from 'react';

/*
 * One floating card that shows what a download is doing:
 *   Loading data (live row count) → Building the Excel → Saving → ✓ Done
 * Use:  const job = startDownload('PO & Appointments');
 *       job.step('load', 'Loading PO lines', { done: 3000, total: 25000 });
 *       job.step('build', 'Building Excel · 4 tabs');  await job.paint();   // let the card draw before heavy work
 *       job.done('881 POs · 25,047 lines');   or   job.fail('message')
 */
const STEPS = [['load', 'Loading data'], ['build', 'Building Excel'], ['save', 'Saving file']];
let state = null;
const subs = new Set();
const emit = () => subs.forEach((f) => f(state));
let hideTimer = null;

export function startDownload(title) {
  clearTimeout(hideTimer);
  state = { id: Date.now(), title, stage: 'load', label: 'Loading data…', done: 0, total: 0, status: 'run', note: '', started: Date.now() };
  emit();
  const id = state.id;
  const live = () => state && state.id === id;
  return {
    step(stage, label, prog) {
      if (!live()) return;
      state = { ...state, stage, label: label || state.label, done: prog?.done ?? (stage !== state.stage ? 0 : state.done), total: prog?.total ?? (stage !== state.stage ? 0 : state.total) };
      emit();
    },
    progress(done, total) { if (live()) { state = { ...state, done, total: total ?? state.total }; emit(); } },
    paint: () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 40))),
    done(note) {
      if (!live()) return;
      state = { ...state, status: 'ok', stage: 'done', note: note || '' }; emit();
      hideTimer = setTimeout(() => { if (live()) { state = null; emit(); } }, 3200);
    },
    fail(msg) {
      if (!live()) return;
      state = { ...state, status: 'err', note: msg || 'Download failed' }; emit();
      hideTimer = setTimeout(() => { if (live()) { state = null; emit(); } }, 6000);
    },
  };
}

/** Wrap any download: shows the card, catches errors. */
export async function trackDownload(title, fn) {
  const job = startDownload(title);
  try { const note = await fn(job); job.done(note); return true; } catch (e) { job.fail(e?.message || String(e)); return false; }
}

function pct(s) {
  if (s.status === 'ok') return 100;
  const base = { load: 4, build: 72, save: 92 }[s.stage] ?? 0;
  const span = { load: 66, build: 18, save: 6 }[s.stage] ?? 0;
  const frac = s.total ? Math.min(1, s.done / s.total) : 0;
  return Math.round(base + span * frac);
}

export function DownloadProgress() {
  const [s, setS] = useState(state);
  const [, tick] = useState(0);
  useEffect(() => { subs.add(setS); return () => subs.delete(setS); }, []);
  useEffect(() => {
    if (!s || s.status !== 'run') return undefined;
    const t = setInterval(() => tick((x) => x + 1), 500);
    return () => clearInterval(t);
  }, [s?.id, s?.status]);
  if (!s) return null;
  const p = pct(s);
  const secs = Math.max(0, Math.round((Date.now() - s.started) / 1000));
  const idx = s.status === 'ok' ? STEPS.length : Math.max(0, STEPS.findIndex(([k]) => k === s.stage));
  return (
    <div className={'dlp ' + s.status} role="status" aria-live="polite" key={s.id}>
      <div className="dlp-top">
        <div className="dlp-icon">
          {s.status === 'ok'
            ? <svg viewBox="0 0 24 24" width="18" height="18"><path className="dlp-check" d="M5 12.5l4.2 4.2L19 7" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
            : s.status === 'err' ? <span>!</span>
              : <svg viewBox="0 0 24 24" width="18" height="18" className="dlp-arrow"><path d="M12 4v11m0 0l-4.5-4.5M12 15l4.5-4.5M5 19.5h14" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" /></svg>}
        </div>
        <div className="dlp-txt">
          <div className="dlp-title">{s.status === 'ok' ? 'Downloaded' : s.status === 'err' ? 'Download failed' : 'Preparing download'} · {s.title}</div>
          <div className="dlp-label">
            {s.status === 'run' ? <>{s.label}{s.total ? <> · <b>{s.done.toLocaleString('en-IN')}</b> of {s.total.toLocaleString('en-IN')}</> : s.done ? <> · <b>{s.done.toLocaleString('en-IN')}</b> rows</> : null}</> : s.note}
          </div>
        </div>
        {s.status === 'run' && <div className="dlp-pct">{p}%</div>}
      </div>
      <div className="dlp-bar"><i style={{ width: p + '%' }} /></div>
      <div className="dlp-steps">
        {STEPS.map(([k, l], i) => (
          <span key={k} className={i < idx ? 'done' : i === idx && s.status === 'run' ? 'now' : ''}>{i < idx ? '✓ ' : ''}{l}</span>
        ))}
        {s.status === 'run' && <span className="dlp-time">{secs}s</span>}
      </div>
    </div>
  );
}
