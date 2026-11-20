import { useState, useRef, useLayoutEffect, useCallback } from 'react';
import { Lockup, Icon } from './ui.jsx';
import { initials } from '../lib/format.js';
import BrandLogo from './BrandLogo.jsx';

export const PAGES = [
  { id: 'report', label: 'Sales report', icon: Icon.overview },
  { id: 'po', label: 'PO & Appointments', icon: Icon.doc },
  { id: 'stock', label: 'Stock', icon: Icon.box },
  { id: 'overview', label: 'Overview', icon: Icon.overview },
  { id: 'products', label: 'Products', icon: Icon.box },
  { id: 'outlets', label: 'Outlets', icon: Icon.store },
  { id: 'invoices', label: 'Invoices', icon: Icon.doc },
  { id: 'downloads', label: 'Downloads', icon: Icon.download, to: 'overview' }
];

export function TopBar({ page, go, profile, brands, brandId, setBrandId, onSignOut }) {
  const [open, setOpen] = useState(false);
  // optional profile photo: public/avatars/<email with symbols as dashes>.jpg (falls back to initials)
  const [photo, setPhoto] = useState(profile.email ? '/avatars/' + profile.email.toLowerCase().replace(/[^a-z0-9]+/g, '-') + '.jpg' : null);
  const navRef = useRef(null);
  const [pill, setPill] = useState(null);
  // sliding pill: follows the hovered tab, rests on the active tab
  const moveTo = useCallback((el) => {
    if (!el) return;
    setPill({ left: el.offsetLeft, top: el.offsetTop, width: el.offsetWidth, height: el.offsetHeight });
  }, []);
  const rest = useCallback(() => {
    const el = navRef.current && navRef.current.querySelector('.tlink.on');
    if (el) moveTo(el); else setPill(null);
  }, [moveTo]);
  useLayoutEffect(() => {
    rest();
    const t = setTimeout(rest, 250); // after fonts settle
    window.addEventListener('resize', rest);
    return () => { clearTimeout(t); window.removeEventListener('resize', rest); };
  }, [page, rest]);
  const isAdmin = profile.role === 'admin';
  const current = brands.find((b) => b.id === brandId);
  const chipBrand = isAdmin ? current : brands[0];
  return (
    <nav className="topbar" aria-label="Main">
      <a href="#/overview" onClick={(e) => { e.preventDefault(); go('overview'); }}><Lockup /></a>
      <span className="slash" aria-hidden="true">/</span>
      {isAdmin ? (
        <BrandPicker brands={brands} brandId={brandId} setBrandId={setBrandId} current={current} />
      ) : (
        <div className="brandchip" style={{ paddingLeft: 6 }}>
          <BrandLogo brand={chipBrand} size={26} />
          <span>{chipBrand ? chipBrand.name : 'My brand'}</span>
        </div>
      )}
      <div className="navlinks" ref={navRef} onMouseLeave={rest}>
        {pill && <span className="nav-pill" aria-hidden="true" style={pill} />}
        {PAGES.map((p) => (
          <button key={p.id} className={'tlink' + (page === p.id ? ' on' : '')} aria-current={page === p.id ? 'page' : undefined} onMouseEnter={(e) => moveTo(e.currentTarget)} onFocus={(e) => moveTo(e.currentTarget)} onBlur={rest} onClick={() => go(p.to || p.id)}>{p.label}</button>
        ))}
        {isAdmin && <button className={'tlink' + (page === 'admin' ? ' on' : '')} onMouseEnter={(e) => moveTo(e.currentTarget)} onFocus={(e) => moveTo(e.currentTarget)} onBlur={rest} onClick={() => go('admin')}>Admin</button>}
      </div>
      <div className="tright">
        <div className="menu">
          <button className="avatar" aria-label="Account" aria-expanded={open} onClick={() => setOpen(!open)}>
            {photo ? <img src={photo} alt="" onError={() => setPhoto(null)} /> : initials(profile.full_name)}
          </button>
          {open && (
            <div className="pm-back" onClick={() => setOpen(false)} role="dialog" aria-modal="true" aria-label="Profile">
              <div className="pm-card" onClick={(e) => e.stopPropagation()}>
                <button className="pm-x" aria-label="Close" onClick={() => setOpen(false)}>×</button>
                <div className="pm-photo">{photo ? <img src={photo} alt="" onError={() => setPhoto(null)} /> : <span>{initials(profile.full_name)}</span>}</div>
                <div className="pm-name">{profile.full_name || 'User'}</div>
                <div className="pm-mail">{profile.email}</div>
                <div className="pm-role">{isAdmin ? 'DCC admin · all brands' : (brands[0]?.name || '') + ' · viewer'}</div>
                {isAdmin && <button className="pm-btn" onClick={() => { setOpen(false); go('admin'); }}>Admin & uploads</button>}
                <button className="pm-btn pm-out" onClick={onSignOut}>Sign out</button>
              </div>
            </div>
          )}
        </div>
      </div>
    </nav>
  );
}

export function TabBar({ page, go, isAdmin }) {
  const items = isAdmin ? [...PAGES, { id: 'admin', label: 'Admin', icon: Icon.upload }] : PAGES;
  return (
    <nav className="tabbar" aria-label="Main">
      {items.map((p) => (
        <button key={p.id} className={page === p.id ? 'on' : ''} aria-current={page === p.id ? 'page' : undefined} onClick={() => go(p.to || p.id)}>
          {p.icon(20)}{p.label}
        </button>
      ))}
    </nav>
  );
}

const PRESETS = [['month', 'This month'], ['lastmonth', 'Last month'], ['7d', '7 days'], ['fy', 'This FY']];

export function Filters({ f, setF, presetRange, showLoc = true }) {
  return (
    <div className="controls">
      {showLoc && (
        <div className="seg" role="group" aria-label="Warehouse">
          {[[null, 'All'], ['Okhla', 'Okhla'], ['Gurgaon', 'Gurgaon']].map(([v, l]) => (
            <button key={l} className={f.loc === v ? 'on' : ''} onClick={() => setF({ ...f, loc: v })}>{l}</button>
          ))}
        </div>
      )}
      <div className="seg" role="group" aria-label="Period">
        {PRESETS.map(([k, l]) => (
          <button key={k} className={f.preset === k ? 'on' : ''} onClick={() => { const [a, b] = presetRange(k); setF({ ...f, preset: k, from: a, to: b }); }}>{l}</button>
        ))}
      </div>
      <div className="dates">
        <span className="muted" style={{ display: 'flex' }}>{Icon.cal()}</span>
        <input type="date" aria-label="From date" value={f.from} max={f.to} onChange={(e) => e.target.value && setF({ ...f, preset: null, from: e.target.value })} />
        <span className="muted">–</span>
        <input type="date" aria-label="To date" value={f.to} min={f.from} onChange={(e) => e.target.value && setF({ ...f, preset: null, to: e.target.value })} />
      </div>
    </div>
  );
}


/** Admin brand switcher: custom dropdown so every brand shows its logo. */
function BrandPicker({ brands, brandId, setBrandId, current }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useLayoutEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);
  const pick = (id) => { setBrandId(id); setOpen(false); };
  return (
    <div className="brandpick" ref={ref}>
      <button type="button" className="brandchip" aria-haspopup="listbox" aria-expanded={open} aria-label="Brand" onClick={() => setOpen(!open)} style={{ paddingLeft: 6 }}>
        <BrandLogo brand={current} size={26} />
        <span>{current ? current.name : 'All brands'}</span>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ transition: 'transform 250ms var(--ease)', transform: open ? 'rotate(180deg)' : 'none' }}><path d="M6 9l6 6 6-6" /></svg>
      </button>
      {open && (
        <div className="brandlist" role="listbox" aria-label="Brands">
          <button type="button" role="option" aria-selected={!brandId} className={'bopt' + (!brandId ? ' on' : '')} onClick={() => pick(null)} style={{ animationDelay: '0s' }}>
            <BrandLogo brand={null} size={28} /><span>All brands</span>
          </button>
          {brands.map((b, i) => (
            <button type="button" role="option" aria-selected={brandId === b.id} key={b.id} className={'bopt' + (brandId === b.id ? ' on' : '')} onClick={() => pick(b.id)} style={{ animationDelay: (0.03 * (i + 1)) + 's' }}>
              <BrandLogo brand={b} size={28} /><span>{b.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
