"""Market data skills: search_stock / get_stock_daily / get_index_daily /
get_sector_spot / get_current_date (design.md §2/§4).

Only whitelisted data sources are used:
  - sina suggest API for code search (NOT akshare)
  - akshare.stock_zh_a_daily (sina) with fallback akshare.stock_zh_a_hist_tx (tencent)
  - akshare.stock_zh_index_daily / akshare.stock_sector_spot
  - akshare.stock_us_daily (东方财富) for US-listed tickers (AAPL/TSLA/...)
"""
from __future__ import annotations

import re
from datetime import date, datetime, timedelta
from typing import Optional

import akshare as ak
import pandas as pd
import requests

from .registry import err, meta, ok, skill

# ------------------------------------------------------------ helpers ------


# 美股代码：以字母开头、1~5 字符，可含 . / -（如 AAPL / BRK.B / RDS-A）
US_SYMBOL_RE = re.compile(r"^[A-Za-z][A-Za-z0-9.\-]{0,5}$")


def is_us_symbol(symbol: str) -> bool:
    """判断是否为美股字母代码（AAPL/TSLA/NVDA/BRK.B 等）。纯数字或 sh/sz/bj 前缀视为 A 股。"""
    s = (symbol or "").strip()
    if not s or s.isdigit():
        return False
    return bool(US_SYMBOL_RE.match(s))


def norm_us_symbol(symbol: str) -> str:
    return (symbol or "").strip().upper()


def norm_symbol(symbol: str) -> str:
    """Normalize user/LLM supplied code to sina format, e.g. sh600519 / sz300750."""
    s = (symbol or "").strip().lower()
    if not s:
        raise ValueError("股票代码为空")
    m = re.match(r"^(sh|sz|bj)(\d{6})$", s)
    if m:
        return m.group(1) + m.group(2)
    m = re.match(r"^(\d{6})\.(sh|sz|bj)$", s)
    if m:
        return m.group(2) + m.group(1)
    m = re.search(r"(\d{6})", s)
    if m:
        code = m.group(1)
        if code[0] in ("6", "9"):
            return "sh" + code
        if code[0] in ("4", "8"):
            return "bj" + code
        return "sz" + code
    raise ValueError(f"无法识别股票代码: {symbol}")


def norm_index_symbol(symbol: str) -> str:
    s = (symbol or "").strip().lower()
    if re.match(r"^(sh|sz)\d{6}$", s):
        return s
    m = re.search(r"(\d{6})", s)
    if m:
        code = m.group(1)
        return ("sh" if code.startswith(("0", "9")) else "sz") + code
    raise ValueError(f"无法识别指数代码: {symbol}")


def norm_date(s: Optional[str], default: Optional[date] = None) -> str:
    """Accept YYYYMMDD / YYYY-MM-DD / ISO datetime -> YYYYMMDD."""
    if not s:
        d = default or date.today()
        return d.strftime("%Y%m%d")
    s = str(s).strip()
    m = re.match(r"^(\d{4})-?(\d{2})-?(\d{2})", s)
    if m:
        return "".join(m.groups())
    raise ValueError(f"无法识别日期: {s}")


def _d8_to_iso(d8: str) -> str:
    return f"{d8[:4]}-{d8[4:6]}-{d8[6:]}"


def _clean_ohlcv(df: pd.DataFrame, limit: int = 250) -> tuple[pd.DataFrame, bool]:
    """Normalize a daily-kline df to date/open/close/high/low/volume sorted asc."""
    col_map = {}
    for c in df.columns:
        cl = str(c).lower()
        if cl in ("date", "日期"):
            col_map[c] = "date"
        elif cl in ("open", "开盘"):
            col_map[c] = "open"
        elif cl in ("close", "收盘"):
            col_map[c] = "close"
        elif cl in ("high", "最高"):
            col_map[c] = "high"
        elif cl in ("low", "最低"):
            col_map[c] = "low"
        elif cl in ("volume", "成交量"):
            col_map[c] = "volume"
    df = df.rename(columns=col_map)
    keep = [c for c in ("date", "open", "close", "high", "low", "volume") if c in df.columns]
    df = df[keep].copy()
    if "volume" not in df.columns:
        df["volume"] = 0
    df["date"] = df["date"].astype(str).str[:10]
    for c in ("open", "close", "high", "low", "volume"):
        df[c] = pd.to_numeric(df[c], errors="coerce")
    df = df.dropna(subset=["close"]).sort_values("date").reset_index(drop=True)
    truncated = False
    if len(df) > limit:
        df = df.tail(limit).reset_index(drop=True)
        truncated = True
    return df, truncated


# ------------------------------------------------------------- skills ------


@skill(
    "search_stock",
    "按名称/拼音/代码搜索A股股票，返回前5个匹配（名称、6位代码、sina格式symbol）。不知道股票代码时先用它。",
    {
        "type": "object",
        "properties": {"keyword": {"type": "string", "description": "股票名称、简称或代码片段"}},
        "required": ["keyword"],
    },
)
def search_stock(keyword: str) -> dict:
    try:
        resp = requests.get(
            "https://suggest3.sinajs.cn/suggest/type=11,12&key={}&name=suggestdata".format(
                requests.utils.quote(keyword)
            ),
            headers={"User-Agent": "Mozilla/5.0", "Referer": "https://finance.sina.com.cn"},
            timeout=10,
        )
        resp.encoding = "gbk"
        text = resp.text
        m = re.search(r'"(.*)"', text)
        body = m.group(1) if m else ""
        items = []
        for entry in body.split(";"):
            entry = entry.strip()
            if not entry:
                continue
            parts = entry.split(",")
            if len(parts) >= 4 and parts[1] in ("11", "12") and re.match(r"^\d{6}$", parts[2]):
                items.append({"name": parts[0], "code": parts[2], "symbol": parts[3]})
            if len(items) >= 5:
                break
        if not items:
            return ok([], meta("sina.suggest3", 0), artifact=None) | {"note": "未找到匹配股票"}
        return ok(items, meta("sina.suggest3", len(items)))
    except Exception as e:  # noqa: BLE001
        return err(f"股票搜索失败: {type(e).__name__}: {e}")


@skill(
    "get_stock_daily",
    "获取个股日K线（OHLC+成交量），返回最近至多250个交易日。自动识别市场：A 股 600519 / sh600519；美股字母代码 AAPL/TSLA/NVDA 等。",
    {
        "type": "object",
        "properties": {
            "symbol": {"type": "string", "description": "股票代码：A 股如 600519 / sh600519；美股如 AAPL"},
            "start_date": {"type": "string", "description": "YYYYMMDD 或 YYYY-MM-DD，美股忽略（接口返回全历史）"},
            "end_date": {"type": "string", "description": "YYYYMMDD 或 YYYY-MM-DD，美股忽略"},
            "adjust": {"type": "string", "enum": ["qfq", "hfq", ""], "description": "复权方式，默认 qfq"},
        },
        "required": ["symbol"],
    },
)
def get_stock_daily(symbol: str, start_date: Optional[str] = None,
                    end_date: Optional[str] = None, adjust: str = "qfq") -> dict:
    # 美股字母代码 → 转交美股 skill
    if is_us_symbol(symbol):
        return get_us_stock_daily(symbol, start_date, end_date, adjust)
    try:
        sym = norm_symbol(symbol)
        end8 = norm_date(end_date, date.today())
        start8 = norm_date(start_date, date.today() - timedelta(days=365))
        adjust = adjust if adjust in ("qfq", "hfq") else ""
        source = "akshare.stock_zh_a_daily"
        try:
            df = ak.stock_zh_a_daily(symbol=sym, start_date=start8, end_date=end8, adjust=adjust)
            if df is None or len(df) == 0:
                raise ValueError("sina 日K返回空数据")
        except Exception as e1:  # noqa: BLE001
            # fallback: 腾讯日K（无成交量列）
            try:
                df = ak.stock_zh_a_hist_tx(symbol=sym, start_date=start8, end_date=end8, adjust=adjust)
                source = "akshare.stock_zh_a_hist_tx"
                if df is None or len(df) == 0:
                    return err(f"{sym} 在 {start8}~{end8} 无日K数据（sina/腾讯均为空）")
            except Exception as e2:  # noqa: BLE001
                return err(f"日K获取失败: sina({type(e1).__name__}: {e1}); tx({type(e2).__name__}: {e2})")
        df, truncated = _clean_ohlcv(df, limit=250)
        records = df.to_dict(orient="records")
        artifact = {
            "kind": "kline",
            "title": f"{sym.upper()} 日K线（{_d8_to_iso(start8)}~{_d8_to_iso(end8)}）",
            "payload": {
                "symbol": sym,
                "dates": df["date"].tolist(),
                "ohlc": [[r["open"], r["close"], r["low"], r["high"]] for r in records],
                "volumes": [r["volume"] for r in records],
            },
        }
        m = meta(source, len(df))
        if truncated:
            m["note"] = "仅保留最近 250 行"
        return ok(records, m, artifact=artifact)
    except Exception as e:  # noqa: BLE001
        return err(f"日K获取失败: {type(e).__name__}: {e}")


@skill(
    "get_us_stock_daily",
    "获取美股个股日K线（OHLC+成交量），symbol 为字母代码如 AAPL/TSLA/NVDA/BRK.B。",
    {
        "type": "object",
        "properties": {
            "symbol": {"type": "string", "description": "美股代码，如 AAPL / TSLA"},
            "adjust": {"type": "string", "enum": ["qfq", "hfq", ""], "description": "复权方式，默认 qfq"},
        },
        "required": ["symbol"],
    },
)
def get_us_stock_daily(symbol: str, start_date: Optional[str] = None,
                       end_date: Optional[str] = None, adjust: str = "qfq") -> dict:
    """美股日K（akshare.stock_us_daily 东方财富源）。start_date/end_date 接口不支持，按返回全量截取。"""
    try:
        sym = norm_us_symbol(symbol)
        adjust = adjust if adjust in ("qfq", "hfq") else "qfq"
        df = ak.stock_us_daily(symbol=sym, adjust=adjust)
        if df is None or len(df) == 0:
            return err(f"美股 {sym} 无日K数据")
        # 标准化列：date / open / close / high / low / volume
        col_map = {}
        for c in df.columns:
            cl = str(c).lower()
            if cl in ("date", "日期"):
                col_map[c] = "date"
            elif cl in ("open", "开盘"):
                col_map[c] = "open"
            elif cl in ("close", "收盘"):
                col_map[c] = "close"
            elif cl in ("high", "最高"):
                col_map[c] = "high"
            elif cl in ("low", "最低"):
                col_map[c] = "low"
            elif cl in ("volume", "成交量"):
                col_map[c] = "volume"
        df = df.rename(columns=col_map)
        if "volume" not in df.columns:
            df["volume"] = 0
        df["date"] = df["date"].astype(str).str[:10]
        for c in ("open", "close", "high", "low", "volume"):
            df[c] = pd.to_numeric(df[c], errors="coerce")
        df = df.dropna(subset=["close"]).sort_values("date").reset_index(drop=True)
        truncated = False
        if len(df) > 250:
            df = df.tail(250).reset_index(drop=True)
            truncated = True
        records = df.to_dict(orient="records")
        start_iso = df["date"].iloc[0] if len(df) else ""
        end_iso = df["date"].iloc[-1] if len(df) else ""
        artifact = {
            "kind": "kline",
            "title": f"{sym} 美股日K线（{start_iso} ~ {end_iso}）",
            "payload": {
                "symbol": sym,
                "dates": df["date"].tolist(),
                "ohlc": [[r["open"], r["close"], r["low"], r["high"]] for r in records],
                "volumes": [r["volume"] for r in records],
            },
        }
        m = meta("akshare.stock_us_daily", len(df))
        if truncated:
            m["note"] = "仅保留最近 250 行"
        return ok(records, m, artifact=artifact)
    except Exception as e:  # noqa: BLE001
        return err(f"美股日K获取失败: {type(e).__name__}: {e}")


@skill(
    "get_index_daily",
    "获取指数日K收盘价序列，symbol 支持 sh000001(上证)/sh000300(沪深300)/sz399001(深成指)/sz399006(创业板指)。",
    {
        "type": "object",
        "properties": {
            "symbol": {"type": "string", "description": "指数代码，如 sh000300"},
            "start_date": {"type": "string", "description": "默认一年前"},
            "end_date": {"type": "string", "description": "默认今天"},
        },
        "required": ["symbol"],
    },
)
def get_index_daily(symbol: str, start_date: Optional[str] = None,
                    end_date: Optional[str] = None) -> dict:
    try:
        sym = norm_index_symbol(symbol)
        start_iso = _d8_to_iso(norm_date(start_date, date.today() - timedelta(days=365)))
        end_iso = _d8_to_iso(norm_date(end_date, date.today()))
        df = ak.stock_zh_index_daily(symbol=sym)
        if df is None or len(df) == 0:
            return err(f"指数 {sym} 无数据")
        df = df.rename(columns={"date": "date"})
        df["date"] = df["date"].astype(str).str[:10]
        df = df[(df["date"] >= start_iso) & (df["date"] <= end_iso)]
        if len(df) == 0:
            return err(f"指数 {sym} 在 {start_iso}~{end_iso} 无数据")
        if len(df) > 250:
            df = df.tail(250)
        df["close"] = pd.to_numeric(df["close"], errors="coerce")
        df = df.dropna(subset=["close"])
        records = df[["date", "open", "high", "low", "close", "volume"]].to_dict(orient="records")
        artifact = {
            "kind": "line",
            "title": f"{sym.upper()} 指数走势（{start_iso}~{end_iso}）",
            "payload": {
                "x": df["date"].tolist(),
                "series": [{"name": f"{sym.upper()} 收盘", "data": df["close"].tolist()}],
                "yname": "点位",
            },
        }
        return ok(records, meta("akshare.stock_zh_index_daily", len(df)), artifact=artifact)
    except Exception as e:  # noqa: BLE001
        return err(f"指数日K获取失败: {type(e).__name__}: {e}")


@skill(
    "get_sector_spot",
    "获取新浪行业板块实时快照（板块、公司数、平均价、涨跌幅、总成交额、领涨股）。",
    {"type": "object", "properties": {}, "required": []},
)
def get_sector_spot() -> dict:
    try:
        df = ak.stock_sector_spot(indicator="新浪行业")
        if df is None or len(df) == 0:
            return err("行业板块快照为空")
        df = df.sort_values("涨跌幅", ascending=False).head(40)
        records = []
        for _, r in df.iterrows():
            records.append({
                "板块": r.get("板块"),
                "公司家数": r.get("公司家数"),
                "平均价格": r.get("平均价格"),
                "涨跌幅(%)": r.get("涨跌幅"),
                "总成交额": r.get("总成交额"),
                "领涨股": r.get("股票名称"),
                "领涨股涨跌幅(%)": r.get("个股-涨跌幅"),
            })
        artifact = {
            "kind": "table",
            "title": "新浪行业板块快照（按涨跌幅排序，前40）",
            "payload": {
                "columns": list(records[0].keys()),
                "rows": [[rec[c] for c in rec] for rec in records],
            },
        }
        return ok(records, meta("akshare.stock_sector_spot(新浪行业)", len(records)), artifact=artifact)
    except Exception as e:  # noqa: BLE001
        return err(f"行业板块快照获取失败: {type(e).__name__}: {e}")


@skill(
    "get_current_date",
    "返回服务器当前日期与时间（用于对齐「最近/今天」等相对时间表述）。",
    {"type": "object", "properties": {}, "required": []},
)
def get_current_date() -> dict:
    now = datetime.now().astimezone()
    weekdays = "一二三四五六日"
    return ok(
        {
            "date": now.date().isoformat(),
            "datetime": now.isoformat(timespec="seconds"),
            "weekday": f"星期{weekdays[now.weekday()]}",
        },
        meta("server.clock", 1),
    )
