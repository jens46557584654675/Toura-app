# Toura — AI walkthrough videos

De complete Toura-app: makelaars maken een account aan, uploaden plattegronden en foto's, schrijven een prompt met @image-verwijzingen en genereren een cinematic walkthrough-video. Alle rendering loopt via **jouw centrale Higgsfield-key op de server** — gebruikers zien of merken niets van Higgsfield.

## Hoe het werkt

Frontend (`public/index.html`) → Toura API (`api/`) → Higgsfield Cloud.

De API regelt accounts (veilig gehasht wachtwoord, sessie-cookie), slaat projecten op in een database, host geüploade foto's, stuurt render-opdrachten naar Higgsfield en archiveert de klaar-gerenderde video zodat hij nooit verloopt.

## Online zetten (Vercel) — stap voor stap

Eenmalig, duurt ± 15 minuten. Je hebt nodig: een gratis [GitHub](https://github.com)-account, een gratis [Vercel](https://vercel.com)-account en een [Higgsfield Cloud](https://cloud.higgsfield.ai) API-key.

**Stap 1 — Zet dit project op GitHub.**
Ga naar github.com → "New repository" → naam `toura-app` → "Create". Kies daarna "uploading an existing file" en sleep alle bestanden uit deze map erin (inclusief de mappen `api`, `lib`, `public`). Klik "Commit changes".

**Stap 2 — Importeer in Vercel.**
Ga naar vercel.com → "Add New… → Project" → kies je `toura-app`-repository → "Deploy". De eerste versie staat nu online, maar kan nog geen accounts bewaren of video's renderen — dat regelen stap 3 en 4.

**Stap 3 — Voeg de database en opslag toe.**
In je Vercel-project: tabblad **Storage** → "Create Database" → kies **Upstash (Redis/KV)** → aanmaken en aan dit project koppelen. Doe hetzelfde voor **Blob** ("Create Blob Store"). Vercel vult de bijbehorende instellingen automatisch in.

**Stap 4 — Voeg je geheime sleutels toe.**
Tabblad **Settings → Environment Variables**, voeg toe:

| Naam | Waarde |
|---|---|
| `HIGGSFIELD_API_KEY` | je key van cloud.higgsfield.ai |
| `HIGGSFIELD_API_SECRET` | je secret van cloud.higgsfield.ai |
| `SESSION_SECRET` | zelfbedachte lange willekeurige tekst (32+ tekens) |

**Stap 5 — Redeploy.**
Tabblad **Deployments** → drie puntjes bij de bovenste → "Redeploy". Klaar: je app werkt volledig, voor iedereen hetzelfde.

**Stap 6 (later) — Eigen domein.**
Settings → Domains → voeg `toura.ai` toe en volg de DNS-instructies van je registrar.

## Lokaal testen

```
node dev-server.js          # → http://localhost:3000
```
Zonder database-instellingen draait alles in het geheugen (accounts verdwijnen bij herstart). Volledige testflow zonder credits te gebruiken:
```
bash test/run-e2e.sh        # 17 checks, gesimuleerde Higgsfield-server
```

## Goed om te weten

- **Kosten**: elke video kost Higgsfield-credits van jouw account. Bouw dus snel een limiet of credits-systeem per gebruiker in voordat je de app breed deelt — nu kan elke ingelogde gebruiker onbeperkt genereren.
- **Model**: standaard `higgsfield-ai/dop/standard`. Ander model? Zet env var `HF_MODEL`.
- E-mailverificatie en wachtwoord-reset zijn nog niet ingebouwd.
