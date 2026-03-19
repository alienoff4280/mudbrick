"""
Mudbrick v2 -- Local Filesystem Blob Adapter

Stores binary objects as files on the local filesystem.
Used for local development with uvicorn.
"""

from __future__ import annotations

import os
import shutil
from fnmatch import fnmatch
from pathlib import Path
from typing import Optional

from ..blob_storage import BlobStorageAdapter


class LocalBlobAdapter(BlobStorageAdapter):
    """Filesystem-based blob storage for local development."""

    def __init__(self, base_dir: str) -> None:
        self.base_dir = Path(base_dir).resolve()
        self.base_dir.mkdir(parents=True, exist_ok=True)

    def _path(self, key: str) -> Path:
        """Resolve a key to a filesystem path. Prevents path traversal."""
        resolved = (self.base_dir / key).resolve()
        if not str(resolved).startswith(str(self.base_dir)):
            raise ValueError(f"Invalid key (path traversal attempt): {key}")
        return resolved

    async def put(
        self, key: str, data: bytes, content_type: str = "application/octet-stream"
    ) -> str:
        path = self._path(key)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
        return str(path)

    async def get(self, key: str) -> Optional[bytes]:
        path = self._path(key)
        if not path.exists():
            return None
        return path.read_bytes()

    async def delete(self, key: str) -> bool:
        path = self._path(key)
        if path.exists():
            path.unlink()
            return True
        return False

    async def delete_prefix(self, prefix: str) -> int:
        """Delete all files under the prefix directory."""
        path = self._path(prefix)
        if not path.exists():
            return 0
        count = 0
        if path.is_dir():
            for item in path.rglob("*"):
                if item.is_file():
                    item.unlink()
                    count += 1
            # Remove empty directories
            shutil.rmtree(path, ignore_errors=True)
        elif path.is_file():
            path.unlink()
            count = 1
        return count

    async def list_keys(self, prefix: str = "") -> list[str]:
        path = self._path(prefix) if prefix else self.base_dir
        if not path.exists():
            return []
        keys: list[str] = []
        base = self.base_dir
        if path.is_dir():
            for item in path.rglob("*"):
                if item.is_file():
                    keys.append(str(item.relative_to(base)).replace(os.sep, "/"))
        return sorted(keys)

    async def copy(self, source_key: str, dest_key: str) -> bool:
        source = self._path(source_key)
        dest = self._path(dest_key)
        if not source.exists():
            return False
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(str(source), str(dest))
        return True

    async def exists(self, key: str) -> bool:
        return self._path(key).exists()
