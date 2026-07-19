"""Ark LLM client + streaming tool-call loop (design.md §2/§6.2).

实现约定：所有轮次都用 stream=True，累积 tool_calls deltas；本轮有 tool_calls
则执行技能并继续循环，无则为最终答复（token 已流式发出）。
"""
from __future__ import annotations

import asyncio
import json
from typing import Any, AsyncIterator, Awaitable, Callable, Optional

from openai import AsyncOpenAI

from . import config
from .skills.registry import REGISTRY, ensure_skills_loaded, serialize_tool_result, tool_schema_subset, tools_for_agent

_client: Optional[AsyncOpenAI] = None


def get_client() -> AsyncOpenAI:
    global _client
    if _client is None:
        _client = AsyncOpenAI(
            base_url=config.ARK_API_URL,
            api_key=config.ARK_API_KEY,
            timeout=config.LLM_TIMEOUT,
        )
    return _client


ArtifactStore = Callable[[str, str, Any], Awaitable[dict]]


async def noop_artifact_store(kind: str, title: str, payload: Any) -> dict:
    return {"id": None, "kind": kind, "title": title, "payload": payload}


async def execute_skill(name: str, args: dict) -> dict:
    """Run a skill handler with timeout; never raises.

    Supports both sync and async handlers:
    - async handler: 直接 await（skill 内部 await sub-tool）
    - sync handler:  to_thread 跑（保持原行为）
    """
    ensure_skills_loaded()
    sd = REGISTRY.get(name)
    if sd is None:
        return {"ok": False, "error": f"未知技能: {name}"}
    try:
        if asyncio.iscoroutinefunction(sd.handler):
            return await asyncio.wait_for(
                sd.handler(**args), timeout=config.SKILL_TIMEOUT
            )
        return await asyncio.wait_for(
            asyncio.to_thread(sd.handler, **args), timeout=config.SKILL_TIMEOUT
        )
    except asyncio.TimeoutError:
        return {"ok": False, "error": f"技能 {name} 执行超时（>{int(config.SKILL_TIMEOUT)}s）"}
    except TypeError as e:
        return {"ok": False, "error": f"技能参数错误: {e}"}
    except Exception as e:  # noqa: BLE001
        return {"ok": False, "error": f"技能执行失败: {type(e).__name__}: {e}"}


def _preview(result: dict) -> str:
    if not result.get("ok"):
        return f"失败: {result.get('error', '未知错误')}"
    meta = result.get("meta") or {}
    rows = meta.get("rows")
    src = meta.get("source", "")
    if isinstance(result.get("data"), list):
        rows = rows if rows is not None else len(result["data"])
    parts = []
    if rows is not None:
        parts.append(f"返回 {rows} 行")
    if src:
        parts.append(f"来源 {src}")
    if result.get("note"):
        parts.append(str(result["note"]))
    if result.get("truncated"):
        parts.append("已截断")
    return ", ".join(parts) or "成功"


async def run_agent(
    agent_id: str,
    messages: list[dict],
    *,
    agent_def: dict,
    state: dict,
    artifact_store: ArtifactStore = noop_artifact_store,
    max_rounds: int = 8,
    emit_thinking: bool = True,
) -> AsyncIterator[dict]:
    """Streaming tool-call loop. Yields SSE event dicts (each with 'agent' field).

    state (mutated): {"content": str, "tool_trace": [..], "rounds": int}
    """
    ensure_skills_loaded()
    # 三层模型：自动过滤 internal=True 的 atomic tool（LLM 不可见）
    # skill 走 LLM 可见
    tools = tools_for_agent(agent_def.get("skills", []) or agent_id)
    client = get_client()

    for round_no in range(1, max_rounds + 1):
        state["rounds"] = round_no
        kwargs: dict[str, Any] = {
            "model": config.ARK_MODEL,
            "messages": messages,
            "stream": True,
        }
        if tools:
            kwargs["tools"] = tools
        stream = await client.chat.completions.create(**kwargs)

        tc_acc: dict[int, dict] = {}
        saw_content = False
        finish_reason = None
        async for chunk in stream:
            if not chunk.choices:
                continue
            choice = chunk.choices[0]
            delta = choice.delta
            rc = getattr(delta, "reasoning_content", None)
            if rc and emit_thinking:
                yield {"type": "thinking", "agent": agent_id, "delta": rc}
            if delta.content:
                saw_content = True
                state["content"] += delta.content
                yield {"type": "token", "agent": agent_id, "delta": delta.content}
            if delta.tool_calls:
                for tc in delta.tool_calls:
                    slot = tc_acc.setdefault(tc.index, {"id": "", "name": "", "arguments": ""})
                    if tc.id:
                        slot["id"] = tc.id
                    if tc.function:
                        if tc.function.name:
                            slot["name"] += tc.function.name
                        if tc.function.arguments:
                            slot["arguments"] += tc.function.arguments
            if choice.finish_reason:
                finish_reason = choice.finish_reason

        tool_calls = [tc_acc[i] for i in sorted(tc_acc)]
        if not tool_calls:
            # 最终答复轮（token 已流式发出）
            break

        # 有 tool_calls：执行技能并继续循环
        messages.append({
            "role": "assistant",
            "content": None,
            "tool_calls": [
                {"id": t["id"] or f"call_{round_no}_{i}", "type": "function",
                 "function": {"name": t["name"], "arguments": t["arguments"] or "{}"}}
                for i, t in enumerate(tool_calls)
            ],
        })
        for i, t in enumerate(tool_calls):
            tc_id = t["id"] or f"call_{round_no}_{i}"
            name = t["name"]
            try:
                args = json.loads(t["arguments"]) if t["arguments"] else {}
            except json.JSONDecodeError:
                args = {}
            yield {"type": "tool_call", "agent": agent_id, "id": tc_id,
                   "skill": name, "args": args}
            result = await execute_skill(name, args)

            artifact_ids: list[str] = []
            if result.get("ok"):
                arts = result.get("artifacts") or ([result["artifact"]] if result.get("artifact") else [])
                for art in arts:
                    try:
                        row = await artifact_store(art.get("kind", "table"),
                                                   art.get("title", name),
                                                   art.get("payload", {}))
                        artifact_ids.append(row.get("id"))
                        yield {"type": "artifact", "agent": agent_id, "artifact": row}
                    except Exception as e:  # noqa: BLE001
                        yield {"type": "thinking", "agent": agent_id,
                               "delta": f"\n[artifact 落库失败: {e}]\n"}

            preview = _preview(result)
            yield {"type": "tool_result", "agent": agent_id, "id": tc_id,
                   "skill": name, "ok": bool(result.get("ok")), "preview": preview,
                   "artifact_id": artifact_ids[0] if artifact_ids else None}
            state["tool_trace"].append({
                "type": "tool", "agent": agent_id, "id": tc_id, "skill": name,
                "args": args, "ok": bool(result.get("ok")), "preview": preview,
                "artifact_ids": artifact_ids,
            })
            messages.append({
                "role": "tool",
                "tool_call_id": tc_id,
                "content": serialize_tool_result(result, config.TOOL_RESULT_MAX_CHARS),
            })
        # 继续下一轮
    else:
        # 达到最大轮数仍有 tool_calls —— 让模型做一次无工具总结
        state["truncated_by_rounds"] = True
        summary_kwargs: dict[str, Any] = {
            "model": config.ARK_MODEL,
            "messages": messages + [{"role": "user", "content": "工具轮次已用完，请基于已获得的信息直接给出最终回答。"}],
            "stream": True,
        }
        stream = await client.chat.completions.create(**summary_kwargs)
        async for chunk in stream:
            if not chunk.choices:
                continue
            delta = chunk.choices[0].delta
            rc = getattr(delta, "reasoning_content", None)
            if rc and emit_thinking:
                yield {"type": "thinking", "agent": agent_id, "delta": rc}
            if delta.content:
                state["content"] += delta.content
                yield {"type": "token", "agent": agent_id, "delta": delta.content}


# ------------------------------------------------------- one-shot helpers ---


async def complete_text(system: str, user: str, *, max_tokens: int = 2000) -> str:
    """Non-streaming single completion (returns content only)."""
    client = get_client()
    resp = await client.chat.completions.create(
        model=config.ARK_MODEL,
        messages=[{"role": "system", "content": system},
                  {"role": "user", "content": user}],
        max_tokens=max_tokens,
    )
    msg = resp.choices[0].message
    return (msg.content or "").strip()


async def complete_json(system: str, user: str, *, max_tokens: int = 3000) -> Optional[dict]:
    """Non-streaming completion forced to JSON object; returns parsed dict or None."""
    client = get_client()
    resp = await client.chat.completions.create(
        model=config.ARK_MODEL,
        messages=[{"role": "system", "content": system},
                  {"role": "user", "content": user}],
        max_tokens=max_tokens,
        response_format={"type": "json_object"},
    )
    text = (resp.choices[0].message.content or "").strip()
    if not text:
        return None
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        m = text[text.find("{"): text.rfind("}") + 1]
        try:
            return json.loads(m)
        except Exception:  # noqa: BLE001
            return None
