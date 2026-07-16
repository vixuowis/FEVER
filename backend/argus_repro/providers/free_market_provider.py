from __future__ import annotations

import asyncio
import json
import math
import re
import time
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from ..core.utils import write_json

try:
    import akshare as ak
except Exception:  # noqa: BLE001
    ak = None


SUPPORTED_MARKETS = {"Global", "US", "EU", "Asia"}
_CACHE_TTL_SECONDS = 300
_PROVIDER_DIR = Path(__file__).resolve().parent
_SNAPSHOT_DIR = Path(__file__).resolve().parents[2] / "data" / "free_market_snapshots"
_SEED_EVENTS_PATH = _PROVIDER_DIR / "free_market_seed_events.json"


@dataclass(frozen=True)
class FreeMarketEvent:
    title: str
    desc: str
    assets: list[str]
    baseFever: float
    sourceUrl: str
    market: str
    timestamp: str
    provider: str = "akshare"
    raw: dict[str, Any] | None = None

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, payload: dict[str, Any], *, market: str) -> "FreeMarketEvent":
        return cls(
            title=str(payload.get("title") or "").strip(),
            desc=str(payload.get("desc") or "").strip(),
            assets=[str(item).strip() for item in payload.get("assets", []) if str(item).strip()],
            baseFever=float(payload.get("baseFever") or 60.0),
            sourceUrl=str(payload.get("sourceUrl") or "").strip(),
            market=str(payload.get("market") or market).strip() or market,
            timestamp=_safe_timestamp(payload.get("timestamp")),
            provider=str(payload.get("provider") or "free_snapshot").strip() or "free_snapshot",
            raw=payload.get("raw") if isinstance(payload.get("raw"), dict) else None,
        )


class FreeMarketProvider:
    def __init__(self, ttl_seconds: int = _CACHE_TTL_SECONDS):
        self.ttl_seconds = ttl_seconds
        self._cache: dict[str, tuple[float, list[FreeMarketEvent]]] = {}
        self._cursor: dict[str, int] = {}
        self._seed_events = _load_seed_events()

    async def get_event(self, market: str) -> dict[str, Any]:
        events = await self.get_events(market, limit=6)
        if not events:
            raise RuntimeError("No free market events are available")
        previous_pick = self._cursor.get(market)
        if previous_pick is None:
            pick = int(time.time()) % len(events)
        else:
            pick = (previous_pick + 1) % len(events)
        self._cursor[market] = pick
        return events[pick].to_dict()

    async def get_events(self, market: str, *, limit: int = 6) -> list[FreeMarketEvent]:
        canonical_market = canonical_market_name(market)
        now = time.time()
        cached = self._cache.get(canonical_market)
        if cached and now - cached[0] < self.ttl_seconds:
            return cached[1][:limit]
        try:
            events = await asyncio.to_thread(self._build_events, canonical_market)
            self._cache[canonical_market] = (now, events)
            self._save_snapshot(canonical_market, events)
            return events[:limit]
        except Exception as exc:  # noqa: BLE001
            if cached and cached[1]:
                return cached[1][:limit]

            snapshot_events = self._load_snapshot(canonical_market)
            if snapshot_events:
                self._cache[canonical_market] = (now, snapshot_events)
                return snapshot_events[:limit]

            seed_events = self._seed_events.get(canonical_market, [])
            if seed_events:
                self._cache[canonical_market] = (now, seed_events)
                return seed_events[:limit]

            raise RuntimeError(f"AKShare free market feed is unavailable: {exc}") from exc

    def _build_events(self, market: str) -> list[FreeMarketEvent]:
        if ak is None:
            raise RuntimeError("AKShare is not installed. Run `pip install -r backend/requirements.txt` first.")

        events: list[FreeMarketEvent] = []
        errors: list[str] = []

        try:
            events.extend(self._macro_events(market))
        except Exception as exc:  # noqa: BLE001
            errors.append(f"macro:{exc}")

        try:
            events.extend(self._fund_flow_events(market))
        except Exception as exc:  # noqa: BLE001
            errors.append(f"fund_flow:{exc}")

        try:
            events.extend(self._etf_events(market))
        except Exception as exc:  # noqa: BLE001
            errors.append(f"etf:{exc}")

        try:
            events.extend(self._theme_fund_events(market))
        except Exception as exc:  # noqa: BLE001
            errors.append(f"theme_fund:{exc}")

        if market in {"Global", "Asia"}:
            try:
                events.extend(self._stock_hot_events(market))
            except Exception as exc:  # noqa: BLE001
                errors.append(f"stock_hot:{exc}")

        deduped: list[FreeMarketEvent] = []
        seen_titles: set[str] = set()
        for event in _mix_events(events):
            title_key = event.title.strip()
            if not title_key or title_key in seen_titles:
                continue
            seen_titles.add(title_key)
            deduped.append(event)

        if deduped:
            return deduped

        detail = "; ".join(errors) if errors else "unknown_error"
        raise RuntimeError(f"AKShare free market feed is unavailable: {detail}")

    def _snapshot_path(self, market: str) -> Path:
        return _SNAPSHOT_DIR / f"{canonical_market_name(market).lower()}.json"

    def _save_snapshot(self, market: str, events: list[FreeMarketEvent]) -> None:
        payload = {
            "market": market,
            "saved_at": datetime.now(timezone.utc).isoformat(),
            "events": [event.to_dict() for event in events],
        }
        write_json(self._snapshot_path(market), payload)

    def _load_snapshot(self, market: str) -> list[FreeMarketEvent]:
        path = self._snapshot_path(market)
        if not path.exists():
            return []
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            return []
        rows = payload.get("events")
        if not isinstance(rows, list):
            return []
        return _deserialize_event_rows(rows, market=market)

    def _macro_events(self, market: str) -> list[FreeMarketEvent]:
        df = ak.news_economic_baidu()
        if df is None or df.empty:
            return []

        region_keywords = _region_keywords(market)
        candidates: list[FreeMarketEvent] = []
        for row in df.to_dict(orient="records"):
            region = str(row.get("地区") or "").strip()
            if region_keywords and not any(keyword in region for keyword in region_keywords):
                continue
            event_name = str(row.get("事件") or "").strip()
            if not event_name:
                continue
            actual = _display_value(row.get("公布"))
            forecast = _display_value(row.get("预期"))
            previous = _display_value(row.get("前值"))
            importance = _importance_score(row.get("重要性"))
            fever = min(95.0, max(56.0, 52.0 + importance * 8.0))
            title = f"{region or market}宏观日历异动: {event_name}"
            desc = (
                f"{region or market}宏观日历出现高频催化，事件为「{event_name}」。"
                f"公布值 {actual}，预期 {forecast}，前值 {previous}。"
                "系统将其作为免费宏观信号输入，用于驱动后续事件追踪。"
            )
            when = _event_timestamp(row.get("日期"), row.get("时间"))
            candidates.append(
                FreeMarketEvent(
                    title=title,
                    desc=desc,
                    assets=_macro_assets(region, event_name, market),
                    baseFever=round(fever, 1),
                    sourceUrl="https://finance.pae.baidu.com/",
                    market=market,
                    timestamp=when,
                    provider="akshare_macro",
                    raw={
                        "source": "news_economic_baidu",
                        "region": region,
                        "event": event_name,
                        "actual": actual,
                        "forecast": forecast,
                        "previous": previous,
                        "importance": row.get("重要性"),
                    },
                )
            )
        events: list[FreeMarketEvent] = []
        seen_topics: set[str] = set()
        region_counts: dict[str, int] = {}
        for event in sorted(candidates, key=lambda item: item.baseFever, reverse=True):
            raw = event.raw or {}
            region = str(raw.get("region") or event.market).strip() or event.market
            event_name = str(raw.get("event") or event.title).strip()
            topic = _macro_topic_key(region, event_name)
            if topic in seen_topics:
                continue
            if region_counts.get(region, 0) >= 2:
                continue
            seen_topics.add(topic)
            region_counts[region] = region_counts.get(region, 0) + 1
            events.append(event)
            if len(events) >= 8:
                break
        return events

    def _fund_flow_events(self, market: str) -> list[FreeMarketEvent]:
        if market not in {"Asia", "Global"}:
            return []

        df = ak.stock_hsgt_fund_flow_summary_em()
        if df is None or df.empty:
            return []

        events: list[FreeMarketEvent] = []
        for row in df.to_dict(orient="records"):
            board = str(row.get("板块") or "").strip()
            index_name = str(row.get("相关指数") or "").strip()
            flow_direction = str(row.get("资金方向") or "").strip() or "资金"
            if market == "Asia" and not any(keyword in f"{board}{index_name}" for keyword in ("沪", "深", "港", "恒生")):
                continue

            net_buy = _float_value(row.get("成交净买额")) or 0.0
            net_inflow = _float_value(row.get("资金净流入")) or 0.0
            index_change = _float_value(row.get("指数涨跌幅")) or 0.0
            advancers = int(_float_value(row.get("上涨数")) or 0)
            decliners = int(_float_value(row.get("下跌数")) or 0)
            fever = min(92.0, max(60.0, 58.0 + abs(index_change) * 4.0 + min(abs(net_buy), 30.0)))
            title = f"{board}{flow_direction}资金异动"
            desc = (
                f"{board}{flow_direction}成交净买额 {net_buy:.1f} 亿元，资金净流入 {net_inflow:.1f} 亿元，"
                f"{index_name or '相关指数'} {index_change:+.2f}%，上涨 {advancers} 家，下跌 {decliners} 家。"
            )
            events.append(
                FreeMarketEvent(
                    title=title,
                    desc=desc,
                    assets=_flow_assets(board, index_name, market),
                    baseFever=round(fever, 1),
                    sourceUrl="https://data.eastmoney.com/hsgtcg/",
                    market=market,
                    timestamp=_safe_timestamp(row.get("交易日")),
                    provider="akshare_fund_flow",
                    raw={
                        "source": "stock_hsgt_fund_flow_summary_em",
                        "board": board,
                        "direction": flow_direction,
                        "index_name": index_name,
                        "net_buy": net_buy,
                        "net_inflow": net_inflow,
                        "index_change_pct": index_change,
                    },
                )
            )
            if len(events) >= 4:
                break
        return events

    def _etf_events(self, market: str) -> list[FreeMarketEvent]:
        df = ak.fund_etf_spot_em()
        if df is None or df.empty:
            return []

        rows = sorted(
            df.to_dict(orient="records"),
            key=lambda row: (
                abs(_float_value(row.get("涨跌幅")) or 0.0) * 3.0
                + min(25.0, (_float_value(row.get("成交额")) or 0.0) / 100000000.0)
            ),
            reverse=True,
        )

        events: list[FreeMarketEvent] = []
        for row in rows:
            name = str(row.get("名称") or "").strip()
            if not name or not _fund_name_matches_market(name, market):
                continue

            code = str(row.get("代码") or "").strip()
            latest = _float_value(row.get("最新价")) or 0.0
            change_pct = _float_value(row.get("涨跌幅")) or 0.0
            amount = (_float_value(row.get("成交额")) or 0.0) / 100000000.0
            main_flow = (_float_value(row.get("主力净流入-净额")) or 0.0) / 100000000.0
            direction = "走强" if change_pct >= 0 else "回落"
            fever = min(94.0, max(58.0, 57.0 + abs(change_pct) * 5.0 + min(16.0, amount)))
            desc = (
                f"{name} {direction}，涨跌幅 {change_pct:+.2f}%，成交额 {amount:.1f} 亿元，"
                f"主力净流入 {main_flow:+.1f} 亿元。"
            )
            events.append(
                FreeMarketEvent(
                    title=f"{name} {direction}",
                    desc=desc,
                    assets=_fund_assets(name, market, code),
                    baseFever=round(fever, 1),
                    sourceUrl="https://quote.eastmoney.com/center/gridlist.html#fund_etf",
                    market=market,
                    timestamp=_safe_timestamp(row.get("更新时间") or row.get("数据日期")),
                    provider="akshare_etf",
                    raw={
                        "source": "fund_etf_spot_em",
                        "code": code,
                        "name": name,
                        "latest": latest,
                        "change_pct": change_pct,
                        "amount_yi": amount,
                        "main_flow_yi": main_flow,
                    },
                )
            )
            if len(events) >= 6:
                break
        return events

    def _theme_fund_events(self, market: str) -> list[FreeMarketEvent]:
        df = ak.fund_exchange_rank_em()
        if df is None or df.empty:
            return []

        rows = sorted(
            df.to_dict(orient="records"),
            key=lambda row: abs(_float_value(row.get("近1月")) or _float_value(row.get("近3月")) or 0.0),
            reverse=True,
        )

        events: list[FreeMarketEvent] = []
        for row in rows:
            name = str(row.get("基金简称") or "").strip()
            if not name or not _fund_name_matches_market(name, market):
                continue

            one_month = _float_value(row.get("近1月"))
            three_month = _float_value(row.get("近3月"))
            score = one_month if one_month is not None else three_month if three_month is not None else 0.0
            if score is None:
                continue
            direction = "强势" if score >= 0 else "回撤"
            fever = min(88.0, max(55.0, 55.0 + min(28.0, abs(score) * 1.3)))
            desc = (
                f"{name} {direction}，近1月 { _format_pct(one_month) }，近3月 { _format_pct(three_month) }。"
            )
            events.append(
                FreeMarketEvent(
                    title=f"{name} {direction}",
                    desc=desc,
                    assets=_fund_assets(name, market, str(row.get("基金代码") or "").strip()),
                    baseFever=round(fever, 1),
                    sourceUrl="https://fund.eastmoney.com/data/fundranking.html",
                    market=market,
                    timestamp=_safe_timestamp(row.get("日期")),
                    provider="akshare_theme_fund",
                    raw={
                        "source": "fund_exchange_rank_em",
                        "code": str(row.get("基金代码") or "").strip(),
                        "name": name,
                        "one_month_pct": one_month,
                        "three_month_pct": three_month,
                    },
                )
            )
            if len(events) >= 4:
                break
        return events

    def _stock_hot_events(self, market: str) -> list[FreeMarketEvent]:
        df = ak.stock_hot_rank_em()
        if df is None or df.empty:
            return []

        events: list[FreeMarketEvent] = []
        for row in df.head(5).to_dict(orient="records"):
            code = _clean_stock_code(row.get("代码"))
            rank = _float_value(row.get("当前排名")) or 100.0
            name = str(row.get("股票名称") or code or "热门个股").strip()
            latest = _display_value(row.get("最新价"))
            change = _float_value(row.get("涨跌幅")) or 0.0
            rank_bonus = max(0.0, 18.0 - rank) * 1.8
            move_bonus = min(28.0, abs(change) * 2.2)
            fever = min(96.0, max(60.0, 58.0 + rank_bonus + move_bonus))
            news = self._stock_news_headline(code)
            headline = news.get("title") or f"{name} 跻身东方财富人气榜前列"
            desc = (
                f"{name} 当前位于东方财富人气榜前列，最新价 {latest}，涨跌幅 {change:.2f}%。"
                f"{news.get('summary') or '市场关注度显著抬升，适合作为亚洲市场免费事件源。'}"
            )
            source_url = news.get("url") or "https://guba.eastmoney.com/rank/"
            timestamp = news.get("published_at") or datetime.now(timezone.utc).isoformat()
            events.append(
                FreeMarketEvent(
                    title=headline,
                    desc=desc,
                    assets=[name, code, "A股"],
                    baseFever=round(fever, 1),
                    sourceUrl=source_url,
                    market=market,
                    timestamp=timestamp,
                    provider="akshare_stock_hot",
                    raw={
                        "source": "stock_hot_rank_em",
                        "rank": rank,
                        "code": code,
                        "name": name,
                        "latest": latest,
                        "change_pct": change,
                        "news": news,
                    },
                )
            )
        return events

    def _stock_news_headline(self, code: str) -> dict[str, Any]:
        if not code:
            return {}
        try:
            df = ak.stock_news_em(symbol=code)
        except Exception:  # noqa: BLE001
            return {}
        if df is None or df.empty:
            return {}
        row = df.head(1).to_dict(orient="records")[0]
        return {
            "title": str(row.get("新闻标题") or "").strip(),
            "summary": _compact_text(str(row.get("新闻内容") or "").strip(), limit=140),
            "published_at": _safe_timestamp(row.get("发布时间")),
            "url": str(row.get("新闻链接") or "").strip(),
            "source": str(row.get("文章来源") or "").strip(),
        }


def canonical_market_name(value: str | None) -> str:
    raw = (value or "Global").strip()
    lowered = raw.lower()
    aliases = {
        "global": "Global",
        "us": "US",
        "usa": "US",
        "eu": "EU",
        "europe": "EU",
        "asia": "Asia",
    }
    return aliases.get(lowered, raw if raw in SUPPORTED_MARKETS else "Global")


def _load_seed_events() -> dict[str, list[FreeMarketEvent]]:
    try:
        payload = json.loads(_SEED_EVENTS_PATH.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError):
        return {}

    out: dict[str, list[FreeMarketEvent]] = {}
    for market, rows in payload.items():
        if not isinstance(rows, list):
            continue
        canonical = canonical_market_name(market)
        out[canonical] = _deserialize_event_rows(rows, market=canonical)
    return out


def _deserialize_event_rows(rows: list[Any], *, market: str) -> list[FreeMarketEvent]:
    events: list[FreeMarketEvent] = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        try:
            event = FreeMarketEvent.from_dict(row, market=market)
        except (TypeError, ValueError):
            continue
        if event.title:
            events.append(event)
    return events


def _region_keywords(market: str) -> tuple[str, ...]:
    mapping = {
        "Global": (),
        "US": ("美国",),
        "EU": ("欧元区", "欧洲", "英国", "德国", "法国", "意大利", "西班牙", "瑞士"),
        "Asia": ("中国", "日本", "韩国", "新加坡", "印度", "亚洲", "香港"),
    }
    return mapping.get(market, ())


def _macro_assets(region: str, event_name: str, market: str) -> list[str]:
    text = f"{region} {event_name}"
    if any(keyword in text for keyword in ("利率", "国债", "收益率", "央行")):
        if "美国" in text:
            return ["美债收益率", "美元指数", "纳斯达克100"]
        if any(keyword in text for keyword in ("欧元区", "欧洲", "德国", "法国", "英国")):
            return ["欧元", "Euro Stoxx 50", "德国国债"]
        return ["国债", "汇率", "黄金"]
    if any(keyword in text for keyword in ("就业", "非农", "失业", "薪资")):
        return ["美元指数", "标普500", "黄金"]
    if any(keyword in text for keyword in ("通胀", "CPI", "PPI")):
        return ["黄金", "原油", "全球股指"]
    if any(keyword in text for keyword in ("GDP", "制造业", "PMI", "景气")):
        return ["股指期货", "工业金属", "离岸人民币"]
    defaults = {
        "US": ["标普500", "美元指数", "美债收益率"],
        "EU": ["欧元", "Euro Stoxx 50", "德国国债"],
        "Asia": ["沪深300", "恒生科技", "离岸人民币"],
        "Global": ["全球股指", "黄金", "美元指数"],
    }
    return defaults.get(market, defaults["Global"])


def _event_timestamp(date_value: Any, time_value: Any) -> str:
    date_text = str(date_value or "").strip()
    time_text = str(time_value or "").strip()
    if date_text and time_text:
        for fmt in ("%Y-%m-%d %H:%M", "%Y/%m/%d %H:%M"):
            try:
                return datetime.strptime(f"{date_text} {time_text}", fmt).replace(tzinfo=timezone.utc).isoformat()
            except ValueError:
                continue
    return datetime.now(timezone.utc).isoformat()


def _safe_timestamp(value: Any) -> str:
    text = str(value or "").strip()
    if not text:
        return datetime.now(timezone.utc).isoformat()
    try:
        return datetime.fromisoformat(text.replace("Z", "+00:00")).astimezone(timezone.utc).isoformat()
    except ValueError:
        pass
    for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M"):
        try:
            return datetime.strptime(text, fmt).replace(tzinfo=timezone.utc).isoformat()
        except ValueError:
            continue
    return datetime.now(timezone.utc).isoformat()


def _compact_text(text: str, *, limit: int) -> str:
    collapsed = re.sub(r"\s+", " ", text).strip()
    if len(collapsed) <= limit:
        return collapsed
    return collapsed[: max(0, limit - 1)].rstrip() + "…"


def _clean_stock_code(value: Any) -> str:
    text = str(value or "").strip().upper()
    matched = re.search(r"(\d{6})", text)
    return matched.group(1) if matched else text


def _display_value(value: Any) -> str:
    text = str(value if value is not None else "").strip()
    if not text or text.lower() == "nan":
        return "待公布"
    return text


def _float_value(value: Any) -> float | None:
    if value is None:
        return None
    if isinstance(value, (int, float)):
        if isinstance(value, float) and math.isnan(value):
            return None
        return float(value)
    text = str(value).strip().replace("%", "").replace(",", "")
    if not text or text.lower() == "nan":
        return None
    try:
        return float(text)
    except ValueError:
        return None


def _importance_score(value: Any) -> float:
    if value is None:
        return 1.0
    if isinstance(value, (int, float)):
        if isinstance(value, float) and math.isnan(value):
            return 1.0
        return max(1.0, float(value))
    text = str(value).strip()
    numeric = _float_value(text)
    if numeric is not None:
        return max(1.0, numeric)
    return float(max(1, text.count("★")))


def _provider_priority(provider: str) -> int:
    order = {
        "akshare_macro": 0,
        "akshare_fund_flow": 1,
        "akshare_etf": 2,
        "akshare_stock_hot": 3,
        "akshare_theme_fund": 4,
        "free_snapshot": 5,
    }
    return order.get(provider, 99)


def _mix_events(events: list[FreeMarketEvent]) -> list[FreeMarketEvent]:
    grouped: dict[str, list[FreeMarketEvent]] = {}
    for event in events:
        grouped.setdefault(event.provider, []).append(event)

    for rows in grouped.values():
        rows.sort(key=lambda item: (item.baseFever, item.timestamp), reverse=True)

    ordered: list[FreeMarketEvent] = []
    providers = sorted(grouped.keys(), key=_provider_priority)
    while any(grouped[provider] for provider in providers):
        for provider in providers:
            if grouped[provider]:
                ordered.append(grouped[provider].pop(0))
    return ordered


def _flow_assets(board: str, index_name: str, market: str) -> list[str]:
    text = f"{board} {index_name}"
    if "恒生" in text or "港" in text:
        return ["恒生指数", "港股互联网", "离岸人民币"]
    if "沪" in text or "深" in text:
        return ["沪深300", "中证1000", "北向资金"]
    defaults = {
        "Asia": ["沪深300", "恒生指数", "北向资金"],
        "Global": ["全球股指", "美元指数", "黄金"],
    }
    return defaults.get(market, ["全球股指", "黄金", "美元指数"])


def _fund_name_matches_market(name: str, market: str) -> bool:
    text = name.strip()
    if not text:
        return False

    mapping = {
        "US": ("美股", "美国", "纳指", "纳斯达克", "标普", "道琼斯", "中概", "全球科技", "标普500"),
        "EU": ("欧洲", "欧元", "德国", "法国", "英国", "DAX", "STOXX", "Euro"),
        "Asia": ("港股", "恒生", "A股", "沪深", "中证", "上证", "深证", "科创", "创业板", "中概互联", "日本", "日经", "亚洲"),
    }
    if market == "Global":
        return True
    return any(keyword in text for keyword in mapping.get(market, ()))


def _fund_assets(name: str, market: str, code: str) -> list[str]:
    assets = [name]
    text = f"{name} {code}"
    if any(keyword in text for keyword in ("纳指", "纳斯达克", "美股", "标普", "道琼斯")):
        assets.extend(["纳斯达克100", "标普500"])
    elif any(keyword in text for keyword in ("欧洲", "欧元", "德国", "法国", "英国")):
        assets.extend(["Euro Stoxx 50", "欧元"])
    elif any(keyword in text for keyword in ("港股", "恒生", "中概")):
        assets.extend(["恒生科技", "恒生指数"])
    elif any(keyword in text for keyword in ("沪深", "A股", "中证", "上证", "深证", "科创", "创业板")):
        assets.extend(["沪深300", "中证1000"])
    elif any(keyword in text for keyword in ("黄金", "有色", "原油", "能源")):
        assets.extend(["黄金", "原油"])
    else:
        defaults = {
            "US": ["纳斯达克100", "标普500"],
            "EU": ["Euro Stoxx 50", "欧元"],
            "Asia": ["沪深300", "恒生指数"],
            "Global": ["全球股指", "黄金"],
        }
        assets.extend(defaults.get(market, defaults["Global"]))
    deduped: list[str] = []
    for item in assets:
        if item and item not in deduped:
            deduped.append(item)
    return deduped[:3]


def _format_pct(value: float | None) -> str:
    if value is None:
        return "N/A"
    return f"{value:+.2f}%"


def _macro_topic_key(region: str, event_name: str) -> str:
    base = str(event_name).split("-", 1)[0].strip()
    base = re.sub(r"\s+", "", base)
    return f"{region}:{base}"
