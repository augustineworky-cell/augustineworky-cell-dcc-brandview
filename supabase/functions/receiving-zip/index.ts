// BrandView receiving-zip: zips the stamped receiving copies (Google Drive files) for a list of invoices.
// Runs as the signed-in user, so row-level security decides which invoices they may download.
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { zipSync } from 'npm:fflate@0.8.2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Expose-Headers': 'content-disposition'
};
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } });
const EXT: Record<string, string> = { 'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/png': 'png', 'image/heic': 'heic', 'image/heif': 'heif', 'image/webp': 'webp' };
const driveId = (u: string) => (u.match(/[?&]id=([\w-]{10,})/) || u.match(/\/d\/([\w-]{10,})/) || [])[1];

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
  try {
    const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } }, auth: { persistSession: false }
    });
    const { data: { user } } = await db.auth.getUser();
    if (!user) return json({ error: 'Not signed in' }, 401);

    const body = await req.json().catch(() => ({}));
    const docs: string[] = [...new Set((Array.isArray(body.docs) ? body.docs : []).map((d: unknown) => String(d).trim()).filter(Boolean))].slice(0, 50) as string[];
    if (!docs.length) return json({ error: 'No invoices' }, 400);

    // RLS: a brand only gets rows for bills that contain only its own brand
    const { data: rows, error } = await db.from('invoice_documents').select('document_no, file_url').in('document_no', docs);
    if (error) throw error;

    const files: Record<string, Uint8Array> = {};
    const failed: string[] = [];
    const allowed = new Set((rows ?? []).map((r) => r.document_no));
    for (const d of docs) if (!allowed.has(d)) failed.push(`${d} - no receiving copy available`);

    const queue = [...(rows ?? [])];
    async function worker() {
      while (queue.length) {
        const r = queue.shift()!;
        const id = driveId(r.file_url);
        const url = id ? `https://drive.usercontent.google.com/download?id=${id}&export=download&confirm=t` : r.file_url;
        try {
          const res = await fetch(url, { redirect: 'follow' });
          const type = (res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
          if (!res.ok || type.startsWith('text/html')) { failed.push(`${r.document_no} - file is not shared as "Anyone with the link"`); continue; }
          const buf = new Uint8Array(await res.arrayBuffer());
          const cd = res.headers.get('content-disposition') || '';
          const fromName = (cd.match(/filename\*?=(?:UTF-8'')?"?([^";]+)/i) || [])[1]?.split('.').pop()?.toLowerCase();
          const ext = EXT[type] || (fromName && fromName.length <= 5 ? fromName : 'pdf');
          files[`${r.document_no.replace(/[\\/:*?"<>|]/g, '-')}.${ext}`] = buf;
        } catch (_e) { failed.push(`${r.document_no} - could not download`); }
      }
    }
    await Promise.all(Array.from({ length: 5 }, worker));

    if (failed.length) files['_not included.txt'] = new TextEncoder().encode('These invoices are not in the ZIP:\r\n\r\n' + failed.join('\r\n') + '\r\n');
    if (!Object.keys(files).some((k) => !k.startsWith('_'))) return json({ error: 'None of the receiving copies could be downloaded. ' + (failed[0] ?? '') }, 422);

    const zip = zipSync(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, [v, { level: 0 }]])));
    return new Response(zip, { headers: { ...cors, 'Content-Type': 'application/octet-stream', 'Content-Disposition': 'attachment; filename="receiving-copies.zip"' } });
  } catch (e) {
    return json({ error: (e as Error).message ?? String(e) }, 500);
  }
});
