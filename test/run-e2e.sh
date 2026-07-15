#!/bin/bash
# End-to-end test: starts the Higgsfield stub + dev server, walks the full flow.
cd "$(dirname "$0")/.." || exit 1
node test/hf-stub.js > /tmp/stub.log 2>&1 &
STUB=$!
HF_BASE=http://localhost:9999 HIGGSFIELD_API_KEY=k HIGGSFIELD_API_SECRET=s node dev-server.js > /tmp/dev.log 2>&1 &
DEV=$!
trap "kill $STUB $DEV 2>/dev/null" EXIT
sleep 1.5

J=/tmp/jar.txt; rm -f $J
PASS=0; FAIL=0
check(){ # name expected_substring actual
  if echo "$3" | grep -q "$2"; then echo "PASS  $1"; PASS=$((PASS+1)); else echo "FAIL  $1 → $3"; FAIL=$((FAIL+1)); fi
}

R=$(curl -s -c $J -X POST localhost:3000/api/auth/signup -H 'Content-Type: application/json' -d '{"name":"Jens Diepeveen","email":"jens@toura.com","password":"toura2026!"}')
check "signup" '"email":"jens@toura.com"' "$R"

R=$(curl -s -X POST localhost:3000/api/auth/signup -H 'Content-Type: application/json' -d '{"name":"Jens","email":"jens@toura.com","password":"12345678"}')
check "duplicate signup rejected" 'already exists' "$R"

R=$(curl -s -X POST localhost:3000/api/auth/signup -H 'Content-Type: application/json' -d '{"name":"K","email":"k@x.nl","password":"kort"}')
check "short password rejected" 'at least 8' "$R"

R=$(curl -s -b $J localhost:3000/api/auth/me)
check "session restore (me)" '"name":"Jens Diepeveen"' "$R"

R=$(curl -s -c $J -X POST localhost:3000/api/auth/signin -H 'Content-Type: application/json' -d '{"email":"jens@toura.com","password":"fout-wachtwoord"}')
check "wrong password rejected" 'Wrong email or password' "$R"

R=$(curl -s -c $J -X POST localhost:3000/api/auth/signin -H 'Content-Type: application/json' -d '{"email":"jens@toura.com","password":"toura2026!"}')
check "signin" '"email":"jens@toura.com"' "$R"

R=$(curl -s localhost:3000/api/projects)
check "projects requires auth" 'Not signed in' "$R"

R=$(curl -s -b $J localhost:3000/api/projects)
check "projects empty list" '"projects":\[\]' "$R"

# tiny valid 1x1 jpeg data-url
IMG="data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEAAAAAAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AVN//2Q=="
R=$(curl -s -b $J -X POST localhost:3000/api/generate -H 'Content-Type: application/json' -d "{\"name\":\"Keizersgracht 214\",\"prompt\":\"Slow dolly through @image1\",\"duration\":5,\"aspect\":\"16:9\",\"quality\":\"720p\",\"image\":\"$IMG\"}")
check "generate submits" '"id":"' "$R"
ID=$(echo "$R" | sed -E 's/.*"id":"([^"]+)".*/\1/')

R=$(curl -s -b $J "localhost:3000/api/status?id=$ID")
check "status queued" '"status":"queued"' "$R"

sleep 5
R=$(curl -s -b $J "localhost:3000/api/status?id=$ID")
check "status in_progress" '"status":"in_progress"' "$R"

sleep 6
R=$(curl -s -b $J "localhost:3000/api/status?id=$ID")
check "status completed + project" '"status":"completed".*"name":"Keizersgracht 214"' "$R"

R=$(curl -s -b $J "localhost:3000/api/status?id=$ID")
check "completed result cached" '"status":"completed"' "$R"

R=$(curl -s -b $J localhost:3000/api/projects)
check "project saved in dashboard" 'Keizersgracht 214' "$R"

R=$(curl -s "localhost:3000/api/status?id=$ID")
check "status requires auth" 'Not signed in' "$R"

R=$(curl -s -b $J -X POST localhost:3000/api/auth/signout)
check "signout" '"ok":true' "$R"

R=$(curl -s localhost:3000/ | head -10)
check "frontend served" 'toura' "$R"

echo
echo "== $PASS passed, $FAIL failed =="
exit $FAIL
