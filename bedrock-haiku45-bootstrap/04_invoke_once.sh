#!/usr/bin/env bash
set -euo pipefail
source ./config.env

AWS_ARGS=(--region "${AWS_REGION}")
if [[ "${USE_PROFILE}" == "1" ]]; then
  AWS_ARGS+=(--profile "${AWS_PROFILE}")
fi

req="$(mktemp)"
out="output.json"

cat > "${req}" <<JSON
{
  "anthropic_version": "bedrock-2023-05-31",
  "max_tokens": 128,
  "temperature": 0.2,
  "messages": [
    {
      "role": "user",
      "content": [
        { "type": "text", "text": "${PROMPT_TEXT}" }
      ]
    }
  ]
}
JSON

echo "Invoking: ${MODEL_ID}"
echo "Region:   ${AWS_REGION}"
aws "${AWS_ARGS[@]}" bedrock-runtime invoke-model \
  --model-id "${MODEL_ID}" \
  --content-type application/json \
  --accept application/json \
  --body "file://${req}" \
  --cli-binary-format raw-in-base64-out \
  "${out}"

rm -f "${req}"
echo "Success. Response written to ${out}"
