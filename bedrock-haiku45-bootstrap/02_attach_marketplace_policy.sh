#!/usr/bin/env bash
set -euo pipefail
source ./config.env

AWS_ARGS=()
if [[ "${USE_PROFILE}" == "1" ]]; then
  AWS_ARGS+=(--profile "${AWS_PROFILE}")
fi

POLICY_NAME="bedrock-marketplace-bootstrap"

tmp="$(mktemp)"
cat > "${tmp}" <<'JSON'
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "MarketplaceSubscribeForBedrock",
      "Effect": "Allow",
      "Action": [
        "aws-marketplace:Subscribe",
        "aws-marketplace:ViewSubscriptions"
      ],
      "Resource": "*"
    }
  ]
}
JSON

echo "Attaching Marketplace bootstrap permissions to IAM user '${USER_NAME}'..."
aws "${AWS_ARGS[@]}" iam put-user-policy \
  --user-name "${USER_NAME}" \
  --policy-name "${POLICY_NAME}" \
  --policy-document "file://${tmp}"

rm -f "${tmp}"
echo "Done."
