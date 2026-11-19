import { useEffect, useRef, useState } from 'react';
import { supabase, configMissing } from '../supabase.js';
import { DccMark, Icon } from '../components/ui.jsx';

/* White sign-in page with a looping brand film on the left (v2, Nov 2026).
 * Add more brands to FILMS (clip in public/brand/, poster = first good frame). The page rotates through them;
 * ?brand=<key> in the link pins one brand (e.g. ?brand=baskin-robbins for a brand's own login link). */
const FILMS = [
  { key: 'baskin-robbins', brand: 'Baskin Robbins', dot: '#d63a7a', src: '/brand/baskin-robbins.mp4', poster: '/brand/baskin-robbins.jpg',
    line: 'Every scoop you sell through DCC, in one place.' }
];

function pickStart() {
  try { const q = new URLSearchParams(window.location.search).get('brand'); const i = FILMS.findIndex((f) => f.key === q); return i < 0 ? 0 : i; } catch { return 0; }
}

export default function Login() {
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [mode, setMode] = useState('login');
  const [shake, setShake] = useState(0);
  const [idx, setIdx] = useState(pickStart);
  const [playing, setPlaying] = useState(false);
  const vid = useRef(null);
  const film = FILMS[idx];

  /* one film plays twice, then the next brand (only when there is more than one and no ?brand= pin) */
  useEffect(() => {
    const v = vid.current; if (!v) return;
    setPlaying(false);
    let loops = 0;
    const pinned = new URLSearchParams(window.location.search).has('brand');
    const onEnd = () => { loops += 1; if (FILMS.length > 1 && !pinned && loops >= 2) setIdx((i) => (i + 1) % FILMS.length); else { v.currentTime = 0; v.play().catch(() => {}); } };
    v.addEventListener('ended', onEnd);
    v.play().catch(() => {});
    return () => v.removeEventListener('ended', onEnd);
  }, [idx]);

  async function google() {
    if (configMissing) { setErr('App is not connected to Supabase yet (missing environment variables).'); return; }
    setErr(''); setBusy(true);
    const { error } = await supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: window.location.origin } });
    if (error) { setBusy(false); setErr(error.message); }
  }

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
    <div className="vlogin">
      <div className="vl-bg" aria-hidden="true">
        <img className={'vl-poster' + (playing ? ' gone' : '')} src={film.poster} alt="" />
        <video key={film.key} ref={vid} src={film.src} poster={film.poster} autoPlay muted playsInline preload="auto"
          onPlaying={() => setPlaying(true)} />
        <div className="vl-shade" />
      </div>

      <header className="vl-top">
        <div className="vl-logo"><DccMark size={34} /><span className="w">DCC</span><span className="p">BrandView</span></div>
        <div className="vl-tag"><i style={{ background: film.dot }} />{film.brand} · Okhla &amp; Gurgaon</div>
      </header>

      <main className="vl-center">
        <div key={shake} className={'vl-formwrap' + (shake ? ' shake' : '')}>
          <form className="vl-form" onSubmit={submit}>
            <h2>{mode === 'reset' ? 'Reset password' : 'Welcome back'}</h2>
            <p className="vl-sub">{mode === 'reset' ? "We'll email you a reset link." : 'Sign in with the login shared by DCC MIS.'}</p>

            {mode === 'login' && (
              <>
                <button type="button" className="vl-btn" disabled={busy} onClick={google}
                  style={{ background: '#fff', color: '#1f2937', border: '1px solid #d1d5db', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10 }}>
                  <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.5 5.4 2.6 13.2l7.9 6.1C12.4 13.6 17.7 9.5 24 9.5z"/><path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.6 5.9c4.5-4.1 7-10.2 7-17.6z"/><path fill="#FBBC05" d="M10.5 28.7c-.5-1.4-.8-3-.8-4.7s.3-3.2.8-4.7l-7.9-6.1C.9 16.4 0 20.100 0 24s.9 7.600 2.600 10.800l7.900-6.100z"/><path fill="#34A853" d="M24 48c6.500 0 12-2.100 16-5.800l-7.600-5.900c-2.100 1.400-4.900 2.300-8.400 2.300-6.300 0-11.600-4.100-13.500-9.800l-7.900 6.100C6.500 42.600 14.600 48 24 48z"/></svg>
                  Sign in with Google
                </button>
                <p className="vl-sub" style={{ textAlign: 'center', margin: '12px 0' }}>or use your email and password</p>
              </>
            )}

            <label htmlFor="em">Work email
              <span className={'vl-field' + (err && !ok ? ' bad' : '')}>
                {Icon.mail()}
                <input id="em" type="email" autoComplete="username" required placeholder="name@yourbrand.com" value={email} onChange={(e) => setEmail(e.target.value)} />
              </span>
            </label>
            {mode === 'login' && (
              <label htmlFor="pw">
                <span className="vl-row"><span>Password</span><a href="#" onClick={(e) => { e.preventDefault(); setMode('reset'); setErr(''); }}>Forgot password?</a></span>
                <span className={'vl-field' + (err && !ok ? ' bad' : '')}>
                  {Icon.lock()}
                  <input id="pw" type={show ? 'text' : 'password'} autoComplete="current-password" required placeholder="Enter your password" value={pw} onChange={(e) => setPw(e.target.value)} />
                  <button type="button" className="vl-eye" aria-label={show ? 'Hide password' : 'Show password'} onClick={() => setShow(!show)}>{Icon.eye()}</button>
                </span>
              </label>
            )}
            {err && <div className={'vl-msg' + (ok ? ' ok' : '')} role="alert">{ok ? Icon.check(14) : Icon.alert(14)}{ok ? err.slice(3) : err}</div>}

            <button className="vl-btn" type="submit" disabled={busy}>
              {busy ? <span className="spinner" /> : null}
              {mode === 'reset' ? 'Send reset link' : 'Sign in'}
              {!busy && Icon.arrow()}
            </button>
            {mode === 'reset' && <a href="#" className="vl-back" onClick={(e) => { e.preventDefault(); setMode('login'); setErr(''); }}>Back to sign in</a>}
            <div className="vl-note">{Icon.shield()} You only ever see your own brand's data</div>
          </form>
        </div>
      </main>

      <footer className="vl-foot">
        <h1 key={film.key}>{film.line}</h1>
        <span>DCC Supply Chain &amp; Distribution LLP · New brand partner? <a href="mailto:info@dccorp.in">Request access</a></span>
      </footer>
    </div>
  );
}
