import { useEffect, useState, useCallback } from 'react';
import { supabase, configMissing, logActivity } from './supabase.js';
import { presetRange } from './lib/format.js';
import { TopBar, TabBar } from './components/Shell.jsx';
import { DccMark, Toast, Icon } from './components/ui.jsx';
import Login from './pages/Login.jsx';
import Overview from './pages/Overview.jsx';
import Products from './pages/Products.jsx';
import Outlets from './pages/Outlets.jsx';
import Invoices from './pages/Invoices.jsx';
import SalesReport from './pages/SalesReport.jsx';
import Admin from './pages/Admin.jsx';

const pageFromHash = () => (window.location.hash.replace(/^#\/?/, '') || 'overview').split('?')[0];

function Splash({ text }) {
  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 16 }}>
      <div className="mark" style={{ animation: 'none' }}><DccMark size={36} dark /></div>
      <span className="muted" style={{ display: 'flex', alignItems: 'center', gap: 10 }}><span className="spinner" />{text}</span>
    </div>
  );
}

function Notice({ title, text, onSignOut }) {
  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div className="card state" style={{ maxWidth: 460 }}>
        <div className="ic err">{Icon.alert()}</div>
        <h3>{title}</h3>
        <p>{text}</p>
        {onSignOut && <button className="btn" onClick={onSignOut}>Sign out</button>}
      </div>
    </div>
  );
}

function SetPassword({ done }) {
  const [pw, setPw] = useState('');
  const [msg, setMsg] = useState('');
  async function save(e) {
    e.preventDefault();
    if (pw.length < 8) { setMsg('Use at least 8 characters.'); return; }
    const { error } = await supabase.auth.updateUser({ password: pw });
    if (error) setMsg(error.message); else done();
  }
  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div className="ring" style={{ maxWidth: 420 }}>
        <form className="lform" onSubmit={save} style={{ paddingBottom: 30 }}>
          <div className="lhead"><div className="mark"><DccMark size={36} dark /></div><h2>Set a new password</h2></div>
          <div className="fld"><label htmlFor="np">New password</label>
            <div className="field"><span style={{ color: '#6f747d', display: 'flex' }}>{Icon.lock()}</span>
              <input id="np" type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} /></div></div>
          {msg && <div className="lerr">{Icon.alert(14)}{msg}</div>}
          <button className="lbtn" type="submit">Save password {Icon.arrow()}</button>
        </form>
      </div>
    </div>
  );
}

export default function App() {
  const [session, setSession] = useState(undefined);
  const [recovery, setRecovery] = useState(false);
  const [profile, setProfile] = useState(undefined);
  const [brands, setBrands] = useState([]);
  const [brandId, setBrandId] = useState(null);
  const [page, setPage] = useState(pageFromHash());
  const [toast, setToast] = useState(null);
  const [invSearch, setInvSearch] = useState('');
  const [theme, setTheme] = useState(() => { try { return localStorage.getItem('bv-theme') || 'dark'; } catch { return 'dark'; } });
  const toggleTheme = () => setTheme((t) => { const n = t === 'light' ? 'dark' : 'light'; try { localStorage.setItem('bv-theme', n); } catch { /* private mode */ } return n; });
  useEffect(() => {
    document.body.style.background = profile && theme === 'light' ? '#f6f7f9' : '';
    return () => { document.body.style.background = ''; };
  }, [theme, profile]);
  const [f, setF] = useState(() => { const [from, to] = presetRange('month'); return { preset: 'month', from, to, loc: null }; });

  const notify = useCallback((msg, err = false) => {
    setToast({ msg, err });
    setTimeout(() => setToast(null), 3200);
  }, []);

  useEffect(() => {
    if (configMissing) return;
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((event, s) => {
      if (event === 'PASSWORD_RECOVERY') setRecovery(true);
      setSession(s);
    });
    const onHash = () => setPage(pageFromHash());
    window.addEventListener('hashchange', onHash);
    return () => { data.subscription.unsubscribe(); window.removeEventListener('hashchange', onHash); };
  }, []);

  useEffect(() => {
    if (!session) { setProfile(session === null ? null : undefined); return; }
    let live = true;
    (async () => {
      const { data: p, error } = await supabase.from('profiles').select('user_id, full_name, role, brand_id, active').eq('user_id', session.user.id).maybeSingle();
      if (!live) return;
      if (error || !p || !p.active) { setProfile(false); return; }
      const { data: b } = await supabase.from('brands').select('id, name, slug, color, active').order('name');
      if (!live) return;
      setBrands((b || []).filter((x) => x.active || p.role === 'admin'));
      setProfile({ ...p, email: session.user.email });
      logActivity('login', { email: session.user.email });
    })();
    return () => { live = false; };
  }, [session]);

  const go = (p) => { window.location.hash = '/' + p; setPage(p); window.scrollTo({ top: 0 }); };
  const signOut = async () => { await supabase.auth.signOut(); setProfile(null); setBrands([]); setBrandId(null); };

  if (configMissing) return <Notice title="Not connected yet" text="Add VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY in Vercel (Settings → Environment Variables) and redeploy." />;
  if (recovery && session) return <SetPassword done={() => { setRecovery(false); notify('Password updated'); }} />;
  if (session === undefined) return <Splash text="Loading…" />;
  if (!session) return <Login />;
  if (profile === undefined) return <Splash text="Loading your brand…" />;
  if (profile === false) return <Notice title="Access not set up" text={`You're signed in as ${session.user.email}, but this login isn't linked to a brand yet. Ask the DCC MIS team to enable it.`} onSignOut={signOut} />;
  if (!profile) return <Splash text="Signing out…" />;

  const isAdmin = profile.role === 'admin';
  const ctx = {
    ...f,
    brand: isAdmin ? brandId : null,
    brandName: isAdmin ? (brands.find((b) => b.id === brandId)?.name || 'All brands') : (brands[0]?.name || 'My brand'),
    isAdmin, setF, notify, go, brands,
    invSearch, setInvSearch,
    openInvoices: (party) => { setInvSearch(party); go('invoices'); },
    viewAs: (id) => { setBrandId(id); go('overview'); }
  };
  const view = page === 'admin' && isAdmin ? 'admin' : (['overview', 'products', 'outlets', 'invoices', 'report'].includes(page) ? page : 'overview');

  return (
    <div className="app" data-theme={theme}>
      <TopBar page={view} go={go} profile={profile} brands={brands} brandId={brandId} setBrandId={setBrandId} onSignOut={signOut} theme={theme} toggleTheme={toggleTheme} />
      {view === 'overview' && <Overview ctx={ctx} />}
      {view === 'products' && <Products ctx={ctx} />}
      {view === 'outlets' && <Outlets ctx={ctx} />}
      {view === 'invoices' && <Invoices ctx={ctx} />}
      {view === 'report' && <SalesReport ctx={ctx} />}
      {view === 'admin' && <Admin ctx={ctx} />}
      <TabBar page={view} go={go} isAdmin={isAdmin} />
      <Toast toast={toast} />
    </div>
  );
}
