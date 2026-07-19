"""Composite Skill（设计：三层调度模型）。

设计目的
========

将现有 atomic skill（akshare 取数 + 9 个 ``_eg_*`` 图操作）编排为 8 个 **LLM 可见的高层
复合技能**。Agent 的 skills 列表只放 composite —— LLM 不再直接面对几十个 atomic tool。

Composite 接口规范：

  入参：高层意图（query / symbol / lookback_days / focus），少而精
  出参：{"ok": True,
         "data": 聚合摘要（结构化，便于 LLM 消费）,
         "artifacts": 子 skill 产出的 artifacts（自动落库）,
         "meta": { "composed": ["_eg_add_evidence", "get_stock_daily", ...],
                   "ok_count": N, "fail_count": M }}
  失败：{"ok": False, "error": "..."}

Composite 内部用 ``asyncio.gather`` 并发调子 skill（execute_skill 由 llm.execute_skill 提供，
它同时支持 sync 与 async handler —— 本文件 handler 都是 async，便于 await 子 skill）。
"""
from __future__ import annotations

import asyncio
import json
import re
from typing import Any

from ..llm import execute_skill
from .market import is_us_symbol
from .registry import err, meta, ok, skill


# ---------------------------------------------------------------- helpers ---

def _clip(s: str | None, n: int = 200) -> str:
    s = "" if s is None else str(s).replace("\n", " ").strip()
    return s if len(s) <= n else s[:n] + "…"


async def _gather_sub(name_args: list[tuple[str, dict]]) -> list[dict]:
    """并发调一组 (skill_name, args)，return_exceptions=True 收集所有结果。"""
    if not name_args:
        return []
    tasks = [execute_skill(n, a) for n, a in name_args]
    return await asyncio.gather(*tasks, return_exceptions=False)


def _summarize_subs(results: list[dict]) -> dict:
    """聚合 sub-skill 调用结果：返回 (ok_count, fail_count, errors, data_points, composed)。"""
    ok_count = 0
    fail_count = 0
    errors: list[str] = []
    data_points: list[Any] = []
    composed: list[str] = []
    for r in results:
        if not isinstance(r, dict):
            fail_count += 1
            errors.append(f"非 dict 返回: {type(r).__name__}")
            continue
        if r.get("ok"):
            ok_count += 1
            d = r.get("data")
            if d is not None:
                data_points.append(d)
        else:
            fail_count += 1
            e = r.get("error") or r.get("data") or "未知失败"
            errors.append(_clip(str(e), 200))
    return {
        "ok_count": ok_count,
        "fail_count": fail_count,
        "errors": errors,
        "data_points": data_points,
        "composed": [],  # 由调用方补充
    }


def _collect_artifacts(results: list[dict]) -> list[dict]:
    """从 sub-skill 结果中收集所有 artifacts 列表（artifacts 优先，单 artifact 兜底）。

    composite skill 内部调子 skill 时，execute_skill 不会自动落库。
    本函数把子结果里的 artifacts/artifact 拍平，统一挂到 composite 的返回上，
    由 llm.run_agent 走 artifact_store 流程落库 —— 这样 LLM 调一次 composite
    也能在前端 artifacts 面板看到所有子数据。
    """
    out: list[dict] = []
    for r in results:
        if not isinstance(r, dict) or not r.get("ok"):
            continue
        if r.get("artifacts"):
            out.extend(r["artifacts"])
        elif r.get("artifact"):
            out.append(r["artifact"])
    return out


# ============================================================ evidence_graph
# 9 个 _eg_* 的高层 dispatcher。LLM 只看到 1 个 evidence_graph skill，
# 通过 action 参数路由到对应 sub-tool。LLM 不需要记住 9 个 sub-tool 名。

_VALID_GRAPH_ACTIONS = {
    "add_evidence", "add_claim", "link", "set_status", "merge",
    "add_missing", "set_sufficient", "export", "clear",
}

# action -> _eg_* sub-tool 名 的显式映射（sub-tool 名不一定与 action 一一对应，
# 比如 set_status 对应的是 _eg_set_claim_status，merge 对应 _eg_merge_claims）
_GRAPH_ACTION_TO_SUB: dict[str, str] = {
    "add_evidence": "_eg_add_evidence",
    "add_claim": "_eg_add_claim",
    "link": "_eg_link",
    "set_status": "_eg_set_claim_status",
    "merge": "_eg_merge_claims",
    "add_missing": "_eg_add_missing",
    "set_sufficient": "_eg_set_sufficient",
    "export": "_eg_export",
    "clear": "_eg_clear",
}


@skill(
    "evidence_graph",
    "证据图操作（建图/编辑/导出）。action 决定子操作："
    "add_evidence / add_claim / link / set_status / merge / add_missing / "
    "set_sufficient / export / clear。"
    "子操作需要的参数按 action 传递（除 action 外的所有参数透传给对应 sub-tool）。"
    "导出时返回 markdown 摘要 + JSON 统计，可同时作为 graph 类型的 artifact 沉淀。",
    {
        "type": "object",
        "properties": {
            "action": {"type": "string", "enum": sorted(_VALID_GRAPH_ACTIONS),
                       "description": "图操作类型"},
        },
        "required": ["action"],
        # 透传其他参数：composite 接口故意用宽松 schema，sub-tool 校验
        "additionalProperties": True,
    },
    category="composite",
    composes=[
        "_eg_add_evidence", "_eg_add_claim", "_eg_link",
        "_eg_set_claim_status", "_eg_merge_claims",
        "_eg_add_missing", "_eg_set_sufficient", "_eg_export", "_eg_clear",
    ],
)
async def evidence_graph(action: str, **kwargs) -> dict:
    if action not in _VALID_GRAPH_ACTIONS:
        return err(f"未知 action: {action}（允许: {sorted(_VALID_GRAPH_ACTIONS)}）")
    sub_name = _GRAPH_ACTION_TO_SUB[action]
    sub_result = await execute_skill(sub_name, kwargs)
    if not sub_result.get("ok"):
        return sub_result
    # sub-tool 的返回值直接暴露给 LLM；artifact 走 execute_skill 的 artifact_store 流程
    return ok(
        sub_result.get("data"),
        meta("evidence_graph", 1),
        artifact=sub_result.get("artifact"),
        artifacts=sub_result.get("artifacts"),
    )


# ============================================================== market_research
# 行情研究：并发拉个股 K线 + 行业板块 + 资金流向，聚合返回。
# LLM 入参 {symbol, lookback_days, focus?: ["price", "sector", "flow"]}

@skill(
    "market_research",
    "行情综合研究：并发拉取个股 K线 / 行业板块 / 资金流向 / 龙虎榜 等子数据并聚合。"
    "symbol 为 6 位 A 股代码或美股 ticker（如 AAPL/NVDA）；lookback_days 默认 60；"
    "focus 限定子集（默认 ['price', 'sector', 'flow']）。"
    "美股路径自动禁用 sector / flow / lhb（akshare 无 US 行业/资金流接口），只跑 price。",
    {
        "type": "object",
        "properties": {
            "symbol": {"type": "string",
                       "description": "6 位 A 股代码 / 美股 ticker (AAPL/NVDA/TSLA)"},
            "lookback_days": {"type": "integer", "description": "回溯天数，默认 60"},
            "focus": {"type": "array", "items": {"type": "string"},
                      "description": "子集：price / sector / flow / lhb（美股仅 price 有效）"},
        },
        "required": ["symbol"],
        "additionalProperties": False,
    },
    category="composite",
    composes=["get_stock_daily", "list_industry_boards", "get_industry_fund_flow",
              "get_sector_fund_flow_rank", "get_board_change"],
)
async def market_research(symbol: str, lookback_days: int = 60,
                          focus: list[str] | None = None) -> dict:
    raw = (symbol or "").strip()
    us = bool(raw) and is_us_symbol(raw)
    focus = focus or ["price", "sector", "flow"]
    if us:
        # 美股路径：akshare 无 US 行业/资金流/龙虎榜接口，强制只跑 price
        sym = raw.upper()
        focus_eff = ["price"]
    else:
        code = "".join(ch for ch in raw if ch.isdigit())[-6:]
        if len(code) != 6:
            return err(f"symbol 不合法: {symbol}")
        sym = code
        focus_eff = focus
    from datetime import datetime, timedelta
    end = datetime.now().strftime("%Y%m%d")
    start = (datetime.now() - timedelta(days=lookback_days)).strftime("%Y%m%d")
    tasks: list[tuple[str, dict]] = []
    if "price" in focus_eff:
        tasks.append(("get_stock_daily", {"symbol": sym, "start_date": start, "end_date": end, "adjust": "qfq"}))
    if not us:
        if "sector" in focus_eff:
            tasks.append(("list_industry_boards", {"symbol": sym}))
            tasks.append(("get_board_change", {"symbol": sym}))
        if "flow" in focus_eff:
            tasks.append(("get_industry_fund_flow", {"symbol": sym}))
            tasks.append(("get_sector_fund_flow_rank", {"indicator": "今日"}))
        if "lhb" in focus_eff:
            # 龙虎榜：日期范围需要 sub-tool 支持，先尝试今天
            tasks.append(("get_lhb", {"start_date": start, "end_date": end}))
    if not tasks:
        return err("focus 不能为空")
    results = await _gather_sub(tasks)
    summary = _summarize_subs(results)
    summary["composed"] = [n for n, _ in tasks]
    out: dict = {"symbol": sym, "lookback_days": lookback_days, "focus": focus_eff,
                 "market": "美股" if us else "A股",
                 "sub_results": [{"skill": n, "ok": r.get("ok"),
                                  "preview": _clip(str(r.get("data") or r.get("error")), 200)}
                                 for (n, _), r in zip(tasks, results)],
                 **summary}
    if us:
        # 美股禁用子集提示
        disabled = [x for x in ("sector", "flow", "lhb") if x in focus]
        if disabled:
            out["note"] = f"美股路径不支持 {','.join(disabled)}（akshare 无 US 接口），仅返回价格"
    return ok(
        out,
        meta("market_research", len(tasks)),
        artifacts=_collect_artifacts(results) or None,
    )


# ============================================================== post_market_outlook
# 后市推演（事件预测员的核心入口）：
# 并发拉 K线 + 资金流 + 近期新闻 + 板块异动，输出"预测上下文包"。
# 真正的预测交给 predictor Agent 用 LLM 推理（避免在 composite 里硬编码规则）。
# 第一个落地的预测维度：短期量价 / 催化驱动 / 风险情景。

@skill(
    "post_market_outlook",
    "后市推演上下文包：并发拉取个股近期 K线 / 资金流向 / 个股新闻 / 行业板块异动，"
    "输出聚合数据（不做预测本身 —— 预测由 predictor Agent 接管）。"
    "symbol 6 位 A 股代码或美股 ticker（自动识别）；lookback_days 默认 30。",
    {
        "type": "object",
        "properties": {
            "symbol": {"type": "string", "description": "股票代码（A股 6 位或美股 ticker）"},
            "lookback_days": {"type": "integer", "description": "回溯天数，默认 30"},
        },
        "required": ["symbol"],
        "additionalProperties": False,
    },
    category="composite",
    composes=["get_stock_daily", "get_industry_fund_flow", "get_individual_fund_flow_rank",
              "get_stock_news", "list_industry_boards"],
)
async def post_market_outlook(symbol: str, lookback_days: int = 30) -> dict:
    raw = (symbol or "").strip()
    if not raw:
        return err("symbol 不能为空")
    us = is_us_symbol(raw)
    if us:
        # 美股：ticker 直接传（composite 不解析 6 位 code，atomic 自行判断）
        sym = raw.upper()
    else:
        sym = "".join(ch for ch in raw if ch.isdigit())[-6:]
        if len(sym) != 6:
            return err(f"symbol 不合法: {symbol}")
    from datetime import datetime, timedelta
    end = datetime.now().strftime("%Y%m%d")
    start = (datetime.now() - timedelta(days=lookback_days)).strftime("%Y%m%d")
    tasks: list[tuple[str, dict]] = [
        ("get_stock_daily", {"symbol": sym, "start_date": start, "end_date": end, "adjust": "qfq"}),
        ("get_industry_fund_flow", {"sort_by": "净额", "limit": 20}),
        ("get_individual_fund_flow_rank", {"limit": 10}),
        ("list_industry_boards", {"symbol": sym}) if not us else ("get_global_news", {"limit": 8}),
    ]
    # 个股新闻仅 A 股可拉，美股已在上面用 global news 替代
    if not us:
        tasks.append(("get_stock_news", {"symbol": sym, "limit": 6}))
    results = await _gather_sub(tasks)
    summary = _summarize_subs(results)
    summary["composed"] = [n for n, _ in tasks]
    # 摘要：抽取 K线末尾 5 根的 OHLC + 涨跌幅 + 资金净额 + 板块名
    kline_summary: list[dict] = []
    flow_summary: dict = {}
    news_titles: list[str] = []
    sector_names: list[str] = []
    for (name, _), r in zip(tasks, results):
        if not isinstance(r, dict) or not r.get("ok"):
            continue
        d = r.get("data") or []
        if name == "get_stock_daily" and isinstance(d, list) and d:
            tail = d[-5:]
            for i, row in enumerate(tail):
                close = row.get("close")
                prev_close = tail[i - 1].get("close") if i > 0 else None
                pct = None
                try:
                    if close is not None and prev_close not in (None, 0):
                        pct = round((float(close) - float(prev_close)) / float(prev_close) * 100, 2)
                except (TypeError, ValueError):
                    pct = None
                kline_summary.append({
                    "date": row.get("date"),
                    "close": close,
                    "pct_chg": pct,
                    "volume": row.get("volume"),
                })
        elif name == "get_industry_fund_flow" and isinstance(d, list) and d:
            flow_summary["industry_top"] = [
                {"name": r.get("名称") or r.get("name"), "net": r.get("净额") or r.get("net")}
                for r in d[:5]
            ]
        elif name == "get_individual_fund_flow_rank" and isinstance(d, list) and d:
            flow_summary["individual_top"] = [
                {"name": r.get("名称") or r.get("name"), "net": r.get("净额") or r.get("net")}
                for r in d[:5]
            ]
        elif name == "get_stock_news" and isinstance(d, list) and d:
            news_titles = [(n.get("title") or "")[:80] for n in d[:6]]
        elif name == "list_industry_boards" and isinstance(d, list) and d:
            sector_names = [(r.get("板块名称") or r.get("name") or "") for r in d[:3]]
    return ok(
        {
            "symbol": sym, "market": "美股" if us else "A股",
            "lookback_days": lookback_days,
            "kline_recent": kline_summary,
            "flow": flow_summary,
            "news_titles": news_titles,
            "sectors": sector_names,
            "data_point_count": summary["ok_count"],
            **summary,
        },
        meta("post_market_outlook", len(tasks)),
        artifacts=_collect_artifacts(results) or None,
    ) | ({"note": "美股 ticker 已用全球快讯替代个股新闻；预测维度在 predictor Agent 中完成"}
         if us else {})


# ========================================================== financial_research
# 财务研究：并发拉摘要/指标/利润表/业绩预告

@skill(
    "financial_research",
    "财务综合研究：并发拉取财务摘要 / 财务指标 / 利润表 / 业绩预告 四个子数据并聚合。"
    "symbol 为 6 位代码；period='annual'|'quarterly'。",
    {
        "type": "object",
        "properties": {
            "symbol": {"type": "string", "description": "6 位股票代码"},
            "period": {"type": "string", "enum": ["annual", "quarterly"],
                       "description": "年报/季度报，默认 annual"},
        },
        "required": ["symbol"],
        "additionalProperties": False,
    },
    category="composite",
    composes=["get_financial_abstract", "get_financial_indicator",
              "get_income_statement", "get_profit_forecast"],
)
async def financial_research(symbol: str, period: str = "annual") -> dict:
    code = "".join(ch for ch in str(symbol) if ch.isdigit())[-6:]
    if len(code) != 6:
        return err(f"symbol 不合法: {symbol}")
    tasks = [
        ("get_financial_abstract", {"symbol": code}),
        ("get_financial_indicator", {"symbol": code}),
        ("get_income_statement", {"symbol": code, "periods": 8 if period == "annual" else 12}),
        ("get_profit_forecast", {"symbol": code}),
    ]
    results = await _gather_sub(tasks)
    summary = _summarize_subs(results)
    summary["composed"] = [n for n, _ in tasks]
    return ok(
        {"symbol": code, "period": period,
         "sub_results": [{"skill": n, "ok": r.get("ok"),
                          "preview": _clip(str(r.get("data") or r.get("error")), 200)}
                         for (n, _), r in zip(tasks, results)],
         **summary},
        meta("financial_research", len(tasks)),
        artifacts=_collect_artifacts(results) or None,
    )


# ================================================================== news_intel
# 资讯情报：个股新闻 + 全球快讯 + 公告 三路并发

@skill(
    "news_intel",
    "资讯情报综合：个股新闻 + 全球快讯 + 公告 三路并发拉取聚合。"
    "symbol 可选（不传则只拉全球快讯）；kind 限定子集 default=['news','announcement']。",
    {
        "type": "object",
        "properties": {
            "symbol": {"type": "string", "description": "6 位股票代码（可选）"},
            "kind": {"type": "array", "items": {"type": "string"},
                     "description": "子集：news / global / announcement"},
            "limit": {"type": "integer", "description": "个股新闻条数，默认 8"},
        },
        "required": [],
        "additionalProperties": False,
    },
    category="composite",
    composes=["get_stock_news", "get_global_news", "get_announcements",
              "get_us_stock_news", "get_us_stock_sec_filings"],
)
async def news_intel(symbol: str | None = None,
                     kind: list[str] | None = None,
                     limit: int = 8) -> dict:
    raw_symbol = (symbol or "").strip()
    us_stock = bool(raw_symbol) and is_us_symbol(raw_symbol)
    code = "".join(ch for ch in raw_symbol if ch.isdigit())[-6:] if raw_symbol else ""
    kind = kind or (["news", "announcement"] if code else ["global"])
    tasks: list[tuple[str, dict]] = []
    notes: list[str] = []
    if "news" in kind:
        if code:
            # A 股：调个股新闻
            tasks.append(("get_stock_news", {"symbol": code, "limit": limit}))
        elif us_stock:
            # 美股：走 yfinance.Ticker.news（Yahoo Finance，含标题/摘要/来源/链接）
            tasks.append(("get_us_stock_news", {"symbol": raw_symbol, "count": limit}))
    if "global" in kind:
        tasks.append(("get_global_news", {"limit": limit * 2}))
    if "announcement" in kind:
        if code:
            tasks.append(("get_announcements", {"keyword": code, "limit": limit}))
        elif us_stock:
            # 美股：走 yfinance.Ticker.sec_filings（SEC 8-K/10-Q/10-K 原文）
            tasks.append(("get_us_stock_sec_filings", {"symbol": raw_symbol, "count": limit}))
    if not tasks:
        return err("kind 不能为空（至少要一个非空子集）")

    results = await _gather_sub(tasks)
    summary = _summarize_subs(results)
    summary["composed"] = [n for n, _ in tasks]
    return ok(
        {"symbol": code or (raw_symbol or None), "kind": kind,
         "market": "美股" if us_stock else ("A股" if code else "全局"),
         "sub_results": [{"skill": n, "ok": r.get("ok"),
                          "preview": _clip(str(r.get("data") or r.get("error")), 200)}
                         for (n, _), r in zip(tasks, results)],
         **summary},
        meta("news_intel", len(tasks)),
        artifacts=_collect_artifacts(results) or None,
    ) | ({"note": "；".join(notes)} if notes else {})


# ============================================================== holder_research
# 股东研究：股东变化 + 解禁

@skill(
    "holder_research",
    "股东综合研究：股东变化 + 解禁信息 两个子数据并发拉取聚合。",
    {
        "type": "object",
        "properties": {
            "symbol": {"type": "string", "description": "6 位股票代码"},
        },
        "required": ["symbol"],
        "additionalProperties": False,
    },
    category="composite",
    composes=["get_holder_change", "get_restricted_release_summary"],
)
async def holder_research(symbol: str) -> dict:
    code = "".join(ch for ch in str(symbol) if ch.isdigit())[-6:]
    if len(code) != 6:
        return err(f"symbol 不合法: {symbol}")
    tasks = [
        ("get_holder_change", {"symbol": code}),
        ("get_restricted_release_summary", {"symbol": code}),
    ]
    results = await _gather_sub(tasks)
    summary = _summarize_subs(results)
    summary["composed"] = [n for n, _ in tasks]
    return ok(
        {"symbol": code,
         "sub_results": [{"skill": n, "ok": r.get("ok"),
                          "preview": _clip(str(r.get("data") or r.get("error")), 200)}
                         for (n, _), r in zip(tasks, results)],
         **summary},
        meta("holder_research", len(tasks)),
        artifacts=_collect_artifacts(results) or None,
    )


# ================================================================ macro_intel
# 宏观情报

@skill(
    "macro_intel",
    "宏观情报：宏观指标 + 行业资金流（按板块）。"
    "topic 可选（如 'CPI' / 'GDP' / 'PMI'，不传则默认）。",
    {
        "type": "object",
        "properties": {
            "topic": {"type": "string", "description": "宏观主题（可选）"},
        },
        "required": [],
        "additionalProperties": False,
    },
    category="composite",
    composes=["get_macro", "get_sector_fund_flow_rank"],
)
async def macro_intel(topic: str | None = None) -> dict:
    tasks = [
        ("get_macro", {} if not topic else {"topic": topic}),
        ("get_sector_fund_flow_rank", {"indicator": "今日"}),
    ]
    results = await _gather_sub(tasks)
    summary = _summarize_subs(results)
    summary["composed"] = [n for n, _ in tasks]
    return ok(
        {"topic": topic,
         "sub_results": [{"skill": n, "ok": r.get("ok"),
                          "preview": _clip(str(r.get("data") or r.get("error")), 200)}
                         for (n, _), r in zip(tasks, results)],
         **summary},
        meta("macro_intel", len(tasks)),
        artifacts=_collect_artifacts(results) or None,
    )


# ================================================================ event_study
# 事件研究：先 search_stock 解析 symbol，再调 event_study

@skill(
    "event_study_skill",
    "事件研究：基于 event_study 子能力，分析单次事件前后的异常收益（CAR）。"
    "event_date YYYY-MM-DD，symbol 支持 6 位 A 股代码或美股 ticker（AAPL/NVDA/TSLA）。"
    "如果传 keyword 而无 symbol，先用 search_stock 解析（自动识别美股/ A 股）。"
    "window_days 默认 30；美股默认基准 SPY，A 股默认 sh000300。",
    {
        "type": "object",
        "properties": {
            "event_date": {"type": "string", "description": "事件日期 YYYY-MM-DD"},
            "symbol": {"type": "string",
                       "description": "股票代码：A 股 6 位 / 美股 ticker（与 keyword 二选一）"},
            "keyword": {"type": "string", "description": "股票关键词（与 symbol 二选一）"},
            "window_days": {"type": "integer", "description": "事件窗口，默认 30"},
        },
        "required": ["event_date"],
        "additionalProperties": False,
    },
    category="composite",
    composes=["search_stock", "event_study"],
)
async def event_study_skill(event_date: str, symbol: str | None = None,
                            keyword: str | None = None,
                            window_days: int = 30) -> dict:
    sym_raw = (symbol or "").strip()
    us = bool(sym_raw) and is_us_symbol(sym_raw)
    if us:
        # 美股：保留原始 ticker（去空白 / 大写），如 AAPL / BRK.B
        sym = sym_raw.upper()
    elif sym_raw:
        # A 股：截 6 位数字
        code6 = "".join(ch for ch in sym_raw if ch.isdigit())[-6:]
        if len(code6) == 6:
            sym = code6
        else:
            sym = ""
    else:
        sym = ""
    if not sym and keyword:
        r = await execute_skill("search_stock", {"keyword": keyword})
        if r.get("ok") and isinstance(r.get("data"), list) and r["data"]:
            d0 = r["data"][0]
            cand = str(d0.get("symbol") or d0.get("代码") or d0.get("code") or "")
            cand = cand.strip()
            if is_us_symbol(cand):
                sym = cand.upper()
                us = True
            else:
                code6 = "".join(ch for ch in cand if ch.isdigit())[-6:]
                if len(code6) == 6:
                    sym = code6
    if not sym:
        return err("必须提供 symbol 或 keyword")
    # event_study 子能力用 pre/post 表达事件窗口；window_days 转为单边窗口长度
    pre = max(1, min(int(window_days or 30), 60))
    post = pre
    result = await execute_skill("event_study", {
        "event_date": event_date, "symbol": sym,
        "pre": pre, "post": post,
    })
    if not result.get("ok"):
        return result
    return ok(
        {"symbol": sym, "market": "美股" if us else "A股",
         "event_date": event_date, "window_days": window_days,
         "event_study": result.get("data")},
        meta("event_study_skill", 1),
        artifact=result.get("artifact"),
        artifacts=result.get("artifacts"),
    )


# ============================================================== stock_overview
# 概览：先 search_stock 找到 symbol，再返回基础信息（财务摘要）

@skill(
    "stock_overview",
    "股票概览：先用 search_stock 解析 keyword → symbol，再拉取财务摘要 + 最新行情。"
    "适合 LLM 不知道具体代码、只有公司名/关键词时使用。",
    {
        "type": "object",
        "properties": {
            "keyword": {"type": "string", "description": "公司名 / 关键词"},
        },
        "required": ["keyword"],
        "additionalProperties": False,
    },
    category="composite",
    composes=["search_stock", "get_financial_abstract", "get_stock_daily",
              "get_us_stock_spot", "get_us_stock_info",
              "get_us_stock_finance", "get_us_stock_indicator",
              "get_us_stock_calendar"],
)
async def stock_overview(keyword: str) -> dict:
    r = await execute_skill("search_stock", {"keyword": keyword})
    if not r.get("ok") or not isinstance(r.get("data"), list) or not r["data"]:
        return err(f"未找到股票: {keyword}")
    matches = r["data"][:3]
    primary = matches[0]
    # 优先使用 search_stock 已经判定的 market 字段（A 股 sina 返回 symbol='sh600519'，
    # 会让按 isalpha 启发式误判；这里直接以 search_stock 的结论为准）
    market_str = str(primary.get("market", "") or "").strip()
    raw_symbol = str(primary.get("symbol") or primary.get("代码") or primary.get("code") or "").strip()
    if market_str == "美股" or is_us_symbol(raw_symbol):
        market = "US"
        code = raw_symbol.upper()
    elif market_str == "A股" or (raw_symbol and re.match(r"^(sh|sz|bj)\d{6}$", raw_symbol.lower())):
        market = "A"
        code = raw_symbol.lower()
        if re.match(r"^\d{6}$", code):
            code = "sh" + code if code[0] in ("6", "9") else ("bj" + code if code[0] in ("4", "8") else "sz" + code)
    else:
        # 兜底：尝试抽 6 位
        code6 = "".join(ch for ch in raw_symbol if ch.isdigit())[-6:]
        if len(code6) == 6:
            market = "A"
            code = "sh" + code6 if code6[0] in ("6", "9") else ("bj" + code6 if code6[0] in ("4", "8") else "sz" + code6)
        elif raw_symbol and any(c.isalpha() for c in raw_symbol):
            market = "US"
            code = raw_symbol.upper()
        else:
            return err(f"搜索结果无 symbol: {primary}")
    if not code:
        return err(f"搜索结果无 symbol: {primary}")
    from datetime import datetime, timedelta
    end = datetime.now().strftime("%Y%m%d")
    start = (datetime.now() - timedelta(days=30)).strftime("%Y%m%d")
    # 美股没有 A 股财务摘要；并行拉取实时行情 + 基本信息 + 财务三表(资产负债表) + 财务指标 + 日K
    if market == "US":
        tasks = [
            ("get_us_stock_spot",     {"symbol": code}),
            ("get_us_stock_info",     {"symbol": code}),
            ("get_us_stock_finance",  {"symbol": code, "report_type": "资产负债表", "indicator": "年报"}),
            ("get_us_stock_indicator", {"symbol": code, "indicator": "年报"}),
            ("get_us_stock_calendar", {"symbol": code}),
            ("get_stock_daily",       {"symbol": code, "start_date": start, "end_date": end, "adjust": "qfq"}),
        ]
    else:
        tasks = [
            ("get_financial_abstract", {"symbol": code}),
            ("get_stock_daily", {"symbol": code, "start_date": start, "end_date": end, "adjust": "qfq"}),
        ]
    results = await _gather_sub(tasks)
    summary = _summarize_subs(results)
    summary["composed"] = ["search_stock"] + [n for n, _ in tasks]
    summary["market"] = "美股" if market == "US" else "A股"
    sub_arts = _collect_artifacts(results)
    # search_stock 的 artifact 也捎上
    if r.get("artifact"):
        sub_arts = [r["artifact"]] + sub_arts
    return ok(
        {"keyword": keyword, "resolved_symbol": code, "market": market,
         "matches": [{"name": primary.get("name") or primary.get("名称"),
                      "symbol": code, "market": "美股" if market == "US" else "A股"}], **summary},
        meta("stock_overview", len(tasks) + 1),
        artifacts=sub_arts or None,
    )
