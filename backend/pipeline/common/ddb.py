import time
from typing import Dict, List, Optional
from .aws import get_ddb_resource, get_env

_env = get_env()

ddb = get_ddb_resource()
files_table = ddb.Table(_env["FILES_TABLE"])
jobs_table = ddb.Table(_env["JOBS_TABLE"])
audit_table = ddb.Table(_env["AUDIT_TABLE"])

FILES_GSI_HASH = _env["FILES_GSI_HASH"]
FILES_GSI_RECENT = _env["FILES_GSI_RECENT"]


def now_iso() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def update_item(table, key: Dict, updates: Dict) -> None:
    if not updates:
        return
    expression = "SET " + ", ".join([f"#{k} = :{k}" for k in updates.keys()])
    attribute_names = {f"#{k}": k for k in updates.keys()}
    attribute_values = {f":{k}": v for k, v in updates.items()}
    table.update_item(
        Key=key,
        UpdateExpression=expression,
        ExpressionAttributeNames=attribute_names,
        ExpressionAttributeValues=attribute_values
    )


def update_file(tenant_dataset_id: str, file_id: str, updates: Dict) -> None:
    updates = {**updates, "updatedAt": now_iso()}
    update_item(files_table, {"tenantDatasetId": tenant_dataset_id, "fileId": file_id}, updates)


def put_job(item: Dict) -> None:
    jobs_table.put_item(Item=item)


def update_job(tenant_file_id: str, job_id: str, updates: Dict) -> None:
    updates = {**updates, "updatedAt": now_iso()}
    update_item(jobs_table, {"tenantFileId": tenant_file_id, "jobId": job_id}, updates)


def put_audit(tenant_id: str, event_type: str, metadata: Dict) -> None:
    created_at = now_iso()
    event_id = metadata.get("eventId", created_at)
    audit_table.put_item(
        Item={
            "tenantId": tenant_id,
            "createdAtEventId": f"{created_at}#{event_id}",
            "eventId": event_id,
            "type": event_type,
            "createdAt": created_at,
            "metadata": metadata
        }
    )


def query_duplicates_by_hash(tenant_id: str, raw_sha256: str) -> List[Dict]:
    if not raw_sha256:
        return []
    response = files_table.query(
        IndexName=FILES_GSI_HASH,
        KeyConditionExpression="tenantId = :tenantId AND rawSha256 = :rawSha256",
        ExpressionAttributeValues={":tenantId": tenant_id, ":rawSha256": raw_sha256}
    )
    return response.get("Items", [])


def query_recent_files(tenant_id: str, limit: int = 50) -> List[Dict]:
    response = files_table.query(
        IndexName=FILES_GSI_RECENT,
        KeyConditionExpression="tenantId = :tenantId",
        ExpressionAttributeValues={":tenantId": tenant_id},
        ScanIndexForward=False,
        Limit=limit
    )
    return response.get("Items", [])
