"""Fundamentals & macro skills (design.md §4):
get_financial_abstract / get_financial_indicator / get_research_reports /
get_lhb / get_margin / get_macro — whitelisted akshare interfaces only.
"""
from __future__ import annotations

from datetime import date, timedelta
from typing import Optional

import akshare as ak
import pandas as pd

from .market import norm_date
from .registry import err, json_safe, meta, ok, skill


def _code6(symbol: str) -> str:
    code = "".join(ch for ch in str(symbol) if ch.isdigit())[-6:]
    if len(code) != 6:
        raise ValueError(f"无法识别股票代码: {symbol}")
    return code


def _table_artifact(title: str, records: list[dict], note: str | None = None) -> dict:
    payload: dict = {"columns": list(records[0].keys()),
                     "rows": [[r.get(c) for c in records[0].keys()] for r in records]}
    if note:
        payload["note"] = note
    return {"kind": "table", "title": title, "payload": payload}


# ------------------------------------------------------- financials ------


@skill(
    "get_financial_abstract",
    "获取个股财务摘要（常用指标最近5期转置表：营收/净利润/ROE/毛利率/资产负债率等）。symbol 为6位代码。",
    {
        "type": "object",
        "properties": {"symbol": {"type": "string", "description": "6位股票代码"}},
        "required": ["symbol"],
    },
    internal=True,)
def get_financial_abstract(symbol: str) -> dict:
    try:
        code = _code6(symbol)
        df = ak.stock_financial_abstract(symbol=code)
        if df is None or len(df) == 0:
            return err(f"{code} 无财务摘要数据")
        date_cols = [c for c in df.columns if str(c).isdigit()][:5]  # 最近5期（新→旧）
        keep_indicators = [
            "归母净利润", "营业总收入", "净利润", "扣非净利润", "经营现金流量净额",
            "基本每股收益", "每股净资产", "净资产收益率(ROE)", "毛利率", "销售净利率",
            "资产负债率", "总资产报酬率(ROA)",
        ]
        sub = df[df["指标"].isin(keep_indicators)].drop_duplicates(subset=["指标"])
        sub = sub.set_index("指标").reindex([i for i in keep_indicators if i in set(sub["指标"])])
        periods_asc = sorted(date_cols)  # 旧→新，便于阅读
        records = []
        for ind, row in sub.iterrows():
            rec = {"指标": ind}
            for p in periods_asc:
                rec[p] = json_safe(row.get(p))
            records.append(rec)
        if not records:
            return err(f"{code} 财务摘要缺少常用指标")
        return ok(
            records,
            meta("akshare.stock_financial_abstract", len(records)),
            artifact=_table_artifact(f"{code} 财务摘要（最近 {len(periods_asc)} 期）", records,
                                     note="报告期格式 YYYYMMDD"),
        )
    except Exception as e:  # noqa: BLE001
        return err(f"财务摘要获取失败: {type(e).__name__}: {e}")


@skill(
    "get_financial_indicator",
    "获取个股财务指标时间序列（12个核心列：EPS/ROE/净利率/毛利率/资产负债率/增长率等），按年度。",
    {
        "type": "object",
        "properties": {
            "symbol": {"type": "string", "description": "6位股票代码"},
            "start_year": {"type": "string", "description": "起始年份，如 2022，默认两年前"},
        },
        "required": ["symbol"],
    },
    internal=True,)
def get_financial_indicator(symbol: str, start_year: Optional[str] = None) -> dict:
    try:
        code = _code6(symbol)
        start_year = (start_year or str(date.today().year - 2))[:4]
        df = ak.stock_financial_analysis_indicator(symbol=code, start_year=start_year)
        if df is None or len(df) == 0:
            return err(f"{code} 自 {start_year} 起无财务指标数据")
        core = ["日期", "摊薄每股收益(元)", "每股净资产_调整后(元)", "每股经营性现金流(元)",
                "净资产收益率(%)", "销售净利率(%)", "销售毛利率(%)", "主营业务利润率(%)",
                "资产负债率(%)", "流动比率", "主营业务收入增长率(%)", "净利润增长率(%)"]
        cols = [c for c in core if c in df.columns]
        df = df[cols].copy()
        df["日期"] = df["日期"].astype(str).str[:10]
        df = df.sort_values("日期")
        if len(df) > 24:
            df = df.tail(24)
        records = json_safe(df.to_dict(orient="records"))
        return ok(
            records,
            meta("akshare.stock_financial_analysis_indicator", len(records)),
            artifact=_table_artifact(f"{code} 财务指标（{start_year} 起）", records),
        )
    except Exception as e:  # noqa: BLE001
        return err(f"财务指标获取失败: {type(e).__name__}: {e}")


@skill(
    "get_research_reports",
    "获取个股最近券商研报与评级（机构、评级、盈利预测、报告链接），限10条。",
    {
        "type": "object",
        "properties": {"symbol": {"type": "string", "description": "6位股票代码"}},
        "required": ["symbol"],
    },
    internal=True,)
def get_research_reports(symbol: str) -> dict:
    try:
        code = _code6(symbol)
        df = ak.stock_research_report_em(symbol=code)
        if df is None or len(df) == 0:
            return ok([], meta("akshare.stock_research_report_em", 0)) | {"note": f"{code} 近期无研报"}
        df = df.head(10)
        eps_cols = [c for c in df.columns if "盈利预测" in c]
        keep = ["日期", "机构", "报告名称", "东财评级"] + eps_cols[:4] + ["报告PDF链接"]
        keep = [c for c in keep if c in df.columns]
        records = json_safe(df[keep].to_dict(orient="records"))
        return ok(
            records,
            meta("akshare.stock_research_report_em", len(records)),
            artifact=_table_artifact(f"{code} 券商研报评级（{len(records)} 条）", records),
        )
    except Exception as e:  # noqa: BLE001
        return err(f"研报获取失败: {type(e).__name__}: {e}")


# ------------------------------------------------------ market micro ------


@skill(
    "get_lhb",
    "获取龙虎榜明细（代码/名称/上榜日/收盘价/涨跌幅/净买额/上榜原因/换手率），限30条。",
    {
        "type": "object",
        "properties": {
            "start_date": {"type": "string", "description": "YYYYMMDD，默认7天前"},
            "end_date": {"type": "string", "description": "YYYYMMDD，默认今天"},
        },
        "required": [],
    },
    internal=True,)
def get_lhb(start_date: Optional[str] = None, end_date: Optional[str] = None) -> dict:
    try:
        end8 = norm_date(end_date, date.today())
        start8 = norm_date(start_date, date.today() - timedelta(days=7))
        df = ak.stock_lhb_detail_em(start_date=start8, end_date=end8)
        if df is None or len(df) == 0:
            return ok([], meta("akshare.stock_lhb_detail_em", 0)) | {
                "note": f"{start8}~{end8} 无龙虎榜数据"}
        df = df.head(30)
        keep = ["代码", "名称", "上榜日", "收盘价", "涨跌幅", "龙虎榜净买额", "龙虎榜成交额",
                "换手率", "上榜原因"]
        keep = [c for c in keep if c in df.columns]
        records = json_safe(df[keep].to_dict(orient="records"))
        return ok(
            records,
            meta("akshare.stock_lhb_detail_em", len(records)),
            artifact=_table_artifact(f"龙虎榜（{start8}~{end8}，{len(records)} 条）", records),
        )
    except Exception as e:  # noqa: BLE001
        return err(f"龙虎榜获取失败: {type(e).__name__}: {e}")


@skill(
    "get_margin",
    "获取上交所融资融券汇总（融资余额/融资买入额/融券余量/两融余额 按日）。",
    {
        "type": "object",
        "properties": {
            "start_date": {"type": "string", "description": "YYYYMMDD，默认14天前"},
            "end_date": {"type": "string", "description": "YYYYMMDD，默认今天"},
        },
        "required": [],
    },
    internal=True,)
def get_margin(start_date: Optional[str] = None, end_date: Optional[str] = None) -> dict:
    try:
        end8 = norm_date(end_date, date.today())
        start8 = norm_date(start_date, date.today() - timedelta(days=14))
        df = ak.stock_margin_sse(start_date=start8, end_date=end8)
        if df is None or len(df) == 0:
            return ok([], meta("akshare.stock_margin_sse", 0)) | {
                "note": f"{start8}~{end8} 无融资融券数据"}
        df = df.sort_values("信用交易日期")
        if len(df) > 30:
            df = df.tail(30)
        records = json_safe(df.to_dict(orient="records"))
        return ok(
            records,
            meta("akshare.stock_margin_sse", len(records)),
            artifact=_table_artifact(f"融资融券（{start8}~{end8}）", records),
        )
    except Exception as e:  # noqa: BLE001
        return err(f"融资融券获取失败: {type(e).__name__}: {e}")


# ---------------------------------------------------------------- macro ----


@skill(
    "get_macro",
    "获取宏观指标近24期：cpi/ppi/pmi/gdp/bond_yield（10年期国债收益率）。",
    {
        "type": "object",
        "properties": {
            "indicator": {"type": "string", "enum": ["cpi", "ppi", "pmi", "gdp", "bond_yield"],
                          "description": "指标类型"},
        },
        "required": ["indicator"],
    },
    internal=True,)
def get_macro(indicator: str) -> dict:
    try:
        ind = (indicator or "").strip().lower()
        if ind == "cpi":
            df = ak.macro_china_cpi().tail(24)
            xcol, series = "月份", [("全国-同比增长", "CPI 同比(%)"), ("全国-环比增长", "CPI 环比(%)")]
            source = "akshare.macro_china_cpi"
            title = "中国 CPI（近24月）"
        elif ind == "ppi":
            df = ak.macro_china_ppi().tail(24)
            xcol, series = "月份", [("当月同比增长", "PPI 同比(%)")]
            source = "akshare.macro_china_ppi"
            title = "中国 PPI（近24月）"
        elif ind == "pmi":
            df = ak.macro_china_pmi().tail(24)
            xcol, series = "月份", [("制造业-指数", "制造业PMI"), ("非制造业-指数", "非制造业PMI")]
            source = "akshare.macro_china_pmi"
            title = "中国 PMI（近24月）"
        elif ind == "gdp":
            df = ak.macro_china_gdp().tail(24)
            xcol, series = "季度", [("国内生产总值-同比增长", "GDP 同比(%)")]
            source = "akshare.macro_china_gdp"
            title = "中国 GDP 同比（近24季）"
        elif ind == "bond_yield":
            end8 = date.today().strftime("%Y%m%d")
            df = None
            # akshare 该接口对超长区间返回空，350 天窗口实测可用；失败再退 60 天
            for days in (350, 60):
                start8 = (date.today() - timedelta(days=days)).strftime("%Y%m%d")
                tmp = ak.bond_china_yield(start_date=start8, end_date=end8)
                if tmp is not None and len(tmp) > 0:
                    df = tmp
                    break
            if df is not None and "曲线名称" in df.columns:
                gb = df[df["曲线名称"].astype(str).str.contains("国债")]
                if len(gb) > 0:
                    df = gb
            if df is not None and len(df) > 0:
                df = df.sort_values("日期").tail(24)
            xcol, series = "日期", [("10年", "10年期国债收益率(%)"), ("1年", "1年期国债收益率(%)")]
            source = "akshare.bond_china_yield"
            title = "中债国债收益率（近24期）"
        else:
            return err(f"未知宏观指标: {indicator}（可选 cpi/ppi/pmi/gdp/bond_yield）")
        if df is None or len(df) == 0:
            return err(f"宏观指标 {indicator} 无数据")
        df[xcol] = df[xcol].astype(str)
        records = []
        for _, r in df.iterrows():
            rec = {"期间": r[xcol]}
            for col, label in series:
                if col in df.columns:
                    rec[label] = json_safe(r[col])
            records.append(rec)
        line = {
            "kind": "line",
            "title": title,
            "payload": {
                "x": df[xcol].tolist(),
                "series": [{"name": label, "data": [json_safe(v) for v in df[col].tolist()]}
                           for col, label in series if col in df.columns],
                "yname": "%",
            },
        }
        return ok(records, meta(source, len(records)), artifact=line)
    except Exception as e:  # noqa: BLE001
        return err(f"宏观指标获取失败: {type(e).__name__}: {e}")
