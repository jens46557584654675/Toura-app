#!/bin/bash
# End-to-end test: starts the fal stub + dev server, walks the full multi-clip flow.
cd "$(dirname "$0")/.." || exit 1
node test/fal-stub.js > /tmp/stub.log 2>&1 &
STUB=$!
FAL_BASE=http://localhost:9999 FAL_KEY=test-key ADMIN_EMAIL=jens@toura.com node dev-server.js > /tmp/dev.log 2>&1 &
DEV=$!
trap "kill $STUB $DEV 2>/dev/null" EXIT

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

# --- branding: logo + outro clips ---
LOGO="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="
VID="data:video/mp4;base64,AAAAIGZ0eXBpc29tAAACAGlzb21pc28yYXZjMW1wNDE="

R=$(curl -s -b $J -X POST localhost:3000/api/branding -H 'Content-Type: application/json' -d "{\"action\":\"logo\",\"name\":\"Diepeveen\",\"data\":\"$LOGO\"}")
check "branding logo uploaded" '"logo":{"url":"' "$R"

R=$(curl -s -b $J -X POST localhost:3000/api/branding -H 'Content-Type: application/json' -d "{\"action\":\"video\",\"variant\":\"landscape\",\"name\":\"Outro 16x9\",\"data\":\"$VID\"}")
check "branding landscape video uploaded" '"landscape":{"url":"' "$R"
BRAND_URL=$(jget "$R" branding videos landscape url)
require_val "branding video url" "$BRAND_URL"

R=$(curl -s -b $J localhost:3000/api/branding)
check "branding persisted" '"name":"Diepeveen"' "$R"

R=$(curl -s -b $J -X POST localhost:3000/api/branding -H 'Content-Type: application/json' -d '{"action":"removeVideo","variant":"portrait"}')
check "removing an empty variant is a no-op" '"landscape":{"url":"' "$R"

R=$(curl -s -b $J -X POST localhost:3000/api/branding -H 'Content-Type: application/json' -d '{"action":"nonsense"}')
check "unknown branding action rejected" 'Unknown action' "$R"

R=$(curl -s localhost:3000/api/branding)
check "branding requires auth" 'Not signed in' "$R"

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

# Project is 16:9, so the landscape branding clip is the one that must be used.
R=$(curl -s -b $J -X POST localhost:3000/api/project -H 'Content-Type: application/json' -d "{\"id\":\"$PID\",\"action\":\"branding\",\"outro\":true}")
check "branding outro enabled" '"outro":true' "$R"

R=$(curl -s -b $J -X POST localhost:3000/api/project -H 'Content-Type: application/json' -d "{\"id\":\"$PID\",\"action\":\"export\"}")
check "export started" '"mergedPending":{' "$R"
check "export merges the clips itself" '"phase":"export"' "$R"

# The stub names results per model, so "fake-audio" proves the export really went
# through merge-audio-video. A bare "http" would also pass the music-less
# fallback (export = concept), making this check green with no soundtrack.
R=$(poll_status '"export":"http')
check "export ready (video + music)" '"export":"https://example.com/fake-audio' "$R"

# Ask the stub what fal was actually sent: the outro merge must include the
# branding clip and pin the output shape to the listing video (index 0).
CALLS=$(curl -s localhost:9999/_calls)
check "export merge sent the branding clip to fal" "$BRAND_URL" "$CALLS"
check "export merge pins aspect to the listing video" '"resolution_aspect_ratio_video_index":0' "$CALLS"

# The export merge must carry both clips AND the outro — 3 urls. This is what
# proves export stitches the clips itself instead of reusing a concept merge.
PARTS=$(echo "$CALLS" | python3 -c "
import sys,json
merges=[c for c in json.load(sys.stdin)['calls'] if c['kind']=='merge']
print(len(merges[-1]['input'].get('video_urls',[])) if merges else 0)
")
check "export merge carries both clips and the outro" '^3$' "$PARTS"

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
