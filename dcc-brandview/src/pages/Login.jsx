import { useState } from 'react';
import { supabase, configMissing } from '../supabase.js';
import { DccMark, Lockup, Icon } from '../components/ui.jsx';

const TILES = [
  { no: 'DOC/26-27/3535', t: 'Zomato Hyperpure – DEL4', c: 'Okhla', d: '#5e6ad2', a: '₹4,16,754' },
  { no: 'HR/26-27/2787', t: 'Scootsy Logistics (Swiggy)', c: 'Gurgaon', d: '#e5864a', a: '₹1,59,513' },
  { no: 'SR/DL/26-27/1025', t: 'Return · Whee Consulting', c: 'Return', d: '#eb5757', a: '-₹7,824' },
  { no: 'HR/26-27/2804', t: 'Amazon Retail India', c: 'Gurgaon', d: '#e5864a', a: '₹17,955' },
  { no: 'DOC/26-27/3539', t: 'Pick N Choose Supermarket', c: 'Okhla', d: '#5e6ad2', a: '₹46,800' },
  { no: 'D3884', t: 'Bavarian Chocolate Cone 110 ml', c: 'Top SKU', d: '#4cb782', a: '11,304 pcs' },
  { no: 'HR/26-27/2793', t: 'Zomato Hyperpure – Gopalpur', c: 'Gurgaon', d: '#e5864a', a: '₹2,39,852' },
  { no: 'DOC/26-27/3537', t: 'Zepto Limited', c: 'Okhla', d: '#5e6ad2', a: '₹7,036' },
  { no: 'D4220', t: 'TBC Vanilla Caramel Protein Bar', c: 'Growing', d: '#4cb782', a: '+12%' },
  { no: 'HR/26-27/2800', t: 'Flipkart India (Binolla)', c: 'Gurgaon', d: '#e5864a', a: '₹5,460' },
  { no: 'DOC/26-27/3532', t: 'Zomato Hyperpure – DEL4', c: 'Okhla', d: '#5e6ad2', a: '₹45,564' },
  { no: 'OUTLET', t: 'Bhai Ji Foods · no order 22 days', c: 'Idle', d: '#f2994a', a: 'Follow up' }
];
const GRID = Array.from({ length: 35 }, (_, i) => ({ ...TILES[(i * 7) % TILES.length], delay: ((i * 2.3) % 9).toFixed(1) + 's' }));

export default function Login() {
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [mode, setMode] = useState('login');
  const [shake, setShake] = useState(0);

  async function submit(e) {
    e.preventDefault();
    if (configMissing) { setErr('App is not connected to Supabase yet (missing environment variables).'); return; }
    setErr(''); setBusy(true);
    if (mode === 'reset') {
      const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: window.location.origin });
      setBusy(false);
      if (error) setErr(error.message); else setErr('ok:Password reset link sent. Check your email.');
      return;
    }
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password: pw });
    setBusy(false);
    if (error) {
      setErr(/invalid login credentials/i.test(error.message) ? 'Wrong email or password.' : error.message);
      setShake((n) => n + 1);
    }
  }

  const ok = err.startsWith('ok:');
  return (
    <div className="login">
      <div className="stage" aria-hidden="true">
        <div className="plane-wrap">
          <div className="plane">
            {GRID.map((t, i) => (
              <div key={i} className="tile" style={{ animationDelay: t.delay }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span className="no">{t.no}</span>
                </div>
                <span className="tt">{t.t}</span>
                <div className="tg"><span><i style={{ width: 7, height: 7, borderRadius: '50%', background: t.d, display: 'inline-block' }} />{t.c}</span><span>{t.a}</span></div>
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="veil" aria-hidden="true" />

      <section className="login-left">
        <div className="rise"><Lockup big /></div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 26 }}>
          <span className="badge rise" style={{ animationDelay: '.1s' }}><span className="live" style={{ background: '#4cb782', color: '#4cb782', width: 6, height: 6 }} />Okhla &amp; Gurgaon · updated daily</span>
          <h1>Your sales through DCC.<br />Every outlet. Every day.</h1>
          <p className="rise" style={{ animationDelay: '.25s' }}>The secondary sales portal for brands distributed by DCC Supply Chain — products, outlets, invoices and returns, the moment they're billed.</p>
        </div>
        <div className="bwrap rise" style={{ display: 'flex', flexDirection: 'column', gap: 12, animationDelay: '.35s' }}>
          <span className="muted" style={{ fontSize: 12 }}>Brands on BrandView</span>
          <div className="bchips">
            {['Baskin Robbins', 'Pluckk', 'London Dairy', 'ITC', 'Wow! Momo', 'Blue Tribe', 'McCain'].map((b) => <span key={b}>{b}</span>)}
          </div>
        </div>
      </section>

      <section className="login-right">
        <div key={shake} className={'ring' + (shake ? ' shake' : '')}>
          <form className="lform" onSubmit={submit}>
            <div className="topline" aria-hidden="true" />
            <div className="halo" aria-hidden="true" />
            <div className="lhead">
              <div className="mark"><DccMark size={36} dark /></div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <h2>{mode === 'reset' ? 'Reset password' : 'Welcome back'}</h2>
                <p>{mode === 'reset' ? "We'll email you a reset link" : 'Sign in with the login shared by DCC MIS'}</p>
              </div>
            </div>

            <div className="fld">
              <label htmlFor="em">Work email</label>
              <div className={'field' + (err && !ok ? ' bad' : '')}>
                <span style={{ color: '#6f747d', display: 'flex' }}>{Icon.mail()}</span>
                <input id="em" type="email" autoComplete="username" required placeholder="name@yourbrand.com" value={email} onChange={(e) => setEmail(e.target.value)} />
              </div>
            </div>
            {mode === 'login' && (
              <div className="fld">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <label htmlFor="pw">Password</label>
                  <a href="#" onClick={(e) => { e.preventDefault(); setMode('reset'); setErr(''); }} style={{ fontSize: 13 }}>Forgot password?</a>
                </div>
                <div className={'field' + (err && !ok ? ' bad' : '')}>
                  <span style={{ color: '#6f747d', display: 'flex' }}>{Icon.lock()}</span>
                  <input id="pw" type={show ? 'text' : 'password'} autoComplete="current-password" required placeholder="Enter your password" value={pw} onChange={(e) => setPw(e.target.value)} />
                  <button type="button" className="eye" aria-label={show ? 'Hide password' : 'Show password'} onClick={() => setShow(!show)}>{Icon.eye()}</button>
                </div>
              </div>
            )}
            {err && (
              <div className="lerr" role="alert" style={ok ? { color: '#4cb782' } : null}>
                {ok ? Icon.check(14) : Icon.alert(14)}{ok ? err.slice(3) : err}
              </div>
            )}

            <button className="lbtn" type="submit" disabled={busy}>
              {busy ? <span className="spinner" /> : null}
              {mode === 'reset' ? 'Send reset link' : 'Sign in'}
              {!busy && Icon.arrow()}
            </button>
            {mode === 'reset' && <a href="#" style={{ textAlign: 'center', fontSize: 13 }} onClick={(e) => { e.preventDefault(); setMode('login'); setErr(''); }}>Back to sign in</a>}

            <div style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, fontSize: 12, color: '#8a8f98' }}>
              {Icon.shield()} You only ever see your own brand's data
            </div>
            <div className="lfoot">New brand partner? <a href="mailto:info@dccorp.in">Request access</a></div>
          </form>
        </div>
      </section>
    </div>
  );
}
