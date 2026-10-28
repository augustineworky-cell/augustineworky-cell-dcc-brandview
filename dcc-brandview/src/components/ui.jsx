import { useEffect, useRef, useState, useCallback } from 'react';

export function DccMark({ size = 28, dark = false }) {
  const tile = dark ? '#15171b' : '#f7f8f8';
  const ink = dark ? '#f7f8f8' : '#111215';
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" role="img" aria-label="DCC">
      <rect width="22" height="22" rx="4" fill={tile} />
      <rect x="26" width="22" height="22" rx="4" fill={tile} />
      <rect y="26" width="22" height="22" rx="4" fill={tile} />
      <rect x="26" y="26" width="22" height="22" rx="4" fill={tile} />
      <g fill="none" stroke={ink} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 10.5L11 5l7 5.5V18H4z" /><path d="M11 9.5v6.5M8.2 11.1l5.6 3.3M13.8 11.1l-5.6 3.3" />
        <path d="M30 10.5L37 5l7 5.5V18H30z" /><path d="M33.5 18v-4.5h3.5V18M37 18v-3h3.5v3" />
        <path d="M3.5 32.5h10v8h-10zM13.5 35.5h4l2.5 3V40.5h-6.5z" /><circle cx="7" cy="42.5" r="1.7" /><circle cx="16.5" cy="42.5" r="1.7" />
        <path d="M30.5 30.5v12.5M30.5 43h5M32.5 34h4.5l2 4.5v3.5h-6.5zM41 31v12.5h3.5" /><circle cx="34.5" cy="43.5" r="1.5" /><circle cx="39" cy="43.5" r="1.5" />
      </g>
    </svg>
  );
}

export function Lockup({ big = false }) {
  return (
    <span className="lockup">
      <DccMark size={big ? 38 : 28} />
      <span className="word" style={big ? { fontSize: 27 } : null}>DCC</span>
      <span className="div" />
      <span className="prod" style={big ? { fontSize: 17 } : null}>BrandView</span>
    </span>
  );
}

const P = { fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' };
export const Icon = {
  search: (s = 15) => <svg width={s} height={s} viewBox="0 0 24 24" {...P} aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" /></svg>,
  download: (s = 15) => <svg width={s} height={s} viewBox="0 0 24 24" {...P} aria-hidden="true"><path d="M12 3v12" /><path d="M7 10l5 5 5-5" /><path d="M4 21h16" /></svg>,
  cal: (s = 15) => <svg width={s} height={s} viewBox="0 0 24 24" {...P} aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18M8 3v4M16 3v4" /></svg>,
  close: (s = 15) => <svg width={s} height={s} viewBox="0 0 24 24" {...P} aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>,
  overview: (s = 20) => <svg width={s} height={s} viewBox="0 0 24 24" {...P} aria-hidden="true"><rect x="3" y="3" width="7" height="9" rx="1" /><rect x="14" y="3" width="7" height="5" rx="1" /><rect x="14" y="12" width="7" height="9" rx="1" /><rect x="3" y="16" width="7" height="5" rx="1" /></svg>,
  box: (s = 20) => <svg width={s} height={s} viewBox="0 0 24 24" {...P} aria-hidden="true"><path d="M21 8l-9-5-9 5 9 5 9-5z" /><path d="M3 8v8l9 5 9-5V8" /></svg>,
  store: (s = 20) => <svg width={s} height={s} viewBox="0 0 24 24" {...P} aria-hidden="true"><path d="M3 9l1-5h16l1 5" /><path d="M4 9v11h16V9" /><path d="M9 20v-6h6v6" /></svg>,
  doc: (s = 20) => <svg width={s} height={s} viewBox="0 0 24 24" {...P} aria-hidden="true"><path d="M6 2h9l5 5v15H6z" /><path d="M14 2v6h6" /><path d="M9 13h7M9 17h7" /></svg>,
  upload: (s = 22) => <svg width={s} height={s} viewBox="0 0 24 24" {...P} aria-hidden="true"><path d="M12 16V4" /><path d="M7 9l5-5 5 5" /><path d="M4 16v4h16v-4" /></svg>,
  mail: (s = 16) => <svg width={s} height={s} viewBox="0 0 24 24" {...P} aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M3 7l9 6 9-6" /></svg>,
  lock: (s = 16) => <svg width={s} height={s} viewBox="0 0 24 24" {...P} aria-hidden="true"><rect x="4" y="11" width="16" height="10" rx="2" /><path d="M8 11V7a4 4 0 018 0v4" /></svg>,
  eye: (s = 16) => <svg width={s} height={s} viewBox="0 0 24 24" {...P} aria-hidden="true"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></svg>,
  arrow: (s = 15) => <svg width={s} height={s} viewBox="0 0 24 24" {...P} strokeWidth="2.2" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6" /></svg>,
  shield: (s = 14) => <svg width={s} height={s} viewBox="0 0 24 24" {...P} stroke="#4cb782" aria-hidden="true"><path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z" /><path d="M9 12l2 2 4-4" /></svg>,
  alert: (s = 22) => <svg width={s} height={s} viewBox="0 0 24 24" {...P} stroke="#eb5757" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 8v5M12 16.5v.5" /></svg>,
  empty: (s = 28) => <svg width={s} height={s} viewBox="0 0 24 24" {...P} stroke="#9ba3f5" strokeWidth="1.8" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18M8 3v4M16 3v4M9 15h6" /></svg>,
  check: (s = 15) => <svg width={s} height={s} viewBox="0 0 24 24" {...P} stroke="#4cb782" strokeWidth="2.4" aria-hidden="true"><path d="M20 6L9 17l-5-5" /></svg>,
  retry: (s = 14) => <svg width={s} height={s} viewBox="0 0 24 24" {...P} aria-hidden="true"><path d="M21 12a9 9 0 11-3-6.7L21 8" /><path d="M21 3v5h-5" /></svg>
};

/** Runs an async loader whenever deps change; returns { data, error, loading, reload }. */
export function useLoad(loader, deps) {
  const [state, setState] = useState({ data: null, error: null, loading: true });
  const seq = useRef(0);
  const run = useCallback(() => {
    const n = ++seq.current;
    setState((s) => ({ ...s, loading: true, error: null }));
    loader()
      .then((data) => { if (n === seq.current) setState({ data, error: null, loading: false }); })
      .catch((e) => { if (n === seq.current) setState({ data: null, error: e.message || String(e), loading: false }); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => { run(); }, [run]);
  return { ...state, reload: run };
}

export function Skel({ h = 14, w = '100%', style }) {
  return <div className="sk" style={{ height: h, width: w, ...style }} />;
}

export function LoadingCard({ rows = 5 }) {
  return (
    <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <Skel h={12} w="30%" />
      {Array.from({ length: rows }).map((_, i) => <Skel key={i} h={14} w={`${90 - i * 7}%`} />)}
    </div>
  );
}

export function Empty({ title = 'No sales in the dates you picked', text = 'Try a wider date range or the other warehouse.', action }) {
  return (
    <div className="state">
      <div className="ic">{Icon.empty()}</div>
      <h3>{title}</h3>
      <p>{text}</p>
      {action}
    </div>
  );
}

export function ErrorState({ message, onRetry }) {
  return (
    <div className="state">
      <div className="ic err">{Icon.alert()}</div>
      <h3>Couldn't load your sales</h3>
      <p>{message || 'Check your internet connection and try again.'}</p>
      {onRetry && <button className="btn" onClick={onRetry}>{Icon.retry()} Try again</button>}
    </div>
  );
}

export function Toast({ toast }) {
  if (!toast) return null;
  return <div className={'toast' + (toast.err ? ' err' : '')} role="status">{toast.msg}</div>;
}
