from common.chunk_records import build_chunk_record, compute_content_hash


def test_build_chunk_record_contract():
    record = build_chunk_record(
        tenant_id="tenant-1",
        dataset_id="dataset-1",
        doc_id="doc-1",
        source_uri="s3://bucket/raw/tenant-1/doc.pdf",
        filename="doc.pdf",
        page=3,
        chunk_index=2,
        text="Example text for chunking.",
        created_at="2025-01-01T00:00:00Z",
        embedding_model="amazon.titan-embed-text-v1"
    )

    assert record["tenant_id"] == "tenant-1"
    assert record["dataset_id"] == "dataset-1"
    assert record["doc_id"] == "doc-1"
    assert record["source_uri"].startswith("s3://")
    assert record["filename"] == "doc.pdf"
    assert record["page"] == 3
    assert record["chunk_index"] == 2
    assert record["chunk_id"] == "doc-1#p3#c2"
    assert record["text"] == "Example text for chunking."
    assert record["embedding_model"] == "amazon.titan-embed-text-v1"
    assert isinstance(record["content_hash"], str)


def test_content_hash_deterministic():
    first = compute_content_hash("doc-1", 1, 0, "Text")
    second = compute_content_hash("doc-1", 1, 0, "Text")
    different = compute_content_hash("doc-1", 1, 1, "Text")

    assert first == second
    assert first != different
