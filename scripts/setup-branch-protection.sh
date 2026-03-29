#!/usr/bin/env bash
set -euo pipefail

OWNER="${1:-}"
REPO="${2:-}"
BRANCH="${3:-main}"

if [[ -z "$OWNER" || -z "$REPO" ]]; then
  echo "Uso: GITHUB_TOKEN=token ./scripts/setup-branch-protection.sh <owner> <repo> [branch]" >&2
  exit 1
fi

if [[ -z "${GITHUB_TOKEN:-}" ]]; then
  echo "Falta GITHUB_TOKEN en variables de entorno" >&2
  exit 1
fi

API_URL="https://api.github.com/repos/${OWNER}/${REPO}/branches/${BRANCH}/protection"

read -r -d '' PAYLOAD <<'JSON' || true
{
  "required_status_checks": {
    "strict": true,
    "checks": [
      { "context": "ci" }
    ]
  },
  "enforce_admins": true,
  "required_pull_request_reviews": {
    "dismiss_stale_reviews": true,
    "require_code_owner_reviews": false,
    "required_approving_review_count": 1,
    "require_last_push_approval": true
  },
  "restrictions": null,
  "required_linear_history": true,
  "allow_force_pushes": false,
  "allow_deletions": false,
  "block_creations": false,
  "required_conversation_resolution": true,
  "lock_branch": false,
  "allow_fork_syncing": true
}
JSON

HTTP_CODE=$(curl -sS -o /tmp/branch-protection-response.json -w "%{http_code}" \
  -X PUT \
  -H "Accept: application/vnd.github+json" \
  -H "X-GitHub-Api-Version: 2022-11-28" \
  -H "Authorization: Bearer ${GITHUB_TOKEN}" \
  "$API_URL" \
  --data "$PAYLOAD")

if [[ "$HTTP_CODE" != "200" ]]; then
  echo "Error aplicando protección (HTTP $HTTP_CODE):" >&2
  cat /tmp/branch-protection-response.json >&2
  exit 1
fi

echo "Protección aplicada en ${OWNER}/${REPO}:${BRANCH}"
