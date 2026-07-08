from __future__ import annotations

import json
from datetime import datetime
from dataclasses import replace
from pathlib import Path
from typing import Any

from ..providers.bocha_provider import BochaProvider
from ..core.config import ArgusConfig, load_config
from ..providers.llm_client import LLMClient
from ..core.logging_utils import RunLogger
from ..core.run_paths import RunPaths
from ..agents.navigator import ArgusReproRunner, Navigator
from ..agents.searcher import ReActSearcher
from ..core.utils import write_json
from ..providers.visit_provider import VisitProvider, build_visit_provider


SECRET_CONFIG_FIELDS = {"dashscope_api_key", "bocha_api_key", "jina_api_key"}


def make_run_dir(config: ArgusConfig, prefix: str) -> Path:
    run_id = f"{prefix}_{datetime.now().strftime('%Y%m%d_%H%M%S')}"
    run_dir = config.outputs_dir / run_id
    run_dir.mkdir(parents=True, exist_ok=True)
    return run_dir


def public_config_dict(config: ArgusConfig) -> dict[str, object]:
    data = {**config.__dict__, "outputs_dir": str(config.outputs_dir)}
    for field in SECRET_CONFIG_FIELDS:
        if data.get(field):
            data[field] = "***REDACTED***"
    return data


async def build_runner(
    prefix: str,
    *,
    overrides: dict[str, Any] | None = None,
) -> tuple[ArgusConfig, RunLogger, LLMClient, BochaProvider, VisitProvider, ArgusReproRunner]:
    config = load_config()
    if overrides:
        allowed = {field for field in config.__dataclass_fields__ if field != "outputs_dir"}
        clean = {key: value for key, value in overrides.items() if key in allowed and value is not None}
        if clean:
            config = replace(config, **clean)
    run_dir = make_run_dir(config, prefix)
    paths = RunPaths(run_dir)
    paths.ensure()
    logger = RunLogger(run_dir)
    write_json(paths.config, public_config_dict(config))
    llm = LLMClient(config, logger)
    bocha = BochaProvider(config, logger)
    await bocha.open()
    visit_provider = build_visit_provider(config, logger)
    navigator = Navigator(config, llm, logger)
    searcher = ReActSearcher(config, bocha, llm, visit_provider, logger)
    runner = ArgusReproRunner(config, navigator, searcher, run_dir, logger)
    logger.log("run_started", prefix=prefix, run_dir=str(run_dir))
    return config, logger, llm, bocha, visit_provider, runner


async def close_clients(llm: LLMClient, bocha: BochaProvider, visit_provider: VisitProvider | None = None) -> None:
    if visit_provider is not None:
        await visit_provider.close()
    await bocha.close()
    await llm.close()


def print_result_path(run_dir: Path) -> None:
    print(json.dumps({"run_dir": str(run_dir)}, ensure_ascii=False))
