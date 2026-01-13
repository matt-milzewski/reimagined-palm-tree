#!/usr/bin/env python3
import base64
import json
import os
import time
import urllib.request
import urllib.error

import boto3
from botocore.exceptions import ClientError


def build_sample_pdf() -> bytes:
    objects = []
    objects.append(b"<< /Type /Catalog /Pages 2 0 R >>")
    objects.append(b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>")
    objects.append(
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 144] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >> >>"
    )
    text = "Hello RAG readiness pipeline. " * 8
    text = text.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")
    stream_data = f"BT /F1 12 Tf 72 72 Td ({text}) Tj ET".encode("utf-8")
    obj4 = b"<< /Length " + str(len(stream_data)).encode("utf-8") + b" >>\nstream\n" + stream_data + b"\nendstream"
    objects.append(obj4)
    objects.append(b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>")

    pdf = b"%PDF-1.4\n"
    offsets = [0]
    for i, obj in enumerate(objects, start=1):
        offsets.append(len(pdf))
        pdf += f"{i} 0 obj\n".encode("utf-8") + obj + b"\nendobj\n"

    xref_offset = len(pdf)
    pdf += f"xref\n0 {len(objects) + 1}\n".encode("utf-8")
    pdf += b"0000000000 65535 f \n"
    for offset in offsets[1:]:
        pdf += f"{offset:010d} 00000 n \n".encode("utf-8")
    pdf += f"trailer << /Root 1 0 R /Size {len(objects) + 1} >>\n".encode("utf-8")
    pdf += f"startxref\n{xref_offset}\n%%EOF".encode("utf-8")
    return pdf


def load_pdf_payload() -> tuple[bytes, str]:
    path = os.environ.get("SMOKE_TEST_PDF", "Resume-5.pdf")
    if path and os.path.isfile(path):
        with open(path, "rb") as handle:
            return handle.read(), path
    return build_sample_pdf(), "generated sample"


def api_request(method, url, token=None, payload=None):
    data = None
    if payload is not None:
        data = json.dumps(payload).encode("utf-8")
    request = urllib.request.Request(url, data=data, method=method)
    request.add_header("Content-Type", "application/json")
    if token:
        request.add_header("Authorization", token)

    with urllib.request.urlopen(request) as response:
        return json.loads(response.read().decode("utf-8"))


def upload_to_presigned(url, payload: bytes):
    request = urllib.request.Request(url, data=payload, method="PUT")
    request.add_header("Content-Type", "application/pdf")
    request.add_header("x-amz-server-side-encryption", "AES256")
    with urllib.request.urlopen(request) as response:
        response.read()


def main():
    region = os.environ.get("AWS_REGION", "us-east-1")
    client_id = os.environ.get("COGNITO_CLIENT_ID")
    email = os.environ.get("SMOKE_TEST_EMAIL")
    password = os.environ.get("SMOKE_TEST_PASSWORD")
    api_base = os.environ.get("API_BASE_URL")

    if not all([client_id, email, password, api_base]):
        raise SystemExit("Missing COGNITO_CLIENT_ID, SMOKE_TEST_EMAIL, SMOKE_TEST_PASSWORD, or API_BASE_URL")

    api_base = api_base.rstrip("/")
    cognito = boto3.client("cognito-idp", region_name=region)
    try:
        auth = cognito.initiate_auth(
            ClientId=client_id,
            AuthFlow="USER_PASSWORD_AUTH",
            AuthParameters={"USERNAME": email, "PASSWORD": password}
        )
    except ClientError as error:
        message = error.response.get("Error", {}).get("Message", str(error))
        raise SystemExit(f"Auth failed: {message}")

    if "AuthenticationResult" not in auth:
        if auth.get("ChallengeName") == "NEW_PASSWORD_REQUIRED":
            auth = cognito.respond_to_auth_challenge(
                ClientId=client_id,
                ChallengeName="NEW_PASSWORD_REQUIRED",
                Session=auth.get("Session"),
                ChallengeResponses={"USERNAME": email, "NEW_PASSWORD": password}
            )
        else:
            raise SystemExit(f"Unexpected auth challenge: {auth.get('ChallengeName')}")

    result = auth["AuthenticationResult"]
    token = result.get("IdToken") or result.get("AccessToken")
    if not token:
        raise SystemExit("Auth failed: missing token in authentication result.")

    dataset = api_request("POST", f"{api_base}/datasets", token=token, payload={"name": "Smoke Test"})
    dataset_id = dataset["datasetId"]
    print("Dataset:", dataset_id)

    presign = api_request(
        "POST",
        f"{api_base}/datasets/{dataset_id}/files/presign",
        token=token,
        payload={"filename": "sample.pdf", "contentType": "application/pdf"}
    )

    file_id = presign["fileId"]
    print("File:", file_id)
    pdf_payload, pdf_label = load_pdf_payload()
    print("Using PDF:", pdf_label)
    upload_to_presigned(presign["uploadUrl"], pdf_payload)

    job_id = None
    status = None
    for _ in range(30):
        file_info = api_request("GET", f"{api_base}/datasets/{dataset_id}/files/{file_id}", token=token)
        job = file_info.get("job")
        status = file_info.get("file", {}).get("status")
        if job:
            job_id = job.get("jobId")
        if status in ("COMPLETE", "FAILED"):
            break
        time.sleep(5)

    if status == "FAILED" and job_id:
        job_details = api_request(
            "GET",
            f"{api_base}/datasets/{dataset_id}/files/{file_id}/jobs/{job_id}",
            token=token
        )
        error_message = job_details.get("job", {}).get("errorMessage")
        raise SystemExit(f"Job failed: {error_message or 'Unknown error'}")

    if status != "COMPLETE" or not job_id:
        raise SystemExit(f"Job did not complete. Status: {status}")

    download = api_request(
        "GET",
        f"{api_base}/datasets/{dataset_id}/files/{file_id}/jobs/{job_id}/download?type=quality",
        token=token
    )

    with urllib.request.urlopen(download["url"]) as response:
        report = json.loads(response.read().decode("utf-8"))

    print("Readiness score:", report.get("readinessScore"))

    query_payload = {
        "dataset_id": dataset_id,
        "query": "What is this document about?",
        "top_k": 5
    }

    results = []
    for attempt in range(5):
        try:
            search = api_request("POST", f"{api_base}/rag/query", token=token, payload=query_payload)
            results = search.get("results", [])
            if results:
                break
        except urllib.error.HTTPError as error:
            body = error.read().decode("utf-8")
            raise SystemExit(f"RAG query failed: {error.code} {body}") from error
        time.sleep(3)

    if not results:
        raise SystemExit("RAG query returned no results.")

    top = results[0]
    print("Top RAG result score:", top.get("score"))
    citation = top.get("citation", {})
    print("Top RAG result source:", citation.get("filename"), citation.get("page"))


if __name__ == "__main__":
    main()
