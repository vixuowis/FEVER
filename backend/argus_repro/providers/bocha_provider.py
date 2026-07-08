from __future__ import annotations

from typing import Any

import aiohttp

from ..core.config import ArgusConfig
from ..core.logging_utils import RunLogger
from ..core.schemas import SearchResult
from .search_provider import SearchProvider
from ..core.utils import retry_async


class BochaProvider(SearchProvider):
    def __init__(self, config: ArgusConfig, logger: RunLogger | None = None):
        self.config = config
        self.logger = logger
        self._session: aiohttp.ClientSession | None = None

    async def __aenter__(self) -> "BochaProvider":
        await self.open()
        return self

    async def __aexit__(self, *_args: object) -> None:
        await self.close()

    async def open(self) -> None:
        if self._session is None:
            timeout = aiohttp.ClientTimeout(total=60)
            self._session = aiohttp.ClientSession(timeout=timeout, trust_env=False)

    async def close(self) -> None:
        if self._session is not None:
            await self._session.close()
            self._session = None

    async def search(
        self,
        query: str,
        top_k: int = 10,
        *,
        freshness: str = "noLimit",
        summary: bool = True,
        include: str | None = None,
        exclude: str | None = None,
    ) -> list[SearchResult]:
        await self.open()
        assert self._session is not None
        url = f"{self.config.bocha_base_url.rstrip('/')}/web-search"
        headers = {
            "Authorization": f"Bearer {self.config.bocha_api_key}",
            "Content-Type": "application/json",
        }
        payload: dict[str, Any] = {
            "query": query,
            "freshness": freshness,
            "summary": summary,
            "count": top_k,
        }
        if include:
            payload["include"] = include
        if exclude:
            payload["exclude"] = exclude

        async def _call() -> list[SearchResult]:
            async with self._session.post(url, headers=headers, json=payload) as resp:
                text = await resp.text()
                if resp.status != 200:
                    raise RuntimeError(f"Bocha web-search status={resp.status}: {text[:1000]}")
                raw = await resp.json()
                data = raw.get("data", raw)
                values = data.get("webPages", {}).get("value", [])
                results: list[SearchResult] = []
                for idx, item in enumerate(values, start=1):
                    results.append(
                        SearchResult(
                            title=item.get("name") or "",
                            url=item.get("url") or "",
                            snippet=item.get("snippet"),
                            summary=item.get("summary"),
                            content=item.get("content"),
                            published_time=item.get("datePublished"),
                            source=item.get("siteName"),
                            rank=idx,
                            raw=item,
                        )
                    )
                if self.logger:
                    self.logger.log("bocha_search", query=query, top_k=top_k, returned=len(results))
                return results

        return await retry_async("bocha_web_search", _call, attempts=self.config.retry_attempts)
