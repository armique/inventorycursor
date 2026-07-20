#!/usr/bin/env bash
# One-time Firebase setup for iPhone photo bridge:
# 1) Deploy Firestore + Storage rules (photoUploadSessions + photo-inbox)
# 2) Print Console link to enable Anonymous auth (optional if you use Google on phone)
#
# Usage (from repo root, on a machine where you can log into Firebase):
#   npm i -g firebase-tools   # if needed
#   firebase login
#   bash scripts/deploy-photo-bridge-rules.sh

set -euo pipefail
cd "$(dirname "$0")/.."

PROJECT="${FIREBASE_PROJECT:-inventorycursor-e9000}"

if [[ ! -f .firebaserc ]]; then
  printf '%s\n' "{\"projects\":{\"default\":\"${PROJECT}\"}}" > .firebaserc
fi

echo "==> Using Firebase project: ${PROJECT}"
firebase use "${PROJECT}"

echo "==> Deploying Firestore + Storage rules…"
firebase deploy --only firestore:rules,storage --project "${PROJECT}"

echo
echo "==> Rules deployed."
echo
echo "Optional (skip if phone uses Google sign-in fallback):"
echo "  Enable Anonymous auth:"
echo "  https://console.firebase.google.com/project/${PROJECT}/authentication/providers"
echo "  → Sign-in method → Anonymous → Enable → Save"
echo
echo "Done."
