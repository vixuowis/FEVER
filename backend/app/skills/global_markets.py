"""跨市场/基金/期货/外汇/黄金/债券/期权 skills (design.md §4 补充).

whitelisted akshare (港股/AH/黄金/期权部分接口被网络拦截, 此处只纳入可用):
  - akshare.fund_etf_spot_em (ETF 实时)
  - akshare.fund_value_estimation_em (基金估值/单位净值)
  - akshare.futures_main_sina (期货主力合约列表)
  - akshare.fx_spot_quote (外汇牌价)
  - akshare.bond_zh_hs_cov_spot (沪深可转债实时)
  - akshare.index_us_stock_sina (美股指数: .INX=标普500 / .DJI=道琼 / .IXIC=纳指)
  - akshare.index_stock_info (全球指数代码列表)
"""
from __future__ import annotations

import time
from typing import Any, Callable, Optional

import akshare as ak
import pandas as pd

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


_US_INDEX_ALIAS = {
    "spx": ".INX", "sp500": ".INX", "标普": ".INX", "标普500": ".INX",
    "dji": ".DJI", "道琼": ".DJI", "道琼斯": ".DJI",
    "ixic": ".IXIC", "nasdaq": ".IXIC", "纳指": ".IXIC", "纳斯达克": ".IXIC",
}


def _resolve_us_index(symbol: str) -> str:
    s = (symbol or "").strip().upper()
    if s in _US_INDEX_ALIAS.values():
        return s
    if s.lower() in _US_INDEX_ALIAS:
        return _US_INDEX_ALIAS[s.lower()]
    return s


# ----------------------------------------------------------- ETF 实时 ---


@skill(
    "get_etf_spot",
    "获取 ETF 实时行情（1500+ 条），可按名称/代码模糊过滤，按涨跌幅降序前 N 条。"
    "适合快速挑选 ETF 标的。",
    {
        "type": "object",
        "properties": {
            "keyword": {"type": "string", "description": "可选，名称/代码模糊过滤（如「沪深300」「医药」）"},
            "sort_by": {"type": "string", "enum": ["涨跌幅", "换手率", "成交额"],
                        "description": "排序字段，默认 涨跌幅"},
            "limit": {"type": "integer", "description": "保留条数（1-100），默认 30"},
        },
        "required": [],
    },
    internal=True,)
def get_etf_spot(keyword: Optional[str] = None, sort_by: str = "涨跌幅", limit: int = 30) -> dict:
    try:
        df = _with_retry(lambda: ak.fund_etf_spot_em())
        if df is None or len(df) == 0:
            return err("ETF 实时行情为空")
        if keyword:
            kw = str(keyword).strip()
            mask = (
                df["代码"].astype(str).str.contains(kw, na=False)
                | df["名称"].astype(str).str.contains(kw, na=False)
            )
            df = df[mask]
        df = _keep(df, ["代码", "名称", "最新价", "IOPV实时估值", "基金折价率",
                        "涨跌额", "涨跌幅", "成交量", "成交额", "开盘价", "最高", "最低"])
        sort_col = sort_by if sort_by in df.columns else "涨跌幅"
        df = df.sort_values(sort_col, ascending=False).head(max(1, min(int(limit or 30), 100)))
        records = json_safe(df.to_dict(orient="records"))
        title = f"ETF 实时（{len(records)} 条"
        if keyword:
            title += f"，关键词「{keyword}」"
        title += "）"
        return ok(
            records, meta("akshare.fund_etf_spot_em", len(records)),
            artifact=_table_artifact(title, records, note="来源：东方财富"),
        )
    except Exception as e:  # noqa: BLE001
        return err(f"ETF 实时获取失败: {type(e).__name__}: {e}")


# ----------------------------------------------------------- 基金估值 ---


@skill(
    "get_fund_value_estimation",
    "获取基金当日估值（按今日估算涨跌幅/单位净值/估算偏差），可按名称/代码模糊过滤。",
    {
        "type": "object",
        "properties": {
            "keyword": {"type": "string", "description": "可选，名称/代码模糊过滤"},
            "limit": {"type": "integer", "description": "保留条数（1-100），默认 30"},
        },
        "required": [],
    },
    internal=True,)
def get_fund_value_estimation(keyword: Optional[str] = None, limit: int = 30) -> dict:
    try:
        df = _with_retry(lambda: ak.fund_value_estimation_em(symbol="全部"))
        if df is None or len(df) == 0:
            return err("基金估值为空")
        if keyword:
            kw = str(keyword).strip()
            mask = (
                df["基金代码"].astype(str).str.contains(kw, na=False)
                | df["基金名称"].astype(str).str.contains(kw, na=False)
            )
            df = df[mask]
        # 选估算日期列（列名带日期）
        est_cols = [c for c in df.columns if "估算" in c and "增长率" in c]
        pub_cols = [c for c in df.columns if "公布" in c and "日增长率" in c]
        keep = ["序号", "基金代码", "基金名称"] + est_cols[:1] + pub_cols[:1] + ["估算偏差"]
        df = _keep(df, keep)
        df = df.head(max(1, min(int(limit or 30), 100)))
        records = json_safe(df.to_dict(orient="records"))
        title = f"基金当日估值（{len(records)} 条"
        if keyword:
            title += f"，关键词「{keyword}」"
        title += "）"
        return ok(
            records, meta("akshare.fund_value_estimation_em", len(records)),
            artifact=_table_artifact(title, records, note="来源：东方财富"),
        )
    except Exception as e:  # noqa: BLE001
        return err(f"基金估值获取失败: {type(e).__name__}: {e}")


# ----------------------------------------------------------- 期货主力 ---


@skill(
    "get_futures_main",
    "获取期货主力合约列表（4000+ 条），含日期/开高低收/成交量/持仓量/动态结算价。"
    "可按品种代码过滤（如「V0」「CU0」「AU0」）。",
    {
        "type": "object",
        "properties": {
            "symbol": {"type": "string", "description": "可选，期货代码前缀（V0/CU0/AU0/AG0 等）"},
            "limit": {"type": "integer", "description": "保留条数（1-100），默认 30"},
        },
        "required": [],
    },
    internal=True,)
def get_futures_main(symbol: Optional[str] = None, limit: int = 30) -> dict:
    try:
        df = _with_retry(lambda: ak.futures_main_sina(symbol="V0"))
        if df is None or len(df) == 0:
            return err("期货主力为空")
        if symbol:
            df = df[df["symbol"].astype(str).str.startswith(symbol.upper())]
        df = _keep(df, ["symbol", "date", "open", "high", "low", "close", "volume", "open_interest", "settle"])
        df = df.head(max(1, min(int(limit or 30), 100)))
        records = json_safe(df.to_dict(orient="records"))
        title = f"期货主力（{len(records)} 条"
        if symbol:
            title += f"，品种 {symbol}"
        title += "）"
        return ok(
            records, meta("akshare.futures_main_sina", len(records)),
            artifact=_table_artifact(title, records, note="来源：新浪财经"),
        )
    except Exception as e:  # noqa: BLE001
        return err(f"期货主力获取失败: {type(e).__name__}: {e}")


# ----------------------------------------------------------- 外汇牌价 ---


@skill(
    "get_fx_spot_quote",
    "获取外汇牌价（主要货币对，约 25 条），含货币对/买报价/卖报价。"
    "适合快速查汇率。",
    {
        "type": "object",
        "properties": {},
        "required": [],
    },
    internal=True,)
def get_fx_spot_quote() -> dict:
    try:
        df = _with_retry(lambda: ak.fx_spot_quote())
        if df is None or len(df) == 0:
            return err("外汇牌价为空")
        records = json_safe(df.to_dict(orient="records"))
        return ok(
            records, meta("akshare.fx_spot_quote", len(records)),
            artifact=_table_artifact(f"外汇牌价（{len(records)} 条）", records,
                                     note="来源：新浪财经"),
        )
    except Exception as e:  # noqa: BLE001
        return err(f"外汇牌价获取失败: {type(e).__name__}: {e}")


# ----------------------------------------------------------- 可转债 ---


@skill(
    "get_convert_bond_spot",
    "获取沪深可转债实时行情（300+ 条），按涨跌幅降序前 N 条。"
    "可按名称/代码过滤。",
    {
        "type": "object",
        "properties": {
            "keyword": {"type": "string", "description": "可选，名称/代码模糊过滤"},
            "limit": {"type": "integer", "description": "保留条数（1-100），默认 30"},
        },
        "required": [],
    },
    internal=True,)
def get_convert_bond_spot(keyword: Optional[str] = None, limit: int = 30) -> dict:
    try:
        df = _with_retry(lambda: ak.bond_zh_hs_cov_spot())
        if df is None or len(df) == 0:
            return err("可转债实时为空")
        if keyword:
            kw = str(keyword).strip()
            mask = (
                df["symbol"].astype(str).str.contains(kw, na=False)
                | df["name"].astype(str).str.contains(kw, na=False)
            )
            df = df[mask]
        df = _keep(df, ["symbol", "name", "trade", "pricechange", "changepercent",
                        "buy", "sell", "settlement", "volume", "amount"])
        sort_col = "changepercent" if "changepercent" in df.columns else "trade"
        df = df.sort_values(sort_col, ascending=False).head(max(1, min(int(limit or 30), 100)))
        records = json_safe(df.to_dict(orient="records"))
        title = f"可转债实时（{len(records)} 条"
        if keyword:
            title += f"，关键词「{keyword}」"
        title += "）"
        return ok(
            records, meta("akshare.bond_zh_hs_cov_spot", len(records)),
            artifact=_table_artifact(title, records, note="来源：新浪财经"),
        )
    except Exception as e:  # noqa: BLE001
        return err(f"可转债实时获取失败: {type(e).__name__}: {e}")


# ----------------------------------------------------------- 美股指数 ---


@skill(
    "get_us_index_daily",
    "获取美股指数日 K 线（OHLC+成交量）。symbol 可用别名：spx/sp500/标普500 → .INX；"
    "dji/道琼/道琼斯 → .DJI；ixic/nasdaq/纳指/纳斯达克 → .IXIC。",
    {
        "type": "object",
        "properties": {
            "symbol": {"type": "string", "description": "指数代码或别名（.INX/.DJI/.IXIC/spx/纳指…）"},
            "limit": {"type": "integer", "description": "保留条数（1-500），默认 250"},
        },
        "required": ["symbol"],
    },
    internal=True,)
def get_us_index_daily(symbol: str, limit: int = 250) -> dict:
    try:
        sym = _resolve_us_index(symbol)
        df = _with_retry(lambda: ak.index_us_stock_sina(symbol=sym))
        if df is None or len(df) == 0:
            return err(f"美股指数 {sym} 无数据")
        df["date"] = df["date"].astype(str).str[:10]
        df = df.sort_values("date").tail(max(1, min(int(limit or 250), 500))).reset_index(drop=True)
        records = json_safe(df.to_dict(orient="records"))
        line = {
            "kind": "line",
            "title": f"美股指数 {sym} 走势",
            "payload": {
                "x": df["date"].tolist(),
                "series": [{"name": sym, "data": json_safe(df["close"].tolist())}],
                "yname": "点位",
            },
        }
        return ok(records, meta("akshare.index_us_stock_sina", len(records)), artifact=line)
    except Exception as e:  # noqa: BLE001
        return err(f"美股指数获取失败: {type(e).__name__}: {e}")


# ----------------------------------------------------------- 指数列表 ---


@skill(
    "get_index_list",
    "获取全球指数代码列表（732 条），可用于查询美股/港股/A 股指数代码。"
    "可按名称/display_name 模糊过滤。",
    {
        "type": "object",
        "properties": {
            "keyword": {"type": "string", "description": "可选，名称/代码模糊过滤（如「标普」「上证」）"},
            "limit": {"type": "integer", "description": "保留条数（1-100），默认 30"},
        },
        "required": [],
    },
    internal=True,)
def get_index_list(keyword: Optional[str] = None, limit: int = 30) -> dict:
    try:
        df = _with_retry(lambda: ak.index_stock_info())
        if df is None or len(df) == 0:
            return err("指数代码列表为空")
        if keyword:
            kw = str(keyword).strip()
            mask = (
                df["index_code"].astype(str).str.contains(kw, na=False, case=False)
                | df["display_name"].astype(str).str.contains(kw, na=False)
            )
            df = df[mask]
        df = df.head(max(1, min(int(limit or 30), 100)))
        records = json_safe(df.to_dict(orient="records"))
        title = f"全球指数列表（{len(records)} 条"
        if keyword:
            title += f"，关键词「{keyword}」"
        title += "）"
        return ok(
            records, meta("akshare.index_stock_info", len(records)),
            artifact=_table_artifact(title, records, note="来源：AKShare 整理"),
        )
    except Exception as e:  # noqa: BLE001
        return err(f"指数列表获取失败: {type(e).__name__}: {e}")
