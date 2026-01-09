import json
import os
import urllib.parse

import boto3

from common.ddb import files_table, put_job, update_file, now_iso
from common.ids import new_id


sfn = boto3.client("stepfunctions")

STATE_MACHINE_ARN = os.environ.get("STATE_MACHINE_ARN", "")


def parse_s3_record(record):
    key = record["s3"]["object"]["key"]
    key = urllib.parse.unquote_plus(key)
    parts = key.split("/")
    if len(parts) < 5 or parts[0] != "raw":
        raise ValueError(f"Unexpected key format: {key}")
    return {
        "rawS3Key": key,
        "tenantId": parts[1],
        "datasetId": parts[2],
        "fileId": parts[3],
        "filename": parts[4],
        "sizeBytes": record["s3"]["object"].get("size")
    }


def handler(event, _context):
    for record in event.get("Records", []):
        body = json.loads(record.get("body", "{}"))
        for s3_record in body.get("Records", []):
            try:
                parsed = parse_s3_record(s3_record)
            except ValueError:
                continue

            tenant_id = parsed["tenantId"]
            dataset_id = parsed["datasetId"]
            file_id = parsed["fileId"]
            tenant_dataset_id = f"{tenant_id}#{dataset_id}"

            file_item = files_table.get_item(Key={"tenantDatasetId": tenant_dataset_id, "fileId": file_id}).get("Item")
            if not file_item:
                continue

            if file_item.get("status") in ("PROCESSING", "COMPLETE") and file_item.get("latestJobId"):
                continue

            job_id = new_id()
            created_at = now_iso()

            put_job({
                "tenantFileId": f"{tenant_id}#{file_id}",
                "jobId": job_id,
                "tenantId": tenant_id,
                "datasetId": dataset_id,
                "fileId": file_id,
                "status": "QUEUED",
                "createdAt": created_at
            })

            update_file(
                tenant_dataset_id=tenant_dataset_id,
                file_id=file_id,
                updates={
                    "status": "PROCESSING",
                    "latestJobId": job_id,
                    "rawS3Key": parsed["rawS3Key"],
                    "sizeBytes": parsed.get("sizeBytes"),
                    "filename": file_item.get("filename") or parsed.get("filename")
                }
            )

            sfn.start_execution(
                stateMachineArn=STATE_MACHINE_ARN,
                input=json.dumps({
                    "tenantId": tenant_id,
                    "datasetId": dataset_id,
                    "fileId": file_id,
                    "jobId": job_id,
                    "rawS3Key": parsed["rawS3Key"],
                    "filename": file_item.get("filename") or parsed.get("filename")
                })
            )

    return {"status": "ok"}
