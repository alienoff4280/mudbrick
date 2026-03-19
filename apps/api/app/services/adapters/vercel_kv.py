"""
Mudbrick v2 -- Vercel KV Storage Adapter (Stub)

TODO: Implement when deploying to Vercel.
Uses the Vercel KV (Redis) REST API for key-value metadata storage.
"""

from __future__ import annotations

from typing import Optional

from ..blob_storage import KVStorageAdapter


class VercelKVAdapter(KVStorageAdapter):
    """Vercel KV (Redis) storage adapter. Stub -- implement for production deployment."""

    def __init__(self, api_url: str, api_token: str) -> None:
        self.api_url = api_url
        self.api_token = api_token
        if not api_url or not api_token:
            raise ValueError(
                "KV_REST_API_URL and KV_REST_API_TOKEN are required for Vercel KV adapter"
            )

    async def get(self, key: str) -> Optional[dict]:
        # TODO: Use httpx to call Vercel KV REST API
        # GET {api_url}/get/{key}
        raise NotImplementedError("Vercel KV adapter not yet implemented")

    async def set(
        self, key: str, value: dict, ttl_seconds: Optional[int] = None
    ) -> None:
        # TODO: Use httpx to call Vercel KV REST API
        # POST {api_url}/set/{key} with optional EX {ttl_seconds}
        raise NotImplementedError("Vercel KV adapter not yet implemented")

    async def delete(self, key: str) -> bool:
        raise NotImplementedError("Vercel KV adapter not yet implemented")

    async def scan(self, pattern: str) -> list[str]:
        # TODO: Use SCAN command via REST API
        raise NotImplementedError("Vercel KV adapter not yet implemented")

    async def exists(self, key: str) -> bool:
        raise NotImplementedError("Vercel KV adapter not yet implemented")
