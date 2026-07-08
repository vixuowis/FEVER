from __future__ import annotations

import asyncio
import json
import os
import random
from contextlib import contextmanager
from datetime import datetime, timezone
from functools import lru_cache
from pathlib import Path
from typing import Any, Awaitable, Callable, TypeVar
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

T = TypeVar("T")

PROXY_ENV_NAMES = (
    "HTTP_PROXY",
    "HTTPS_PROXY",
    "ALL_PROXY",
    "http_proxy",
    "https_proxy",
    "all_proxy",
)

TRACKING_QUERY_PREFIXES = ("utm_",)
TRACKING_QUERY_NAMES = {"fbclid", "gclid", "yclid", "mc_cid", "mc_eid"}


def normalize_url(url: str) -> str:
    """Normalize URLs for internal identity checks without changing semantic path."""
    value = (url or "").strip()
    if not value:
        return ""
    parts = urlsplit(value)
    scheme = parts.scheme.lower()
    netloc = parts.netloc.lower()
    path = parts.path.rstrip("/") if parts.path != "/" else ""
    query_items = []
    for key, val in parse_qsl(parts.query, keep_blank_values=True):
        low = key.lower()
        if low in TRACKING_QUERY_NAMES or any(low.startswith(prefix) for prefix in TRACKING_QUERY_PREFIXES):
            continue
        query_items.append((key, val))
    query = urlencode(query_items, doseq=True)
    return urlunsplit((scheme, netloc, path, query, ""))


@lru_cache(maxsize=1)
def _default_token_encoding():
    import tiktoken

    return tiktoken.get_encoding("cl100k_base")


def estimate_tokens(text: str | None) -> int:
    """Count tokens with the project tokenizer used for prompt budgeting."""
    value = text or ""
    if not value:
        return 0
    return len(_default_token_encoding().encode(value))


def token_budget_text(text: str | None, max_tokens: int) -> str:
    """Trim text to a token budget without adding summaries."""
    value = text or ""
    if max_tokens <= 0:
        return value
    encoding = _default_token_encoding()
    tokens = encoding.encode(value)
    if len(tokens) <= max_tokens:
        return value
    return encoding.decode(tokens[:max_tokens]).rstrip() + f"\n\n[token_budget_truncated: original_tokens={len(tokens)}]"


@contextmanager
def without_proxy_env():
    old = {name: os.environ.get(name) for name in PROXY_ENV_NAMES}
    for name in PROXY_ENV_NAMES:
        os.environ.pop(name, None)
    try:
        yield
    finally:
        for name, value in old.items():
            if value is None:
                os.environ.pop(name, None)
            else:
                os.environ[name] = value


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def write_json(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    tmp.replace(path)


def append_jsonl(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as f:
        f.write(json.dumps(data, ensure_ascii=False) + "\n")
        f.flush()
        os.fsync(f.fileno())


def extract_json_object(text: str) -> Any:
    text = text.strip()
    if text.startswith("```"):
        lines = text.splitlines()
        if lines and lines[0].startswith("```"):
            lines = lines[1:]
        if lines and lines[-1].startswith("```"):
            lines = lines[:-1]
        text = "\n".join(lines).strip()
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        start_obj = text.find("{")
        start_arr = text.find("[")
        starts = [x for x in [start_obj, start_arr] if x >= 0]
        if not starts:
            raise
        start = min(starts)
        end = text.rfind("}") if text[start] == "{" else text.rfind("]")
        if end <= start:
            raise
        return json.loads(text[start : end + 1])


async def retry_async(
    label: str,
    fn: Callable[[], Awaitable[T]],
    attempts: int,
    base_delay: float = 0.8,
    max_delay: float = 8.0,
) -> T:
    last_error: Exception | None = None
    for attempt in range(1, attempts + 1):
        try:
            return await fn()
        except Exception as exc:  # noqa: BLE001
            last_error = exc
            if attempt >= attempts:
                break
            delay = min(max_delay, base_delay * (2 ** (attempt - 1)))
            delay = delay * (0.75 + random.random() * 0.5)
            await asyncio.sleep(delay)
    raise RuntimeError(f"{label} failed after {attempts} attempts: {last_error}") from last_error
