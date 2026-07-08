from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import httpx
from openai import AsyncOpenAI

from ..core.config import ArgusConfig
from ..core.logging_utils import RunLogger
from ..core.utils import extract_json_object, retry_async


@dataclass
class LLMTextResponse:
    content: str
    reasoning_content: str | None
    finish_reason: str | None
    prompt_tokens: int | None
    completion_tokens: int | None
    total_tokens: int | None
    usage: dict[str, Any] | None = None


class LLMJSONParseError(RuntimeError):
    def __init__(self, label: str, original_error: Exception | None, response: LLMTextResponse | None):
        super().__init__(f"{label} JSON parse failed: {original_error}")
        self.original_error = original_error
        self.response = response


class LLMClient:
    def __init__(self, config: ArgusConfig, logger: RunLogger | None = None):
        self.config = config
        self.logger = logger
        self._http_client = httpx.AsyncClient(trust_env=False, timeout=120.0)
        self._client = AsyncOpenAI(
            api_key=config.dashscope_api_key,
            base_url=config.dashscope_base_url,
            http_client=self._http_client,
        )

    async def close(self) -> None:
        await self._http_client.aclose()

    async def generate_response(
        self,
        messages: list[dict[str, str]],
        *,
        model: str | None = None,
        temperature: float = 0.2,
        max_tokens: int = 2048,
        json_mode: bool = False,
        enable_thinking: bool | None = None,
        label: str = "llm",
    ) -> LLMTextResponse:
        request_model = model or self.config.llm_model
        thinking_enabled = bool(enable_thinking) if enable_thinking is not None else False

        async def _call() -> LLMTextResponse:
            kwargs: dict[str, Any] = {
                "model": request_model,
                "messages": messages,
                "temperature": temperature,
                "max_tokens": max_tokens,
                "extra_body": {"enable_thinking": thinking_enabled},
            }
            if json_mode:
                kwargs["response_format"] = {"type": "json_object"}
            resp = await self._client.chat.completions.create(**kwargs)
            message = resp.choices[0].message
            content = message.content or ""
            reasoning_content = getattr(message, "reasoning_content", None)
            finish_reason = getattr(resp.choices[0], "finish_reason", None)
            usage = getattr(resp, "usage", None)
            prompt_tokens = getattr(usage, "prompt_tokens", None)
            completion_tokens = getattr(usage, "completion_tokens", None)
            total_tokens = getattr(usage, "total_tokens", None)
            usage_dict = None
            if usage is not None:
                if hasattr(usage, "model_dump"):
                    usage_dict = usage.model_dump()
                elif isinstance(usage, dict):
                    usage_dict = usage
            if self.logger:
                self.logger.log(
                    "llm_call",
                    label=label,
                    model=request_model,
                    enable_thinking=thinking_enabled,
                    prompt_tokens=prompt_tokens,
                    completion_tokens=completion_tokens,
                    total_tokens=total_tokens,
                    max_tokens=max_tokens,
                    finish_reason=finish_reason,
                    output_chars=len(content),
                    reasoning_chars=len(reasoning_content or ""),
                    usage=usage_dict,
                )
            return LLMTextResponse(
                content=content,
                reasoning_content=reasoning_content,
                finish_reason=finish_reason,
                prompt_tokens=prompt_tokens,
                completion_tokens=completion_tokens,
                total_tokens=total_tokens,
                usage=usage_dict,
            )

        return await retry_async(label, _call, attempts=self.config.retry_attempts)

    async def generate(
        self,
        messages: list[dict[str, str]],
        *,
        model: str | None = None,
        temperature: float = 0.2,
        max_tokens: int = 2048,
        json_mode: bool = False,
        enable_thinking: bool | None = None,
        label: str = "llm",
    ) -> str:
        resp = await self.generate_response(
            messages,
            model=model,
            temperature=temperature,
            max_tokens=max_tokens,
            json_mode=json_mode,
            enable_thinking=enable_thinking,
            label=label,
        )
        return resp.content

    async def generate_json(
        self,
        messages: list[dict[str, str]],
        *,
        model: str | None = None,
        temperature: float = 0.0,
        max_tokens: int = 2048,
        enable_thinking: bool | None = None,
        label: str = "llm_json",
    ) -> Any:
        data, _resp = await self.generate_json_response(
            messages,
            model=model,
            temperature=temperature,
            max_tokens=max_tokens,
            enable_thinking=enable_thinking,
            label=label,
        )
        return data

    async def generate_json_response(
        self,
        messages: list[dict[str, str]],
        *,
        model: str | None = None,
        temperature: float = 0.0,
        max_tokens: int = 2048,
        enable_thinking: bool | None = None,
        label: str = "llm_json",
    ) -> tuple[Any, LLMTextResponse]:
        current_max_tokens = max_tokens
        last_error: Exception | None = None
        last_response: LLMTextResponse | None = None
        for attempt in range(1, self.config.json_retry_attempts + 1):
            resp = await self.generate_response(
                messages,
                model=model,
                temperature=temperature,
                max_tokens=current_max_tokens,
                json_mode=True,
                enable_thinking=enable_thinking,
                label=label,
            )
            last_response = resp
            try:
                return extract_json_object(resp.content), resp
            except Exception as exc:  # noqa: BLE001
                last_error = exc
                truncated = self._looks_truncated(resp, current_max_tokens)
                if self.logger:
                    self.logger.log(
                        "llm_json_parse_error",
                        label=label,
                        attempt=attempt,
                        max_tokens=current_max_tokens,
                        finish_reason=resp.finish_reason,
                        completion_tokens=resp.completion_tokens,
                        truncated=truncated,
                        text=resp.content[:2000],
                        error=str(exc),
                    )
                if not truncated or attempt >= self.config.json_retry_attempts:
                    break
                next_max_tokens = current_max_tokens + self.config.json_retry_token_step
                if self.config.json_retry_max_tokens > 0:
                    next_max_tokens = min(self.config.json_retry_max_tokens, next_max_tokens)
                if next_max_tokens <= current_max_tokens:
                    break
                current_max_tokens = next_max_tokens
                if self.logger:
                    self.logger.log(
                        "llm_json_retry_expand_budget",
                        label=label,
                        attempt=attempt + 1,
                        next_max_tokens=current_max_tokens,
                    )
        if self.logger:
            self.logger.log("llm_json_parse_failed", label=label, error=str(last_error))
        raise LLMJSONParseError(label, last_error, last_response)

    @staticmethod
    def _looks_truncated(resp: LLMTextResponse, max_tokens: int) -> bool:
        if resp.finish_reason == "length":
            return True
        if resp.completion_tokens is not None and resp.completion_tokens >= max_tokens - 8:
            return True
        text = resp.content.rstrip()
        if not text:
            return False
        return not (text.endswith("}") or text.endswith("]"))
