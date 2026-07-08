from __future__ import annotations

import argparse
import asyncio
import inspect
import json
import uuid
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any

from aiohttp import web

from ..agents import prompts as prompt_module
from ..core import schemas as schema_module
from ..runners.common import build_runner, close_clients


ROOT = Path(__file__).resolve().parents[2]
STATIC_DIR = Path(__file__).resolve().parent / "static"
OUTPUTS_DIR = ROOT / "outputs"


@dataclass
class JobState:
    job_id: str
    status: str
    run_dir: str | None = None
    answer: str | None = None
    error: str | None = None
    question: str | None = None


_jobs: dict[str, JobState] = {}


def _json_response(data: Any) -> web.Response:
    return web.Response(text=json.dumps(data, ensure_ascii=False), content_type="application/json")


def _read_json(path: Path) -> Any | None:
    if not path.exists():
        return None
    return json.loads(path.read_text(encoding="utf-8"))


def _read_jsonl(path: Path, *, limit: int | None = None) -> list[Any]:
    if not path.exists():
        return []
    rows = []
    for line in path.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        try:
            rows.append(json.loads(line))
        except json.JSONDecodeError:
            rows.append({"raw": line})
    return rows[-limit:] if limit else rows


def _run_dir(run_id: str) -> Path:
    path = (OUTPUTS_DIR / run_id).resolve()
    if not str(path).startswith(str(OUTPUTS_DIR.resolve())) or not path.exists():
        raise web.HTTPNotFound(text="run not found")
    return path


def _latest_graph(run_dir: Path) -> Any | None:
    final_graph = run_dir / "graph" / "final_graph.json"
    if final_graph.exists():
        return _read_json(final_graph)
    graph_dir = run_dir / "graph"
    candidates = list(graph_dir.glob("*.json")) if graph_dir.exists() else []
    if not candidates:
        return None
    stage_rank = {"observed": 1, "verified": 2, "final_verified": 3}

    def _rank(path: Path) -> tuple[int, int, float]:
        stem = path.stem
        if stem == "final_verified":
            return (10**9, stage_rank["final_verified"], path.stat().st_mtime)
        parts = stem.split("_")
        round_id = -1
        stage = ""
        if len(parts) >= 3 and parts[0] == "round":
            try:
                round_id = int(parts[1])
            except ValueError:
                round_id = -1
            stage = parts[2]
        return (round_id, stage_rank.get(stage, 0), path.stat().st_mtime)

    return _read_json(max(candidates, key=_rank))


def _graph_snapshots(run_dir: Path) -> list[dict[str, Any]]:
    graph_dir = run_dir / "graph"
    if not graph_dir.exists():
        return []
    snapshots = []
    for path in sorted(graph_dir.glob("*.json")):
        data = _read_json(path)
        if data is not None:
            snapshots.append({"name": path.stem, "path": str(path), "graph": data})
    return snapshots


def _followups(run_dir: Path) -> dict[str, Any]:
    inputs_dir = run_dir / "inputs"
    if not inputs_dir.exists():
        return {}
    out: dict[str, Any] = {}
    for path in sorted(inputs_dir.glob("followups_round_*.json")):
        round_id = path.stem.removeprefix("followups_round_")
        out[round_id] = _read_json(path)
    return out


def _snapshot(run_dir: Path) -> dict[str, Any]:
    events = _read_jsonl(run_dir / "logs" / "events.jsonl", limit=500)
    trajectories = _read_jsonl(run_dir / "trajectories" / "searcher_trajectories.jsonl", limit=80)
    partials = _read_jsonl(run_dir / "graph" / "partials.jsonl", limit=120)
    return {
        "run_id": run_dir.name,
        "run_dir": str(run_dir),
        "question": _read_json(run_dir / "inputs" / "question.json"),
        "run_request": _read_json(run_dir / "inputs" / "run_request.json"),
        "config": _read_json(run_dir / "inputs" / "config.json"),
        "initial_queries": _read_json(run_dir / "inputs" / "initial_queries.json"),
        "followups": _followups(run_dir),
        "final_answer": _read_json(run_dir / "answers" / "final_answer.json"),
        "benchmark_eval": _read_json(run_dir / "evaluation" / "benchmark_eval.json"),
        "events": events,
        "normalized_events": _normalize_events(events),
        "trajectories": trajectories,
        "partials": partials,
        "graph_snapshots": _graph_snapshots(run_dir),
        "graph": _latest_graph(run_dir),
    }


async def _run_job(job_id: str, request: dict[str, Any]) -> None:
    _jobs[job_id].status = "starting"
    logger = llm = bocha = visit_provider = runner = None
    try:
        _config, logger, llm, bocha, visit_provider, runner = await build_runner(
            "web_argus_repro",
            overrides=request.get("config_overrides") or {},
        )
        _jobs[job_id].run_dir = str(runner.run_dir)
        _jobs[job_id].status = "running"
        request_path = Path(runner.run_dir) / "inputs" / "run_request.json"
        request_path.parent.mkdir(parents=True, exist_ok=True)
        request_path.write_text(json.dumps(_public_request(request), ensure_ascii=False, indent=2), encoding="utf-8")
        result = await runner.run_argus_repro(
            request["question"],
            k=request.get("k"),
            max_rounds=request.get("max_rounds"),
        )
        answer = result["final_answer"].answer
        logger.log("run_finished", final_answer=answer)
        _jobs[job_id].answer = answer
        _jobs[job_id].status = "finished"
    except Exception as exc:  # noqa: BLE001
        _jobs[job_id].error = str(exc)
        _jobs[job_id].status = "failed"
        if logger is not None:
            logger.log("web_run_failed", error=str(exc))
    finally:
        if llm is not None and bocha is not None:
            await close_clients(llm, bocha, visit_provider)


async def index(_request: web.Request) -> web.FileResponse:
    return web.FileResponse(STATIC_DIR / "index.html")


async def list_runs(_request: web.Request) -> web.Response:
    runs = []
    if OUTPUTS_DIR.exists():
        for path in sorted(OUTPUTS_DIR.iterdir(), key=lambda p: p.stat().st_mtime, reverse=True):
            if not path.is_dir() or path.name == "module_tests":
                continue
            if not (path / "inputs" / "question.json").exists():
                continue
            runs.append(
                {
                    "run_id": path.name,
                    "run_dir": str(path),
                    "mtime": path.stat().st_mtime,
                    "has_answer": (path / "answers" / "final_answer.json").exists(),
                    "has_eval": (path / "evaluation" / "benchmark_eval.json").exists(),
                }
            )
    return _json_response({"runs": runs})


async def list_jobs(_request: web.Request) -> web.Response:
    return _json_response({"jobs": [asdict(job) for job in _jobs.values()]})


async def get_run(request: web.Request) -> web.Response:
    return _json_response(_snapshot(_run_dir(request.match_info["run_id"])))


async def get_spec(_request: web.Request) -> web.Response:
    return _json_response(_spec_payload())


async def start_job(request: web.Request) -> web.Response:
    payload = await request.json()
    question = str(payload.get("question") or "").strip()
    if not question:
        raise web.HTTPBadRequest(text="question is required")
    k = _bounded_int(payload.get("k"), "k", 1, 32)
    max_rounds = _bounded_int(payload.get("max_rounds"), "max_rounds", 1, 32)
    overrides = _config_overrides(payload)
    job_id = uuid.uuid4().hex[:12]
    request_data = {
        "question": question,
        "k": k,
        "max_rounds": max_rounds,
        "config_overrides": overrides,
    }
    _jobs[job_id] = JobState(job_id=job_id, status="queued", question=question)
    asyncio.create_task(_run_job(job_id, request_data))
    return _json_response({"job": asdict(_jobs[job_id])})


def _bounded_int(value: Any, field: str, low: int, high: int) -> int | None:
    if value in (None, ""):
        return None
    try:
        parsed = int(value)
    except (TypeError, ValueError) as exc:
        raise web.HTTPBadRequest(text=f"{field} must be an integer") from exc
    if parsed < low or parsed > high:
        raise web.HTTPBadRequest(text=f"{field} must be between {low} and {high}")
    return parsed


def _optional_bool(value: Any, field: str) -> bool | None:
    if value in (None, ""):
        return None
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        lowered = value.strip().lower()
        if lowered in {"true", "1", "yes", "on"}:
            return True
        if lowered in {"false", "0", "no", "off"}:
            return False
    raise web.HTTPBadRequest(text=f"{field} must be a boolean")


def _config_overrides(payload: dict[str, Any]) -> dict[str, Any]:
    specs = {
        "max_searcher_calls": ("max_searcher_calls", 1, 128),
        "max_dispatch_per_round": ("max_dispatch_per_round", 1, 32),
        "max_searcher_steps": ("max_searcher_steps", 2, 40),
        "trajectory_window_size": ("trajectory_window_size", 1, 64),
        "trajectory_window_stride": ("trajectory_window_stride", 1, 64),
        "searcher_concurrency": ("searcher_concurrency", 1, 32),
    }
    overrides: dict[str, Any] = {}
    for payload_key, (config_key, low, high) in specs.items():
        value = _bounded_int(payload.get(payload_key), payload_key, low, high)
        if value is not None:
            overrides[config_key] = value
    for payload_key, config_key in {
        "searcher_enable_thinking": "searcher_enable_thinking",
        "navigator_enable_thinking": "navigator_enable_thinking",
    }.items():
        value = _optional_bool(payload.get(payload_key), payload_key)
        if value is not None:
            overrides[config_key] = value
    if "k" in payload and payload.get("k") not in (None, ""):
        overrides["max_initial_dispatch"] = int(payload["k"])
    if "max_rounds" in payload and payload.get("max_rounds") not in (None, ""):
        overrides["max_rounds"] = int(payload["max_rounds"])
    return overrides


def _public_request(request: dict[str, Any]) -> dict[str, Any]:
    return {
        "question": request.get("question"),
        "k": request.get("k"),
        "max_rounds": request.get("max_rounds"),
        "config_overrides": request.get("config_overrides") or {},
    }


def _spec_payload() -> dict[str, Any]:
    prompt_names = [
        "initial_query_prompt",
        "react_searcher_action_prompt",
        "visit_extraction_prompt",
        "react_searcher_forced_answer_prompt",
        "graph_extraction_prompt",
        "graph_compaction_prompt",
        "verification_prompt",
        "followup_prompt",
        "synthesis_prompt",
    ]
    schema_names = [
        "QuerySpec",
        "SearchStep",
        "SearchTrajectory",
        "EvidenceNode",
        "ClaimNode",
        "GraphEdge",
        "MissingAspect",
        "AnswerPathRequirement",
        "EvidenceGraph",
        "FinalClaim",
        "FinalAnswer",
    ]
    return {
        "roles": [
            {
                "name": "Navigator",
                "summary": "Global controller. It plans Searcher tasks, reads returned trajectories, updates the evidence graph, verifies sufficiency, and synthesizes the final answer.",
            },
            {
                "name": "Searcher",
                "summary": "A ReAct loop for one assigned subtask. Each step chooses SEARCH, VISIT, or ANSWER within the Searcher step budget.",
            },
            {
                "name": "Evidence Graph",
                "summary": "Navigator's shared state: source evidence, factual claims, support/contradiction edges, missing aspects, and sufficiency.",
            },
        ],
        "prompts": [
            {
                "name": name,
                "summary": _prompt_summary(name),
                "source": inspect.getsource(getattr(prompt_module, name)),
            }
            for name in prompt_names
        ],
        "schemas": [_schema_info(name, getattr(schema_module, name)) for name in schema_names],
    }


def _schema_info(name: str, model: Any) -> dict[str, Any]:
    fields = []
    for field_name, field in model.model_fields.items():
        annotation = str(field.annotation).replace("typing.", "")
        fields.append(
            {
                "name": field_name,
                "type": annotation,
                "required": field.is_required(),
                "default": None if field.default is None else str(field.default),
                "description": field.description or "",
            }
        )
    return {"name": name, "fields": fields}


def _prompt_summary(name: str) -> str:
    summaries = {
        "initial_query_prompt": "Navigator creates the initial Searcher task batch.",
        "react_searcher_action_prompt": "Searcher chooses the next ReAct action.",
        "visit_extraction_prompt": "VISIT extraction turns reader text into goal-focused evidence.",
        "react_searcher_forced_answer_prompt": "Searcher gives a conservative answer after step budget exhaustion.",
        "graph_extraction_prompt": "Navigator parses one trajectory window into graph updates.",
        "graph_compaction_prompt": "Navigator merges semantically duplicate claims.",
        "verification_prompt": "Navigator verifies graph-level sufficiency and claim statuses.",
        "followup_prompt": "Navigator creates targeted follow-up Searcher tasks.",
        "synthesis_prompt": "Navigator writes the final answer from the graph.",
    }
    return summaries.get(name, "")


def _normalize_events(events: list[dict[str, Any]]) -> list[dict[str, Any]]:
    out = []
    for idx, event in enumerate(events):
        normalized = dict(event)
        name = str(event.get("event") or "")
        label = str(event.get("label") or "")
        searcher_id = event.get("searcher_id")
        if searcher_id and event.get("round_id") is None:
            round_id = _round_from_searcher_id(str(searcher_id))
            if round_id is not None:
                normalized["round_id"] = round_id
        normalized["event_index"] = idx
        normalized["agent_type"] = _agent_type(name, label, searcher_id)
        normalized["agent_id"] = searcher_id or ("navigator" if normalized["agent_type"] == "navigator" else normalized["agent_type"])
        normalized["phase"] = _event_phase(name, label)
        normalized["status"] = "failed" if event.get("error") or "failed" in name or "fallback" in name else "finished"
        out.append(normalized)
    return out


def _round_from_searcher_id(searcher_id: str) -> int | None:
    if searcher_id.startswith("r"):
        prefix = searcher_id.split("_", 1)[0]
        try:
            return int(prefix[1:])
        except ValueError:
            return None
    return None


def _agent_type(name: str, label: str, searcher_id: Any) -> str:
    if searcher_id or name.startswith("searcher_"):
        return "searcher"
    if "navigator" in label or name in {"round_verified", "final_verified", "graph_compacted"}:
        return "navigator"
    if "bocha" in name or "search" in name:
        return "tool"
    if "visit" in name:
        return "tool"
    if name == "llm_call":
        return "llm"
    return "system"


def _event_phase(name: str, label: str) -> str:
    text = f"{name} {label}"
    if "initial_queries" in text:
        return "planning"
    if "followups" in text:
        return "followup"
    if "bocha" in text or "web_search" in text:
        return "search"
    if "search_tool" in text:
        return "search"
    if "visit" in text:
        return "visit"
    if "searcher" in text and "llm" not in text:
        return "searcher"
    if "graph_extraction" in text or "serial_window" in text:
        return "extract_merge"
    if "compaction" in text or "compacted" in text:
        return "compaction"
    if "verification" in text or "verified" in text:
        return "verification"
    if "synthesis" in text:
        return "synthesis"
    if "llm" in text:
        return "llm"
    return "system"


async def get_job(request: web.Request) -> web.Response:
    job = _jobs.get(request.match_info["job_id"])
    if job is None:
        raise web.HTTPNotFound(text="job not found")
    data: dict[str, Any] = {"job": asdict(job)}
    if job.run_dir:
        data["snapshot"] = _snapshot(Path(job.run_dir))
    return _json_response(data)


import aiohttp_cors

def create_app() -> web.Application:
    app = web.Application()
    
    # Configure default CORS settings.
    cors = aiohttp_cors.setup(app, defaults={
        "*": aiohttp_cors.ResourceOptions(
            allow_credentials=True,
            expose_headers="*",
            allow_headers="*",
            allow_methods="*",
        )
    })
    
    app.router.add_get("/", index)
    cors.add(app.router.add_get("/api/runs", list_runs))
    cors.add(app.router.add_get("/api/jobs", list_jobs))
    cors.add(app.router.add_get("/api/runs/{run_id}", get_run))
    cors.add(app.router.add_get("/api/spec", get_spec))
    cors.add(app.router.add_post("/api/jobs", start_job))
    cors.add(app.router.add_get("/api/jobs/{job_id}", get_job))
    app.router.add_static("/static", STATIC_DIR)
    return app


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=7860)
    args = parser.parse_args()
    web.run_app(create_app(), host=args.host, port=args.port)


if __name__ == "__main__":
    main()
