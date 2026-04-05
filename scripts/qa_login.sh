#!/usr/bin/env bash
# qa_login.sh — Automate magic-link QA login for the headless browse tool.
#
# Usage:
#   ./scripts/qa_login.sh
#   QA_USER_EMAIL=other@example.com ./scripts/qa_login.sh
#   QA_SITE_URL=http://localhost:3000 ./scripts/qa_login.sh
#
# Outputs a ready-to-use `$B js "..."` command that injects the Supabase
# session into the browse instance's localStorage.

set -euo pipefail

VENV="/Users/lumimamini/Documents/Seichijunrei-agent/.venv"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
QA_AUTH="$SCRIPT_DIR/qa_auth.py"

EMAIL="${QA_USER_EMAIL:-qa-bot@seichijunrei.test}"
SITE_URL="${QA_SITE_URL:-https://seichijunrei.zhenjia.org}"
PROJECT_REF="qchdzpnoirwxcskfnspn"
STORAGE_KEY="sb-${PROJECT_REF}-auth-token"

# --- Step 1: Generate magic link ---
echo "→ Generating magic link for ${EMAIL}..." >&2
LINK=$("$VENV/bin/python" "$QA_AUTH" 2>&1)
if [[ -z "$LINK" || "$LINK" != http* ]]; then
  echo "ERROR: Failed to generate magic link. Output: $LINK" >&2
  exit 1
fi
echo "→ Got magic link" >&2

# --- Step 2: Follow the link and extract tokens from the redirect ---
echo "→ Following magic link to extract tokens..." >&2
HEADERS=$(curl -sS -D- -o /dev/null "$LINK" 2>&1)

# The Location header contains a fragment: ...#access_token=...&refresh_token=...
LOCATION=$(echo "$HEADERS" | grep -i '^location:' | head -1 | tr -d '\r')
if [[ -z "$LOCATION" ]]; then
  echo "ERROR: No Location header in response." >&2
  echo "Headers received:" >&2
  echo "$HEADERS" >&2
  exit 1
fi

FRAGMENT="${LOCATION#*#}"
if [[ "$FRAGMENT" == "$LOCATION" ]]; then
  echo "ERROR: No fragment in Location header: $LOCATION" >&2
  exit 1
fi

# Parse tokens from the fragment (key=value&key=value)
extract() {
  echo "$FRAGMENT" | tr '&' '\n' | grep "^${1}=" | head -1 | cut -d= -f2-
}

ACCESS_TOKEN=$(extract "access_token")
REFRESH_TOKEN=$(extract "refresh_token")
EXPIRES_IN=$(extract "expires_in")
TOKEN_TYPE=$(extract "token_type")

if [[ -z "$ACCESS_TOKEN" || -z "$REFRESH_TOKEN" ]]; then
  echo "ERROR: Could not extract tokens from fragment: $FRAGMENT" >&2
  exit 1
fi
echo "→ Tokens extracted" >&2

# --- Step 3: Decode the JWT to get user info (base64 decode the payload) ---
# JWT is header.payload.signature — we want the payload
JWT_PAYLOAD=$(echo "$ACCESS_TOKEN" | cut -d. -f2)
# Add base64 padding if needed
PADDED="$JWT_PAYLOAD"
case $(( ${#PADDED} % 4 )) in
  2) PADDED="${PADDED}==" ;;
  3) PADDED="${PADDED}=" ;;
esac
USER_ID=$(echo "$PADDED" | base64 -d 2>/dev/null | python3 -c "import sys,json; print(json.load(sys.stdin)['sub'])" 2>/dev/null || echo "92cb4f0d-a0a8-4c4f-b5cd-f9fc2eec8412")

# Compute expiry timestamp
NOW=$(date +%s)
EXPIRES_AT=$(( NOW + ${EXPIRES_IN:-3600} ))

echo "→ User ID: ${USER_ID}" >&2
echo "→ Token expires at: ${EXPIRES_AT}" >&2
echo "" >&2

# --- Step 4: Build the localStorage JSON and output the $B js command ---
# Construct the session JSON matching Supabase's @supabase/gotrue-js format
SESSION_JSON=$(python3 -c "
import json, sys
obj = {
    'access_token': '${ACCESS_TOKEN}',
    'token_type': '${TOKEN_TYPE:-bearer}',
    'expires_in': int('${EXPIRES_IN:-3600}'),
    'expires_at': int('${EXPIRES_AT}'),
    'refresh_token': '${REFRESH_TOKEN}',
    'user': {
        'id': '${USER_ID}',
        'aud': 'authenticated',
        'role': 'authenticated',
        'email': '${EMAIL}',
        'email_confirmed_at': '',
        'app_metadata': {'provider': 'email', 'providers': ['email']},
        'user_metadata': {},
        'identities': [],
        'created_at': '',
        'updated_at': ''
    }
}
print(json.dumps(obj, separators=(',', ':')))
")

# Escape for JS string embedding (single quotes)
ESCAPED_JSON=$(echo "$SESSION_JSON" | sed "s/'/\\\\'/g")

echo "# Paste this into your browse session after navigating to ${SITE_URL}:"
echo "\$B js \"localStorage.setItem('${STORAGE_KEY}', '${ESCAPED_JSON}'); location.reload();\""
