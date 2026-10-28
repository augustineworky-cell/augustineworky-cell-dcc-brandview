import { useState } from 'react';
import { Lockup, Icon } from './ui.jsx';
import { initials } from '../lib/format.js';

export const PAGES = [
  { id: 'overview', label: 'Overview', icon: Icon.overview },
  { id: 'products', label: 'Products', icon: Icon.box },
  { id: 'outlets', label: 'Outlets', icon: Icon.store },
  { id: 'invoices', label: 'Invoices', icon: Icon.doc }
];

export function TopBar({ page, go, profile, brands, brandId, setBrandId, onSignOut }) {
  const [open, setOpen] = useState(false);
  const isAdmin = profile.role === 'admin';
  const current = brands.find((b) => b.id === brandId);
  const chipBrand = isAdmin ? current : brands[0];
  return (
    <nav className="topbar" aria-label="Main">
      <a href="#/overview" onClick={(e) => { e.preventDefault(); go('overview'); }}><Lockup /></a>
      <span className="slash" aria-hidden="true">/</span>
      <label className="brandchip">
        <span className="bdot" style={{ background: chipBrand ? chipBrand.color + '22' : '#1c1e24', color: chipBrand ? chipBrand.color : '#b4b8c0' }}>
          {chipBrand ? initials(chipBrand.name) : 'ALL'}
        </span>
        {isAdmin ? (
          <select aria-label="Brand" value={brandId || ''} onChange={(e) => setBrandId(e.target.value || null)}>
            <option value="">All brands</option>
            {brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        ) : (
          <span>{chipBrand ? chipBrand.name : 'My brand'}</span>
        )}
      </label>
      <div className="navlinks">
        {PAGES.map((p) => (
          <button key={p.id} className={'tlink' + (page === p.id ? ' on' : '')} aria-current={page === p.id ? 'page' : undefined} onClick={() => go(p.id)}>{p.label}</button>
        ))}
        {isAdmin && <button className={'tlink' + (page === 'admin' ? ' on' : '')} onClick={() => go('admin')}>Admin</button>}
      </div>
      <div className="tright">
        <div className="menu">
          <button className="avatar" aria-label="Account" aria-expanded={open} onClick={() => setOpen(!open)}>{initials(profile.full_name)}</button>
          {open && (
            <div className="menu-pop" onMouseLeave={() => setOpen(false)}>
              <div className="who">
                <div style={{ fontWeight: 600 }}>{profile.full_name || 'User'}</div>
                <div className="sub">{profile.email}</div>
                <div className="sub">{isAdmin ? 'DCC admin · all brands' : (brands[0]?.name || '') + ' · viewer'}</div>
              </div>
              {isAdmin && <button onClick={() => { setOpen(false); go('admin'); }}>Admin & uploads</button>}
              <button onClick={onSignOut}>Sign out</button>
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
        <button key={p.id} className={page === p.id ? 'on' : ''} aria-current={page === p.id ? 'page' : undefined} onClick={() => go(p.id)}>
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
