# Toura — AI walkthrough videos for real estate agents

Toura lets real estate agents turn listing photos into cinematic walkthrough videos.
Owner: Jens (Diepeveen makelaars context, Dutch market). UI language: **English**. Style: ultra-minimal — white background, grey (#f4f4f4) blocks, black pill buttons, Inter font, "T" monogram + lowercase "toura" wordmark.

**Prices appear on the Billing page and nowhere else** (plan cards only, from `lib/billing.js`). Never surface € anywhere else in the UI — least of all render costs, which stay internal.

## Communicatie

Praat tegen Jens in gewoon Nederlands, zonder technisch jargon — hij is niet technisch.
Vat samen wat je deed in 2-3 simpele zinnen. Leg alleen uit wat hij moet weten of beslissen.
Is een technische term echt nodig, leg hem dan in één zin uit.
(Dit geldt voor het gesprek; de UI en de code/commits blijven Engels.)

## Architecture

Static frontend + Vercel serverless functions. No framework, no build step.

- `public/index.html` — the entire frontend (single file: HTML + CSS + vanilla JS).
- `api/` — Vercel functions: `auth/*` (signup/signin/signout/me), `projects` (list), `generate` (create project + first clip render), `project` (actions: reorder, regenerate, finalize, addclip, removeclip, music, branding, merge, export, rename, delete), `status` (poll fal jobs + advance merge pipeline), `music` (library: upload, AI-generate via Lyria2, favorites), `branding` (logo + outro clips per user), `billing` (plans + subscription choice), `account` (profile photo), `edit` action on `project` (video-editor choices).
- `lib/` — `fal.js` (fal.ai client, models, base prompt, cost accounting), `blob.js` (Vercel Blob hosting for photos/audio/videos/branding), `db.js` (Redis via KV_REDIS_URL or Upstash REST, in-memory fallback for dev), `auth.js` (scrypt + HMAC session cookie), `projects.js` (helpers), `branding.js` (per-user logo + outro clips, aspect→variant mapping), `billing.js` (plan catalogue + subscription record), `shotstack.js` (Shotstack cloud editor — real text/logo burn-in on export).

## Rendering pipeline (cost-optimized — keep it this way)

1. Working clips ALWAYS render at **480p**, silent (`generate_audio:false`). Model: `bytedance/seedance-2.0/fast/reference-to-video` via fal.ai queue API (`queue.fal.run`). Up to 9 photos per clip via `image_urls`, referenced as @Image1..N in the prompt.
2. Per-clip **finalize** re-renders that single clip at **720p** (only changed/new clips — never re-render everything). 720p is the max; NO 1080p/upscale.
3. **`export` is the only place clips get stitched.** Two routes, chosen automatically in `api/project.js`:
   - **Shotstack** (`mergedPending.phase:'shotstack'`) when text cards or a logo are active — it concatenates the clips (720p finals if present, else 480p) + branding outro, burns in the logo (bottom-right) and timed text cards, and lays the soundtrack, all in ONE render. Polled in `status.js` via `shotstackGet` → `response.status:'done'` → `response.url`. ~€0.20–0.30 per export (1 credit = 1 min, any resolution).
   - **fal fallback** (cheaper, no overlays): `merge-videos` over the clips (+ outro), then music via `merge-audio-video`. Chained `mergedPending.phase`: `export` → `audio` (`outro` is a pre-2026-07 alias).
   Either way the result is archived to Blob. Export never triggers a Seedance render.
4. The `merge` action (kind `concept`/`final`) still exists for older projects but **nothing in the UI calls it**. Step 3 previews the walkthrough client-side instead (see below), so checking the order costs nothing at fal.
5. Hidden base prompt in `lib/fal.js` (TOURA_BASE_PROMPT): only use source photos, one continuous shot, no hallucinations, silent. User prompt goes between route sentence and base prompt.
6. Internal budget: `renderCost()` tracks € per project (480p ≈ €0.14/s, 720p ≈ €0.28/s); blocked above `TOURA_BUDGET_EUR` (default 45). ADMIN_EMAIL account bypasses. Never show € in the UI.

## Frontend flow

Dashboard (big drop zone → upload popup: name + aspect auto/16:9/9:16) → step bar: **1 Upload photos · 2 Route & clips · 3 Concept video · 4 Final video**. Each page after the dashboard shows a ghost "Dashboard" button on the right of the title row (in addition to the ← Back button on the left).

- **2 Route & clips**: drag & drop route; per-clip prompt + length slider 2–15s, default 8; render per clip; ✎ next to the title renames the project (before the first render the name only lives in the upload field). Ends with "Continue to concept video →".
- **3 Concept video** (view id `final`): draggable clip cards + a branding-video card, then the client-side concept player, then "Continue to final video →" plus a "Download all clips" button (fetches each clip's best file for agents who want to edit themselves). No 720p controls here.
- **4 Final video** (view id `postprod`): section a) Final quality · 720p, b) Music, c) Export.

NB: the view ids are `final` (Concept video) and `postprod` (Final video) — labels were renamed, ids were not, to avoid churning the whole single-file frontend. `STEPS` in the JS carries the labels.

Every step in the bar is a grey bubble; the active one is marked by the black circle and heavier text, not by a different background.

### Step 3 (Concept video) — preview costs nothing

Two stacked `<video>` elements alternate: while one plays, the next is already loaded in the other, so the hand-over is a class swap rather than a load (`setupConceptPlayer`). The player keeps the video's natural size (no fixed crop; the front element drives height at natural aspect, `min-height:180px` prevents a pre-metadata collapse). Click the video or the ▶ button to pause/resume.

Clicking a segment plays that clip from the start (`load(i,true)`). It plays each clip's best source — 720p final if rendered, else 480p.

The clip cards (dashed border = draggable) are followed by a non-draggable **branding-video card**: click it to toggle `project.branding.outro`. When on, the branding outro (variant matching the project aspect; landscape for `auto`) is appended as the LAST item of both the concept playlist and the export merge. No branding video uploaded → the card sends the user to the Branding page with a toast. This is the same flag the "Add branding video" option in step 4 toggles, so they stay in sync.

### Step 4 (Final video)

a) **Final quality · 720p** — reuses the per-clip `finalize` action (only changed/new clips re-render — the cost saver, do not touch). "Upgrade N clip(s) to 720p" button, or a green "All clips in final quality" tick when done. b) **Video editing** — the timeline (click it, or "Open editor", to open the editor modal) + the branding option. c) **Export** — `Create export`: the single merge of the 720p finals (or 480p when not all are upgraded) + branding outro + music.

### Video editor modal (`openEditor` / `saveEditor`, state in `edState`)

A self-contained modal (no external editor/icon libs). Top: a single-`<video>` sequential preview that plays the clips (720p if present, else 480p) with the branding outro appended when that toggle is on. Text cards and the logo render as **HTML overlays** on top of the preview (`.edoverlays`) — positioned via `.edtext.{tl,tc,tr,bl,bc,br}` and `.edlogo`. Below: a thumbnail timeline (width ∝ clip duration, click to jump) with the outro block toggle, then a stylized (not decoded) music bar. Panels: multiple text cards (text + position + which clip cids it shows during), a logo toggle (Branding logo, bottom-right), the branding-outro toggle, and the music picker (reuses `bindMpick`, audio previews via a dedicated `edState._audio`). Footer carries **"Text & logo in export: coming soon"**, Cancel, Save.

Save posts `{action:'edit', edit:{texts, logo, logoSize, brandingOutro, music}}` → `project.edit` (logoSize `small`|`medium`). **Text and logo are really burned into the export** via Shotstack (see below); `brandingOutro` and `music` are mirrored onto `project.branding.outro` / `project.music`, the fields the export reads, so the editor stays the single place to set them.

### Overlay burn-in — Shotstack

Text cards and the logo are burned into the exported file by **Shotstack** (`lib/shotstack.js`, `buildShotstackEdit`). The timeline: a base track of the clips (cumulative `start`+`length` from each clip's declared duration; the outro appended with `length:'auto'`), a top track with the logo (`image`, `position:'bottomRight'`, `length:'end'`, scale 0.13 small / 0.22 medium) and one `text` clip per (text card × selected clip) with its `start`/`length` and position anchor. `timeline.soundtrack` carries the music; `output` is mp4 / `resolution:'hd'` (720p) / project aspect. Submit → poll like fal, archive to Blob.

Why Shotstack over the earlier options: fal's ffmpeg-api can't position an overlay or draw text; ffmpeg.wasm (client-side) works but costs a ~30 MB download + 2–8 min encode + CSP/isolation changes and breaks the single-file convention. Shotstack's JSON model maps 1:1 to the job, price is flat (1 credit = 1 min at any resolution, ~€0.20–0.30/export), and the submit/poll shape matches the existing fal code. Text font is `Montserrat` (a Shotstack built-in) — Inter would need a hosted font file. **Unverified against the live API** (built to the current docs + a local stub); a real Shotstack key should be smoke-tested once.

Navigation is a single avatar dropdown in every nav bar, injected by `paintUserMenus()` into each empty `.nav-right` — do not hand-write nav links per page. Items: My account, Dashboard, Music, Branding, Billing, Dark mode (toggle, keeps the menu open), Log out. Icons are inline 16px SVG paths in the `ICON` map, stroked in `currentColor` — no icon library.

### Theming

All colours come from CSS custom properties on `:root`, overridden by `body[data-theme=dark]`: `--ink`, `--muted`, `--grey`, `--grey2`, `--line` plus `--bg` (page), `--card` (raised surface), `--on-ink` (text on an `--ink` fill), `--navbg`, `--pill` (labels floating over media), `--dash`, `--edge`, `--hover` (theme-aware surface lift on hover — do not hardcode a light hover colour, it turns white in dark mode and swallows text), `--bar` (tray behind the progress bar, sits slightly darker than the step bubbles). **Never hardcode `#fff` for a surface** — the only two survivors are white glyphs on fixed-dark circles over photos. The choice is stored in `localStorage.toura_theme`; with nothing stored the device setting wins and keeps winning until the user toggles.

### Billing / My account

`My account` shows name, email (password change is a TODO) and the current plan. `Billing` renders the three plan cards from `lib/billing.js`. Choosing a plan only writes `{plan, status:'pending', since}` to `billing:{email}` and shows a confirmation — no payment provider yet, and nothing anywhere gates on it (everyone keeps full access on `trial`). The Stripe/Mollie TODO sits in `api/billing.js`; mark a subscription active from the provider webhook, never from that handler.

Music library page: Favorites / Toura picks (ADMIN_EMAIL uploads + AI-generate) / My uploads. Track duration is read in the browser (`probeDuration`) and stored as `dur` on upload; older tracks are probed lazily on render.

Branding page: kantoor logo (PNG recommended, max 2 MB) + one outro clip per orientation (landscape 16:9 / portrait 9:16, mp4). Step 4 offers "Add branding video" (appends the outro matching the project aspect; disabled when that variant is missing) and "Add logo overlay" (disabled, "Coming soon" — see below).

### Logo overlay — why it is disabled

fal's `ffmpeg-api/compose` accepts image tracks, but a `Keyframe` is only `{timestamp, duration, url}`: no x/y/width/scale/opacity, so "small in a corner" is not expressible, and alpha handling is undocumented. No watermark/overlay endpoint exists in the ffmpeg-api family (`compose`, `merge-videos`, `merge-audio-video`, `merge-audios`, `extract-frame`, `images-to-video`, `metadata`, `waveform`). The only workaround would be pre-rendering a full-frame transparent PNG per resolution and hoping compose layers it over the video — two unverified behaviours. Re-check before building.

## Upload limits

Uploads travel as base64 data URLs in the request body, which inflates them ~33%, and Vercel caps a serverless request body at 4.5 MB. So the real ceiling is **3 MB per file** (`MAX_UPLOAD_MB` in `lib/blob.js`), logo 2 MB. A "4 MB" limit would silently fail. Raising it means switching to client-side direct-to-Blob uploads.

## Environment variables (Vercel)

`FAL_KEY` (fal.ai), `SHOTSTACK_API_KEY` (Shotstack render key for overlay exports; **production key** so downloads have no watermark), `SESSION_SECRET`, `ADMIN_EMAIL` (Toura admin account: unlimited budget, curates "Toura picks" music), `KV_REDIS_URL` (auto, Redis), `BLOB_READ_WRITE_TOKEN` (auto, Blob), optional `SHOTSTACK_ENV` (`v1` prod default / `stage` sandbox), `TOURA_BUDGET_EUR`, `FAL_MODEL`, `HF_BASE`/`FAL_BASE`/`SHOTSTACK_BASE` (test stubs).

## Development & deploy

- Local dev: `node dev-server.js` → http://localhost:3000 (in-memory DB without env vars).
- Tests: `bash test/run-e2e.sh` — full flow against a fal stub (no credits). Keep total runtime < ~40s. ALWAYS run this before pushing.
- Deploy: push to `main` on GitHub → Vercel auto-deploys. No separate build step.
- After changing API shapes, update `test/run-e2e.sh` and `test/fal-stub.js` accordingly.

## Conventions

- Keep everything dependency-light (only @upstash/redis, @vercel/blob, redis; dev: none).
- Single-file frontend; no frameworks. Escape user strings with `esc()`.
- Data lives in Redis: `user:{email}`, `projects:{email}` (full project objects), `music:catalog`, `music:{email}`, `musicfav:{email}`, `musicgen:{email}`, `branding:{email}`, `billing:{email}` (kept off the user record so billing writes can never clobber the password hash). Profile photo is a `photo` field on `user:{email}` (resized to ~256px client-side, hosted via `hostImage`); `/api/auth/me`, signin and signup return it so the nav avatar shows it. `project.edit` = `{texts, logo, logoSize, brandingOutro, music}` holds video-editor choices.
- fal queue: always store `status_url`/`response_url` from the submit response (the queue lives at the base app id, not the full endpoint path).
- `merge-videos` needs ≥2 urls and, when concatenating differently-shaped input, `resolution_aspect_ratio_video_index: 0` — its default takes min width AND min height across inputs, which can yield an aspect matching neither clip.
- The fal stub records every submitted job at `GET localhost:9999/_calls`; the Shotstack stub does the same at `GET localhost:9998/_calls`, so tests can assert what each service was asked to do.

## Roadmap / known gaps

- Payments: plan cards + subscription record exist, but no checkout and no gating yet (Stripe/Mollie later). The internal render budget guard is unrelated and still active.
- Email verification + password reset (required before real customers).
- Server-side render completion via fal webhooks (now: client polling; closing the tab pauses progress tracking, renders continue).
- Team accounts. Text/title + logo overlays are burned into the export via Shotstack (see "Overlay burn-in"); smoke-test against a real Shotstack key still pending. Multiple text cards supported; one shared font (Montserrat).
- Photo upload per-file (current: data URLs in one request; fine ≤45 downscaled photos).
