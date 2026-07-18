"""Pydantic schemas: REST request/response + SSE event shapes (design.md §7/§8)."""
from __future__ import annotations

from typing import Any, Literal, Optional

from pydantic import BaseModel, Field


class ChatRequest(BaseModel):
    case_id: Optional[str] = None
    message: str = Field(..., min_length=1)
    # auto  → 单个 router Agent（主理人 + 工具循环）
    # agent → 直接调单个指定 Agent（agent 字段必填；如缺省则降级为 router）
    # team  → Planner 拆解 + 多专家串行 + 复核 + 提炼
    mode: Literal["auto", "agent", "team"] = "auto"
    # mode="agent" 时指定具体 agent_id（predictor / market_analyst / event_scout 等）
    agent: Optional[str] = None
    # mode="team" 时限制可调度的专家 Agent id 列表（前端可让用户去选）。
    # 缺省=全部；deep_researcher 是硬规则，不会被过滤掉。
    team_members: Optional[list[str]] = None


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
