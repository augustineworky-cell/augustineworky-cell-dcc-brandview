import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

export const configMissing = !url || !key;

export const supabase = configMissing
  ? null
  : createClient(url, key, {
      auth: { persistSession: true, autoRefreshToken: true }
    });

/** Calls a report function and throws a readable error. */
export async function rpc(fn, args) {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw new Error(error.message);
  return data || [];
}

export function logActivity(action, detail) {
  if (!supabase) return;
  supabase.from('activity_log').insert({ action, detail }).then(() => {});
}
