from common.ddb import update_job, update_file, put_audit, now_iso


def handler(event, _context):
    tenant_id = event["tenantId"]
    dataset_id = event["datasetId"]
    file_id = event["fileId"]
    job_id = event["jobId"]

    update_job(
        tenant_file_id=f"{tenant_id}#{file_id}",
        job_id=job_id,
        updates={
            "status": "RUNNING",
            "startedAt": now_iso()
        }
    )

    update_file(
        tenant_dataset_id=f"{tenant_id}#{dataset_id}",
        file_id=file_id,
        updates={
            "status": "PROCESSING",
            "latestJobId": job_id
        }
    )

    put_audit(tenant_id, "JOB_STARTED", {"datasetId": dataset_id, "fileId": file_id, "jobId": job_id})
    return event
