#!/usr/bin/env bash
set -euo pipefail
source ./config.env

AWS_ARGS=(--region "${AWS_REGION}")
if [[ "${USE_PROFILE}" == "1" ]]; then
  AWS_ARGS+=(--profile "${AWS_PROFILE}")
fi

echo "Checking whether Anthropic use-case details are already submitted..."

set +e
out="$(aws "${AWS_ARGS[@]}" bedrock get-use-case-for-model-access 2>&1)"
rc=$?
set -e

if [[ $rc -eq 0 ]]; then
  echo "Use-case details appear to be on file already (GetUseCaseForModelAccess succeeded)."
  exit 0
fi

echo
echo "Anthropic use-case details do NOT appear to be submitted yet (or you lack permission to read them)."
echo
echo "AWS requires first-time Anthropic customers to submit use case details before invoking a model."
echo "You can do it in the Bedrock console:"
echo "  Bedrock console -> Model catalog -> open an Anthropic model -> Submit use case details"
echo
echo "After you submit the form once, rerun this script, then continue to the invoke step."
echo

if [[ -n "${USECASE_FORM_FILE}" ]]; then
  echo "You set USECASE_FORM_FILE='${USECASE_FORM_FILE}'. Attempting CLI submission..."
  aws "${AWS_ARGS[@]}" bedrock put-use-case-for-model-access --form-data "fileb://${USECASE_FORM_FILE}"
  echo "Submitted via CLI. Re-run this script to confirm."
else
  echo "If you want to automate via CLI, set USECASE_FORM_FILE in config.env to a file containing the formData blob."
fi

exit 2
