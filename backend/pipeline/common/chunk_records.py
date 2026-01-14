import hashlib
from typing import Dict, List, Optional

from common.construction import (
    classify_document,
    detect_discipline,
    extract_standards,
    extract_section_reference
)


def normalize_text(text: str) -> str:
    return " ".join(text.split())


def compute_content_hash(doc_id: str, page: Optional[int], chunk_index: int, text: str) -> str:
    normalized = normalize_text(text)
    base = f"{doc_id}|{page or 0}|{chunk_index}|{normalized}"
    return hashlib.sha256(base.encode("utf-8")).hexdigest()


def build_chunk_record(
    *,
    tenant_id: str,
    dataset_id: str,
    doc_id: str,
    source_uri: str,
    filename: str,
    page: Optional[int],
    chunk_index: int,
    text: str,
    created_at: str,
    embedding_model: str,
    acl: Optional[list] = None,
    include_construction_metadata: bool = True
) -> Dict:
    chunk_id = f"{doc_id}#p{page or 0}#c{chunk_index}"
    content_hash = compute_content_hash(doc_id, page, chunk_index, text)

    record = {
        "tenant_id": tenant_id,
        "dataset_id": dataset_id,
        "doc_id": doc_id,
        "source_uri": source_uri,
        "filename": filename,
        "page": page,
        "chunk_id": chunk_id,
        "chunk_index": chunk_index,
        "text": text,
        "created_at": created_at,
        "embedding_model": embedding_model,
        "content_hash": content_hash,
        "acl": acl or []
    }

    # Add construction-specific metadata for Australian construction industry
    if include_construction_metadata:
        doc_type, doc_type_confidence = classify_document(text)
        discipline = detect_discipline(text)
        standards = extract_standards(text)
        section_ref = extract_section_reference(text)

        record["doc_type"] = doc_type
        record["doc_type_confidence"] = doc_type_confidence
        record["discipline"] = discipline
        record["standards_referenced"] = standards
        record["section_reference"] = section_ref

    return record
