from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv


ROOT_DIR = Path(__file__).resolve().parents[2]
DEFAULT_ENV_PATH = ROOT_DIR / ".env"


@dataclass(frozen=True)
class ArgusConfig:
    dashscope_api_key: str
    dashscope_base_url: str
    llm_model: str
    searcher_model: str
    summary_model: str
    graph_extraction_model: str
    graph_compaction_model: str
    verification_model: str
    synthesis_model: str
    navigator_planning_model: str
    judge_model: str
    bocha_api_key: str
    bocha_base_url: str
    jina_api_key: str | None
    jina_reader_base_url: str
    max_initial_dispatch: int
    max_rounds: int
    max_searcher_calls: int
    search_top_k: int
    max_dispatch_per_round: int
    searcher_enable_thinking: bool
    navigator_enable_thinking: bool
    searcher_concurrency: int
    trajectory_window_size: int
    trajectory_window_stride: int
    max_searcher_steps: int
    searcher_action_max_tokens: int
    searcher_forced_answer_max_tokens: int
    searcher_visit_extraction_max_tokens: int
    searcher_visit_extraction_input_max_tokens: int
    searcher_thinking_token_multiplier: float
    navigator_initial_query_max_tokens: int
    navigator_graph_extraction_max_tokens: int
    navigator_verification_max_tokens: int
    navigator_compaction_max_tokens: int
    navigator_followup_max_tokens: int
    navigator_synthesis_max_tokens: int
    navigator_thinking_token_multiplier: float
    visit_provider: str
    visit_timeout: int
    visit_trust_env: bool
    crawl4ai_proxy: str | None
    retry_attempts: int
    json_retry_attempts: int
    json_retry_token_step: int
    json_retry_max_tokens: int
    outputs_dir: Path


def _get_int(name: str, default: int) -> int:
    value = os.environ.get(name)
    if not value:
        return default
    return int(value)


def _get_bool(name: str, default: bool) -> bool:
    value = os.environ.get(name)
    if value is None or value == "":
        return default
    return value.strip().lower() in {"1", "true", "yes", "y", "on"}


def _get_float(name: str, default: float) -> float:
    value = os.environ.get(name)
    if not value:
        return default
    return float(value)


def load_config(env_path: Path | str | None = None) -> ArgusConfig:
    path = Path(env_path) if env_path else DEFAULT_ENV_PATH
    if path.exists():
        load_dotenv(path, override=False)

    dashscope_api_key = os.environ.get("DASHSCOPE_API_KEY") or os.environ.get("OPENAI_API_KEY")
    bocha_api_key = os.environ.get("BOCHA_API_KEY")
    if not dashscope_api_key:
        raise RuntimeError("DASHSCOPE_API_KEY or OPENAI_API_KEY is required")
    if not bocha_api_key:
        raise RuntimeError("BOCHA_API_KEY is required")

    return ArgusConfig(
        dashscope_api_key=dashscope_api_key,
        dashscope_base_url=os.environ.get(
            "DASHSCOPE_BASE_URL",
            os.environ.get("OPENAI_BASE_URL", "https://dashscope.aliyuncs.com/compatible-mode/v1"),
        ),
        llm_model=os.environ.get("ARGUS_LLM_MODEL", "glm-5.2"),
        searcher_model=os.environ.get("ARGUS_SEARCHER_MODEL", os.environ.get("ARGUS_LLM_MODEL", "glm-5.2")),
        summary_model=os.environ.get("ARGUS_SUMMARY_MODEL", "deepseek-v4-flash"),
        graph_extraction_model=os.environ.get("ARGUS_GRAPH_EXTRACTION_MODEL", "qwen3.7-plus"),
        graph_compaction_model=os.environ.get(
            "ARGUS_GRAPH_COMPACTION_MODEL",
            os.environ.get("ARGUS_GRAPH_EXTRACTION_MODEL", "qwen3.7-plus"),
        ),
        verification_model=os.environ.get("ARGUS_VERIFICATION_MODEL", os.environ.get("ARGUS_LLM_MODEL", "glm-5.2")),
        synthesis_model=os.environ.get("ARGUS_SYNTHESIS_MODEL", "qwen3.7-plus"),
        navigator_planning_model=os.environ.get(
            "ARGUS_NAVIGATOR_PLANNING_MODEL",
            os.environ.get("ARGUS_LLM_MODEL", "glm-5.2"),
        ),
        judge_model=os.environ.get("ARGUS_JUDGE_MODEL", "deepseek-v4-pro"),
        bocha_api_key=bocha_api_key,
        bocha_base_url=os.environ.get("BOCHA_BASE_URL", "https://api.bocha.cn/v1"),
        jina_api_key=os.environ.get("JINA_API_KEY"),
        jina_reader_base_url=os.environ.get("JINA_READER_BASE_URL", "https://r.jina.ai"),
        max_initial_dispatch=_get_int("ARGUS_MAX_INITIAL_DISPATCH", 4),
        max_rounds=_get_int("ARGUS_MAX_ROUNDS", 16),
        max_searcher_calls=_get_int("ARGUS_MAX_SEARCHER_CALLS", 64),
        search_top_k=_get_int("ARGUS_SEARCH_TOP_K", 10),
        max_dispatch_per_round=_get_int("ARGUS_MAX_DISPATCH_PER_ROUND", 8),
        searcher_enable_thinking=_get_bool("ARGUS_SEARCHER_ENABLE_THINKING", False),
        navigator_enable_thinking=_get_bool("ARGUS_NAVIGATOR_ENABLE_THINKING", False),
        searcher_concurrency=_get_int("ARGUS_SEARCHER_CONCURRENCY", 16),
        trajectory_window_size=_get_int("ARGUS_TRAJECTORY_WINDOW_SIZE", 16),
        trajectory_window_stride=_get_int("ARGUS_TRAJECTORY_WINDOW_STRIDE", 8),
        max_searcher_steps=_get_int("ARGUS_MAX_SEARCHER_STEPS", 12),
        searcher_action_max_tokens=_get_int("ARGUS_SEARCHER_ACTION_MAX_TOKENS", 3072),
        searcher_forced_answer_max_tokens=_get_int("ARGUS_SEARCHER_FORCED_ANSWER_MAX_TOKENS", 3072),
        searcher_visit_extraction_max_tokens=_get_int("ARGUS_SEARCHER_VISIT_EXTRACTION_MAX_TOKENS", 4096),
        searcher_visit_extraction_input_max_tokens=_get_int("ARGUS_SEARCHER_VISIT_EXTRACTION_INPUT_MAX_TOKENS", 50000),
        searcher_thinking_token_multiplier=_get_float("ARGUS_SEARCHER_THINKING_TOKEN_MULTIPLIER", 2.0),
        navigator_initial_query_max_tokens=_get_int("ARGUS_NAVIGATOR_INITIAL_QUERY_MAX_TOKENS", 4096),
        navigator_graph_extraction_max_tokens=_get_int("ARGUS_NAVIGATOR_GRAPH_EXTRACTION_MAX_TOKENS", 16384),
        navigator_verification_max_tokens=_get_int("ARGUS_NAVIGATOR_VERIFICATION_MAX_TOKENS", 16384),
        navigator_compaction_max_tokens=_get_int("ARGUS_NAVIGATOR_COMPACTION_MAX_TOKENS", 8192),
        navigator_followup_max_tokens=_get_int("ARGUS_NAVIGATOR_FOLLOWUP_MAX_TOKENS", 8192),
        navigator_synthesis_max_tokens=_get_int("ARGUS_NAVIGATOR_SYNTHESIS_MAX_TOKENS", 16384),
        navigator_thinking_token_multiplier=_get_float("ARGUS_NAVIGATOR_THINKING_TOKEN_MULTIPLIER", 2.0),
        visit_provider=os.environ.get("ARGUS_VISIT_PROVIDER", "jina_reader").strip().lower(),
        visit_timeout=_get_int("ARGUS_VISIT_TIMEOUT", 45),
        visit_trust_env=_get_bool("ARGUS_VISIT_TRUST_ENV", True),
        crawl4ai_proxy=os.environ.get("ARGUS_CRAWL4AI_PROXY")
        or os.environ.get("https_proxy")
        or os.environ.get("http_proxy"),
        retry_attempts=_get_int("ARGUS_RETRY_ATTEMPTS", 4),
        json_retry_attempts=_get_int("ARGUS_JSON_RETRY_ATTEMPTS", 3),
        json_retry_token_step=_get_int("ARGUS_JSON_RETRY_TOKEN_STEP", 500),
        json_retry_max_tokens=_get_int("ARGUS_JSON_RETRY_MAX_TOKENS", 0),
        outputs_dir=ROOT_DIR / "outputs",
    )
