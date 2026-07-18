"""Meta endpoints: /api/health · /api/skills · /api/agents · /api/hot_topics · /api/cache/* (design.md §8)."""
from __future__ import annotations

import threading
import time
from typing import Any

import akshare as ak
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
        {"name": s.name, "description": s.description, "parameters": s.parameters}
        for s in REGISTRY.values()
    ]


@router.get("/agents")
def agents():
    return roster_public()


# ------------------------------------------------------------- 热点事件 ---
_HOT_CACHE: dict[str, Any] = {"data": None, "ts": 0.0}
_HOT_TTL = 600.0  # 10 分钟
_HOT_LOCK = threading.Lock()


def _build_hot_topics() -> list[dict]:
    """聚合 5 条热点研究问题：从全局快讯、板块异动、板块资金流中各取若干。
    返回 [{category, title, desc, query, mode, icon_hint}, ...]"""
    items: list[dict] = []

    # 1) 全局快讯 → 2-3 条
    try:
        df = ak.stock_info_global_em()
        if df is not None and len(df) > 0:
            for _, r in df.head(3).iterrows():
                title = str(r.get("标题") or "").strip()
                if not title:
                    continue
                items.append({
                    "category": "news",
                    "title": title[:60],
                    "desc": f"事件：{title[:40]}…（{str(r.get('发布时间') or '')[:16]}）",
                    "query": f"深度分析「{title[:30]}」事件：涉及哪些标的？事件前后的股价/资金反应？是否有后续影响？",
                    "mode": "auto",
                    "icon_hint": "newspaper",
                })
    except Exception:
        pass

    # 2) 板块异动 → 1 条（取涨跌幅最高且异动次数多的板块）
    try:
        df = ak.stock_board_change_em()
        if df is not None and len(df) > 0:
            # 取有异动个股的板块中涨跌幅最高的 1 个
            sub = df.dropna(subset=["板块异动最频繁个股及所属类型-股票名称"]).head(20)
            if len(sub) > 0:
                sub = sub.sort_values("涨跌幅", ascending=False).head(1)
                r = sub.iloc[0]
                board = str(r.get("板块名称") or "").strip()
                pct = r.get("涨跌幅")
                lead = str(r.get("板块异动最频繁个股及所属类型-股票名称") or "").strip()
                if board:
                    items.append({
                        "category": "board",
                        "title": f"「{board}」板块异动 {pct:+.2f}%",
                        "desc": f"领涨个股：{lead or '—'} · 分析板块异动原因与持续性",
                        "query": f"分析「{board}」板块今日异动原因，涉及个股 {lead} 表现；异动是否可持续？",
                        "mode": "team",
                        "icon_hint": "sparkles",
                    })
    except Exception:
        pass

    # 3) 板块资金流 → 1 条（取净流入最高的行业）
    try:
        df = ak.stock_fund_flow_industry()
        if df is not None and len(df) > 0:
            sub = df.copy()
            # 净额可能已经是 float64（亿元）也可能被序列化为 "1.23亿"/"5678.9万"
            def _to_yi(v: Any) -> float:
                if v is None: return 0.0
                if isinstance(v, (int, float)):
                    return float(v)  # 已是亿元
                s = str(v).replace(",", "").strip()
                try:
                    if s.endswith("亿"): return float(s[:-1])
                    if s.endswith("万"): return float(s[:-1]) / 1e4
                    return float(s)
                except Exception:  # noqa: BLE001
                    return 0.0
            if "净额" in sub.columns:
                sub["__n"] = sub["净额"].apply(_to_yi)
                sub = sub[sub["__n"] > 0].sort_values("__n", ascending=False).head(1)
                if len(sub) > 0:
                    r = sub.iloc[0]
                    board = str(r.get("行业") or "").strip()
                    net = r.get("__n", 0)  # 单位：亿元
                    items.append({
                        "category": "fund_flow",
                        "title": f"「{board}」资金净流入 {net:.1f} 亿",
                        "desc": f"行业资金净流入榜首，分析受益股票与投资逻辑",
                        "query": f"分析「{board}」行业资金净流入 {net:.1f} 亿背后的逻辑；列出前 3 只受益股票及其催化因素",
                        "mode": "team",
                        "icon_hint": "trending",
                    })
    except Exception:
        pass

    return items[:5]


@router.get("/hot_topics")
def hot_topics(refresh: bool = False):
    """首页推荐问题：聚合全局快讯 + 板块异动 + 资金流，10 分钟缓存。
    refresh=true 时强制刷新（前端「换一批」按钮触发）。"""
    now = time.time()
    with _HOT_LOCK:
        if not refresh and _HOT_CACHE["data"] and (now - _HOT_CACHE["ts"]) < _HOT_TTL:
            return _HOT_CACHE["data"]
        items = _build_hot_topics()
        result = {
            "items": items,
            "ts": int(now),
            "fresh": True,
            "source": "akshare.stock_info_global_em + stock_board_change_em + stock_fund_flow_industry",
        }
        _HOT_CACHE["data"] = result
        _HOT_CACHE["ts"] = now
        return result


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
