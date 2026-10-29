// BrandView admin-users: lets a DCC admin create / disable brand logins from the app.
// The service-role key stays on Supabase's server (env var), never in the browser.
import { createClient } from 'jsr:@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
  try {
    const url = Deno.env.get('SUPABASE_URL')!;
    const anon = Deno.env.get('SUPABASE_ANON_KEY')!;
    const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    // 1. who is calling? must be an active admin
    const caller = createClient(url, anon, { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } }, auth: { persistSession: false } });
    const { data: { user } } = await caller.auth.getUser();
    if (!user) return json({ error: 'Not signed in' }, 401);
    const { data: me } = await caller.from('profiles').select('role, active').eq('user_id', user.id).maybeSingle();
    if (!me || me.role !== 'admin' || !me.active) return json({ error: 'Admins only' }, 403);

    const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });
    const b = await req.json();

    if (b.action === 'list') {
      const { data, error } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
      if (error) throw error;
      return json({ users: data.users.map((u) => ({ id: u.id, email: u.email, last_sign_in_at: u.last_sign_in_at, created_at: u.created_at })) });
    }

    if (b.action === 'create') {
      const email = String(b.email ?? '').trim().toLowerCase();
      const password = String(b.password ?? '');
      const full_name = String(b.full_name ?? '').trim().slice(0, 80);
      const role = b.role === 'admin' ? 'admin' : 'brand';
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ error: 'Enter a valid email' }, 400);
      if (password.length < 8) return json({ error: 'Password must be at least 8 characters' }, 400);
      if (!full_name) return json({ error: 'Enter a name' }, 400);
      if (role === 'brand' && !b.brand_id) return json({ error: 'Pick a brand' }, 400);
      const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name } });
      if (error) return json({ error: /already/i.test(error.message) ? 'This email already has a login' : error.message }, 400);
      const { error: pErr } = await admin.from('profiles').insert({ user_id: data.user.id, full_name, role, brand_id: role === 'brand' ? b.brand_id : null, active: true });
      if (pErr) { await admin.auth.admin.deleteUser(data.user.id); return json({ error: pErr.message }, 400); }
      await admin.from('activity_log').insert({ user_id: user.id, action: 'login_created', detail: { email, role, brand_id: b.brand_id ?? null } }).then(() => {}, () => {});
      return json({ ok: true, user_id: data.user.id });
    }

    if (b.action === 'set_password') {
      if (String(b.password ?? '').length < 8) return json({ error: 'Password must be at least 8 characters' }, 400);
      const { error } = await admin.auth.admin.updateUserById(b.user_id, { password: b.password });
      if (error) throw error;
      return json({ ok: true });
    }

    if (b.action === 'set_active') {
      if (b.user_id === user.id) return json({ error: 'You cannot disable yourself' }, 400);
      const active = !!b.active;
      const { error } = await admin.from('profiles').update({ active }).eq('user_id', b.user_id);
      if (error) throw error;
      await admin.auth.admin.updateUserById(b.user_id, { ban_duration: active ? 'none' : '876000h' });
      return json({ ok: true });
    }

    return json({ error: 'Unknown action' }, 400);
  } catch (e) {
    return json({ error: (e as Error).message ?? String(e) }, 500);
  }
});
