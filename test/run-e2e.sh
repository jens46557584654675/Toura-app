#!/bin/bash
# End-to-end test: starts the fal stub + dev server, walks the full multi-clip flow.
cd "$(dirname "$0")/.." || exit 1
node test/fal-stub.js > /tmp/stub.log 2>&1 &
STUB=$!
FAL_BASE=http://localhost:9999 FAL_KEY=test-key ADMIN_EMAIL=jens@toura.com node dev-server.js > /tmp/dev.log 2>&1 &
DEV=$!
trap "kill $STUB $DEV 2>/dev/null" EXIT
sleep 1.5

J=/tmp/jar.txt; rm -f $J
PASS=0; FAIL=0
check(){
  if echo "$3" | grep -q "$2"; then echo "PASS  $1"; PASS=$((PASS+1)); else echo "FAIL  $1 → $(echo "$3"|head -c 300)"; FAIL=$((FAIL+1)); fi
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
TRACK_ID=$(echo "$R" | sed -E 's/.*"id":"([^"]+)".*/\1/')
TRACK_URL=$(echo "$R" | sed -E 's/.*"url":"([^"]+)".*/\1/')

R=$(curl -s -b $J -X POST localhost:3000/api/music -H 'Content-Type: application/json' -d "{\"action\":\"fav\",\"id\":\"$TRACK_ID\",\"on\":true}")
check "music favorite" "$TRACK_ID" "$R"

R=$(curl -s -b $J localhost:3000/api/music)
check "music catalog listed" 'Calm Piano' "$R"

# --- generate: 2 segments + music ---
IMG="data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEAAAAAAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AVN//2Q=="
R=$(curl -s -b $J -X POST localhost:3000/api/generate -H 'Content-Type: application/json' -d "{\"name\":\"Keizersgracht 214\",\"segments\":[{\"images\":[\"$IMG\",\"$IMG\"]},{\"images\":[\"$IMG\"]}],\"stylePrompt\":\"Calm and warm\",\"music\":{\"name\":\"Calm Piano\",\"url\":\"$TRACK_URL\"},\"duration\":\"auto\",\"aspect\":\"16:9\",\"quality\":\"720p\"}")
check "generate 2 clips" '"id":"' "$R"
PID=$(echo "$R" | sed -E 's/.*"id":"([^"]+)".*/\1/')

R=$(curl -s -b $J -X POST localhost:3000/api/generate -H 'Content-Type: application/json' -d '{"name":"X","segments":[],"stylePrompt":"y"}')
check "empty segments rejected" 'No photos' "$R"

R=$(curl -s -b $J "localhost:3000/api/status?id=$PID")
check "status shows 2 clips" '"clips":\[.*"cid".*"cid"' "$R"

sleep 8
R=$(curl -s -b $J "localhost:3000/api/status?id=$PID")
check "both clips done" '"status":"done".*"status":"done"' "$R"
CID=$(echo "$R" | python3 -c "import sys,json;print(json.load(sys.stdin)['project']['clips'][0]['cid'])")

R=$(curl -s -b $J localhost:3000/api/projects)
check "dashboard lists project ready" '"ready":true' "$R"

# --- review actions ---
R=$(curl -s -b $J -X POST localhost:3000/api/project -H 'Content-Type: application/json' -d "{\"id\":\"$PID\",\"action\":\"lock\",\"cid\":\"$CID\",\"locked\":true}")
check "lock clip" '"locked":true' "$R"

R=$(curl -s -b $J -X POST localhost:3000/api/project -H 'Content-Type: application/json' -d "{\"id\":\"$PID\",\"action\":\"regenerate\",\"cid\":\"$CID\"}")
check "locked clip cannot regenerate" 'locked' "$R"

CID2=$(curl -s -b $J "localhost:3000/api/status?id=$PID" | python3 -c "import sys,json;print(json.load(sys.stdin)['project']['clips'][1]['cid'])")
R=$(curl -s -b $J -X POST localhost:3000/api/project -H 'Content-Type: application/json' -d "{\"id\":\"$PID\",\"action\":\"regenerate\",\"cid\":\"$CID2\"}")
check "regenerate clip 2" '"status":"queued"' "$R"
sleep 8
R=$(curl -s -b $J "localhost:3000/api/status?id=$PID")
check "regenerated clip done" '"status":"done".*"status":"done"' "$R"

R=$(curl -s -b $J -X POST localhost:3000/api/project -H 'Content-Type: application/json' -d "{\"id\":\"$PID\",\"action\":\"reorder\",\"order\":[\"$CID2\",\"$CID\"]}")
check "reorder clips" "\"cid\":\"$CID2\"" "$R"

# --- merge + music ---
R=$(curl -s -b $J -X POST localhost:3000/api/project -H 'Content-Type: application/json' -d "{\"id\":\"$PID\",\"action\":\"merge\"}")
check "merge started" '"mergedPending"' "$R"
sleep 4
R=$(curl -s -b $J "localhost:3000/api/status?id=$PID")
sleep 4
R=$(curl -s -b $J "localhost:3000/api/status?id=$PID")
check "final video with music ready" '"merged":"https' "$R"

R=$(curl -s "localhost:3000/api/status?id=$PID")
check "status requires auth" 'Not signed in' "$R"

R=$(curl -s localhost:3000/ | head -10)
check "frontend served" 'toura' "$R"

echo
echo "== $PASS passed, $FAIL failed =="
exit $FAIL
