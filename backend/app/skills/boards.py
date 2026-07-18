"""板块/异动/资金流排名 skills (design.md §4 补充).

whitelisted akshare (东财 EM 部分被网络拦截 → 用 ths 同花顺兜底):
  - akshare.stock_board_industry_summary_ths (行业板块列表+涨跌幅+领涨股)
  - akshare.stock_board_industry_index_ths (行业指数K线, symbol=行业名)
  - akshare.stock_sector_fund_flow_summary (新浪行业资金流汇总)
  - akshare.stock_sector_fund_flow_rank (板块资金流排名)
  - akshare.stock_board_change_em (板块异动)
  - akshare.stock_individual_info_em (个股所属行业/总股本等)
"""
from __future__ import annotations

import datetime as _dt
import time
from typing import Any, Callable, Optional

import akshare as ak
import pandas as pd

from . import cache
from .registry import err, json_safe, meta, ok, skill


def _with_retry(fn: Callable[[], Any], attempts: int = 3, base_delay: float = 0.6) -> Any:
    """重试包装，规避 EM/THS 接口的瞬时网络抖动。"""
    last: Exception | None = None
    for i in range(attempts):
        try:
            return fn()
        except Exception as e:  # noqa: BLE001
            last = e
            if i < attempts - 1:
                time.sleep(base_delay * (2 ** i))
    raise last  # type: ignore[misc]


def _table_artifact(title: str, records: list[dict], note: str | None = None) -> dict:
    payload: dict = {"columns": list(records[0].keys()),
                     "rows": [[r.get(c) for c in records[0].keys()] for r in records]}
    if note:
        payload["note"] = note
    return {"kind": "table", "title": title, "payload": payload}


def _safe_table_artifact(title: str, records: list[dict], note: str | None = None) -> dict:
    """同 _table_artifact 但处理空 records 情形."""
    if not records:
        return {"kind": "table", "title": title, "payload": {"columns": [], "rows": [], "note": note or "无数据"}}
    return _table_artifact(title, records, note)


def _keep(df: pd.DataFrame, cols: list[str]) -> pd.DataFrame:
    cols = [c for c in cols if c in df.columns]
    return df[cols].copy() if cols else df.copy()


# ------------------------------------------------------------ 行业板块 ---


@skill(
    "list_industry_boards",
    "获取同花顺行业板块列表（90 个），含涨跌幅/总成交额/净流入/上涨家数/下跌家数/领涨股。可选 sort 按涨跌幅排序。",
    {
        "type": "object",
        "properties": {
            "sort_by": {"type": "string", "enum": ["涨跌幅", "净流入", "总成交额"],
                        "description": "排序字段，默认 涨跌幅"},
            "limit": {"type": "integer", "description": "保留条数（1-90），默认 30"},
        },
        "required": [],
    },
    internal=True,)
@cache.cached("industry_boards")
def list_industry_boards(sort_by: str = "涨跌幅", limit: int = 30) -> dict:
    try:
        df = _with_retry(lambda: ak.stock_board_industry_summary_ths())
        if df is None or len(df) == 0:
            return err("行业板块列表为空")
        sort_col = sort_by if sort_by in df.columns else "涨跌幅"
        df = df.sort_values(sort_col, ascending=False)
        df = _keep(df, ["板块", "涨跌幅", "总成交量", "总成交额", "净流入",
                        "上涨家数", "下跌家数", "均价", "领涨股",
                        "领涨股-最新价", "领涨股-涨跌幅"]).head(max(1, min(int(limit or 30), 90)))
        records = json_safe(df.to_dict(orient="records"))
        return ok(
            records,
            meta("akshare.stock_board_industry_summary_ths", len(records)),
            artifact=_table_artifact(f"行业板块快照（{len(records)} 条，按{sort_col}排序）", records,
                                     note="来源：同花顺"),
        )
    except Exception as e:  # noqa: BLE001
        return err(f"行业板块列表获取失败: {type(e).__name__}: {e}")


@skill(
    "get_industry_board_history",
    "获取同花顺某行业板块指数的历史 K 线，symbol 为板块名（如「电力」「银行」「新能源」）。"
    "period 仅作周期提示用，内部会换算为起止日期（默认最近 250 个交易日）。",
    {
        "type": "object",
        "properties": {
            "symbol": {"type": "string", "description": "行业板块名称，需先调 list_industry_boards 获取"},
            "period": {"type": "string", "enum": ["日k", "周k", "月k"], "description": "周期（仅用作默认起止窗口），默认日k"},
            "limit": {"type": "integer", "description": "保留条数（1-1000），默认 250"},
        },
        "required": ["symbol"],
    },
    internal=True,)
@cache.cached("board_history")
def get_industry_board_history(symbol: str, period: str = "日k", limit: int = 250) -> dict:
    try:
        # period -> 起止日期窗口（保留 limit 条；留 4 倍余量以防缺失日）
        days = {"日k": int(limit) + 30, "周k": (int(limit) + 30) * 7, "月k": (int(limit) + 30) * 31}.get(period, int(limit) + 30)
        end = _dt.date.today()
        start = end - _dt.timedelta(days=days)
        start8 = start.strftime("%Y%m%d")
        end8 = end.strftime("%Y%m%d")
        df = ak.stock_board_industry_index_ths(symbol=symbol, start_date=start8, end_date=end8)
        if df is None or len(df) == 0:
            return err(f"行业板块「{symbol}」无历史数据（名称需严格匹配，可先调 list_industry_boards）")
        df["日期"] = df["日期"].astype(str).str[:10]
        df = df.sort_values("日期").tail(max(1, min(int(limit or 250), 1000))).reset_index(drop=True)
        records = json_safe(df.to_dict(orient="records"))
        line = {
            "kind": "line",
            "title": f"行业「{symbol}」指数走势（{period}）",
            "payload": {
                "x": df["日期"].tolist(),
                "series": [{"name": "收盘价", "data": json_safe(df["收盘价"].tolist())}],
                "yname": "点位",
            },
        }
        return ok(records, meta("akshare.stock_board_industry_index_ths", len(records)),
                  artifact=line)
    except Exception as e:  # noqa: BLE001
        return err(f"行业板块历史获取失败: {type(e).__name__}: {e}")


# ----------------------------------------------------------- 板块资金流 ---


@skill(
    "get_sector_fund_flow_rank",
    "获取行业/概念板块资金流入流出排名（限前 N 名），按净额降序。",
    {
        "type": "object",
        "properties": {
            "board_type": {"type": "string", "enum": ["industry", "concept"],
                            "description": "板块类型，默认 industry"},
            "limit": {"type": "integer", "description": "保留条数（1-100），默认 30"},
        },
        "required": [],
    },
    internal=True,)
@cache.cached("fund_flow_rank")
def get_sector_fund_flow_rank(board_type: str = "industry", limit: int = 30) -> dict:
    try:
        n = max(1, min(int(limit or 30), 100))
        source = "akshare.stock_fund_flow_industry"
        if board_type == "concept":
            df = _with_retry(lambda: ak.stock_fund_flow_concept())
            source = "akshare.stock_fund_flow_concept"
        else:
            df = _with_retry(lambda: ak.stock_fund_flow_industry())
        if df is None or len(df) == 0:
            return err("板块资金流排名为空")
        df = _keep(df, ["序号", "行业", "行业指数", "行业-涨跌幅", "流入资金", "流出资金",
                        "净额", "公司家数", "领涨股", "领涨股-涨跌幅", "当前价"])
        df = df.sort_values("净额", ascending=False).head(n)
        records = json_safe(df.to_dict(orient="records"))
        title_prefix = "概念" if board_type == "concept" else "行业"
        return ok(
            records, meta(source, len(records)),
            artifact=_table_artifact(f"{title_prefix}板块资金流排名（前 {n} 名，按净额降序）",
                                     records, note=f"来源：{source}"),
        )
    except Exception as e:  # noqa: BLE001
        return err(f"板块资金流排名失败: {type(e).__name__}: {e}")


# ----------------------------------------------------------- 板块异动 ---


@skill(
    "get_board_change",
    "获取板块异动（涨跌幅/主力净流入/异动次数/最频繁个股/异动类型），按涨跌幅降序前 N 条。"
    "适合捕捉盘中板块异动热点。",
    {
        "type": "object",
        "properties": {
            "limit": {"type": "integer", "description": "保留条数（1-200），默认 50"},
            "sort_by": {"type": "string", "enum": ["涨跌幅", "主力净流入", "板块异动总次数"],
                        "description": "排序字段，默认 涨跌幅"},
        },
        "required": [],
    },
    internal=True,)
@cache.cached("board_change")
def get_board_change(limit: int = 50, sort_by: str = "涨跌幅") -> dict:
    try:
        df = _with_retry(lambda: ak.stock_board_change_em())
        if df is None or len(df) == 0:
            return err("板块异动为空")
        sort_col = sort_by if sort_by in df.columns else "涨跌幅"
        df = _keep(df, ["板块名称", "涨跌幅", "主力净流入", "板块异动总次数",
                        "板块异动最频繁个股及所属类型-股票代码",
                        "板块异动最频繁个股及所属类型-股票名称",
                        "板块异动最频繁个股及所属类型-买卖方向",
                        "板块具体异动类型列表及出现次数"])
        df = df.sort_values(sort_col, ascending=False).head(max(1, min(int(limit or 50), 200)))
        records = json_safe(df.to_dict(orient="records"))
        return ok(
            records, meta("akshare.stock_board_change_em", len(records)),
            artifact=_table_artifact(f"板块异动（{len(records)} 条，按{sort_col}排序）", records,
                                     note="来源：东方财富"),
        )
    except Exception as e:  # noqa: BLE001
        return err(f"板块异动获取失败: {type(e).__name__}: {e}")


# ------------------------------------------------------- 个股所属板块 ---


@skill(
    "get_stock_industry_info",
    "获取某行业板块的实时概况（板块名/今开/昨收/最高/最低/成交量/成交额/换手率/PE/PB 等）。"
    "symbol 为行业板块名（如「半导体」「银行」「电力」），非股票代码。先调 list_industry_boards 获取合法名称。",
    {
        "type": "object",
        "properties": {"symbol": {"type": "string", "description": "行业板块名（非股票代码），如 半导体/银行"}},
        "required": ["symbol"],
    },
    internal=True,)
@cache.cached("industry_info")
def get_stock_industry_info(symbol: str) -> dict:
    try:
        try:
            df = _with_retry(lambda: ak.stock_board_industry_info_ths(symbol=symbol))
        except IndexError:
            return err(f"行业板块「{symbol}」未在同花顺板块列表中（请先调 list_industry_boards 获取合法名称）")
        if df is None or len(df) == 0:
            return err(f"行业板块「{symbol}」暂无信息（名称需严格匹配，可先调 list_industry_boards）")
        records = json_safe(df.to_dict(orient="records"))
        return ok(
            records, meta("akshare.stock_board_industry_info_ths", len(records)),
            artifact=_safe_table_artifact(f"行业「{symbol}」实时概况（{len(records)} 项）", records,
                                          note="来源：同花顺"),
        )
    except Exception as e:  # noqa: BLE001
        return err(f"行业信息获取失败: {type(e).__name__}: {e}")
