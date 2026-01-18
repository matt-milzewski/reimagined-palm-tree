#!/usr/bin/env bash
set -euo pipefail
source ./config.env

AWS_ARGS=()
if [[ "${USE_PROFILE}" == "1" ]]; then
  AWS_ARGS+=(--profile "${AWS_PROFILE}")
fi

echo "Region: ${AWS_REGION}"
aws "${AWS_ARGS[@]}" sts get-caller-identity
