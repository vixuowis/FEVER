"""股东/解禁 skills (design.md §4 补充).

whitelisted akshare:
  - akshare.stock_main_stock_holder (前十大股东, stock=code)
  - akshare.stock_circulate_stock_holder (流通股东, symbol=code)
  - akshare.stock_fund_stock_holder (基金持股, symbol=code, 默认最近季度)
  - akshare.stock_shareholder_change_ths (股东增减持, 同花顺)
  - akshare.stock_restricted_release_summary_em (解禁汇总)
  - akshare.stock_restricted_release_detail_em (解禁明细)
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


def _code6(symbol: str) -> str:
    code = "".join(ch for ch in str(symbol) if ch.isdigit())[-6:]
    if len(code) != 6:
        raise ValueError(f"无法识别股票代码: {symbol}")
    return code


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


# ----------------------------------------------------------- 主要股东 ---


@skill(
    "get_main_holders",
    "获取个股前十大股东及股东总数（按股东说明+股本性质归类），symbol 为6位代码。"
    "适合了解控股结构与机构持股变动。",
    {
        "type": "object",
        "properties": {
            "symbol": {"type": "string", "description": "6位股票代码"},
            "limit": {"type": "integer", "description": "保留条数（1-100），默认 20"},
        },
        "required": ["symbol"],
    },
)
@cache.cached("holders")
def get_main_holders(symbol: str, limit: int = 20) -> dict:
    try:
        code = _code6(symbol)
        df = _with_retry(lambda: ak.stock_main_stock_holder(stock=code))
        if df is None or len(df) == 0:
            return err(f"{code} 无主要股东数据")
        df = _keep(df, ["编号", "股东名称", "持股数量", "持股比例", "股本性质",
                        "截至日期", "公告日期", "股东说明", "股东总数", "平均持股数"])
        # 取最近一期（按公告日期 desc）
        if "公告日期" in df.columns:
            df["__d"] = df["公告日期"].astype(str)
            df = df.sort_values("__d", ascending=False).drop(columns=["__d"])
        df = df.head(max(1, min(int(limit or 20), 100)))
        records = json_safe(df.to_dict(orient="records"))
        return ok(
            records, meta("akshare.stock_main_stock_holder", len(records)),
            artifact=_table_artifact(f"{code} 主要股东（{len(records)} 条）", records,
                                     note="来源：东方财富"),
        )
    except Exception as e:  # noqa: BLE001
        return err(f"主要股东获取失败: {type(e).__name__}: {e}")


# ----------------------------------------------------------- 流通股东 ---


@skill(
    "get_circulate_holders",
    "获取个股流通股东（最近一期前 N 名），symbol 为6位代码。",
    {
        "type": "object",
        "properties": {
            "symbol": {"type": "string", "description": "6位股票代码"},
            "limit": {"type": "integer", "description": "保留条数（1-50），默认 10"},
        },
        "required": ["symbol"],
    },
)
@cache.cached("holders")
def get_circulate_holders(symbol: str, limit: int = 10) -> dict:
    try:
        code = _code6(symbol)
        df = _with_retry(lambda: ak.stock_circulate_stock_holder(symbol=code))
        if df is None or len(df) == 0:
            return err(f"{code} 无流通股东数据")
        df = _keep(df, ["截止日期", "公告日期", "编号", "股东名称", "持股数量", "占流通股比例", "股本性质"])
        if "公告日期" in df.columns:
            df["__d"] = df["公告日期"].astype(str)
            df = df.sort_values("__d", ascending=False).drop(columns=["__d"])
        df = df.head(max(1, min(int(limit or 10), 50)))
        records = json_safe(df.to_dict(orient="records"))
        return ok(
            records, meta("akshare.stock_circulate_stock_holder", len(records)),
            artifact=_table_artifact(f"{code} 流通股东（{len(records)} 条）", records,
                                     note="来源：东方财富"),
        )
    except Exception as e:  # noqa: BLE001
        return err(f"流通股东获取失败: {type(e).__name__}: {e}")


# ----------------------------------------------------------- 基金持股 ---


@skill(
    "get_fund_holders",
    "获取个股基金持股明细（基金名称/基金代码/持仓数量/占流通股比例/持股市值/占净值比例/截止日期）。"
    "symbol 为6位代码。",
    {
        "type": "object",
        "properties": {
            "symbol": {"type": "string", "description": "6位股票代码"},
            "limit": {"type": "integer", "description": "保留条数（1-200），默认 30"},
        },
        "required": ["symbol"],
    },
)
@cache.cached("holders")
def get_fund_holders(symbol: str, limit: int = 30) -> dict:
    try:
        code = _code6(symbol)
        df = _with_retry(lambda: ak.stock_fund_stock_holder(symbol=code))
        if df is None or len(df) == 0:
            return ok([], meta("akshare.stock_fund_stock_holder", 0)) | {
                "note": f"{code} 暂无基金持股"
            }
        df = _keep(df, ["基金名称", "基金代码", "持仓数量", "占流通股比例",
                        "持股市值", "占净值比例", "截止日期"])
        df = df.head(max(1, min(int(limit or 30), 200)))
        records = json_safe(df.to_dict(orient="records"))
        return ok(
            records, meta("akshare.stock_fund_stock_holder", len(records)),
            artifact=_table_artifact(f"{code} 基金持股（{len(records)} 只基金）", records,
                                     note="来源：东方财富"),
        )
    except Exception as e:  # noqa: BLE001
        return err(f"基金持股获取失败: {type(e).__name__}: {e}")


# ----------------------------------------------------------- 股东增减持 ---


@skill(
    "get_holder_change",
    "获取个股股东增减持变动记录（同花顺），含变动股东/变动数量/交易均价/剩余股份/变动期间/变动途径。"
    "symbol 为6位代码。",
    {
        "type": "object",
        "properties": {
            "symbol": {"type": "string", "description": "6位股票代码"},
            "limit": {"type": "integer", "description": "保留条数（1-50），默认 20"},
        },
        "required": ["symbol"],
    },
)
@cache.cached("holders")
def get_holder_change(symbol: str, limit: int = 20) -> dict:
    try:
        code = _code6(symbol)
        df = _with_retry(lambda: ak.stock_shareholder_change_ths(symbol=code))
        if df is None or len(df) == 0:
            return ok([], meta("akshare.stock_shareholder_change_ths", 0)) | {
                "note": f"{code} 暂无股东增减持"
            }
        df = _keep(df, ["公告日期", "变动股东", "变动数量", "交易均价", "剩余股份总数", "变动期间", "变动途径"])
        df = df.head(max(1, min(int(limit or 20), 50)))
        records = json_safe(df.to_dict(orient="records"))
        return ok(
            records, meta("akshare.stock_shareholder_change_ths", len(records)),
            artifact=_table_artifact(f"{code} 股东增减持（{len(records)} 条）", records,
                                     note="来源：同花顺"),
        )
    except Exception as e:  # noqa: BLE001
        return err(f"股东增减持获取失败: {type(e).__name__}: {e}")


# ----------------------------------------------------------- 解禁汇总 ---


@skill(
    "get_restricted_release_summary",
    "获取限售解禁汇总（沪深京全部股票），含解禁时间/解禁家数/解禁数量/实际解禁市值/沪深300涨跌幅。"
    "默认最近 10 条。",
    {
        "type": "object",
        "properties": {
            "limit": {"type": "integer", "description": "保留条数（1-30），默认 10"},
        },
        "required": [],
    },
)
@cache.cached("restricted")
def get_restricted_release_summary(limit: int = 10) -> dict:
    try:
        df = _with_retry(lambda: ak.stock_restricted_release_summary_em(symbol="全部股票"))
        if df is None or len(df) == 0:
            return err("解禁汇总为空")
        df = _keep(df, ["序号", "解禁时间", "当日解禁股票家数", "解禁数量",
                        "实际解禁数量", "实际解禁市值", "沪深300指数", "沪深300指数涨跌幅"])
        df = df.head(max(1, min(int(limit or 10), 30)))
        records = json_safe(df.to_dict(orient="records"))
        return ok(
            records, meta("akshare.stock_restricted_release_summary_em", len(records)),
            artifact=_table_artifact(f"限售解禁汇总（{len(records)} 条）", records,
                                     note="市值单位：万元；来源：东方财富"),
        )
    except Exception as e:  # noqa: BLE001
        return err(f"解禁汇总获取失败: {type(e).__name__}: {e}")


# ----------------------------------------------------------- 解禁明细 ---


@skill(
    "get_restricted_release_detail",
    "获取某只股票解禁明细（指定起止日期），含解禁时间/限售股类型/解禁数量/实际解禁市值。"
    "默认最近 90 天。",
    {
        "type": "object",
        "properties": {
            "symbol": {"type": "string", "description": "6位股票代码"},
            "start_date": {"type": "string", "description": "YYYYMMDD，默认 90 天前"},
            "end_date": {"type": "string", "description": "YYYYMMDD，默认今天"},
            "limit": {"type": "integer", "description": "保留条数（1-100），默认 30"},
        },
        "required": ["symbol"],
    },
)
def get_restricted_release_detail(symbol: str, start_date: Optional[str] = None,
                                  end_date: Optional[str] = None, limit: int = 30) -> dict:
    try:
        code = _code6(symbol)
        today = _dt.date.today()
        end8 = (end_date or today.strftime("%Y%m%d")).replace("-", "")[:8]
        start8 = (start_date or (today - _dt.timedelta(days=365 * 2)).strftime("%Y%m%d")).replace("-", "")[:8]
        df = _with_retry(lambda: ak.stock_restricted_release_detail_em(start_date=start8, end_date=end8))
        if df is None or len(df) == 0:
            return err(f"{code} 在 {start8}~{end8} 无解禁明细（接口本身返回空）")
        if "股票代码" in df.columns:
            mask = df["股票代码"].astype(str).str[-6:] == code
            if mask.sum() == 0:
                return ok([], meta("akshare.stock_restricted_release_detail_em", 0)) | {
                    "note": f"{code} 在 {start8}~{end8} 无解禁记录"
                }
            df = df[mask]
        df = _keep(df, ["序号", "股票代码", "股票简称", "解禁时间", "限售股类型",
                        "解禁数量", "实际解禁数量", "实际解禁市值"])
        df = df.head(max(1, min(int(limit or 30), 100)))
        records = json_safe(df.to_dict(orient="records"))
        return ok(
            records, meta("akshare.stock_restricted_release_detail_em", len(records)),
            artifact=_table_artifact(f"{code} 解禁明细（{start8}~{end8}，{len(records)} 条）",
                                     records, note="市值单位：万元；来源：东方财富"),
        )
    except Exception as e:  # noqa: BLE001
        return err(f"解禁明细获取失败: {type(e).__name__}: {e}")
