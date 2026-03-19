"""
Mudbrick v2 -- Storage Adapter Factory

Selects the appropriate Blob and KV adapters based on MUDBRICK_ENV.
- "local": filesystem-based adapters for development
- "production": Vercel Blob + KV adapters

Usage:
    from app.services.blob_storage import get_blob_adapter, get_kv_adapter

    blob = get_blob_adapter()
    kv = get_kv_adapter()
"""

from __future__ import annotations

import abc
from typing import Optional

from ..config import settings


class BlobStorageAdapter(abc.ABC):
    """Abstract interface for binary object storage (PDFs, images, etc.)."""

    @abc.abstractmethod
    async def put(self, key: str, data: bytes, content_type: str = "application/octet-stream") -> str:
        """Store binary data. Returns the storage URL/path."""
        ...

    @abc.abstractmethod
    async def get(self, key: str) -> Optional[bytes]:
        """Retrieve binary data by key. Returns None if not found."""
        ...

    @abc.abstractmethod
    async def delete(self, key: str) -> bool:
        """Delete a single object. Returns True if deleted."""
        ...

    @abc.abstractmethod
    async def delete_prefix(self, prefix: str) -> int:
        """Delete all objects matching a prefix. Returns count of deleted objects."""
        ...

    @abc.abstractmethod
    async def list_keys(self, prefix: str = "") -> list[str]:
        """List all keys matching a prefix."""
        ...

    @abc.abstractmethod
    async def copy(self, source_key: str, dest_key: str) -> bool:
        """Copy an object from source to destination. Returns True if successful."""
        ...

    @abc.abstractmethod
    async def exists(self, key: str) -> bool:
        """Check if a key exists."""
        ...


class KVStorageAdapter(abc.ABC):
    """Abstract interface for key-value metadata storage (sessions, OCR results, etc.)."""

    @abc.abstractmethod
    async def get(self, key: str) -> Optional[dict]:
        """Get a JSON value by key. Returns None if not found."""
        ...

    @abc.abstractmethod
    async def set(self, key: str, value: dict, ttl_seconds: Optional[int] = None) -> None:
        """Set a JSON value. Optional TTL in seconds."""
        ...

    @abc.abstractmethod
    async def delete(self, key: str) -> bool:
        """Delete a key. Returns True if deleted."""
        ...

    @abc.abstractmethod
    async def scan(self, pattern: str) -> list[str]:
        """Scan for keys matching a glob pattern (e.g., 'session:*')."""
        ...

    @abc.abstractmethod
    async def exists(self, key: str) -> bool:
        """Check if a key exists."""
        ...


# Singleton instances
_blob_adapter: Optional[BlobStorageAdapter] = None
_kv_adapter: Optional[KVStorageAdapter] = None


def get_blob_adapter() -> BlobStorageAdapter:
    """Get the singleton Blob storage adapter."""
    global _blob_adapter
    if _blob_adapter is None:
        if settings.environment == "local":
            from .adapters.local_storage import LocalBlobAdapter

            _blob_adapter = LocalBlobAdapter(settings.data_dir)
        else:
            from .adapters.vercel_blob import VercelBlobAdapter

            _blob_adapter = VercelBlobAdapter(settings.blob_read_write_token)
    return _blob_adapter


def get_kv_adapter() -> KVStorageAdapter:
    """Get the singleton KV storage adapter."""
    global _kv_adapter
    if _kv_adapter is None:
        if settings.environment == "local":
            from .adapters.local_kv import LocalKVAdapter

            _kv_adapter = LocalKVAdapter(settings.data_dir)
        else:
            from .adapters.vercel_kv import VercelKVAdapter

            _kv_adapter = VercelKVAdapter(
                settings.kv_rest_api_url, settings.kv_rest_api_token
            )
    return _kv_adapter


def reset_adapters() -> None:
    """Reset singleton adapters (for testing)."""
    global _blob_adapter, _kv_adapter
    _blob_adapter = None
    _kv_adapter = None
