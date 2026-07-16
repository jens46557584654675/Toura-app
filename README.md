# Toura — AI walkthrough videos

De complete Toura-app: makelaars maken een account aan, uploaden plattegronden en foto's, schrijven een prompt met @image-verwijzingen en genereren een cinematic walkthrough-video met **Seedance 2.0 via fal.ai**. Alle rendering loopt via **jouw centrale fal-key op de server** — je betaalt puur per gegenereerde video, geen abonnement. Gebruikers zien alleen Toura.

## Hoe het werkt

Frontend (`public/index.html`) → Toura API (`api/`) → fal.ai (Seedance 2.0 + ffmpeg).

De flow voor makelaars: foto's uploaden (drag & drop) → **route** bepalen door foto's te slepen en met "cuts" op te knippen in clips (elke clip = één doorlopend shot, max 9 foto's) → **muziek** kiezen (Toura picks, favorieten of eigen upload) → automatisch voorgestelde prompt → Generate. Daarna in het review-scherm: clips herordenen, goede clips locken, mislukte opnieuw genereren, los downloaden, en met één knop samenvoegen tot een **final video met muziek** (via fal ffmpeg).

De API regelt accounts (gehasht wachtwoord, sessie-cookie), projecten in de database, foto/muziek-hosting, render-opdrachten en archiveert klare video's zodat ze nooit verlopen.

## Online zetten (Vercel) — stap voor stap

Eenmalig, ± 15 minuten. Nodig: gratis [GitHub](https://github.com)- en [Vercel](https://vercel.com)-accounts en een [fal.ai](https://fal.ai)-account met tegoed.

**Stap 1 — Zet dit project op GitHub.** New repository → `toura-app` → upload alle bestanden en mappen → Commit changes.

**Stap 2 — Importeer in Vercel.** Add New → Project → kies de repository → Deploy.

**Stap 3 — Database en opslag.** Tabblad Storage → Create Database → **Redis** (prefix: `KV`) → koppel aan het project. Daarna Create → **Blob** (access: public) → koppel.

**Stap 4 — Geheime sleutels.** Settings → Environment Variables:

| Naam | Waarde |
|---|---|
| `FAL_KEY` | je API-key van fal.ai/dashboard/keys |
| `SESSION_SECRET` | zelfbedachte lange willekeurige tekst (32+ tekens) |
| `ADMIN_EMAIL` | jouw Toura-loginmail — muziek die dit account uploadt verschijnt voor álle gebruikers als "Toura picks" |

**Stap 5 — Redeploy.** Deployments → ⋯ bij de bovenste → Redeploy. Klaar.

**Stap 6 (later) — Eigen domein.** Settings → Domains → `toura.ai` toevoegen.

## Lokaal testen

```
node dev-server.js          # → http://localhost:3000
bash test/run-e2e.sh        # 20 checks, gesimuleerde fal-server, geen kosten
```

## Goed om te weten

- **Kosten**: elke video kost fal-tegoed (Seedance 2.0 fast, ± enkele dubbeltjes per 720p-clip). Er zit nog géén limiet per gebruiker in — bouw een credits-systeem in voordat je de app breed deelt.
- **Model wisselen**: standaard `bytedance/seedance-2.0/fast/reference-to-video`. Hogere kwaliteit? Zet env var `FAL_MODEL` op `bytedance/seedance-2.0/reference-to-video`.
- **Instellingen in de app**: duur Auto/5/10/15s, aspect 16:9/9:16/Auto, kwaliteit 480p/720p, audio automatisch aan.
- E-mailverificatie en wachtwoord-reset zijn nog niet ingebouwd.
