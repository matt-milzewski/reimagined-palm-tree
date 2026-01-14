import re
from typing import Dict, List, Optional, Tuple

from common.aws import get_env
from common.ddb import update_file, query_duplicates_by_hash, query_recent_files
from common.simhash import simhash, hamming_distance
from common.storage import read_text
from common.construction import classify_document, detect_discipline, extract_standards


env = get_env()


# Revision/version patterns for construction documents
REVISION_PATTERNS = [
    r"[Rr]ev(?:ision)?[-_.\s]*([A-Z0-9]+)",   # Rev A, Rev-A, Rev_A, Rev.A, Revision B
    r"[Vv](?:ersion)?[-_.\s]*(\d+(?:\.\d+)*)", # V1, V2.1, Version 3, v_2
    r"[Ii]ssue[-_\s]*(\d+)",                   # Issue 1, Issue-2, Issue_3
    r"[Aa]mendment[-_\s]*(\d+)",               # Amendment 1, Amendment-2
]

# Date patterns for Australian construction documents
DATE_PATTERNS = [
    r"\d{1,2}\s+(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{4}",
    r"\d{1,2}/\d{1,2}/\d{4}",                  # DD/MM/YYYY
    r"\d{4}-\d{2}-\d{2}",                      # YYYY-MM-DD
    r"(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{4}",
]

# OCR quality indicators
OCR_ERROR_PATTERNS = [
    r"[^\s]{20,}",           # Very long strings without spaces (OCR merging)
    r"[\|\[\]\{\}]{3,}",     # Repeated bracket characters
    r"[0-9OoIl]{10,}",       # Common OCR confusion characters in long strings
]


def extract_revision(text: str, filename: str) -> Optional[str]:
    """Extract revision/version from text or filename."""
    # Check filename first
    for pattern in REVISION_PATTERNS:
        match = re.search(pattern, filename)
        if match:
            return match.group(0).strip()

    # Check first 2000 chars of text
    sample = text[:2000]
    for pattern in REVISION_PATTERNS:
        match = re.search(pattern, sample)
        if match:
            return match.group(0).strip()

    return None


def extract_document_date(text: str) -> Optional[str]:
    """Extract date from document text."""
    sample = text[:3000]
    for pattern in DATE_PATTERNS:
        match = re.search(pattern, sample, re.IGNORECASE)
        if match:
            return match.group(0).strip()
    return None


def detect_ocr_quality_issues(text: str) -> Tuple[bool, float]:
    """
    Detect OCR quality issues in text.
    Returns (has_issues, error_ratio)
    """
    if not text:
        return False, 0.0

    sample = text[:5000]
    issue_count = 0

    for pattern in OCR_ERROR_PATTERNS:
        matches = re.findall(pattern, sample)
        issue_count += len(matches)

    # Calculate ratio of problematic patterns
    words = sample.split()
    if not words:
        return False, 0.0

    error_ratio = issue_count / len(words)
    return error_ratio > 0.1, round(error_ratio, 4)


def detect_drawing_document(text: str, filename: str) -> bool:
    """Detect if document is a drawing with minimal text."""
    drawing_indicators = [
        r"(?i)DWG[-\s]?\d+",
        r"(?i)SK[-\s]?\d+",
        r"(?i)DRAWING\s+(?:NO|NUMBER|#)",
        r"(?i)\b(?:A|S|M|E|P|H)[-]?\d{3}\b",  # Standard drawing prefixes
    ]

    # Check filename
    if re.search(r"(?i)(dwg|drawing|sk-|floorplan)", filename):
        return True

    sample = text[:2000]
    for pattern in drawing_indicators:
        if re.search(pattern, sample):
            return True

    return False


def get_base_filename(filename: str) -> str:
    """Extract base filename without revision suffix for superseded detection."""
    # Remove extension first
    base = re.sub(r"\.\w+$", "", filename)
    # Remove common revision suffixes
    base = re.sub(r"[-_\s]+[Rr]ev(?:ision)?[-_.\s]*[A-Z0-9]+$", "", base, flags=re.IGNORECASE)
    base = re.sub(r"[-_\s]+[Vv](?:ersion)?[-_.\s]*\d+(?:\.\d+)*$", "", base, flags=re.IGNORECASE)
    base = re.sub(r"[-_\s]+[Ii]ssue[-_\s]*\d+$", "", base, flags=re.IGNORECASE)
    base = re.sub(r"[-_\s]+[Aa]mendment[-_\s]*\d+$", "", base, flags=re.IGNORECASE)
    return base.strip()


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
    filename = event.get("filename", "")

    cleaned_text = read_text(env["PROCESSED_BUCKET"], event["cleanedTextKey"])
    raw_sha256 = event.get("rawSha256")
    extraction_stats = event.get("extractionStats", {})
    normalization_stats = event.get("normalizationStats", {})

    findings: List[Dict] = []

    # ----- EXACT DUPLICATE CHECK -----
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

    # ----- NEAR DUPLICATE CHECK -----
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

    # ----- SUPERSEDED DOCUMENT DETECTION -----
    # Check if this file supersedes or is superseded by another version
    current_revision = extract_revision(cleaned_text, filename)
    base_filename = get_base_filename(filename)

    if base_filename and current_revision:
        for item in recent_files:
            if item.get("fileId") == file_id:
                continue
            other_filename = item.get("filename", "")
            other_base = get_base_filename(other_filename)

            # Check if same base document
            if other_base.lower() == base_filename.lower():
                other_revision = extract_revision("", other_filename)
                if other_revision and other_revision != current_revision:
                    findings.append({
                        "type": "SUPERSEDED_VERSION",
                        "severity": "WARN",
                        "description": f"Another version of this document exists ({other_revision}).",
                        "evidence": {
                            "currentRevision": current_revision,
                            "otherFileId": item.get("fileId"),
                            "otherRevision": other_revision
                        },
                        "recommendation": "Ensure only the latest revision is used for queries. Consider removing outdated versions."
                    })
                    break

    # ----- LOW TEXT VOLUME CHECK -----
    text_length = extraction_stats.get("textLength", 0)
    is_drawing = detect_drawing_document(cleaned_text, filename)

    if text_length < 300:
        if is_drawing:
            findings.append({
                "type": "DRAWING_LOW_TEXT",
                "severity": "INFO",
                "description": "Drawing document with minimal text content.",
                "evidence": {"textLength": text_length, "isDrawing": True},
                "recommendation": "Drawings contain limited searchable text. Consider adding drawing registers or specification cross-references."
            })
        else:
            findings.append({
                "type": "LOW_TEXT_VOLUME",
                "severity": "WARN",
                "description": "Extracted text is very short.",
                "evidence": {"textLength": text_length},
                "recommendation": "Verify the PDF has selectable text or re-export it."
            })

    # ----- OCR QUALITY CHECK -----
    has_ocr_issues, ocr_error_ratio = detect_ocr_quality_issues(cleaned_text)
    if has_ocr_issues:
        findings.append({
            "type": "POOR_OCR_QUALITY",
            "severity": "CRITICAL",
            "description": "Text appears to have OCR quality issues (garbled text, merged words).",
            "evidence": {"errorRatio": ocr_error_ratio},
            "recommendation": "Re-scan the original document with higher quality or use a PDF with selectable text."
        })

    # ----- HIGH NON-ALPHA RATIO CHECK -----
    if extraction_stats.get("nonAlphaRatio", 0) > 0.5:
        findings.append({
            "type": "HIGH_NON_ALPHA_RATIO",
            "severity": "WARN",
            "description": "Extracted text contains a high ratio of non-alphanumeric characters.",
            "evidence": {"nonAlphaRatio": extraction_stats.get("nonAlphaRatio")},
            "recommendation": "Clean formatting artifacts or re-export the PDF."
        })

    # ----- REPEATED LINES CHECK -----
    if extraction_stats.get("repeatedLineRatio", 0) > 0.4:
        findings.append({
            "type": "REPEATED_LINES",
            "severity": "WARN",
            "description": "Repeated lines suggest header/footer noise.",
            "evidence": {"repeatedLineRatio": extraction_stats.get("repeatedLineRatio")},
            "recommendation": "Remove recurring headers or footers and reprocess."
        })

    # ----- HEADER/FOOTER REMOVAL INFO -----
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

    # ----- CONSTRUCTION-SPECIFIC CHECKS -----
    # Missing date check
    doc_date = extract_document_date(cleaned_text)
    if not doc_date:
        findings.append({
            "type": "MISSING_DATE",
            "severity": "INFO",
            "description": "No document date could be identified.",
            "evidence": {},
            "recommendation": "Documents without dates may be difficult to verify as current. Consider adding date metadata."
        })

    # Missing revision check (for non-drawings)
    if not current_revision and not is_drawing:
        doc_type, _ = classify_document(cleaned_text)
        if doc_type in ["specification", "contract", "swms", "itp", "variation"]:
            findings.append({
                "type": "MISSING_REVISION",
                "severity": "INFO",
                "description": f"No revision number found for {doc_type} document.",
                "evidence": {"docType": doc_type},
                "recommendation": "Construction documents should include revision numbers for version control."
            })

    # Australian standards referenced
    standards = extract_standards(cleaned_text)
    if standards:
        findings.append({
            "type": "STANDARDS_REFERENCED",
            "severity": "INFO",
            "description": f"Australian standards referenced in document.",
            "evidence": {"standards": standards[:10]},  # Limit to 10 standards
            "recommendation": "Document contains regulatory references that may be useful for compliance queries."
        })

    # ----- UPDATE FILE RECORD -----
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
        "findingsSummary": findings_summary,
        "constructionMetadata": {
            "revision": current_revision,
            "documentDate": doc_date,
            "standards": standards[:10] if standards else [],
            "isDrawing": is_drawing
        }
    })

    return event
