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
    }


def get_ddb_resource():
    return boto3.resource("dynamodb")


def get_ddb_client():
    return boto3.client("dynamodb")


def get_s3_client():
    return boto3.client("s3")
