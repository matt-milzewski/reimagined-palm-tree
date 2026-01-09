from typing import Dict, List

from common.aws import get_env
from common.ddb import update_file, query_duplicates_by_hash, query_recent_files
from common.simhash import simhash, hamming_distance
from common.storage import read_text


env = get_env()


SEVERITY_DEDUCTIONS = {
    "CRITICAL": 40,
    "WARN": 15,
    "INFO": 5
}


def summarize_findings(findings: List[Dict]) -> Dict:
    summary = {"CRITICAL": 0, "WARN": 0, "INFO": 0}
    for finding in findings:
        severity = finding.get("severity", "INFO")
        if severity in summary:
            summary[severity] += 1
    return summary


def compute_readiness(findings: List[Dict]) -> int:
    score = 100
    for finding in findings:
        score -= SEVERITY_DEDUCTIONS.get(finding.get("severity", "INFO"), 0)
    return max(0, min(100, score))


def handler(event, _context):
    tenant_id = event["tenantId"]
    dataset_id = event["datasetId"]
    file_id = event["fileId"]

    cleaned_text = read_text(env["PROCESSED_BUCKET"], event["cleanedTextKey"])
    raw_sha256 = event.get("rawSha256")
    extraction_stats = event.get("extractionStats", {})
    normalization_stats = event.get("normalizationStats", {})

    findings: List[Dict] = []

    duplicates = query_duplicates_by_hash(tenant_id, raw_sha256)
    duplicates = [item for item in duplicates if item.get("fileId") != file_id]
    if duplicates:
        findings.append({
            "type": "EXACT_DUPLICATE",
            "severity": "CRITICAL",
            "description": "Exact duplicate detected based on raw file hash.",
            "evidence": {"matchingFileIds": [item.get("fileId") for item in duplicates]},
            "recommendation": "Remove duplicates or keep the most complete copy."
        })

    simhash_value = simhash(cleaned_text)
    recent_files = query_recent_files(tenant_id, limit=50)
    near_dupes = []
    for item in recent_files:
        if item.get("fileId") == file_id:
            continue
        other_hash = item.get("simhash")
        if other_hash is None:
            continue
        distance = hamming_distance(simhash_value, int(other_hash))
        if distance <= 3:
            near_dupes.append({"fileId": item.get("fileId"), "distance": distance})

    if near_dupes:
        findings.append({
            "type": "NEAR_DUPLICATE",
            "severity": "WARN",
            "description": "Near duplicate detected based on text fingerprint.",
            "evidence": {"matches": near_dupes[:5]},
            "recommendation": "Review similar files to reduce redundancy."
        })

    if extraction_stats.get("textLength", 0) < 300:
        findings.append({
            "type": "LOW_TEXT_VOLUME",
            "severity": "WARN",
            "description": "Extracted text is very short.",
            "evidence": {"textLength": extraction_stats.get("textLength", 0)},
            "recommendation": "Verify the PDF has selectable text or re-export it."
        })

    if extraction_stats.get("nonAlphaRatio", 0) > 0.5:
        findings.append({
            "type": "HIGH_NON_ALPHA_RATIO",
            "severity": "WARN",
            "description": "Extracted text contains a high ratio of non-alphanumeric characters.",
            "evidence": {"nonAlphaRatio": extraction_stats.get("nonAlphaRatio")},
            "recommendation": "Clean formatting artifacts or re-export the PDF."
        })

    if extraction_stats.get("repeatedLineRatio", 0) > 0.4:
        findings.append({
            "type": "REPEATED_LINES",
            "severity": "WARN",
            "description": "Repeated lines suggest header/footer noise.",
            "evidence": {"repeatedLineRatio": extraction_stats.get("repeatedLineRatio")},
            "recommendation": "Remove recurring headers or footers and reprocess."
        })

    removed_headers = normalization_stats.get("removedHeaderLines") or []
    removed_footers = normalization_stats.get("removedFooterLines") or []
    if removed_headers or removed_footers:
        findings.append({
            "type": "HEADER_FOOTER_REMOVAL",
            "severity": "INFO",
            "description": "Repeated headers or footers were removed during normalization.",
            "evidence": {"headers": removed_headers, "footers": removed_footers},
            "recommendation": "Review the cleaned output to ensure important data was preserved."
        })

    update_file(
        tenant_dataset_id=f"{tenant_id}#{dataset_id}",
        file_id=file_id,
        updates={
            "simhash": str(simhash_value)
        }
    )

    readiness_score = compute_readiness(findings)
    findings_summary = summarize_findings(findings)

    event.update({
        "readinessScore": readiness_score,
        "findings": findings,
        "findingsSummary": findings_summary
    })

    return event
