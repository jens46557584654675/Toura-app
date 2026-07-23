#!/bin/bash
# End-to-end test: starts the fal stub + dev server, walks the full multi-clip flow.
cd "$(dirname "$0")/.." || exit 1
node test/fal-stub.js > /tmp/stub.log 2>&1 &
STUB=$!
node test/shotstack-stub.js > /tmp/shotstack.log 2>&1 &
SS=$!
node test/mail-stub.js > /tmp/mail.log 2>&1 &
ML=$!
# AUTH_IP_LIMIT high so the many test auth calls aren't blocked; FAIL_LIMIT stays
# 5 so the per-email lockout is exercised.
FAL_BASE=http://localhost:9999 FAL_KEY=test-key \
  SHOTSTACK_BASE=http://localhost:9998 SHOTSTACK_API_KEY=test-key SHOTSTACK_ENV=v1 \
  RESEND_BASE=http://localhost:9997 RESEND_API_KEY=test-key MAIL_FROM='Toura <test@toura.com>' \
  AUTH_IP_LIMIT=500 AUTH_FAIL_LIMIT=5 \
  ADMIN_EMAIL=jens@toura.com node dev-server.js > /tmp/dev.log 2>&1 &
DEV=$!
trap "kill $STUB $SS $ML $DEV 2>/dev/null" EXIT

# Wait for both servers to accept connections (fixed sleeps race on cold start).
wait_up(){
  for _ in $(seq 1 100); do
    curl -s -o /dev/null "$1" && return 0
    sleep 0.1
  done
  echo "FATAL  $1 never came up"; exit 1
}
wait_up localhost:3000/
wait_up localhost:9999/
wait_up localhost:9998/
wait_up localhost:9997/_mails

J=/tmp/jar.txt; rm -f $J
PASS=0; FAIL=0
check(){
  local name=$1 pattern=$2 body=$3
  # An empty pattern matches anything and an empty body means the request never
  # landed — both used to report PASS. Treat them as failures.
  if [ -z "$pattern" ]; then echo "FAIL  $name → empty pattern (extraction failed upstream)"; FAIL=$((FAIL+1)); return; fi
  if [ -z "$body" ]; then echo "FAIL  $name → empty response"; FAIL=$((FAIL+1)); return; fi
  if echo "$body" | grep -q "$pattern"; then echo "PASS  $name"; PASS=$((PASS+1)); else echo "FAIL  $name → $(echo "$body"|head -c 300)"; FAIL=$((FAIL+1)); fi
}

# Pull a value out of a JSON response. Prints nothing (instead of echoing the
# whole blob back, which makes checks trivially self-match) when absent.
jget(){ echo "$1" | python3 -c "
import sys,json
try: d=json.load(sys.stdin)
except Exception: sys.exit(0)
for k in sys.argv[1:]:
    if d is None: sys.exit(0)
    d = d[int(k)] if isinstance(d,list) else d.get(k)
print(d if d is not None else '')
" "${@:2}" 2>/dev/null; }

# Abort early when an extraction yields nothing: every downstream check would
# otherwise run against a bogus id and report misleading failures.
require_val(){ [ -n "$2" ] || { echo "FATAL  could not extract $1"; exit 1; }; }

# Poll /api/status until $1 matches (or ~20s). Polling is also what drives the
# fal job + merge pipeline forward, so this doubles as the pump. Echoes the last
# response either way, letting check() report the real body on timeout.
poll_status(){
  local last
  for _ in $(seq 1 100); do
    last=$(curl -s -b $J "localhost:3000/api/status?id=$PID")
    echo "$last" | grep -q "$1" && break
    sleep 0.2
  done
  echo "$last"
}

R=$(curl -s -c $J -X POST localhost:3000/api/auth/signup -H 'Content-Type: application/json' -d '{"name":"Jens Diepeveen","email":"jens@toura.com","password":"toura2026!"}')
check "signup" '"email":"jens@toura.com"' "$R"

R=$(curl -s -c $J -X POST localhost:3000/api/auth/signin -H 'Content-Type: application/json' -d '{"email":"jens@toura.com","password":"fout"}')
check "wrong password rejected" 'Wrong email or password' "$R"

R=$(curl -s -c $J -X POST localhost:3000/api/auth/signin -H 'Content-Type: application/json' -d '{"email":"jens@toura.com","password":"toura2026!"}')
check "signin" '"email"' "$R"

# --- password policy (≥10 chars, a letter and a number) ---
R=$(curl -s -X POST localhost:3000/api/auth/signup -H 'Content-Type: application/json' -d '{"name":"Weak","email":"weak@toura.com","password":"ab1"}')
check "signup rejects a short password" 'at least 10 characters' "$R"
R=$(curl -s -X POST localhost:3000/api/auth/signup -H 'Content-Type: application/json' -d '{"name":"Weak","email":"weak@toura.com","password":"abcdefghijkl"}')
check "signup rejects a password with no number" 'at least one number' "$R"
R=$(curl -s -X POST localhost:3000/api/auth/signup -H 'Content-Type: application/json' -d '{"name":"Dup","email":"jens@toura.com","password":"another2026x"}')
check "signup rejects a duplicate email" 'already exists' "$R"

# --- failed-login lockout: 5 attempts allowed, the 6th is blocked ---
for i in 1 2 3 4 5; do
  R=$(curl -s -X POST localhost:3000/api/auth/signin -H 'Content-Type: application/json' -d '{"email":"locktest@toura.com","password":"nope123456"}')
done
check "5th failed sign-in still the normal error" 'Wrong email or password' "$R"
R=$(curl -s -X POST localhost:3000/api/auth/signin -H 'Content-Type: application/json' -d '{"email":"locktest@toura.com","password":"nope123456"}')
check "6th failed sign-in is rate-limited" 'Too many failed sign-ins' "$R"

# --- change password (My account) ---
R=$(curl -s -b $J -X POST localhost:3000/api/account -H 'Content-Type: application/json' -d '{"action":"password","current":"wrongpw123","newPassword":"brandnew2026x"}')
check "change password checks the current one" 'current password is incorrect' "$R"
R=$(curl -s -b $J -X POST localhost:3000/api/account -H 'Content-Type: application/json' -d '{"action":"password","current":"toura2026!","newPassword":"short1"}')
check "change password enforces the policy" 'at least 10 characters' "$R"
R=$(curl -s -b $J -X POST localhost:3000/api/account -H 'Content-Type: application/json' -d '{"action":"password","current":"toura2026!","newPassword":"changed2026x"}')
check "password changed" '"ok":true' "$R"
CJ=/tmp/cj.txt; rm -f $CJ
R=$(curl -s -c $CJ -X POST localhost:3000/api/auth/signin -H 'Content-Type: application/json' -d '{"email":"jens@toura.com","password":"changed2026x"}')
check "sign in with the new password" '"email":"jens@toura.com"' "$R"
R=$(curl -s -X POST localhost:3000/api/auth/signin -H 'Content-Type: application/json' -d '{"email":"jens@toura.com","password":"toura2026!"}')
check "old password no longer works" 'Wrong email or password' "$R"

# --- forgot / reset password ---
R=$(curl -s -X POST localhost:3000/api/auth/forgot -H 'Content-Type: application/json' -d '{"email":"jens@toura.com"}')
check "forgot returns a generic message" 'reset link is on its way' "$R"
R=$(curl -s -X POST localhost:3000/api/auth/forgot -H 'Content-Type: application/json' -d '{"email":"nobody@toura.com"}')
check "forgot does not leak unknown emails" 'reset link is on its way' "$R"
# Pull the reset token out of the email the stub captured.
RTOKEN=$(curl -s localhost:9997/_mails | python3 -c "
import sys,json,re
mails=json.load(sys.stdin)['mails']
me=[m for m in mails if m.get('to')=='jens@toura.com'][-1]
print(re.search(r'reset=([0-9a-f]+)', me['html']).group(1))
")
require_val "reset token" "$RTOKEN"
R=$(curl -s -X POST localhost:3000/api/auth/reset -H 'Content-Type: application/json' -d "{\"token\":\"$RTOKEN\",\"password\":\"resetted2026x\"}")
check "reset sets the new password" '"email":"jens@toura.com"' "$R"
R=$(curl -s -X POST localhost:3000/api/auth/reset -H 'Content-Type: application/json' -d "{\"token\":\"$RTOKEN\",\"password\":\"resetted2026x\"}")
check "reset token is single-use" 'invalid or has expired' "$R"
R=$(curl -s -X POST localhost:3000/api/auth/signin -H 'Content-Type: application/json' -d '{"email":"jens@toura.com","password":"resetted2026x"}')
check "sign in after reset" '"email":"jens@toura.com"' "$R"

# --- music ---
AUD="data:audio/mpeg;base64,SUQzAwAAAAAAAA=="
R=$(curl -s -b $J -X POST localhost:3000/api/music -H 'Content-Type: application/json' -d "{\"action\":\"upload\",\"name\":\"Calm Piano\",\"data\":\"$AUD\"}")
check "music upload (admin → Toura picks)" '"by":"toura"' "$R"
# The upload response nests the track: {"track":{...}}
TRACK_ID=$(jget "$R" track id)
TRACK_URL=$(jget "$R" track url)
require_val "track id" "$TRACK_ID"; require_val "track url" "$TRACK_URL"

R=$(curl -s -b $J -X POST localhost:3000/api/music -H 'Content-Type: application/json' -d "{\"action\":\"fav\",\"id\":\"$TRACK_ID\",\"on\":true}")
# Assert the id landed in the favs list. TRACK_ID is now empty when extraction
# fails, so check() reports that instead of self-matching the error blob.
check "music favorite" "\"favs\":\[\"$TRACK_ID\"\]" "$R"

R=$(curl -s -b $J localhost:3000/api/music)
check "music catalog listed" 'Calm Piano' "$R"

# --- branding: logo + named intro/outro items ---
LOGO="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="
VID="data:video/mp4;base64,AAAAIGZ0eXBpc29tAAACAGlzb21pc28yYXZjMW1wNDE="

R=$(curl -s -b $J -X POST localhost:3000/api/branding -H 'Content-Type: application/json' -d "{\"action\":\"logo\",\"name\":\"Diepeveen\",\"data\":\"$LOGO\"}")
check "branding logo uploaded" '"logo":{"url":"' "$R"

# Create a named outro item, then upload its landscape variant with a duration.
R=$(curl -s -b $J -X POST localhost:3000/api/branding -H 'Content-Type: application/json' -d '{"action":"additem","kind":"outro","name":"Logo card"}')
check "outro item created" '"name":"Logo card"' "$R"
OUTRO_ID=$(jget "$R" branding outros 0 id)
require_val "outro id" "$OUTRO_ID"

R=$(curl -s -b $J -X POST localhost:3000/api/branding -H 'Content-Type: application/json' -d "{\"action\":\"uploadvariant\",\"kind\":\"outro\",\"id\":\"$OUTRO_ID\",\"variant\":\"landscape\",\"data\":\"$VID\",\"dur\":4}")
check "outro landscape uploaded with duration" '"landscape":{"url":"' "$R"
BRAND_URL=$(jget "$R" branding outros 0 videos landscape url)
require_val "outro video url" "$BRAND_URL"

# Create a named intro item + landscape variant.
R=$(curl -s -b $J -X POST localhost:3000/api/branding -H 'Content-Type: application/json' -d '{"action":"additem","kind":"intro","name":"Opening"}')
INTRO_ID=$(jget "$R" branding intros 0 id)
require_val "intro id" "$INTRO_ID"
R=$(curl -s -b $J -X POST localhost:3000/api/branding -H 'Content-Type: application/json' -d "{\"action\":\"uploadvariant\",\"kind\":\"intro\",\"id\":\"$INTRO_ID\",\"variant\":\"landscape\",\"data\":\"$VID\",\"dur\":3}")
check "intro landscape uploaded" '"intros":\[{"id"' "$R"
INTRO_URL=$(jget "$R" branding intros 0 videos landscape url)

R=$(curl -s -b $J -X POST localhost:3000/api/branding -H 'Content-Type: application/json' -d "{\"action\":\"rename\",\"kind\":\"outro\",\"id\":\"$OUTRO_ID\",\"name\":\"Outro card\"}")
check "outro renamed" '"name":"Outro card"' "$R"

# A custom font (used later on a text card, burned into the export).
FONT="data:font/woff2;base64,d09GMgABAAAAAAABAAAAAAAAAAA="
R=$(curl -s -b $J -X POST localhost:3000/api/branding -H 'Content-Type: application/json' -d "{\"action\":\"addfont\",\"name\":\"Diepeveen Serif\",\"ext\":\"woff2\",\"data\":\"$FONT\"}")
check "font added" '"name":"Diepeveen Serif"' "$R"
FONT_ID=$(jget "$R" branding fonts 0 id)
require_val "font id" "$FONT_ID"

R=$(curl -s -b $J localhost:3000/api/branding)
check "branding persisted" '"name":"Outro card"' "$R"

R=$(curl -s -b $J -X POST localhost:3000/api/branding -H 'Content-Type: application/json' -d '{"action":"nonsense"}')
check "unknown branding action rejected" 'Unknown action' "$R"

R=$(curl -s localhost:3000/api/branding)
check "branding requires auth" 'Not signed in' "$R"

# --- account: profile photo ---
PIMG="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="
R=$(curl -s -b $J -X POST localhost:3000/api/account -H 'Content-Type: application/json' -d "{\"action\":\"photo\",\"data\":\"$PIMG\"}")
check "profile photo uploaded" '"photo":"data:image/png' "$R"

R=$(curl -s -b $J localhost:3000/api/auth/me)
check "me reflects the photo" '"photo":"data:image/png' "$R"

R=$(curl -s -b $J -X POST localhost:3000/api/account -H 'Content-Type: application/json' -d '{"action":"removePhoto"}')
check "profile photo removed" '"photo":null' "$R"

R=$(curl -s -b $J localhost:3000/api/auth/me)
check "me shows no photo after removal" '"photo":null' "$R"

R=$(curl -s localhost:3000/api/account)
check "account requires auth" 'Not signed in' "$R"

# --- generate: 2 segments ---
IMG="data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEAAAAAAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AVN//2Q=="
R=$(curl -s -b $J -X POST localhost:3000/api/generate -H 'Content-Type: application/json' -d "{\"name\":\"Keizersgracht 214\",\"segments\":[{\"images\":[\"$IMG\",\"$IMG\"]},{\"images\":[\"$IMG\"]}],\"stylePrompt\":\"Calm and warm\",\"duration\":\"auto\",\"aspect\":\"16:9\",\"quality\":\"720p\"}")
check "generate 2 clips" '"id":"' "$R"
PID=$(jget "$R" id)
require_val "project id" "$PID"

R=$(curl -s -b $J -X POST localhost:3000/api/generate -H 'Content-Type: application/json' -d '{"name":"X","segments":[],"stylePrompt":"y"}')
check "empty segments rejected" 'No photos' "$R"

R=$(curl -s -b $J "localhost:3000/api/status?id=$PID")
check "status shows 2 clips" '"clips":\[.*"cid".*"cid"' "$R"

R=$(poll_status '"status":"done".*"status":"done"')
check "both clips done" '"status":"done".*"status":"done"' "$R"
CID=$(jget "$R" project clips 0 cid)

R=$(curl -s -b $J localhost:3000/api/projects)
check "dashboard lists project ready" '"ready":true' "$R"

# --- review actions ---
R=$(curl -s -b $J -X POST localhost:3000/api/project -H 'Content-Type: application/json' -d "{\"id\":\"$PID\",\"action\":\"lock\",\"cid\":\"$CID\",\"locked\":true}")
check "lock clip" '"locked":true' "$R"

R=$(curl -s -b $J -X POST localhost:3000/api/project -H 'Content-Type: application/json' -d "{\"id\":\"$PID\",\"action\":\"regenerate\",\"cid\":\"$CID\"}")
check "locked clip cannot regenerate" 'locked' "$R"

CID2=$(jget "$(curl -s -b $J "localhost:3000/api/status?id=$PID")" project clips 1 cid)
R=$(curl -s -b $J -X POST localhost:3000/api/project -H 'Content-Type: application/json' -d "{\"id\":\"$PID\",\"action\":\"regenerate\",\"cid\":\"$CID2\"}")
check "regenerate clip 2" '"status":"queued"' "$R"
R=$(poll_status '"status":"done".*"status":"done"')
check "regenerated clip done" '"status":"done".*"status":"done"' "$R"

R=$(curl -s -b $J -X POST localhost:3000/api/project -H 'Content-Type: application/json' -d "{\"id\":\"$PID\",\"action\":\"reorder\",\"order\":[\"$CID2\",\"$CID\"]}")
check "reorder clips" "\"cid\":\"$CID2\"" "$R"

# --- export: the single merge step ---
# The concept merge action still exists for old projects but the UI no longer
# calls it; export stitches the clips itself.
R=$(curl -s -b $J -X POST localhost:3000/api/project -H 'Content-Type: application/json' -d "{\"id\":\"$PID\",\"action\":\"merge\"}")
# Match the object, not the bare key — "mergedPending":null contains the key too.
check "legacy concept merge still works" '"mergedPending":{' "$R"

# Polling status is what advances the merge pipeline, so poll rather than sleep.
R=$(poll_status '"concept":"http')
check "concept video merged" '"concept":"http' "$R"

# Music is attached in step 4 via the music action — /api/generate ignores it.
R=$(curl -s -b $J -X POST localhost:3000/api/project -H 'Content-Type: application/json' -d "{\"id\":\"$PID\",\"action\":\"music\",\"music\":{\"name\":\"Calm Piano\",\"url\":\"$TRACK_URL\"}}")
check "music attached to project" '"name":"Calm Piano"' "$R"

# Music is attached in step 4 via the music action — /api/generate ignores it.
R=$(curl -s -b $J -X POST localhost:3000/api/project -H 'Content-Type: application/json' -d "{\"id\":\"$PID\",\"action\":\"music\",\"music\":{\"name\":\"Calm Piano\",\"url\":\"$TRACK_URL\"}}")
check "music attached to project" '"name":"Calm Piano"' "$R"

# Video editor: empty text cards dropped; unknown position → bl; logoScale
# clamped to [0.5,2]; the new text model stores start/dur/font/scale; introId/
# outroId land on the project.
R=$(curl -s -b $J -X POST localhost:3000/api/project -H 'Content-Type: application/json' -d "{\"id\":\"$PID\",\"action\":\"edit\",\"edit\":{\"texts\":[{\"text\":\"\",\"pos\":\"xx\"},{\"text\":\"Hi\",\"pos\":\"zz\",\"start\":2,\"dur\":3,\"scale\":9,\"font\":\"$FONT_ID\"}],\"logo\":true,\"logoScale\":9,\"introId\":\"$INTRO_ID\",\"outroId\":\"$OUTRO_ID\",\"music\":{\"name\":\"Calm Piano\",\"url\":\"$TRACK_URL\"}}}")
check "editor drops empty text cards" '"texts":\[{"text":"Hi","pos":"bl"' "$R"
check "text stores start + duration" '"start":2,"dur":3' "$R"
check "text scale clamped to 2" '"scale":2' "$R"
check "text keeps the chosen font" "\"font\":\"$FONT_ID\"" "$R"
check "logoScale clamped to 2" '"logoScale":2' "$R"
check "intro selected on the project" "\"introId\":\"$INTRO_ID\"" "$R"
check "outro selected on the project" "\"outroId\":\"$OUTRO_ID\"" "$R"

# ---- Export route A: text + logo active → Shotstack burns them in ----
R=$(curl -s -b $J -X POST localhost:3000/api/project -H 'Content-Type: application/json' -d "{\"id\":\"$PID\",\"action\":\"edit\",\"edit\":{\"texts\":[{\"text\":\"Keizersgracht 214\",\"pos\":\"bl\",\"start\":5,\"dur\":3,\"scale\":1.5,\"font\":\"$FONT_ID\"}],\"logo\":true,\"logoScale\":1.5,\"introId\":\"$INTRO_ID\",\"outroId\":\"$OUTRO_ID\",\"music\":{\"name\":\"Calm Piano\",\"url\":\"$TRACK_URL\"}}}")
check "editor overlays saved" '"logoScale":1.5' "$R"

R=$(curl -s -b $J -X POST localhost:3000/api/project -H 'Content-Type: application/json' -d "{\"id\":\"$PID\",\"action\":\"export\"}")
check "overlay export routes to shotstack" '"phase":"shotstack"' "$R"

R=$(poll_status '"export":"https://example.com/shotstack')
check "overlay export ready (shotstack)" '"export":"https://example.com/shotstack' "$R"

# Ask the shotstack stub what edit we actually sent.
SS=$(curl -s localhost:9998/_calls)
check "shotstack renders text as an html asset" '"type":"html"' "$SS"
check "shotstack got the text card" 'Keizersgracht 214' "$SS"
check "text has no box, just a shadow" 'text-shadow' "$SS"
check "text embeds the chosen font via @font-face" '@font-face' "$SS"
check "shotstack got a logo image overlay" '"type":"image"' "$SS"
check "shotstack got the intro clip" "$INTRO_URL" "$SS"
check "shotstack got the outro clip" "$BRAND_URL" "$SS"
check "shotstack got the soundtrack" "\"soundtrack\":{\"src\":\"$TRACK_URL\"" "$SS"
check "shotstack output aspect matches the project" '"aspectRatio":"16:9"' "$SS"

# The intro is 3s so the logo starts at 3s (never over the intro); the text
# card was placed at start:5 and must land there on the timeline.
TIMES=$(echo "$SS" | python3 -c "
import sys,json
tl=json.load(sys.stdin)['calls'][-1]['timeline']['tracks']
clips=[c for tr in tl for c in tr['clips']]
img=[c for c in clips if c['asset'].get('type')=='image'][0]
html=[c for c in clips if c['asset'].get('type')=='html'][0]
print(int(img['start']), int(html['start']))
")
check "logo starts after the intro (3s) and text at 5s" '^3 5$' "$TIMES"

# ---- Export route B: no overlays → cheaper fal fallback, still with intro+outro ----
R=$(curl -s -b $J -X POST localhost:3000/api/project -H 'Content-Type: application/json' -d "{\"id\":\"$PID\",\"action\":\"edit\",\"edit\":{\"texts\":[],\"logo\":false,\"introId\":\"$INTRO_ID\",\"outroId\":\"$OUTRO_ID\",\"music\":{\"name\":\"Calm Piano\",\"url\":\"$TRACK_URL\"}}}")
check "overlays cleared" '"texts":\[\]' "$R"

R=$(curl -s -b $J -X POST localhost:3000/api/project -H 'Content-Type: application/json' -d "{\"id\":\"$PID\",\"action\":\"export\"}")
check "export started" '"mergedPending":{' "$R"
check "plain export uses the fal fallback" '"phase":"export"' "$R"

# The stub names results per model, so "fake-audio" proves the export really went
# through merge-audio-video (a bare "http" would also pass the music-less path).
R=$(poll_status '"export":"https://example.com/fake-audio')
check "export ready (video + music)" '"export":"https://example.com/fake-audio' "$R"

# The fal merge must include the intro + both clips + the outro — 4 urls.
CALLS=$(curl -s localhost:9999/_calls)
check "fal merge includes the intro clip" "$INTRO_URL" "$CALLS"
check "fal merge includes the outro clip" "$BRAND_URL" "$CALLS"
check "fal merge pins aspect to the listing video" '"resolution_aspect_ratio_video_index":0' "$CALLS"
PARTS=$(echo "$CALLS" | python3 -c "
import sys,json
merges=[c for c in json.load(sys.stdin)['calls'] if c['kind']=='merge']
print(len(merges[-1]['input'].get('video_urls',[])) if merges else 0)
")
check "fal merge carries intro + 2 clips + outro" '^4$' "$PARTS"

# --- billing ---
R=$(curl -s -b $J localhost:3000/api/billing)
check "billing lists three plans" '"starter".*"office".*"pro"' "$R"
check "new account starts on trial" '"status":"trial"' "$R"

R=$(curl -s -b $J -X POST localhost:3000/api/billing -H 'Content-Type: application/json' -d '{"action":"choose","plan":"office"}')
check "choosing a plan is recorded" '"plan":"office"' "$R"
# Nothing is paid yet, so it must not read as an active subscription.
check "chosen plan is pending, not active" '"status":"pending"' "$R"

R=$(curl -s -b $J -X POST localhost:3000/api/billing -H 'Content-Type: application/json' -d '{"action":"choose","plan":"free-forever"}')
check "unknown plan rejected" 'Unknown plan' "$R"

R=$(curl -s -b $J localhost:3000/api/billing)
check "plan persisted" '"plan":"office"' "$R"

R=$(curl -s localhost:3000/api/billing)
check "billing requires auth" 'Not signed in' "$R"

R=$(curl -s "localhost:3000/api/status?id=$PID")
check "status requires auth" 'Not signed in' "$R"

R=$(curl -s localhost:3000/ | head -10)
check "frontend served" 'toura' "$R"

echo
echo "== $PASS passed, $FAIL failed =="
exit $FAIL
