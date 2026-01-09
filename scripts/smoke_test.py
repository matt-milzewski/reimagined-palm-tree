#!/usr/bin/env python3
import base64
import json
import os
import time
import urllib.request
import urllib.error

import boto3


def build_sample_pdf() -> bytes:
    objects = []
    objects.append(b"<< /Type /Catalog /Pages 2 0 R >>")
    objects.append(b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>")
    objects.append(
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 144] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >> >>"
    )
    stream_data = b"BT /F1 24 Tf 72 72 Td (Hello RAG) Tj ET"
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
    auth = cognito.initiate_auth(
        ClientId=client_id,
        AuthFlow="USER_PASSWORD_AUTH",
        AuthParameters={"USERNAME": email, "PASSWORD": password}
    )

    token = auth["AuthenticationResult"]["AccessToken"]

    dataset = api_request("POST", f"{api_base}/datasets", token=token, payload={"name": "Smoke Test"})
    dataset_id = dataset["datasetId"]

    presign = api_request(
        "POST",
        f"{api_base}/datasets/{dataset_id}/files/presign",
        token=token,
        payload={"filename": "sample.pdf", "contentType": "application/pdf"}
    )

    upload_to_presigned(presign["uploadUrl"], build_sample_pdf())

    job_id = None
    status = None
    for _ in range(30):
        file_info = api_request("GET", f"{api_base}/datasets/{dataset_id}/files/{presign['fileId']}", token=token)
        job = file_info.get("job")
        status = file_info.get("file", {}).get("status")
        if job:
            job_id = job.get("jobId")
        if status in ("COMPLETE", "FAILED"):
            break
        time.sleep(5)

    if status != "COMPLETE" or not job_id:
        raise SystemExit(f"Job did not complete. Status: {status}")

    download = api_request(
        "GET",
        f"{api_base}/datasets/{dataset_id}/files/{presign['fileId']}/jobs/{job_id}/download?type=quality",
        token=token
    )

    with urllib.request.urlopen(download["url"]) as response:
        report = json.loads(response.read().decode("utf-8"))

    print("Readiness score:", report.get("readinessScore"))


if __name__ == "__main__":
    main()
