#!/usr/bin/env bash
set -euo pipefail

if [[ -z "${FRONTEND_BUCKET:-}" || -z "${CLOUDFRONT_DISTRIBUTION_ID:-}" ]]; then
  echo "Missing FRONTEND_BUCKET or CLOUDFRONT_DISTRIBUTION_ID"
  exit 1
fi

aws s3 sync frontend/out "s3://${FRONTEND_BUCKET}" --delete
aws cloudfront create-invalidation --distribution-id "${CLOUDFRONT_DISTRIBUTION_ID}" --paths "/*"

echo "Frontend deployed."
