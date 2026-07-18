"""POST /api/chat — SSE 对话流 (design.md §6.2/§7)."""
from __future__ import annotations

import asyncio
from typing import AsyncIterator

from fastapi import APIRouter
from fastapi.responses import StreamingResponse

from .. import config, db
from ..agents.roster import get_agent, system_prompt
from ..agents.team import run_team
from ..llm import complete_text, run_agent
from ..schemas import ChatRequest, sse

router = APIRouter(prefix="/api", tags=["chat"])


def _history_for_llm(case_id: str) -> list[dict]:
    """该 case 最近 CONTEXT_MESSAGES 条消息 → LLM 上下文（user/assistant 纯文本）。"""
    msgs = db.list_messages(case_id, limit=config.CONTEXT_MESSAGES)
    out = []
    for m in msgs:
        if m["role"] in ("user", "assistant") and (m.get("content") or "").strip():
            out.append({"role": m["role"], "content": m["content"]})
    return out


async def _gen_title(question: str) -> str:
    import re

    fallback = re.sub(r"\s+", "", question or "")[:15] or "未命名研究"
    try:
        title = await complete_text(
            "你是标题生成器。用不超过15个字的中文概括用户的研究问题，只输出标题本身，不要标点收尾。",
            question[:300],
            max_tokens=800,  # reasoning 模型会消耗部分预算在思考上，给足余量
        )
        title = (title or "").strip().strip("「」\"'。 \n")
        return title[:20] or fallback
    except Exception:  # noqa: BLE001
        return fallback


async def _chat_stream(req: ChatRequest) -> AsyncIterator[str]:
    case_id = req.case_id
    case = db.get_case(case_id) if case_id else None
    if case is None:
        case = db.create_case()
    case_id = case["id"]

    # 1) 落库 user message；上下文取最近 12 条（含本条）
    is_first = db.count_messages(case_id, role="user") == 0
    db.add_message(case_id, role="user", content=req.message)
    history = _history_for_llm(case_id)

    message_id = db.new_id()
    state = {"content": "", "tool_trace": [], "rounds": 0}

    async def artifact_store(kind: str, title: str, payload):
        return await asyncio.to_thread(
            db.add_artifact, case_id, message_id, kind, title, payload
        )

    yield sse({"type": "meta", "case_id": case_id, "mode": req.mode})
    try:
        if req.mode == "team":
            # team 模式：history 传给 synthesize；问题原文作为规划输入
            hist_for_team = history[:-1] if history else []  # 排除当前 user 消息
            async for ev in run_team(req.message, hist_for_team, state, artifact_store):
                yield sse(ev)
        else:
            messages = [{"role": "system", "content": system_prompt("router")}] + history
            async for ev in run_agent("router", messages, agent_def=get_agent("router"),
                                      state=state, artifact_store=artifact_store,
                                      max_rounds=config.AUTO_MAX_ROUNDS):
                yield sse(ev)

        # 2) 落库 assistant message（content + tool_trace JSON）
        db.add_message(case_id, role="assistant", agent="router",
                       content=state["content"], tool_trace=state["tool_trace"] or None,
                       message_id=message_id)

        # 3) 首条消息 → 生成 case 标题
        if is_first:
            title = await _gen_title(req.message)
            await asyncio.to_thread(db.update_case_title, case_id, title)
            yield sse({"type": "case_title", "title": title})

        yield sse({"type": "done", "case_id": case_id, "message_id": message_id})
    except Exception as e:  # noqa: BLE001
        # 尽力保留已产出内容
        try:
            if state["content"] or state["tool_trace"]:
                db.add_message(case_id, role="assistant", agent="router",
                               content=state["content"],
                               tool_trace=state["tool_trace"] or None,
                               message_id=message_id)
        except Exception:  # noqa: BLE001
            pass
        yield sse({"type": "error", "message": f"{type(e).__name__}: {e}"})


@router.post("/chat")
async def chat(req: ChatRequest):
    return StreamingResponse(
        _chat_stream(req),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
