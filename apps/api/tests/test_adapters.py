"""
Mudbrick v2 -- Tests for Local Storage Adapters
"""

from __future__ import annotations

import pytest


@pytest.mark.asyncio
class TestLocalBlobAdapter:
    """Tests for LocalBlobAdapter filesystem operations."""

    async def test_put_and_get(self, blob_adapter):
        data = b"hello world"
        await blob_adapter.put("test/file.txt", data)
        result = await blob_adapter.get("test/file.txt")
        assert result == data

    async def test_get_nonexistent(self, blob_adapter):
        result = await blob_adapter.get("nonexistent/file.txt")
        assert result is None

    async def test_delete(self, blob_adapter):
        await blob_adapter.put("test/delete-me.txt", b"data")
        assert await blob_adapter.exists("test/delete-me.txt")
        deleted = await blob_adapter.delete("test/delete-me.txt")
        assert deleted is True
        assert not await blob_adapter.exists("test/delete-me.txt")

    async def test_delete_nonexistent(self, blob_adapter):
        deleted = await blob_adapter.delete("nonexistent.txt")
        assert deleted is False

    async def test_delete_prefix(self, blob_adapter):
        await blob_adapter.put("sessions/abc/current.pdf", b"pdf1")
        await blob_adapter.put("sessions/abc/versions/v1.pdf", b"pdf2")
        await blob_adapter.put("sessions/abc/versions/v2.pdf", b"pdf3")
        await blob_adapter.put("sessions/other/current.pdf", b"pdf4")

        count = await blob_adapter.delete_prefix("sessions/abc/")
        assert count == 3
        assert not await blob_adapter.exists("sessions/abc/current.pdf")
        assert await blob_adapter.exists("sessions/other/current.pdf")

    async def test_list_keys(self, blob_adapter):
        await blob_adapter.put("a/1.txt", b"1")
        await blob_adapter.put("a/2.txt", b"2")
        await blob_adapter.put("b/3.txt", b"3")

        all_keys = await blob_adapter.list_keys()
        assert len(all_keys) == 3

        a_keys = await blob_adapter.list_keys("a/")
        assert len(a_keys) == 2
        assert all(k.startswith("a/") for k in a_keys)

    async def test_copy(self, blob_adapter):
        await blob_adapter.put("source.pdf", b"source data")
        success = await blob_adapter.copy("source.pdf", "dest.pdf")
        assert success is True
        assert await blob_adapter.get("dest.pdf") == b"source data"
        # Source still exists
        assert await blob_adapter.exists("source.pdf")

    async def test_copy_nonexistent(self, blob_adapter):
        success = await blob_adapter.copy("nonexistent.pdf", "dest.pdf")
        assert success is False

    async def test_exists(self, blob_adapter):
        assert not await blob_adapter.exists("test.pdf")
        await blob_adapter.put("test.pdf", b"data")
        assert await blob_adapter.exists("test.pdf")

    async def test_path_traversal_blocked(self, blob_adapter):
        with pytest.raises(ValueError, match="path traversal"):
            await blob_adapter.put("../../etc/passwd", b"hack")


@pytest.mark.asyncio
class TestLocalKVAdapter:
    """Tests for LocalKVAdapter JSON file operations."""

    async def test_set_and_get(self, kv_adapter):
        value = {"session_id": "abc123", "page_count": 10}
        await kv_adapter.set("session:abc123", value)
        result = await kv_adapter.get("session:abc123")
        assert result == value

    async def test_get_nonexistent(self, kv_adapter):
        result = await kv_adapter.get("nonexistent:key")
        assert result is None

    async def test_delete(self, kv_adapter):
        await kv_adapter.set("session:delete-me", {"data": True})
        assert await kv_adapter.exists("session:delete-me")
        deleted = await kv_adapter.delete("session:delete-me")
        assert deleted is True
        assert not await kv_adapter.exists("session:delete-me")

    async def test_delete_nonexistent(self, kv_adapter):
        deleted = await kv_adapter.delete("nonexistent:key")
        assert deleted is False

    async def test_ttl_expiration(self, kv_adapter):
        await kv_adapter.set("session:ttl", {"data": True}, ttl_seconds=-1)
        # TTL is already expired (negative)
        result = await kv_adapter.get("session:ttl")
        assert result is None

    async def test_ttl_not_expired(self, kv_adapter):
        await kv_adapter.set("session:ttl", {"data": True}, ttl_seconds=3600)
        result = await kv_adapter.get("session:ttl")
        assert result is not None
        assert result["data"] is True
        # Internal TTL field should not be exposed
        assert "_ttl_expires_at" not in result

    async def test_scan(self, kv_adapter):
        await kv_adapter.set("session:abc", {"id": "abc"})
        await kv_adapter.set("session:def", {"id": "def"})
        await kv_adapter.set("ocr:abc", {"id": "abc"})

        session_keys = await kv_adapter.scan("session:*")
        assert len(session_keys) == 2
        assert all(k.startswith("session:") for k in session_keys)

    async def test_exists(self, kv_adapter):
        assert not await kv_adapter.exists("session:x")
        await kv_adapter.set("session:x", {"data": True})
        assert await kv_adapter.exists("session:x")

    async def test_overwrite(self, kv_adapter):
        await kv_adapter.set("session:x", {"version": 1})
        await kv_adapter.set("session:x", {"version": 2})
        result = await kv_adapter.get("session:x")
        assert result is not None
        assert result["version"] == 2
