from typing import Dict, List

from common.aws import get_env
from common.ddb import update_job, update_file, put_audit, now_iso
from common.storage import read_json, write_json


env = get_env()


def summarize_findings(findings: List[Dict]) -> Dict:
    summary = {"CRITICAL": 0, "WARN": 0, "INFO": 0}
    for finding in findings:
        severity = finding.get("severity", "INFO")
        if severity in summary:
            summary[severity] += 1
    return summary


def adjust_readiness(base_score: int, extra_findings: List[Dict]) -> int:
    score = base_score
    for finding in extra_findings:
        if finding.get("severity") == "WARN":
            score -= 3
    return max(0, min(100, score))


def handler(event, _context):
    tenant_id = event["tenantId"]
    dataset_id = event["datasetId"]
    file_id = event["fileId"]
    job_id = event["jobId"]
    filename = event.get("filename", "unknown.pdf")

    pages = read_json(env["PROCESSED_BUCKET"], event["cleanedPagesKey"])

    base_prefix = f"processed/{tenant_id}/{dataset_id}/{file_id}"
    document_key = f"{base_prefix}/document.json"
    quality_key = f"{base_prefix}/quality_report.json"

    findings = event.get("findings", [])
    chunk_warnings = event.get("chunkWarnings", [])
    all_findings = findings + chunk_warnings

    readiness_score = adjust_readiness(event.get("readinessScore", 100), chunk_warnings)
    summary = summarize_findings(all_findings)

    document_payload = {
        "schemaVersion": "1.0",
        "tenantId": tenant_id,
        "datasetId": dataset_id,
        "fileId": file_id,
        "sourceFilename": filename,
        "pageCount": len(pages),
        "textLength": sum(len(page.get("text", "")) for page in pages),
        "extraction": event.get("extractionStats", {}),
        "normalization": event.get("normalizationStats", {}),
        "pages": pages,
        "createdAt": now_iso()
    }

    quality_payload = {
        "schemaVersion": "1.0",
        "tenantId": tenant_id,
        "datasetId": dataset_id,
        "fileId": file_id,
        "readinessScore": readiness_score,
        "summary": summary,
        "findings": all_findings
    }

    write_json(env["PROCESSED_BUCKET"], document_key, document_payload)
    write_json(env["PROCESSED_BUCKET"], quality_key, quality_payload)

    update_job(
        tenant_file_id=f"{tenant_id}#{file_id}",
        job_id=job_id,
        updates={
            "status": "COMPLETE",
            "finishedAt": now_iso(),
            "artifacts": {
                "extractedTextKey": event.get("extractedTextKey"),
                "documentJsonKey": document_key,
                "chunksJsonlKey": event.get("chunksKey"),
                "qualityReportKey": quality_key
            },
            "readinessScore": readiness_score,
            "findingsSummary": summary
        }
    )

    update_file(
        tenant_dataset_id=f"{tenant_id}#{dataset_id}",
        file_id=file_id,
        updates={
            "status": "COMPLETE",
            "latestJobId": job_id
        }
    )

    put_audit(tenant_id, "JOB_COMPLETED", {"datasetId": dataset_id, "fileId": file_id, "jobId": job_id})

    return event
