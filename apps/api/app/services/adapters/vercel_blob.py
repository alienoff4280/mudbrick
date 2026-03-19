"""
Mudbrick v2 -- Vercel Blob Storage Adapter (Stub)

TODO: Implement when deploying to Vercel.
Uses the Vercel Blob Python SDK or REST API for binary object storage.
"""

from __future__ import annotations

from typing import Optional

from ..blob_storage import BlobStorageAdapter


class VercelBlobAdapter(BlobStorageAdapter):
    """Vercel Blob storage adapter. Stub -- implement for production deployment."""

    def __init__(self, token: str) -> None:
        self.token = token
        if not token:
            raise ValueError(
                "BLOB_READ_WRITE_TOKEN is required for Vercel Blob adapter"
            )

    async def put(
        self, key: str, data: bytes, content_type: str = "application/octet-stream"
    ) -> str:
        # TODO: Use vercel-blob SDK or REST API
        # https://vercel.com/docs/storage/vercel-blob/using-blob-sdk
        raise NotImplementedError("Vercel Blob adapter not yet implemented")

    async def get(self, key: str) -> Optional[bytes]:
        raise NotImplementedError("Vercel Blob adapter not yet implemented")

    async def delete(self, key: str) -> bool:
        raise NotImplementedError("Vercel Blob adapter not yet implemented")

    async def delete_prefix(self, prefix: str) -> int:
        raise NotImplementedError("Vercel Blob adapter not yet implemented")

    async def list_keys(self, prefix: str = "") -> list[str]:
        raise NotImplementedError("Vercel Blob adapter not yet implemented")

    async def copy(self, source_key: str, dest_key: str) -> bool:
        raise NotImplementedError("Vercel Blob adapter not yet implemented")

    async def exists(self, key: str) -> bool:
        raise NotImplementedError("Vercel Blob adapter not yet implemented")
