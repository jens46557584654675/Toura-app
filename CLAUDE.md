# Toura — AI walkthrough videos for real estate agents

Toura lets real estate agents turn listing photos into cinematic walkthrough videos.
Owner: Jens (Diepeveen makelaars context, Dutch market). UI language: **English**. Style: ultra-minimal — white background, grey (#f4f4f4) blocks, black pill buttons, Inter font, "T" monogram + lowercase "toura" wordmark. Never add prices/costs to the UI.

## Communicatie

Praat tegen Jens in gewoon Nederlands, zonder technisch jargon — hij is niet technisch.
Vat samen wat je deed in 2-3 simpele zinnen. Leg alleen uit wat hij moet weten of beslissen.
Is een technische term echt nodig, leg hem dan in één zin uit.
(Dit geldt voor het gesprek; de UI en de code/commits blijven Engels.)

## Architecture

Static frontend + Vercel serverless functions. No framework, no build step.

- `public/index.html` — the entire frontend (single file: HTML + CSS + vanilla JS).
- `api/` — Vercel functions: `auth/*` (signup/signin/signout/me), `projects` (list), `generate` (create project + first clip render), `project` (actions: reorder, regenerate, finalize, addclip, removeclip, music, branding, merge, export, rename, delete), `status` (poll fal jobs + advance merge pipeline), `music` (library: upload, AI-generate via Lyria2, favorites), `branding` (logo + outro clips per user).
- `lib/` — `fal.js` (fal.ai client, models, base prompt, cost accounting), `blob.js` (Vercel Blob hosting for photos/audio/videos/branding), `db.js` (Redis via KV_REDIS_URL or Upstash REST, in-memory fallback for dev), `auth.js` (scrypt + HMAC session cookie), `projects.js` (helpers), `branding.js` (per-user logo + outro clips, aspect→variant mapping).

## Rendering pipeline (cost-optimized — keep it this way)

1. Working clips ALWAYS render at **480p**, silent (`generate_audio:false`). Model: `bytedance/seedance-2.0/fast/reference-to-video` via fal.ai queue API (`queue.fal.run`). Up to 9 photos per clip via `image_urls`, referenced as @Image1..N in the prompt.
2. Per-clip **finalize** re-renders that single clip at **720p** (only changed/new clips — never re-render everything). 720p is the max; NO 1080p/upscale.
3. `merge` kind `concept` (480p clips) or `final` (720p clips) via `fal-ai/ffmpeg-api/merge-videos`.
4. `export` = final||concept, then optionally the branding outro via `merge-videos`, then optionally music via `merge-audio-video`. Chained through `mergedPending.phase`: `outro` → `audio`. Branding never triggers a Seedance render — ffmpeg steps only.
5. Hidden base prompt in `lib/fal.js` (TOURA_BASE_PROMPT): only use source photos, one continuous shot, no hallucinations, silent. User prompt goes between route sentence and base prompt.
6. Internal budget: `renderCost()` tracks € per project (480p ≈ €0.14/s, 720p ≈ €0.28/s); blocked above `TOURA_BUDGET_EUR` (default 45). ADMIN_EMAIL account bypasses. Never show € in the UI.

## Frontend flow

Dashboard (big drop zone → upload popup: name + aspect auto/16:9/9:16) → step bar: 1 Upload photos, 2 Route & clips (drag & drop route with cut-dots between photos; per-clip prompt + length slider 2–15s, default 8; render per clip), 3 Final video (drag clip cards to reorder — free; concept 480p → upgrade 720p), 4 Music & export (timeline, music picker, branding options, download).

Navigation is a single avatar dropdown in every nav bar (Dashboard / Music / Branding / Log out), injected by `paintUserMenus()` into each empty `.nav-right` — do not hand-write nav links per page.

Music library page: Favorites / Toura picks (ADMIN_EMAIL uploads + AI-generate) / My uploads. Track duration is read in the browser (`probeDuration`) and stored as `dur` on upload; older tracks are probed lazily on render.

Branding page: kantoor logo (PNG recommended, max 2 MB) + one outro clip per orientation (landscape 16:9 / portrait 9:16, mp4). Step 4 offers "Add branding video" (appends the outro matching the project aspect; disabled when that variant is missing) and "Add logo overlay" (disabled, "Coming soon" — see below).

### Logo overlay — why it is disabled

fal's `ffmpeg-api/compose` accepts image tracks, but a `Keyframe` is only `{timestamp, duration, url}`: no x/y/width/scale/opacity, so "small in a corner" is not expressible, and alpha handling is undocumented. No watermark/overlay endpoint exists in the ffmpeg-api family (`compose`, `merge-videos`, `merge-audio-video`, `merge-audios`, `extract-frame`, `images-to-video`, `metadata`, `waveform`). The only workaround would be pre-rendering a full-frame transparent PNG per resolution and hoping compose layers it over the video — two unverified behaviours. Re-check before building.

## Upload limits

Uploads travel as base64 data URLs in the request body, which inflates them ~33%, and Vercel caps a serverless request body at 4.5 MB. So the real ceiling is **3 MB per file** (`MAX_UPLOAD_MB` in `lib/blob.js`), logo 2 MB. A "4 MB" limit would silently fail. Raising it means switching to client-side direct-to-Blob uploads.

## Environment variables (Vercel)

`FAL_KEY` (fal.ai), `SESSION_SECRET`, `ADMIN_EMAIL` (Toura admin account: unlimited budget, curates "Toura picks" music), `KV_REDIS_URL` (auto, Redis), `BLOB_READ_WRITE_TOKEN` (auto, Blob), optional `TOURA_BUDGET_EUR`, `FAL_MODEL`, `HF_BASE`/`FAL_BASE` (test stubs).

## Development & deploy

- Local dev: `node dev-server.js` → http://localhost:3000 (in-memory DB without env vars).
- Tests: `bash test/run-e2e.sh` — full flow against a fal stub (no credits). Keep total runtime < ~40s. ALWAYS run this before pushing.
- Deploy: push to `main` on GitHub → Vercel auto-deploys. No separate build step.
- After changing API shapes, update `test/run-e2e.sh` and `test/fal-stub.js` accordingly.

## Conventions

- Keep everything dependency-light (only @upstash/redis, @vercel/blob, redis; dev: none).
- Single-file frontend; no frameworks. Escape user strings with `esc()`.
- Data lives in Redis: `user:{email}`, `projects:{email}` (full project objects), `music:catalog`, `music:{email}`, `musicfav:{email}`, `musicgen:{email}`, `branding:{email}`.
- fal queue: always store `status_url`/`response_url` from the submit response (the queue lives at the base app id, not the full endpoint path).
- `merge-videos` needs ≥2 urls and, when concatenating differently-shaped input, `resolution_aspect_ratio_video_index: 0` — its default takes min width AND min height across inputs, which can yield an aspect matching neither clip.
- The fal stub records every submitted job at `GET localhost:9999/_calls`, so tests can assert what fal was actually asked to do.

## Roadmap / known gaps

- Credits/subscription system (Starter €49 = 1 video) — budget guard exists, no payments yet (Stripe/Mollie later).
- Email verification + password reset (required before real customers).
- Server-side render completion via fal webhooks (now: client polling; closing the tab pauses progress tracking, renders continue).
- Team accounts, text/title overlay in video (postponed by choice). Logo overlay blocked on fal capability (see above).
- Photo upload per-file (current: data URLs in one request; fine ≤45 downscaled photos).
