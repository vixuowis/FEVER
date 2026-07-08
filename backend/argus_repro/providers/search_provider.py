from __future__ import annotations

from abc import ABC, abstractmethod

from ..core.schemas import SearchResult


class SearchProvider(ABC):
    @abstractmethod
    async def search(self, query: str, top_k: int = 10, **kwargs) -> list[SearchResult]:
        raise NotImplementedError
