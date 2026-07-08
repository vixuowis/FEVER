from __future__ import annotations

import csv
import hashlib
import io
import re
import zipfile
from dataclasses import dataclass
from typing import Any, Protocol
from urllib.parse import urljoin, urlsplit

import aiohttp

from ..core.config import ArgusConfig
from ..core.logging_utils import RunLogger
from ..core.run_paths import RunPaths
from ..core.schemas import SearchResult
from ..core.utils import append_jsonl, estimate_tokens, retry_async, token_budget_text, utc_now_iso


@dataclass
class VisitResult:
    url: str
    title: str = ""
    source: str | None = None
    published_time: str | None = None
    text: str = ""
    markdown: str = ""
    snippet: str = ""
    status: str = "ok"
    provider: str = ""
    links: list[dict[str, Any]] | None = None
    tables: list[dict[str, Any]] | None = None
    data_endpoints: list[dict[str, Any]] | None = None
    raw: dict[str, Any] | None = None

    def to_observation(self, *, result_id: str | None) -> dict[str, Any]:
        page_text = self.text or self.markdown
        return {
            "result_id": result_id,
            "url": self.url,
            "page_text": page_text,
            "links": self.links or [],
            "tables": self.tables or [],
            "data_endpoints": self.data_endpoints or [],
            "visit_status": self.status,
            "visit_provider": self.provider,
        }


class VisitProvider(Protocol):
    async def visit(self, result: SearchResult, *, result_id: str | None = None, goal: str | None = None) -> VisitResult:
        ...

    async def close(self) -> None:
        ...


def _is_zip_url(url: str) -> bool:
    clean = (url or "").split("?", 1)[0].lower()
    return clean.endswith(".zip")


def _is_direct_download_url(url: str) -> bool:
    clean = (url or "").split("?", 1)[0].lower()
    return (
        clean.endswith((".csv", ".json", ".xlsx", ".xls"))
        or any(marker in (url or "").lower() for marker in ("format=csv", "format=json"))
    )


def _artifact_extension(url: str, content_type: str, content: bytes) -> str:
    clean = (url or "").split("?", 1)[0].lower()
    for suffix in (".zip", ".pdf", ".csv", ".json", ".txt", ".html", ".xml", ".xlsx", ".xls"):
        if clean.endswith(suffix):
            return suffix
    lower_type = (content_type or "").lower()
    if content.startswith(b"PK") or "zip" in lower_type:
        return ".zip"
    if content.startswith(b"%PDF") or "pdf" in lower_type:
        return ".pdf"
    if "json" in lower_type:
        return ".json"
    if "csv" in lower_type:
        return ".csv"
    if "html" in lower_type:
        return ".html"
    return ".bin"


def _decode_text_bytes(content: bytes) -> str:
    for encoding in ("utf-8-sig", "utf-8", "latin-1"):
        try:
            return content.decode(encoding)
        except UnicodeDecodeError:
            continue
    return content.decode("utf-8", errors="replace")


def _goal_terms(goal: str | None) -> list[str]:
    terms: list[str] = []
    seen: set[str] = set()
    for term in re.findall(r"[A-Za-z0-9_.:/-]{2,}|[\u4e00-\u9fff]{2,}", goal or ""):
        clean = term.strip().lower()
        if len(clean) < 2 or clean in seen:
            continue
        seen.add(clean)
        terms.append(clean)
    return terms


def _goal_match_score(text: str, terms: list[str]) -> int:
    lower = text.lower()
    score = 0
    for term in terms:
        if term not in lower:
            continue
        has_alpha = any(ch.isalpha() for ch in term)
        has_digit = any(ch.isdigit() for ch in term)
        if any(ch in term for ch in "._:/-") and has_alpha and has_digit:
            score += 20
        elif has_alpha and has_digit:
            score += 10
        elif has_alpha and len(term) >= 6:
            score += 5
        elif "\u4e00" <= term[0] <= "\u9fff":
            score += 4
        elif has_digit and len(term) >= 6:
            score += 3
        else:
            score += 1
    return score


def _oversize_member_view(text: str, *, goal: str | None, max_tokens: int) -> str:
    if max_tokens <= 0 or estimate_tokens(text) <= max_tokens:
        return text
    terms = _goal_terms(goal)
    out = [
        "[member_content_exceeds_token_budget]",
        f"Original member tokens: {estimate_tokens(text)}",
        f"Member view token budget: {max_tokens}",
    ]
    if terms:
        scored: list[tuple[int, int, str]] = []
        for idx, line in enumerate(text.splitlines()):
            score = _goal_match_score(line, terms)
            if score > 0:
                scored.append((score, idx, line))
        scored.sort(key=lambda item: (-item[0], item[1]))
        if scored:
            out.append("Exact goal-matched original lines from this member:")
            for score, idx, line in scored[:80]:
                out.append(f"[line {idx + 1}, score={score}] {line}")
        else:
            out.append("No exact goal-matched lines were found inside this member.")
    out.append("Leading original content:")
    out.append(token_budget_text(text, max_tokens=max(1000, max_tokens // 4)))
    return token_budget_text("\n".join(out), max_tokens=max_tokens)


def _persist_download_artifact(
    *,
    logger: RunLogger | None,
    url: str,
    content: bytes,
    content_type: str,
    extracted_text: str,
    provider: str,
    status: str,
    result_id: str | None,
) -> dict[str, Any] | None:
    if logger is None:
        return None
    paths = RunPaths(logger.run_dir)
    paths.ensure()
    digest = hashlib.sha256(content).hexdigest()
    extension = _artifact_extension(url, content_type, content)
    download_path = paths.downloads / f"{digest}{extension}"
    extracted_path = paths.extracted / f"{digest}.txt"
    if not download_path.exists():
        download_path.write_bytes(content)
    extracted_path.write_text(extracted_text, encoding="utf-8")
    record = {
        "ts": utc_now_iso(),
        "kind": "download",
        "provider": provider,
        "status": status,
        "result_id": result_id,
        "url": url,
        "content_type": content_type or None,
        "sha256": digest,
        "byte_size": len(content),
        "download_path": str(download_path),
        "extracted_text_path": str(extracted_path),
        "extracted_chars": len(extracted_text),
    }
    append_jsonl(paths.artifact_manifest, record)
    return record


def _extract_markdown_links(text: str) -> list[tuple[str, str, bool]]:
    links: list[tuple[str, str, bool]] = []
    for bang, label, url in re.findall(r"(!?)\[([^\]]+)\]\((https?://[^)]+)\)", text):
        compact_label = " ".join(label.split())
        if not compact_label or not url:
            continue
        links.append((compact_label, url, bool(bang)))
    return links


def _classify_link(url: str, label: str = "") -> str:
    lower = f"{label} {url}".lower()
    if any(token in lower for token in (".csv", "format=csv", "download data", "bulk download")):
        return "csv"
    if any(token in lower for token in (".xlsx", ".xls")):
        return "spreadsheet"
    if ".zip" in lower:
        return "zip"
    if ".pdf" in lower or "/bitstreams/" in lower:
        return "pdf"
    split = urlsplit(url)
    path_parts = [part for part in split.path.lower().split("/") if part]
    api_like = (
        "api" in path_parts
        or any(part.endswith("api") for part in path_parts)
        or "api." in split.netloc.lower()
        or any(token in lower for token in ("odata", "format=json", ".json", "$filter", "query?"))
        or re.search(r"\bapi\b", label.lower()) is not None
    )
    if api_like:
        return "api"
    if any(token in lower for token in ("data", "indicator", "dataset", "table", "statistics", "download")):
        return "data_portal"
    if any(token in lower for token in ("report", "publication", "pdf")):
        return "report"
    return "web"


def _extract_html_links(text: str, base_url: str) -> list[tuple[str, str, bool]]:
    links: list[tuple[str, str, bool]] = []
    pattern = re.compile(r"<a\b[^>]*href=[\"']([^\"']+)[\"'][^>]*>(.*?)</a>", re.I | re.S)
    for href, label_html in pattern.findall(text or ""):
        if href.startswith(("mailto:", "javascript:", "#")):
            continue
        url = urljoin(base_url, href)
        if not url.startswith(("http://", "https://")):
            continue
        label = " ".join(re.sub(r"<[^>]+>", " ", label_html).split()) or url
        links.append((label, url, False))
    return links


def _extract_raw_urls(text: str) -> list[tuple[str, str, bool]]:
    links: list[tuple[str, str, bool]] = []
    for url in re.findall(r"https?://[^\s<>()\"']+", text or ""):
        clean = url.rstrip(".,;]")
        links.append((clean, clean, False))
    return links


def _extract_actionable_links(text: str, base_url: str) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    seen: set[str] = set()
    raw_links = [*_extract_markdown_links(text), *_extract_html_links(text, base_url), *_extract_raw_urls(text)]
    for label, url, is_image in raw_links:
        url = urljoin(base_url, url)
        if not url.startswith(("http://", "https://")) or url in seen:
            continue
        kind = _classify_link(url, label)
        if is_image and kind == "web":
            continue
        priority = 2 if kind in {"api", "csv", "spreadsheet", "zip", "pdf", "data_portal"} else 1
        out.append(
            {
                "url": url,
                "text": label[:240],
                "kind": kind,
                "priority": priority,
                "why_relevant": "Detected as a concrete next-hop source from the visited page.",
            }
        )
        seen.add(url)
    out.sort(key=lambda item: (-int(item["priority"]), item["kind"], item["url"]))
    return out[:40]


def _extract_markdown_tables(text: str) -> list[dict[str, Any]]:
    tables: list[dict[str, Any]] = []
    lines = (text or "").splitlines()
    idx = 0
    while idx < len(lines) - 1:
        header = lines[idx].strip()
        sep = lines[idx + 1].strip()
        if header.startswith("|") and sep.startswith("|") and re.search(r"\|[\s:-]+\|", sep):
            cols = [cell.strip() for cell in header.strip("|").split("|")]
            rows = []
            idx += 2
            while idx < len(lines) and lines[idx].strip().startswith("|"):
                cells = [cell.strip() for cell in lines[idx].strip().strip("|").split("|")]
                if len(cells) == len(cols):
                    rows.append(dict(zip(cols, cells)))
                idx += 1
                if len(rows) >= 8:
                    break
            tables.append({"columns": cols, "sample_rows": rows, "row_count_visible": len(rows)})
            if len(tables) >= 8:
                break
            continue
        idx += 1
    return tables


def _actionable_metadata(text: str, base_url: str) -> dict[str, Any]:
    links = _extract_actionable_links(text, base_url)
    endpoints = [
        {
            "url": item["url"],
            "kind": item["kind"],
            "params_hint": _endpoint_param_hints(item["url"]),
            "why_relevant": item["why_relevant"],
        }
        for item in links
        if item["kind"] in {"api", "csv", "spreadsheet", "zip", "data_portal"}
    ]
    return {
        "links": links,
        "tables": _extract_markdown_tables(text),
        "data_endpoints": endpoints[:20],
    }


def _endpoint_param_hints(url: str) -> list[str]:
    hints = []
    lower = url.lower()
    for token in ("year", "time", "sex", "location", "country", "spatial", "indicator", "dim", "filter", "format"):
        if token in lower:
            hints.append(token)
    return hints


def _important_link_block(text: str) -> str:
    report_links: list[str] = []
    data_links: list[str] = []
    seen: set[str] = set()
    for label, url, is_image in _extract_markdown_links(text):
        lower = f"{label} {url}".lower()
        if url in seen:
            continue
        direct_file = any(token in lower for token in (".pdf", ".csv", ".zip", ".xlsx", ".xls"))
        if is_image and not direct_file:
            continue
        if "world health statistics" in lower or "world health statistics" in lower.replace("_", " ") or direct_file:
            report_links.append(f"- {label}: {url}")
            seen.add(url)
        elif any(token in lower for token in ("download data", ".csv", ".zip", "api", "dataset")):
            data_links.append(f"- {label}: {url}")
            seen.add(url)
    parts: list[str] = []
    if report_links:
        parts.append("Detected report/download links. Copy exact URLs for VISIT; do not rewrite them:\n" + "\n".join(report_links[:30]))
    if data_links:
        parts.append("Detected data links. Copy exact URLs for VISIT; do not rewrite them:\n" + "\n".join(data_links[:30]))
    return "\n\n".join(parts)


def _reader_text_with_link_hints(text: str) -> str:
    link_block = _important_link_block(text)
    return f"{link_block}\n\n{text}" if link_block else text


def _pdf_to_text(content: bytes, *, url: str) -> str:
    from pypdf import PdfReader

    out = [f"PDF document: {url}"]
    reader = PdfReader(io.BytesIO(content))
    out.append(f"Pages: {len(reader.pages)}")
    for idx, page in enumerate(reader.pages, start=1):
        try:
            page_text = page.extract_text() or ""
        except Exception as exc:  # noqa: BLE001
            page_text = f"[page extraction failed: {exc}]"
        page_text = " ".join(page_text.split())
        if not page_text:
            continue
        out.append(f"\n--- Page {idx} ---\n{page_text}")
    return "\n".join(out)


def _parse_jsonl_text(text: str, *, url: str) -> str | None:
    lines = [line for line in text.splitlines() if line.strip()]
    if not lines:
        return None
    for line in lines[:200]:
        try:
            __import__("json").loads(line)
        except Exception:
            return None
    return "\n".join([f"JSONL text file: {url}", f"Records: {len(lines)}", "Content:", text])


def _plain_text_to_text(content: bytes, *, url: str, goal: str | None = None) -> str:
    text = _decode_text_bytes(content)
    jsonl = _parse_jsonl_text(text, url=url)
    if jsonl:
        return jsonl
    return f"Text file: {url}\n{text}"


def _spreadsheet_to_text(content: bytes, *, url: str) -> str:
    import pandas as pd

    sheets = pd.read_excel(io.BytesIO(content), sheet_name=None, dtype=str)
    out = [f"Spreadsheet document: {url}", f"Sheets: {len(sheets)}"]
    for sheet_name, frame in sheets.items():
        frame = frame.fillna("")
        out.append(f"\n--- Sheet: {sheet_name} ---")
        out.append(f"Rows: {len(frame)}")
        out.append("Content:")
        out.append(frame.to_csv(index=False))
    return "\n".join(out)


def _member_text_view(
    content: bytes,
    *,
    url: str,
    name: str,
    goal: str | None,
    max_tokens: int,
) -> str:
    lower = name.lower()
    if lower.endswith(".csv"):
        parsed = _csv_to_text(content, url=url, goal=goal)
    elif lower.endswith(".tsv"):
        parsed = _csv_to_text(content, url=url, goal=goal, delimiter="\t")
    elif lower.endswith(".json"):
        parsed = _json_to_text(content, url=url, goal=goal)
    elif lower.endswith((".jsonl", ".txt", ".md", ".xml", ".html", ".htm")):
        parsed = _plain_text_to_text(content, url=url, goal=goal)
    elif lower.endswith((".xlsx", ".xls")):
        try:
            parsed = _spreadsheet_to_text(content, url=url)
        except Exception as exc:  # noqa: BLE001
            parsed = f"Spreadsheet member could not be parsed: {name}\nError: {exc}"
    else:
        parsed = f"Unsupported member format: {name}"
    return _oversize_member_view(parsed, goal=goal, max_tokens=max_tokens)


def _zip_to_text(content: bytes, *, url: str, goal: str | None = None, max_tokens: int = 0) -> str:
    out: list[str] = [f"ZIP data package: {url}"]
    with zipfile.ZipFile(io.BytesIO(content)) as zf:
        infos = [info for info in zf.infolist() if not info.is_dir()]
        out.append(f"Files: {len(infos)} total.")
        out.append("Container file structure:")
        for info in infos:
            out.append(f"- {info.filename} ({info.file_size} bytes)")

        parseable_suffixes = (
            ".csv",
            ".tsv",
            ".json",
            ".jsonl",
            ".txt",
            ".md",
            ".xml",
            ".html",
            ".htm",
            ".xlsx",
            ".xls",
        )
        parseable_infos = [info for info in infos if info.filename.lower().endswith(parseable_suffixes)]
        member_budget = 0
        if max_tokens > 0 and parseable_infos:
            header_tokens = estimate_tokens("\n".join(out))
            section_overhead = 32 * len(parseable_infos)
            remaining_tokens = max(1, max_tokens - header_tokens - section_overhead)
            member_budget = max(1, remaining_tokens // len(parseable_infos))

        parsed_any = False
        for info in parseable_infos:
            name = info.filename
            section_url = f"{url}#{name}"
            member = zf.read(info)
            parsed = _member_text_view(
                member,
                url=section_url,
                name=name,
                goal=goal,
                max_tokens=member_budget,
            )
            parsed_any = True
            out.append(f"\n--- Parsed member: {name} ---")
            out.append(parsed)
        if not parsed_any:
            out.append("No independently parseable text/csv/json members were found.")
    return "\n".join(out)


def _json_to_text(content: bytes, *, url: str, goal: str | None = None) -> str:
    text = _decode_text_bytes(content)
    try:
        __import__("json").loads(text)
    except Exception:
        return _plain_text_to_text(content, url=url, goal=goal)
    return "\n".join([f"JSON document: {url}", "Content:", text])


def _csv_to_text(content: bytes, *, url: str, goal: str | None = None, delimiter: str = ",") -> str:
    decoded = _decode_text_bytes(content)
    reader = csv.reader(io.StringIO(decoded), delimiter=delimiter)
    row_count = sum(1 for _row in reader)
    return "\n".join([f"Delimited data: {url}", f"Rows: {row_count}", "Content:", decoded])


class JinaReaderVisitProvider:
    def __init__(self, config: ArgusConfig, logger: RunLogger | None = None):
        self.config = config
        self.logger = logger
        self._session: aiohttp.ClientSession | None = None

    async def open(self) -> None:
        if self._session is None:
            timeout = aiohttp.ClientTimeout(total=self.config.visit_timeout)
            self._session = aiohttp.ClientSession(timeout=timeout, trust_env=self.config.visit_trust_env)

    async def close(self) -> None:
        if self._session is not None:
            await self._session.close()
            self._session = None

    async def visit(self, result: SearchResult, *, result_id: str | None = None, goal: str | None = None) -> VisitResult:
        await self.open()
        assert self._session is not None
        if not result.url:
            return VisitResult(url="", status="missing_url", provider="jina_reader")
        if _is_zip_url(result.url) or _is_direct_download_url(result.url):
            return await self._visit_download(result, result_id=result_id, goal=goal)
        reader_url = f"{self.config.jina_reader_base_url.rstrip('/')}/{result.url}"
        headers = {"Accept": "text/markdown"}
        if self.config.jina_api_key:
            headers["Authorization"] = f"Bearer {self.config.jina_api_key}"

        async def _call() -> VisitResult:
            async with self._session.get(reader_url, headers=headers) as resp:
                text = await resp.text()
                if resp.status >= 400:
                    raise RuntimeError(f"Jina Reader status={resp.status}: {text[:1000]}")
            text = _reader_text_with_link_hints(text)
            metadata = _actionable_metadata(text, result.url)
            if self.logger:
                self.logger.log("visit", provider="jina_reader", result_id=result_id, url=result.url, chars=len(text))
            return VisitResult(
                url=result.url,
                title=result.title,
                source=result.source,
                published_time=result.published_time,
                text=text,
                markdown=text,
                snippet=result.snippet or "",
                status="jina_reader_markdown",
                provider="jina_reader",
                links=metadata["links"],
                tables=metadata["tables"],
                data_endpoints=metadata["data_endpoints"],
                raw={"reader_url": reader_url},
            )

        return await retry_async("jina_reader_visit", _call, attempts=self.config.retry_attempts)

    async def _visit_download(
        self,
        result: SearchResult,
        *,
        result_id: str | None = None,
        goal: str | None = None,
    ) -> VisitResult:
        await self.open()
        assert self._session is not None

        async def _call() -> VisitResult:
            async with self._session.get(result.url) as resp:
                content = await resp.read()
                if resp.status >= 400:
                    text = content[:1000].decode("utf-8", errors="replace")
                    raise RuntimeError(f"Download status={resp.status}: {text}")
                content_type = resp.headers.get("Content-Type", "")
            clean_url = result.url.lower().split("?", 1)[0]
            is_spreadsheet = (
                clean_url.endswith((".xlsx", ".xls"))
                or "spreadsheet" in content_type.lower()
                or "excel" in content_type.lower()
            )
            if is_spreadsheet:
                try:
                    text = _spreadsheet_to_text(content, url=result.url)
                    status = "spreadsheet_reader_text"
                    provider = "spreadsheet_reader"
                except Exception as exc:  # noqa: BLE001
                    text = (
                        f"Spreadsheet download could not be parsed.\n"
                        f"URL: {result.url}\n"
                        f"Content-Type: {content_type or 'unknown'}\n"
                        f"Bytes: {len(content)}\n"
                        f"Error: {exc}"
                    )
                    status = "spreadsheet_reader_failed"
                    provider = "spreadsheet_reader"
            elif content.startswith(b"PK") or "zip" in content_type.lower() or _is_zip_url(result.url):
                text = _zip_to_text(
                    content,
                    url=result.url,
                    goal=goal,
                    max_tokens=self.config.searcher_visit_extraction_input_max_tokens,
                )
                status = "zip_reader_text"
                provider = "zip_reader"
            elif content.startswith(b"%PDF") or ("pdf" in content_type.lower() and not content.lstrip().startswith(b"<")):
                try:
                    text = _pdf_to_text(content, url=result.url)
                except Exception as exc:  # noqa: BLE001
                    text = (
                        f"PDF download could not be parsed.\n"
                        f"URL: {result.url}\n"
                        f"Content-Type: {content_type or 'unknown'}\n"
                        f"Bytes: {len(content)}\n"
                        f"Error: {exc}"
                )
                status = "pdf_reader_text"
                provider = "pdf_reader"
            elif "json" in content_type.lower() or clean_url.endswith(".json"):
                text = _json_to_text(content, url=result.url, goal=goal)
                status = "json_reader_text"
                provider = "json_reader"
            elif "csv" in content_type.lower() or clean_url.endswith(".csv"):
                text = _csv_to_text(content, url=result.url, goal=goal)
                status = "csv_reader_text"
                provider = "csv_reader"
            elif not content_type.lower().startswith(("text/", "application/json", "application/xml")):
                text = (
                    f"Binary download is not text-readable.\n"
                    f"URL: {result.url}\n"
                    f"Content-Type: {content_type or 'unknown'}\n"
                    f"Bytes: {len(content)}"
                )
                status = "binary_download_unreadable"
                provider = "download_reader"
            else:
                text = _plain_text_to_text(content, url=result.url, goal=goal)
                status = "download_text"
                provider = "download_reader"
            text = token_budget_text(text, max_tokens=self.config.searcher_visit_extraction_input_max_tokens)
            artifact = _persist_download_artifact(
                logger=self.logger,
                url=result.url,
                content=content,
                content_type=content_type,
                extracted_text=text,
                provider=provider,
                status=status,
                result_id=result_id,
            )
            if self.logger:
                self.logger.log(
                    "visit",
                    provider=provider,
                    result_id=result_id,
                    url=result.url,
                    chars=len(text),
                    artifact=artifact,
                )
            metadata = _actionable_metadata(text, result.url)
            return VisitResult(
                url=result.url,
                title=result.title,
                source=result.source,
                published_time=result.published_time,
                text=text,
                markdown=text,
                snippet=result.snippet or "",
                status=status,
                provider=provider,
                links=metadata["links"],
                tables=metadata["tables"],
                data_endpoints=metadata["data_endpoints"],
                raw={"content_bytes": len(content), "artifact": artifact},
            )

        return await retry_async("download_visit", _call, attempts=self.config.retry_attempts)


class Crawl4AIVisitProvider:
    def __init__(self, config: ArgusConfig, logger: RunLogger | None = None):
        self.config = config
        self.logger = logger
        self._crawler: Any | None = None

    async def open(self) -> None:
        if self._crawler is not None:
            return
        from crawl4ai import AsyncWebCrawler, BrowserConfig

        user_data_dir = None
        downloads_path = None
        if self.logger is not None:
            paths = RunPaths(self.logger.run_dir)
            paths.ensure()
            user_data_dir = str(paths.crawl4ai / "user_data")
            downloads_path = str(paths.crawl4ai / "downloads")
            (paths.crawl4ai / "user_data").mkdir(parents=True, exist_ok=True)
            (paths.crawl4ai / "downloads").mkdir(parents=True, exist_ok=True)
        browser_config = BrowserConfig(
            proxy_config=self.config.crawl4ai_proxy,
            verbose=False,
            use_persistent_context=bool(user_data_dir),
            user_data_dir=user_data_dir,
            accept_downloads=bool(downloads_path),
            downloads_path=downloads_path,
        )
        if self.logger:
            self.logger.log(
                "crawl4ai_open",
                user_data_dir=user_data_dir,
                downloads_path=downloads_path,
                browser_mode="persistent" if user_data_dir else "default",
            )
        self._crawler = AsyncWebCrawler(config=browser_config)
        await self._crawler.__aenter__()

    async def close(self) -> None:
        if self._crawler is not None:
            await self._crawler.__aexit__(None, None, None)
            self._crawler = None

    async def visit(self, result: SearchResult, *, result_id: str | None = None, goal: str | None = None) -> VisitResult:
        if not result.url:
            return VisitResult(url="", status="missing_url", provider="crawl4ai")
        if _is_zip_url(result.url) or _is_direct_download_url(result.url):
            jina = JinaReaderVisitProvider(self.config, self.logger)
            try:
                return await jina._visit_download(result, result_id=result_id, goal=goal)
            finally:
                await jina.close()
        await self.open()
        assert self._crawler is not None

        async def _call() -> VisitResult:
            crawl = await self._crawler.arun(url=result.url)
            markdown = _reader_text_with_link_hints(str(getattr(crawl, "markdown", "") or ""))
            metadata = _actionable_metadata(markdown, result.url)
            success = bool(getattr(crawl, "success", False))
            status = "crawl4ai_markdown" if success and markdown else "crawl4ai_empty"
            error = getattr(crawl, "error_message", None)
            if self.logger:
                self.logger.log(
                    "visit",
                    provider="crawl4ai",
                    result_id=result_id,
                    url=result.url,
                    chars=len(markdown),
                    success=success,
                    error=error,
                )
            return VisitResult(
                url=result.url,
                title=result.title,
                source=result.source,
                published_time=result.published_time,
                text=markdown,
                markdown=markdown,
                snippet=result.snippet or "",
                status=status,
                provider="crawl4ai",
                links=metadata["links"],
                tables=metadata["tables"],
                data_endpoints=metadata["data_endpoints"],
                raw={"success": success, "error_message": error},
            )

        return await retry_async("crawl4ai_visit", _call, attempts=self.config.retry_attempts)


def build_visit_provider(config: ArgusConfig, logger: RunLogger | None = None) -> VisitProvider:
    if config.visit_provider in {"jina", "jina_reader", "jina-reader"}:
        return JinaReaderVisitProvider(config, logger)
    if config.visit_provider in {"crawl4ai", "crawl"}:
        return Crawl4AIVisitProvider(config, logger)
    raise ValueError(f"Unsupported ARGUS_VISIT_PROVIDER={config.visit_provider!r}")
