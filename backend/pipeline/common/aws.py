import os
import boto3


def get_env() -> dict:
    return {
        "RAW_BUCKET": os.environ.get("RAW_BUCKET", ""),
        "PROCESSED_BUCKET": os.environ.get("PROCESSED_BUCKET", ""),
        "FILES_TABLE": os.environ.get("FILES_TABLE", ""),
        "JOBS_TABLE": os.environ.get("JOBS_TABLE", ""),
        "DATASETS_TABLE": os.environ.get("DATASETS_TABLE", ""),
        "AUDIT_TABLE": os.environ.get("AUDIT_TABLE", ""),
        "FILES_GSI_HASH": os.environ.get("FILES_GSI_HASH", "rawSha256-index"),
        "FILES_GSI_RECENT": os.environ.get("FILES_GSI_RECENT", "tenantCreatedAt-index"),
        "OPENSEARCH_COLLECTION_ENDPOINT": os.environ.get("OPENSEARCH_COLLECTION_ENDPOINT", ""),
        "OPENSEARCH_INDEX_NAME": os.environ.get("OPENSEARCH_INDEX_NAME", ""),
        "BEDROCK_EMBED_MODEL_ID": os.environ.get("BEDROCK_EMBED_MODEL_ID", ""),
        "EMBEDDING_DIMENSION": os.environ.get("EMBEDDING_DIMENSION", ""),
        "INGEST_BATCH_SIZE": os.environ.get("INGEST_BATCH_SIZE", "50"),
        "INGEST_CONCURRENCY": os.environ.get("INGEST_CONCURRENCY", "4"),
    }


def get_ddb_resource():
    return boto3.resource("dynamodb")


def get_ddb_client():
    return boto3.client("dynamodb")


def get_s3_client():
    return boto3.client("s3")
