# Deploying VIPSAR CRM to a GoDaddy domain

A learn-as-you-go guide. Read Part 1 before clicking anything — the rest makes
far more sense once the mental model is in place.

---

## Part 1 — What is actually happening

Three separate things are involved, and people conflate them constantly:

| Thing | Who provides it | What it does |
|---|---|---|
| **The domain name** | GoDaddy (registrar) | A name you rent. It owns nothing and hosts nothing. |
| **DNS** | Whoever your *nameservers* point at | The phone book. Translates `yourdomain.com` → a server address. |
| **The host** | Vercel | The machine that actually serves your files. |

Buying a domain gives you a name in a registry. It does not give you a server.
Hosting gives you a server but no name. **DNS is the wire between them.**

So the job is only ever two moves:

1. Put the app on a server (Vercel) → you get an address.
2. Tell DNS that your name points at that address.

One more thing specific to your app. VIPSAR CRM is a **static frontend**: `npm
run build` produces a `dist/` folder of plain HTML/CSS/JS. There is no backend
server to run — Supabase is your backend and it already lives at its own URL.
That is why a static host works and why this is cheap and simple.

The subtle consequence: because everything ships to the browser, your
`VITE_SUPABASE_ANON_KEY` will be **visible in the built JavaScript**. That is by
design — the anon key is public, and your Row Level Security policies in
`Schema/rls_policies.sql` are what actually protect the data. Never put a
service-role key in a `VITE_*` variable. Anything prefixed `VITE_` is public.

---

## Part 2 — Prepare the repo

### 2.1 The `vercel.json` file (already created for you)

Your app uses `BrowserRouter` (see `src/App.jsx:25`). That means React Router
invents URLs like `/dashboard` and `/activity` that **do not exist as files** on
disk. Loading the homepage and clicking through works fine — React handles it in
memory. But if someone refreshes on `/dashboard`, or bookmarks it, the browser
asks the server for a file at that path, finds nothing, and returns 404.

The fix is a *rewrite*: tell the server "for any path you can't find, serve
`index.html` anyway and let React sort it out." That is what the `rewrites`
block does. Vercel checks the real filesystem first, so genuine files
(`sw.js`, your icons, `/assets/*`) are still served normally.

The `headers` block handles the PWA. Service workers must never be cached hard,
or users get permanently stuck on a stale version of the app with no way to
update. Hashed assets in `/assets/` get the opposite treatment — cached for a
year, because their filenames change on every build.

### 2.2 Get on a sensible branch

You are currently on `phase9-audit`. Vercel deploys your *production branch*,
which defaults to whatever your GitHub default branch is. Decide deliberately:

```bash
git status                    # commit or stash anything loose first
git checkout main             # or whichever branch should be live
git merge phase9-audit        # if the audit work belongs in production
git add vercel.json DEPLOY.md
git commit -m "Add Vercel deploy config"
git push origin main
```

If you would rather deploy `phase9-audit` as-is, that is fine — just set it as
the production branch in Vercel later (Settings → Git → Production Branch).

### 2.3 Know your environment variables

Your `.env` is gitignored, correctly — it will **not** travel with the push.
Vercel needs these three re-entered manually or the app builds to a blank screen:

```
VITE_SUPABASE_URL
VITE_SUPABASE_ANON_KEY
VITE_VAPID_PUBLIC_KEY
```

Have your local `.env` open when you get to the Vercel step.

---

## Part 3 — Deploy to Vercel

1. Go to **vercel.com** → **Sign Up** → **Continue with GitHub**. Authorise it
   for the `Raywantt` account.
2. On the dashboard: **Add New…** → **Project**.
3. Find **Vipsar-CRM** in the repo list → **Import**. If it is not listed, click
   *Adjust GitHub App Permissions* and grant access to that repo.
4. Vercel will auto-detect **Vite**. Leave Build Command (`npm run build`) and
   Output Directory (`dist`) alone — your `vercel.json` pins them anyway.
5. Expand **Environment Variables** and add all three `VITE_*` keys with their
   real values. Leave them applied to all three environments.
6. **Deploy.** Two to three minutes.

You now have a live URL like `vipsar-crm.vercel.app`. **Open it and confirm the
app actually works — log in, click around, refresh on an inner page.** Do not
move to DNS until this URL is healthy. Debugging is far easier when only one
variable is in play.

> If the build fails, read the log top to bottom. The two usual culprits are a
> missing env var and a Node version mismatch (Settings → General → Node.js
> Version; pick 22.x).

---

## Part 4 — Navigating GoDaddy

GoDaddy's interface is cluttered with upsells, and several menu items sound
like what you want but are not. Here is the map.

### 4.1 Getting to the right screen

1. Sign in at **godaddy.com**.
2. Click your **name / initials, top right** → **My Products**.
   (Direct link: `dcc.godaddy.com/control/portfolio`)
3. You will see your **Domain Portfolio** — a table of domains.
4. Click the **domain name itself** (not the checkbox, not *Manage* on a
   product card). This opens **Domain Settings**.
5. On the Domain Settings page, find the **DNS** tab or the **Manage DNS**
   link. This is the screen you want. Bookmark it.

### 4.2 Things on that page that are NOT what you want

- **Domain Forwarding** — sends visitors to another URL, often via a redirect
  or a frame. It is not hosting. It breaks HTTPS and deep links. Do not use it.
- **Website Builder / Websites + Marketing** — GoDaddy's own drag-and-drop
  product, a paid upsell. Irrelevant to you.
- **Web Hosting / cPanel** — a Linux server you would have to configure
  yourself. You do not need it; Vercel is your host.
- **Parked page** — the placeholder GoDaddy shows on unconfigured domains.

You only need the **DNS** tab. Nothing else.

### 4.3 The check that matters most — nameservers

**Do this before anything else.** You said the domain was previously used by
someone else. That is exactly the situation where this trips people up.

On the Domain Settings page, look for the **Nameservers** section.

- If it says **"Using default GoDaddy nameservers"**, or lists something like
  `ns01.domaincontrol.com` / `ns02.domaincontrol.com` — good. GoDaddy is your
  DNS provider, and edits you make in the DNS tab will take effect.

- If it lists **anything else** — `*.cloudflare.com`, `*.awsdns-*.net`,
  `ns*.bigrock.in`, a previous host's nameservers — then **GoDaddy is not
  running your DNS**. Records you add in GoDaddy's DNS tab will be silently
  ignored, because the internet is asking a different server. You would spend
  hours wondering why nothing works.

  Two options: log in to whoever owns those nameservers and add the records
  there, or click **Change Nameservers → Default** to pull DNS control back to
  GoDaddy. Pulling it back wipes any records held at the old provider, so if
  the domain has working email, capture those MX records first.

### 4.4 Audit before you edit

Still on the DNS tab, photograph or copy the full record list before touching
anything. Then read it:

| Record type | What it means | Action |
|---|---|---|
| `A` on `@` | The root domain's current destination | **Replace** — this is the one that points at your site |
| `CNAME` on `www` | Where `www` goes | **Replace** |
| `MX` (any) | **Email routing.** Delete these and email dies instantly. | **Leave alone** |
| `TXT` with `v=spf1` | Email anti-spoofing | **Leave alone** |
| `TXT` / `CNAME` starting `_dmarc`, `_domainkey`, `selector1._domainkey` | Email authentication | **Leave alone** |
| `CNAME` on `_domainconnect` | GoDaddy's own automation helper | Harmless, leave it |
| `NS` and `SOA` | Structural, not editable | Leave |

The rule of thumb: **you are only ever touching the `A` record on `@` and the
`CNAME` on `www`.** If you find yourself deleting an MX record, stop.

If there are MX records, the domain has email attached. Find out whose before
you proceed.

---

## Part 5 — Connect the domain

Work from Vercel's side first, because Vercel tells you the exact values.

### 5.1 Tell Vercel about the domain

In your Vercel project: **Settings** → **Domains** → type `yourdomain.com` →
**Add**.

Vercel will show a **domain card** with the DNS records it wants. **Those values
are the source of truth — use them over anything written here.** Vercel now
assigns per-project addresses from a pool, so your values may legitimately
differ from the common ones.

Typically it asks for:

| Type | Name | Value |
|---|---|---|
| A | `@` | `76.76.21.21` (older) or `216.198.79.1` (newer) — **read your card** |
| CNAME | `www` | `cname.vercel-dns.com` or a project-specific `<hash>.vercel-dns-0xx.com` — **read your card** |

Add the root (`yourdomain.com`) and Vercel will usually offer to add `www` too.
Accept — you want both, with one redirecting to the other.

### 5.2 Enter them at GoDaddy

Back on the GoDaddy DNS tab:

**For the A record:**

- If an `A` record on `@` already exists (likely — GoDaddy parks domains with
  one), click the **pencil / Edit** icon on that row and change only the Value.
  Editing beats delete-and-recreate; fewer ways to go wrong.
- If none exists, **Add New Record** → Type: **A** → Name: `@` → Value: the IP
  from your Vercel card → TTL: **600 seconds** (1 hour is the default, but a
  short TTL during setup means mistakes correct in minutes rather than hours —
  raise it back to 1 hour once everything works).

**For the CNAME:**

- **Add New Record** → Type: **CNAME** → Name: `www` → Value: the hostname from
  your Vercel card → TTL: 600 seconds.
- A CNAME value must be a *hostname*, never an IP. If GoDaddy rejects it, you
  have probably pasted the A record's IP by mistake.
- If a `www` CNAME already exists pointing at a parked page, edit it rather
  than adding a second — you cannot have two.

**Name field semantics:** GoDaddy wants the prefix only, never the full domain.
`@` means the root (`yourdomain.com`). `www` means `www.yourdomain.com`. Typing
`www.yourdomain.com` produces `www.yourdomain.com.yourdomain.com`, a classic
and very confusing mistake.

**Save.**

### 5.3 Wait, then verify

Propagation is usually 10–30 minutes with a 600s TTL, occasionally longer.
Vercel's Domains page polls automatically — the record turns green with a
**Valid Configuration** checkmark when it sees the change.

Verify independently from your own machine:

```bash
nslookup yourdomain.com
nslookup www.yourdomain.com
```

The first should return the Vercel IP; the second should resolve through the
Vercel hostname. If you still see an old address, your local DNS cache is
stale — try `ipconfig /flushdns` on Windows, or check from your phone on mobile
data, which uses a different resolver.

### 5.4 HTTPS

Nothing to do. Once DNS validates, Vercel automatically issues a free Let's
Encrypt certificate, usually within a minute or two. If it stalls, check for a
`CAA` record on the domain restricting which authorities may issue certs —
rare, but it is the usual cause.

---

## Part 6 — The step everyone forgets: Supabase

**Your login will break on the new domain until you do this.** Supabase Auth
refuses to redirect to URLs it does not recognise, as an anti-phishing measure.

Supabase dashboard → your project → **Authentication** → **URL Configuration**:

- **Site URL** → `https://yourdomain.com`
- **Redirect URLs** → add all of these:
  - `https://yourdomain.com/**`
  - `https://www.yourdomain.com/**`
  - `https://vipsar-crm.vercel.app/**` (keep preview deploys working)
  - `http://localhost:5173/**` (keep local dev working)

While you are there, check **Project Settings → API → CORS** if you have
restricted allowed origins; add the new domain if so.

---

## Part 7 — Verification checklist

Work through these on the live domain, ideally in a private window:

- [ ] `https://yourdomain.com` loads the app over HTTPS, no certificate warning
- [ ] `https://www.yourdomain.com` also works (redirects to the canonical one)
- [ ] `http://yourdomain.com` upgrades to HTTPS automatically
- [ ] Log in as an owner account — succeeds, lands on the dashboard
- [ ] Log in as a sales_executive — succeeds, lands on lead intake
- [ ] Navigate to `/dashboard`, then **hard refresh (Ctrl+Shift+R)** — must not
      404. This is the `vercel.json` rewrite doing its job.
- [ ] Paste `https://yourdomain.com/activity` fresh into the address bar — loads
- [ ] Browser devtools → Console — no red errors, no CORS complaints
- [ ] Devtools → Application → Service Workers — registered and activated
- [ ] On mobile, the browser offers "Add to Home Screen" (PWA install)
- [ ] If email was on this domain: **send yourself a test email** and confirm
      it arrives. Do this even if you believe you touched nothing.

---

## Common failure modes

| Symptom | Cause | Fix |
|---|---|---|
| Blank white page, console shows `supabaseUrl is required` | Env vars missing in Vercel | Add them, then **redeploy** — env vars are baked in at build time, not read at runtime |
| DNS changes seem to do nothing, for hours | Nameservers point away from GoDaddy | See 4.3 |
| 404 on refresh at `/dashboard` | Rewrite not applied | Confirm `vercel.json` is committed and pushed |
| Login redirects to `localhost` or errors | Supabase redirect URLs not updated | See Part 6 |
| Old version keeps loading after deploys | Stale service worker | Devtools → Application → Service Workers → Unregister, then hard refresh. The cache headers in `vercel.json` prevent this recurring |
| Company email stopped working | An MX record was deleted | Restore from the record list you saved in 4.4 |
| Cert stuck on "pending" for over an hour | `CAA` record blocking Let's Encrypt | Remove the CAA record or add `letsencrypt.org` to it |

---

## After it is live

Vercel now redeploys automatically on every push to your production branch.
Pull requests get their own preview URL, which is a genuinely good way to review
changes before they reach the team.

Two habits worth forming:

- Do not commit `.env`. It is gitignored; keep it that way.
- Rotate the Supabase anon key if it was ever pasted into a chat, ticket, or
  screenshot. Rotating is cheap; assuming it is fine is not.
