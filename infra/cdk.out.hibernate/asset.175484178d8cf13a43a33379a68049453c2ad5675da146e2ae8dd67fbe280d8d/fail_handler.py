import json

from common.ddb import update_job, update_file, update_dataset, put_audit, now_iso


def extract_error(event):
    error = event.get("error") or {}
    if isinstance(error, str):
        return error
    if isinstance(error, dict):
        if "Cause" in error:
            try:
                cause = json.loads(error["Cause"])
                return cause.get("errorMessage", error["Cause"])
            except Exception:
                return error["Cause"]
        if "Error" in error:
            return str(error["Error"])
    return "Pipeline failed"


def handler(event, _context):
    tenant_id = event.get("tenantId")
    dataset_id = event.get("datasetId")
    file_id = event.get("fileId")
    job_id = event.get("jobId")

    message = extract_error(event)

    if tenant_id and file_id and job_id:
        update_job(
            tenant_file_id=f"{tenant_id}#{file_id}",
            job_id=job_id,
            updates={
                "status": "FAILED",
                "finishedAt": now_iso(),
                "errorMessage": message
            }
        )

    if tenant_id and dataset_id and file_id:
        update_file(
            tenant_dataset_id=f"{tenant_id}#{dataset_id}",
            file_id=file_id,
            updates={
                "status": "FAILED"
            }
        )

    if tenant_id and dataset_id:
        update_dataset(tenant_id, dataset_id, {"status": "FAILED"})

    if tenant_id and dataset_id and file_id:
        put_audit(tenant_id, "JOB_FAILED", {"datasetId": dataset_id, "fileId": file_id, "jobId": job_id, "error": message})

    return {"status": "FAILED", "message": message}
