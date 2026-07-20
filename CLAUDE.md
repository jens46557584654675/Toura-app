# Toura — AI walkthrough videos for real estate agents

Toura lets real estate agents turn listing photos into cinematic walkthrough videos.
Owner: Jens (Diepeveen makelaars context, Dutch market). UI language: **English**. Style: ultra-minimal — white background, grey (#f4f4f4) blocks, black pill buttons, Inter font, "T" monogram + lowercase "toura" wordmark. Never add prices/costs to the UI.

## Architecture

Static frontend + Vercel serverless functions. No framework, no build step.

- `public/index.html` — the entire frontend (single file: HTML + CSS + vanilla JS).
- `api/` — Vercel functions: `auth/*` (signup/signin/signout/me), `projects` (list), `generate` (create project + first clip render), `project` (actions: reorder, regenerate, finalize, addclip, removeclip, music, merge, export, rename, delete), `status` (poll fal jobs + advance merge pipeline), `music` (library: upload, AI-generate via Lyria2, favorites).
- `lib/` — `fal.js` (fal.ai client, models, base prompt, cost accounting), `blob.js` (Vercel Blob hosting for photos/audio/videos), `db.js` (Redis via KV_REDIS_URL or Upstash REST, in-memory fallback for dev), `auth.js` (scrypt + HMAC session cookie), `projects.js` (helpers).

## Rendering pipeline (cost-optimized — keep it this way)

1. Working clips ALWAYS render at **480p**, silent (`generate_audio:false`). Model: `bytedance/seedance-2.0/fast/reference-to-video` via fal.ai queue API (`queue.fal.run`). Up to 9 photos per clip via `image_urls`, referenced as @Image1..N in the prompt.
2. Per-clip **finalize** re-renders that single clip at **720p** (only changed/new clips — never re-render everything). 720p is the max; NO 1080p/upscale.
3. `merge` kind `concept` (480p clips) or `final` (720p clips) via `fal-ai/ffmpeg-api/merge-videos`.
4. `export` = final||concept + optional music via `fal-ai/ffmpeg-api/merge-audio-video`.
5. Hidden base prompt in `lib/fal.js` (TOURA_BASE_PROMPT): only use source photos, one continuous shot, no hallucinations, silent. User prompt goes between route sentence and base prompt.
6. Internal budget: `renderCost()` tracks € per project (480p ≈ €0.14/s, 720p ≈ €0.28/s); blocked above `TOURA_BUDGET_EUR` (default 45). ADMIN_EMAIL account bypasses. Never show € in the UI.

## Frontend flow

Dashboard (big drop zone → upload popup: name + aspect auto/16:9/9:16) → step bar: 1 Upload photos, 2 Route & clips (drag & drop route with cut-dots between photos; per-clip prompt + length slider 2–15s, default 8; render per clip), 3 Final video (drag clip cards to reorder — free; concept 480p → upgrade 720p), 4 Music & export (timeline, music picker, download). Music library page: Favorites / Toura picks (ADMIN_EMAIL uploads + AI-generate) / My uploads.

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
- Data lives in Redis: `user:{email}`, `projects:{email}` (full project objects), `music:catalog`, `music:{email}`, `musicfav:{email}`, `musicgen:{email}`.
- fal queue: always store `status_url`/`response_url` from the submit response (the queue lives at the base app id, not the full endpoint path).

## Roadmap / known gaps

- Credits/subscription system (Starter €49 = 1 video) — budget guard exists, no payments yet (Stripe/Mollie later).
- Email verification + password reset (required before real customers).
- Server-side render completion via fal webhooks (now: client polling; closing the tab pauses progress tracking, renders continue).
- Kantoor branding (logo, outro card), team accounts, text/title overlay in video (postponed by choice).
- Photo upload per-file (current: data URLs in one request; fine ≤45 downscaled photos).
