"""Skill registry: @skill decorator + REGISTRY (design.md §4).

Every handler returns a unified dict:
  {"ok": True, "data": ..., "meta": {...}, "artifact": {...}}   # or "artifacts": [...]
  {"ok": False, "error": "human readable"}
"""
from __future__ import annotations

import json
from dataclasses import dataclass, field
from datetime import date, datetime
from typing import Any, Callable


@dataclass
class SkillDef:
    name: str
    description: str
    parameters: dict[str, Any]
    handler: Callable[..., dict]
    emit_artifact: bool = field(default=True)

    def openai_tool(self) -> dict:
        return {
            "type": "function",
            "function": {
                "name": self.name,
                "description": self.description,
                "parameters": self.parameters,
            },
        }


REGISTRY: dict[str, SkillDef] = {}


def skill(name: str, description: str, parameters: dict[str, Any]):
    """Register a skill handler."""

    def deco(fn: Callable[..., dict]):
        REGISTRY[name] = SkillDef(
            name=name, description=description, parameters=parameters, handler=fn
        )
        return fn

    return deco


def ok(data: Any, meta: dict[str, Any], artifact: dict | None = None,
       artifacts: list[dict] | None = None) -> dict:
    out: dict[str, Any] = {"ok": True, "data": data, "meta": meta}
    if artifacts:
        out["artifacts"] = artifacts
    elif artifact:
        out["artifact"] = artifact
    return out


def err(message: str) -> dict:
    return {"ok": False, "error": message}


def meta(source: str, rows: int, url: str | None = None) -> dict:
    m: dict[str, Any] = {
        "source": source,
        "rows": rows,
        "retrieved_at": datetime.now().astimezone().isoformat(timespec="seconds"),
    }
    if url:
        m["url"] = url
    return m


def json_safe(obj: Any) -> Any:
    """Convert pandas/numpy/datetime values into JSON-safe builtins."""
    import math

    import pandas as pd

    if obj is None or isinstance(obj, (str, int, bool)):
        return obj
    if isinstance(obj, float):
        if math.isnan(obj) or math.isinf(obj):
            return None
        return obj
    if isinstance(obj, (datetime, date, pd.Timestamp)):
        return obj.isoformat()[:10] if not isinstance(obj, datetime) else obj.isoformat()
    if isinstance(obj, dict):
        return {str(k): json_safe(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [json_safe(v) for v in obj]
    # numpy scalars / others
    try:
        import numpy as np

        if isinstance(obj, np.generic):
            return json_safe(obj.item())
    except Exception:
        pass
    return str(obj)


def df_records(df, columns: list[str] | None = None, limit: int | None = None) -> tuple[list[dict], bool]:
    """DataFrame -> list[dict] (JSON-safe). Returns (records, truncated?)."""
    if columns:
        cols = [c for c in columns if c in df.columns]
        df = df[cols]
    truncated = False
    if limit is not None and len(df) > limit:
        df = df.tail(limit)
        truncated = True
    recs = json_safe(df.to_dict(orient="records"))
    return recs, truncated


def serialize_tool_result(result: dict, max_chars: int) -> str:
    """Serialize a skill result for the LLM tool message (design.md §4: ≤4000 chars)."""
    text = json.dumps(result, ensure_ascii=False, default=str)
    if len(text) <= max_chars:
        return text
    # Progressively shrink `data` until it fits.
    if isinstance(result.get("data"), list) and result["data"]:
        data = result["data"]
        keep = len(data)
        while keep > 1:
            keep = keep // 2
            candidate = dict(result)
            candidate["data"] = data[:keep]
            candidate["truncated"] = True
            candidate["note"] = f"结果过大，已截断为前 {keep}/{len(data)} 条"
            text = json.dumps(candidate, ensure_ascii=False, default=str)
            if len(text) <= max_chars:
                return text
    return text[: max_chars - 60] + '..."(已截断)"}'


def tool_schema_subset(names: list[str]) -> list[dict]:
    return [REGISTRY[n].openai_tool() for n in names if n in REGISTRY]


def ensure_skills_loaded() -> None:
    """Import skill modules so decorators run (idempotent)."""
    from . import (
        analysis, fundamentals, market, news,
        fundamentals_detail, boards, flows, holders, global_markets,
        evidence_graph,
    )  # noqa: F401
