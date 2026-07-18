"""资金流 skills (design.md §4 补充).

whitelisted akshare:
  - akshare.stock_fund_flow_industry / stock_fund_flow_concept (行业/概念资金流)
  - akshare.stock_fund_flow_individual (个股资金流排名)
  - akshare.stock_fund_flow_big_deal (大单交易, 全市场)
  - akshare.stock_hsgt_fund_flow_summary_em (沪深港通北向资金汇总)
"""
from __future__ import annotations

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
    if not records:
        return {"kind": "table", "title": title, "payload": {"columns": [], "rows": [], "note": note or "无数据"}}
    payload: dict = {"columns": list(records[0].keys()),
                     "rows": [[r.get(c) for c in records[0].keys()] for r in records]}
    if note:
        payload["note"] = note
    return {"kind": "table", "title": title, "payload": payload}


def _keep(df: pd.DataFrame, cols: list[str]) -> pd.DataFrame:
    cols = [c for c in cols if c in df.columns]
    return df[cols].copy() if cols else df.copy()


# ----------------------------------------------------------- 行业资金流 ---


@skill(
    "get_industry_fund_flow",
    "获取行业板块资金流入流出排名（90 个行业），可按净额或涨跌幅排序。",
    {
        "type": "object",
        "properties": {
            "sort_by": {"type": "string", "enum": ["净额", "行业-涨跌幅", "流入资金"],
                        "description": "排序字段，默认 净额"},
            "limit": {"type": "integer", "description": "保留条数（1-90），默认 30"},
        },
        "required": [],
    },
    internal=True,)
@cache.cached("fund_flow")
def get_industry_fund_flow(sort_by: str = "净额", limit: int = 30) -> dict:
    try:
        df = _with_retry(lambda: ak.stock_fund_flow_industry(symbol="即时"))
        if df is None or len(df) == 0:
            return err("行业资金流为空")
        sort_col = sort_by if sort_by in df.columns else "净额"
        df = _keep(df, ["序号", "行业", "行业指数", "行业-涨跌幅", "流入资金", "流出资金",
                        "净额", "公司家数", "领涨股", "领涨股-涨跌幅", "当前价"])
        df = df.sort_values(sort_col, ascending=False).head(max(1, min(int(limit or 30), 90)))
        records = json_safe(df.to_dict(orient="records"))
        return ok(
            records, meta("akshare.stock_fund_flow_industry", len(records)),
            artifact=_table_artifact(f"行业资金流（{len(records)} 条，按{sort_col}排序）", records,
                                     note="单位：亿元；来源：东方财富"),
        )
    except Exception as e:  # noqa: BLE001
        return err(f"行业资金流获取失败: {type(e).__name__}: {e}")


# ----------------------------------------------------------- 概念资金流 ---


@skill(
    "get_concept_fund_flow",
    "获取概念板块资金流入流出排名（386 个概念），可按净额或涨跌幅排序。",
    {
        "type": "object",
        "properties": {
            "sort_by": {"type": "string", "enum": ["净额", "行业-涨跌幅", "流入资金"],
                        "description": "排序字段，默认 净额"},
            "limit": {"type": "integer", "description": "保留条数（1-200），默认 30"},
        },
        "required": [],
    },
    internal=True,)
@cache.cached("fund_flow")
def get_concept_fund_flow(sort_by: str = "净额", limit: int = 30) -> dict:
    try:
        df = _with_retry(lambda: ak.stock_fund_flow_concept(symbol="即时"))
        if df is None or len(df) == 0:
            return err("概念资金流为空")
        sort_col = sort_by if sort_by in df.columns else "净额"
        df = _keep(df, ["序号", "行业", "行业指数", "行业-涨跌幅", "流入资金", "流出资金",
                        "净额", "公司家数", "领涨股", "领涨股-涨跌幅", "当前价"])
        df = df.sort_values(sort_col, ascending=False).head(max(1, min(int(limit or 30), 200)))
        records = json_safe(df.to_dict(orient="records"))
        return ok(
            records, meta("akshare.stock_fund_flow_concept", len(records)),
            artifact=_table_artifact(f"概念资金流（{len(records)} 条，按{sort_col}排序）", records,
                                     note="单位：亿元；来源：东方财富"),
        )
    except Exception as e:  # noqa: BLE001
        return err(f"概念资金流获取失败: {type(e).__name__}: {e}")


# ----------------------------------------------------------- 个股资金流 ---


@skill(
    "get_individual_fund_flow_rank",
    "获取全市场个股资金流排名（约 5000+ 条），按净额降序前 N 名。"
    "适合发现资金净流入/流出最显著个股。",
    {
        "type": "object",
        "properties": {
            "limit": {"type": "integer", "description": "保留条数（1-100），默认 30"},
        },
        "required": [],
    },
    internal=True,)
@cache.cached("fund_flow")
def get_individual_fund_flow_rank(limit: int = 30) -> dict:
    try:
        df = _with_retry(lambda: ak.stock_fund_flow_individual(symbol="即时"))
        if df is None or len(df) == 0:
            return err("个股资金流排名为空")
        df = _keep(df, ["序号", "股票代码", "股票简称", "最新价", "涨跌幅", "换手率",
                        "流入资金", "流出资金", "净额", "成交额"])
        # 净额列可能是带"万/亿"的字符串
        def _parse(s):
            if s is None: return 0.0
            ss = str(s).replace(",", "")
            try:
                if ss.endswith("亿"): return float(ss[:-1]) * 1e8
                if ss.endswith("万"): return float(ss[:-1]) * 1e4
                return float(ss)
            except Exception:  # noqa: BLE001
                return 0.0
        df["__净额_n"] = df["净额"].apply(_parse)
        df = df.sort_values("__净额_n", ascending=False).drop(columns=["__净额_n"])
        df = df.head(max(1, min(int(limit or 30), 100)))
        records = json_safe(df.to_dict(orient="records"))
        return ok(
            records, meta("akshare.stock_fund_flow_individual", len(records)),
            artifact=_table_artifact(f"个股资金流排名（前 {len(records)} 名，按净额降序）", records,
                                     note="单位：元；来源：东方财富"),
        )
    except Exception as e:  # noqa: BLE001
        return err(f"个股资金流排名获取失败: {type(e).__name__}: {e}")


# -------------------------------------------------------------- 大单 ---


@skill(
    "get_big_deal_flow",
    "获取全市场大单交易记录（买盘/卖盘，>100万元），可按股票代码过滤、限定条数。"
    "适合盘中监控主力动向。",
    {
        "type": "object",
        "properties": {
            "symbol": {"type": "string", "description": "可选，6位股票代码；不填返回全市场"},
            "limit": {"type": "integer", "description": "保留条数（1-500），默认 50"},
        },
        "required": [],
    },
    internal=True,)
def get_big_deal_flow(symbol: Optional[str] = None, limit: int = 50) -> dict:
    try:
        df = _with_retry(lambda: ak.stock_fund_flow_big_deal())
        if df is None or len(df) == 0:
            return err("大单交易为空")
        if symbol:
            code = "".join(ch for ch in str(symbol) if ch.isdigit())[-6:]
            if len(code) == 6:
                df = df[df["股票代码"].astype(str).str[-6:] == code]
        df = df.head(max(1, min(int(limit or 50), 500)))
        records = json_safe(df.to_dict(orient="records"))
        title = f"大单交易（{len(records)} 条" + (f"，股票 {code}" if symbol else "，全市场") + "）"
        return ok(
            records, meta("akshare.stock_fund_flow_big_deal", len(records)),
            artifact=_table_artifact(title, records, note="单位：万元；来源：东方财富"),
        )
    except Exception as e:  # noqa: BLE001
        return err(f"大单交易获取失败: {type(e).__name__}: {e}")


# ----------------------------------------------------------- 北向资金 ---


@skill(
    "get_hsgt_fund_flow",
    "获取沪深港通北向资金汇总（沪股通/深股通/北向/南向），含成交净买额/资金净流入/当日资金余额/相关指数涨跌幅。"
    "默认最近 10 条。",
    {
        "type": "object",
        "properties": {
            "limit": {"type": "integer", "description": "保留条数（1-30），默认 10"},
        },
        "required": [],
    },
    internal=True,)
def get_hsgt_fund_flow(limit: int = 10) -> dict:
    try:
        df = _with_retry(lambda: ak.stock_hsgt_fund_flow_summary_em())
        if df is None or len(df) == 0:
            return err("北向资金汇总为空")
        df = _keep(df, ["交易日", "类型", "板块", "资金方向", "交易状态",
                        "成交净买额", "资金净流入", "当日资金余额",
                        "上涨数", "持平数", "下跌数", "相关指数", "指数涨跌幅"])
        df = df.head(max(1, min(int(limit or 10), 30)))
        records = json_safe(df.to_dict(orient="records"))
        return ok(
            records, meta("akshare.stock_hsgt_fund_flow_summary_em", len(records)),
            artifact=_table_artifact(f"沪深港通资金流向（{len(records)} 条）", records,
                                     note="单位：亿元；来源：东方财富"),
        )
    except Exception as e:  # noqa: BLE001
        return err(f"北向资金获取失败: {type(e).__name__}: {e}")
