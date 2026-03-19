"""
Mudbrick v2 -- Local Filesystem KV Adapter

Stores key-value pairs as JSON files on the local filesystem.
Used for local development with uvicorn.
"""

from __future__ import annotations

import json
import os
import time
from fnmatch import fnmatch
from pathlib import Path
from typing import Optional

from ..blob_storage import KVStorageAdapter


class LocalKVAdapter(KVStorageAdapter):
    """Filesystem-based key-value storage for local development."""

    def __init__(self, base_dir: str) -> None:
        self.kv_dir = Path(base_dir).resolve() / "kv"
        self.kv_dir.mkdir(parents=True, exist_ok=True)

    def _path(self, key: str) -> Path:
        """Convert a key like 'session:abc123' to a safe filesystem path."""
        # Replace colons and slashes with underscores for safe filenames
        safe_name = key.replace(":", "_").replace("/", "_")
        resolved = (self.kv_dir / f"{safe_name}.json").resolve()
        if not str(resolved).startswith(str(self.kv_dir)):
            raise ValueError(f"Invalid key (path traversal attempt): {key}")
        return resolved

    async def get(self, key: str) -> Optional[dict]:
        path = self._path(key)
        if not path.exists():
            return None
        data = json.loads(path.read_text(encoding="utf-8"))
        # Check TTL
        if "_ttl_expires_at" in data:
            if time.time() > data["_ttl_expires_at"]:
                path.unlink()
                return None
            # Remove internal TTL field from returned data
            result = {k: v for k, v in data.items() if k != "_ttl_expires_at"}
            return result
        return data

    async def set(
        self, key: str, value: dict, ttl_seconds: Optional[int] = None
    ) -> None:
        path = self._path(key)
        path.parent.mkdir(parents=True, exist_ok=True)
        data = dict(value)
        if ttl_seconds is not None:
            data["_ttl_expires_at"] = time.time() + ttl_seconds
        path.write_text(json.dumps(data, indent=2, default=str), encoding="utf-8")

    async def delete(self, key: str) -> bool:
        path = self._path(key)
        if path.exists():
            path.unlink()
            return True
        return False

    async def scan(self, pattern: str) -> list[str]:
        """Scan for keys matching a glob pattern (e.g., 'session:*').

        Converts the key pattern to a filename pattern and matches against stored files.
        """
        keys: list[str] = []
        for item in self.kv_dir.glob("*.json"):
            # Reconstruct the key from filename
            # We stored 'session:abc' as 'session_abc.json'
            # To match, convert the pattern the same way
            stem = item.stem  # e.g. 'session_abc'
            # Check if the file matches by trying both original and safe patterns
            safe_pattern = pattern.replace(":", "_").replace("/", "_")
            if fnmatch(stem, safe_pattern):
                # Read the file to get the original key if stored, or reconstruct
                try:
                    data = json.loads(item.read_text(encoding="utf-8"))
                    # Check TTL expiration
                    if "_ttl_expires_at" in data and time.time() > data["_ttl_expires_at"]:
                        item.unlink()
                        continue
                except (json.JSONDecodeError, OSError):
                    continue
                # Reconstruct key: replace first underscore back to colon
                # This is a best-effort reconstruction
                key = stem.replace("_", ":", 1)
                keys.append(key)
        return sorted(keys)

    async def exists(self, key: str) -> bool:
        path = self._path(key)
        if not path.exists():
            return False
        # Check TTL
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
            if "_ttl_expires_at" in data and time.time() > data["_ttl_expires_at"]:
                path.unlink()
                return False
        except (json.JSONDecodeError, OSError):
            return False
        return True
