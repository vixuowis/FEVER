"""Pydantic schemas: REST request/response + SSE event shapes (design.md §7/§8)."""
from __future__ import annotations

from typing import Any, Literal, Optional

from pydantic import BaseModel, Field


class ChatRequest(BaseModel):
    case_id: Optional[str] = None
    message: str = Field(..., min_length=1)
    mode: Literal["auto", "team"] = "auto"


class CreateCaseRequest(BaseModel):
    title: Optional[str] = None


class SkillInfo(BaseModel):
    name: str
    description: str
    parameters: dict[str, Any]


class AgentInfo(BaseModel):
    id: str
    name: str
    avatar_color: str
    description: str
    persona: str
    skills: list[str]


# ---------------------------------------------------------------- SSE ------
# Every SSE frame is `data: {json}\n\n`. Event types (design.md §7):
#   meta / thinking / token / tool_call / tool_result / artifact /
#   agent_step / case_title / done / error

def sse(event: dict[str, Any]) -> str:
    """Serialize one SSE frame."""
    import json

    return f"data: {json.dumps(event, ensure_ascii=False, default=str)}\n\n"
