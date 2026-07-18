"""Meta endpoints: /api/health · /api/skills · /api/agents · /api/cache/* (design.md §8)."""
from __future__ import annotations

from fastapi import APIRouter, Query

from .. import config
from ..agents.roster import roster_public
from ..skills.cache import CACHE, TTL_PROFILES, clear_cache, set_cache_disabled
from ..skills.registry import REGISTRY, ensure_skills_loaded

router = APIRouter(prefix="/api", tags=["meta"])


@router.get("/health")
def health():
    return {"ok": True, "llm": "configured" if config.ARK_API_KEY else "missing_api_key"}


@router.get("/skills")
def skills():
    ensure_skills_loaded()
    return [
        {
            "name": s.name,
            "description": s.description,
            "parameters": s.parameters,
            "category": s.category,        # "atomic" | "composite"
            "internal": s.internal,        # True: LLM 不可见
            "composes": list(s.composes),  # composite 声明调用的 sub-skill
        }
        for s in REGISTRY.values()
    ]


@router.get("/agents")
def agents():
    return roster_public()


# ------------------------------------------------------------ 缓存管理 ---


@router.get("/cache/stats")
def cache_stats():
    """缓存命中统计：size / hits / misses / hit_rate / 各 profile 数量。"""
    stats = CACHE.stats()
    stats["ttl_profiles"] = TTL_PROFILES
    return stats


@router.post("/cache/clear")
def cache_clear():
    """手动清空缓存（调试 / 强制刷新用）。"""
    return {"cleared": clear_cache()}


@router.post("/cache/toggle")
def cache_toggle(disabled: bool = Query(False, description="True=禁用缓存，False=启用")):
    """运行时切换缓存开关（仅供调试）。环境变量 FEVER_CACHE_DISABLE 也可在启动时禁用。"""
    set_cache_disabled(disabled)
    return {"disabled": disabled}
