# DCC BrandView

Secondary-sales portal for brands distributed by **DCC Supply Chain & Distribution**.
Each brand logs in and sees only its own sales (Okhla + Gurgaon); DCC admins see every brand and upload the daily Tally exports.

**Stack:** React + Vite (static site on Vercel) · Supabase (Postgres, Auth, row-level security)

## Pages
| Page | What it shows |
|---|---|
| Sign in | Email + password (Supabase Auth), password reset |
| Overview | Net sales vs last month, invoices, quantity, active/idle outlets, returns, daily Okhla vs Gurgaon chart, top products, top outlets, latest invoices |
| Products | Every SKU with qty, net sales, outlets, Okhla/Gurgaon split, change vs last month · Excel export |
| Outlets | Every outlet with bills, SKUs, last order and status (Active / Slowing / Not ordered) · Excel export |
| Invoices | Sales and credit notes, search, bill detail with item lines · Excel export per list or per bill |
| Admin (DCC only) | Upload Tally "New Sales Report" files → preview → publish; map new Tally item groups to brands; per-brand totals; upload history; logins |

## Security
All filtering happens in the database. `sales_lines` has row-level security: a brand user can only read rows where
`brand_id = my_brand_id()`; admins (`profiles.role = 'admin'`) read everything. Report functions (`rpt_*`) are `security invoker`,
so the same rules apply. The browser only ever holds the **publishable** key.

## Deploy on Vercel
1. Vercel → **Add New → Project** → import this GitHub repo. Framework preset: **Vite** (detected automatically).
2. **Environment Variables** – add both, for Production and Preview:
   - `VITE_SUPABASE_URL` = `https://wqihutjxrmeuuiezevty.supabase.co`
   - `VITE_SUPABASE_PUBLISHABLE_KEY` = `sb_publishable_…` (Supabase → Project Settings → API Keys)
3. Deploy.
4. In Supabase → **Authentication → URL Configuration**, set **Site URL** to the Vercel URL (needed for password-reset emails).
5. Custom domain later: Vercel → Settings → Domains → `brands.dccorp.in` (CNAME at the DNS host).

## Run locally
```bash
npm install
cp .env.example .env.local   # fill in the publishable key
npm run dev
```

## Daily update (admin)
Admin → drop the Okhla and Gurgaon Tally exports → check the preview → **Publish to brands**.
Header/Total rows, DCC internal transfers and duplicate lines are removed automatically; re-uploading the same day is safe.

## Adding a brand login
1. Supabase → Authentication → Users → **Add user** (tick *Auto Confirm User*).
2. Link it to the brand:
```sql
insert into public.profiles (user_id, full_name, role, brand_id)
select u.id, 'Arun – London Dairy', 'brand', b.id
from auth.users u, public.brands b
where u.email = 'arun@example.com' and b.slug = 'london-dairy';
```
Brand slugs: `baskin-robbins` (incl. TBC), `pluckk`, `itc`, `blue-tribe`, `london-dairy`, `wow-momo`, `mccain`, `goeld`.
To disable someone: `update public.profiles set active = false where user_id = …`.
