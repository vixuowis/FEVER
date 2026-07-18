"""财务三表细表 + 业绩预告 (design.md §4 补充).

whitelisted akshare:
  - akshare.stock_financial_report_sina (利润表，新浪，覆盖2003至今)
  - akshare.stock_balance_sheet_by_report_em / _yearly_em (资产负债表)
  - akshare.stock_cash_flow_sheet_by_report_em / _yearly_em (现金流量表)
  - akshare.stock_profit_forecast_ths (业绩预告，同花顺)
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
    """重试包装，规避 EM/THS 接口的瞬时网络抖动。返回最后一次异常由调用方处理。"""
    last: Exception | None = None
    for i in range(attempts):
        try:
            return fn()
        except Exception as e:  # noqa: BLE001
            last = e
            if i < attempts - 1:
                time.sleep(base_delay * (2 ** i))
    raise last  # type: ignore[misc]


def _code6(symbol: str) -> str:
    code = "".join(ch for ch in str(symbol) if ch.isdigit())[-6:]
    if len(code) != 6:
        raise ValueError(f"无法识别股票代码: {symbol}")
    return code


def _sh_symbol(code: str) -> str:
    """东财接口的 symbol 需要 sh/sz/bj 前缀."""
    if code[0] in ("6", "9"):
        return "SH" + code
    if code[0] in ("4", "8"):
        return "BJ" + code
    return "SZ" + code


def _table_artifact(title: str, records: list[dict], note: str | None = None) -> dict:
    if not records:
        return {"kind": "table", "title": title, "payload": {"columns": [], "rows": [], "note": note or "无数据"}}
    payload: dict = {"columns": list(records[0].keys()),
                     "rows": [[r.get(c) for c in records[0].keys()] for r in records]}
    if note:
        payload["note"] = note
    return {"kind": "table", "title": title, "payload": payload}


def _pick_period(df: pd.DataFrame, n: int = 8) -> pd.DataFrame:
    """按报告日排序保留最近 n 期."""
    date_col = None
    for c in ("REPORT_DATE", "报告日", "报告日期", "日期"):
        if c in df.columns:
            date_col = c
            break
    if date_col:
        df = df.copy()
        df[date_col] = df[date_col].astype(str).str[:10]
        df = df.sort_values(date_col, ascending=False).head(n)
    return df


# ------------------------------------------------------------- 利润表 ---


@skill(
    "get_income_statement",
    "获取个股利润表（按报告期），列含营业总收入/营业收入/营业总成本/营业利润/利润总额/净利润/归母净利润/EPS 等，"
    "默认最近 8 期。symbol 为6位代码。",
    {
        "type": "object",
        "properties": {
            "symbol": {"type": "string", "description": "6位股票代码"},
            "periods": {"type": "integer", "description": "保留期数（1-20），默认8"},
        },
        "required": ["symbol"],
    },
)
@cache.cached("fundamentals")
def get_income_statement(symbol: str, periods: int = 8) -> dict:
    try:
        code = _code6(symbol)
        n = max(1, min(int(periods or 8), 20))
        df = ak.stock_financial_report_sina(stock=code, symbol="利润表")
        if df is None or len(df) == 0:
            return err(f"{code} 无利润表数据")
        df = _pick_period(df, n)
        records = json_safe(df.to_dict(orient="records"))
        return ok(
            records,
            meta("akshare.stock_financial_report_sina", len(records)),
            artifact=_table_artifact(f"{code} 利润表（最近 {len(records)} 期）", records,
                                     note="来源：新浪财经；单位：元"),
        )
    except Exception as e:  # noqa: BLE001
        return err(f"利润表获取失败: {type(e).__name__}: {e}")


# ------------------------------------------------------------ 资产负债表 --


@skill(
    "get_balance_sheet",
    "获取个股资产负债表（按报告期），列含货币资金/应收账款/存货/固定资产/总资产/总负债/股东权益等。"
    "symbol 需带 sh/sz/bj 前缀（如 SH600519）或纯6位代码。",
    {
        "type": "object",
        "properties": {
            "symbol": {"type": "string", "description": "6位代码（自动加前缀）或 sh600519 格式"},
            "periods": {"type": "integer", "description": "保留期数（1-12），默认8"},
        },
        "required": ["symbol"],
    },
)
@cache.cached("fundamentals")
def get_balance_sheet(symbol: str, periods: int = 8) -> dict:
    try:
        code = _code6(symbol)
        prefix = _sh_symbol(code)
        n = max(1, min(int(periods or 8), 12))
        df = _with_retry(lambda: ak.stock_balance_sheet_by_report_em(symbol=prefix))
        if df is None or len(df) == 0:
            return err(f"{code} 无资产负债表数据")
        df = _pick_period(df, n)
        records = json_safe(df.to_dict(orient="records"))
        return ok(
            records,
            meta("akshare.stock_balance_sheet_by_report_em", len(records)),
            artifact=_table_artifact(f"{code} 资产负债表（最近 {len(records)} 期）", records,
                                     note="来源：东方财富；单位：元"),
        )
    except Exception as e:  # noqa: BLE001
        return err(f"资产负债表获取失败: {type(e).__name__}: {e}")


# ----------------------------------------------------------- 现金流量表 ---


@skill(
    "get_cash_flow",
    "获取个股现金流量表（按报告期），列含经营/投资/筹资活动现金流净额、销售商品收到现金、购建固定资产支付等。"
    "symbol 需带 sh/sz/bj 前缀。",
    {
        "type": "object",
        "properties": {
            "symbol": {"type": "string", "description": "6位代码（自动加前缀）或 sh600519 格式"},
            "periods": {"type": "integer", "description": "保留期数（1-12），默认8"},
        },
        "required": ["symbol"],
    },
)
@cache.cached("fundamentals")
def get_cash_flow(symbol: str, periods: int = 8) -> dict:
    try:
        code = _code6(symbol)
        prefix = _sh_symbol(code)
        n = max(1, min(int(periods or 8), 12))
        df = _with_retry(lambda: ak.stock_cash_flow_sheet_by_report_em(symbol=prefix))
        if df is None or len(df) == 0:
            return err(f"{code} 无现金流量表数据")
        df = _pick_period(df, n)
        records = json_safe(df.to_dict(orient="records"))
        return ok(
            records,
            meta("akshare.stock_cash_flow_sheet_by_report_em", len(records)),
            artifact=_table_artifact(f"{code} 现金流量表（最近 {len(records)} 期）", records,
                                     note="来源：东方财富；单位：元"),
        )
    except Exception as e:  # noqa: BLE001
        return err(f"现金流量表获取失败: {type(e).__name__}: {e}")


# ------------------------------------------------------------ 业绩预告 ---


@skill(
    "get_profit_forecast",
    "获取个股业绩预告/预测汇总（同花顺），含年度、预测机构数、EPS/净利润最小/均值/最大值、行业均值。"
    "symbol 为6位代码。",
    {
        "type": "object",
        "properties": {"symbol": {"type": "string", "description": "6位股票代码"}},
        "required": ["symbol"],
    },
)
@cache.cached("profit_forecast")
def get_profit_forecast(symbol: str) -> dict:
    try:
        code = _code6(symbol)
        df = ak.stock_profit_forecast_ths(symbol=code)
        if df is None or len(df) == 0:
            return ok([], meta("akshare.stock_profit_forecast_ths", 0)) | {
                "note": f"{code} 暂无业绩预告"
            }
        records = json_safe(df.to_dict(orient="records"))
        return ok(
            records,
            meta("akshare.stock_profit_forecast_ths", len(records)),
            artifact=_table_artifact(f"{code} 业绩预告（{len(records)} 条）", records,
                                     note="来源：同花顺"),
        )
    except Exception as e:  # noqa: BLE001
        return err(f"业绩预告获取失败: {type(e).__name__}: {e}")
