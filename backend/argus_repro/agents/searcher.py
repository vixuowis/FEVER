from __future__ import annotations

from ..providers.bocha_provider import BochaProvider
from ..core.config import ArgusConfig
from ..providers.llm_client import LLMClient, LLMJSONParseError, LLMTextResponse
from ..core.logging_utils import RunLogger
from .prompts import react_searcher_action_prompt, react_searcher_forced_answer_prompt, visit_extraction_prompt
from ..core.schemas import LocalAnswer, QuerySpec, SearchResult, SearchStep, SearchTrajectory
from ..core.utils import normalize_url, token_budget_text, utc_now_iso
from ..providers.visit_provider import VisitProvider


class ReActSearcher:
    """Paper-aligned stateless Searcher with SEARCH, VISIT, and ANSWER actions.

    SEARCH returns shallow result metadata without Bocha summaries. VISIT uses
    the configured VisitProvider, then extracts goal-focused evidence for the
    assigned research question.
    """

    def __init__(
        self,
        config: ArgusConfig,
        search_provider: BochaProvider,
        llm: LLMClient,
        visit_provider: VisitProvider,
        logger: RunLogger | None = None,
    ):
        self.config = config
        self.search_provider = search_provider
        self.llm = llm
        self.logger = logger
        self.visit_provider = visit_provider

    async def run(self, spec: QuerySpec, searcher_id: str) -> SearchTrajectory:
        started_at = utc_now_iso()
        if self.logger:
            self.logger.log("searcher_start", searcher_id=searcher_id, query=spec.query, mode="react")

        steps: list[SearchStep] = []
        result_cache: dict[str, SearchResult] = {}
        result_key_to_id: dict[tuple[str, str, str, str, str, str], str] = {}
        result_order: list[str] = []
        visited_result_ids: set[str] = set()
        seen_search_queries: set[str] = set()
        searches_used = 0
        visits_used = 0
        local_answer: LocalAnswer | dict | None = None

        action_step_budget = max(1, self.config.max_searcher_steps - 1)
        for _step_idx in range(1, action_step_budget + 1):
            remaining_steps = self.config.max_searcher_steps - len(steps)
            state = self._trajectory_state(spec, steps)
            messages = react_searcher_action_prompt(
                spec.query,
                state,
                remaining_steps=remaining_steps,
            )
            response = None
            try:
                action, response = await self.llm.generate_json_response(
                    messages,
                    model=self.config.searcher_model,
                    temperature=0.1,
                    max_tokens=self._searcher_max_tokens(self.config.searcher_action_max_tokens),
                    enable_thinking=self.config.searcher_enable_thinking,
                    label="searcher_react_action",
                )
            except Exception as exc:  # noqa: BLE001
                response = self._response_from_exception(exc)
                if self.logger:
                    self.logger.log("searcher_react_action_fallback", searcher_id=searcher_id, error=str(exc))
                action = self._fallback_next_action(spec.query, searches_used, result_order, visited_result_ids)

            action_name = str(action.get("action") or "").upper()
            rationale = action.get("rationale") or ""
            if self.logger:
                self.logger.log(
                    "searcher_llm_step",
                    searcher_id=searcher_id,
                    step_index=_step_idx,
                    query=spec.query,
                    messages=messages,
                    raw_output=response.content if response else None,
                    reasoning_content=response.reasoning_content if response else None,
                    parsed_action=action,
                    prompt_tokens=response.prompt_tokens if response else None,
                    completion_tokens=response.completion_tokens if response else None,
                    total_tokens=response.total_tokens if response else None,
                    usage=response.usage if response else None,
                    enable_thinking=self.config.searcher_enable_thinking,
                )
            if action_name == "SEARCH":
                search_query = (action.get("query") or spec.query).strip() or spec.query
                search_key = self._normalize_search_query(search_query)
                if search_key in seen_search_queries:
                    steps.append(
                        self._correction_step(
                            step_index=_step_idx,
                            rationale=rationale,
                            action_input={**action, "query": search_query},
                            error="duplicate_search_query",
                            searches_used=searches_used,
                            visits_used=visits_used,
                            extra={
                                "duplicate_query": search_query,
                                "searched_queries": self._searched_queries(steps),
                                "unvisited_result_ids": [rid for rid in result_order if rid not in visited_result_ids],
                                "guidance": (
                                    "This Bocha web-search integration does not paginate. Repeating the same query "
                                    "returns the same top results. Choose VISIT for an unvisited relevant result, "
                                    "reformulate with materially different terms/source/language, or ANSWER with "
                                    "the gap marked unresolved."
                                ),
                            },
                        )
                    )
                    continue
                seen_search_queries.add(search_key)
                results = await self.search_provider.search(search_query, top_k=self.config.search_top_k, summary=False)
                searches_used += 1
                shallow_results = []
                for result in results:
                    result_id = self._get_or_create_result_id(result, result_cache, result_key_to_id, result_order)
                    shallow_results.append(self._shallow_result(result_id, result))
                if self.logger:
                    self.logger.log(
                        "searcher_search_tool_result",
                        searcher_id=searcher_id,
                        step_index=_step_idx,
                        query=search_query,
                        returned=len(shallow_results),
                    )
                steps.append(
                    SearchStep(
                        step_index=_step_idx,
                        action="SEARCH",
                        rationale=rationale,
                        query=search_query,
                        action_input={"query": search_query},
                        observation=shallow_results,
                    )
                )
                continue

            if action_name == "VISIT":
                result_id = action.get("result_id")
                url = action.get("url")
                result = self._resolve_result(action, result_cache, result_order, steps)
                if result is None:
                    steps.append(
                        self._correction_step(
                            step_index=_step_idx,
                            rationale=rationale,
                            action_input=action,
                            error="unknown_result_id_or_unseen_url",
                            searches_used=searches_used,
                            visits_used=visits_used,
                        )
                    )
                    continue
                visits_used += 1
                if result_id:
                    visited_result_ids.add(str(result_id))
                visit_goal = action.get("goal") or action.get("why") or spec.expected_evidence or spec.query
                observation = await self._visit_observation(result_id, url, result, spec, str(visit_goal), searcher_id)
                if self.logger:
                    self.logger.log(
                        "searcher_visit_tool_result",
                        searcher_id=searcher_id,
                        step_index=_step_idx,
                        result_id=observation.get("result_id") or result_id,
                        url=observation.get("url") or url,
                        visit_status=observation.get("visit_status"),
                        visit_provider=observation.get("visit_provider"),
                    )
                steps.append(
                    SearchStep(
                        step_index=_step_idx,
                        action="VISIT",
                        rationale=rationale,
                        url=observation.get("url") or url,
                        result_id=observation.get("result_id") or result_id,
                        action_input={
                            "result_id": result_id,
                            "url": url,
                            "why": action.get("why"),
                            "goal": visit_goal,
                        },
                        observation=observation,
                    )
                )
                continue

            if action_name == "ANSWER":
                if visits_used == 0 and result_order:
                    result_id = result_order[0]
                    result = result_cache.get(result_id)
                    visit_goal = spec.expected_evidence or spec.query
                    visits_used += 1
                    visited_result_ids.add(result_id)
                    observation = await self._visit_observation(
                        result_id,
                        result.url if result else None,
                        result,
                        spec,
                        visit_goal,
                        searcher_id,
                    )
                    if self.logger:
                        self.logger.log(
                            "searcher_visit_tool_result",
                            searcher_id=searcher_id,
                            step_index=_step_idx,
                            result_id=result_id,
                            url=observation.get("url"),
                            visit_status=observation.get("visit_status"),
                            visit_provider=observation.get("visit_provider"),
                            forced_before_answer=True,
                        )
                    steps.append(
                        SearchStep(
                            step_index=_step_idx,
                            action="VISIT",
                            rationale="Forced one cached VISIT before ANSWER to ground ReAct evidence.",
                            url=observation.get("url"),
                            result_id=result_id,
                            action_input={"result_id": result_id, "goal": visit_goal, "forced_before_answer": True},
                            observation=observation,
                        )
                    )
                    if self.logger:
                        self.logger.log("searcher_forced_visit_before_answer", searcher_id=searcher_id, result_id=result_id)
                    continue
                local_answer = self._validate_local_answer(self._local_answer_from_action(action), steps, spec.query)
                steps.append(SearchStep(step_index=_step_idx, action="ANSWER", rationale=rationale, observation=local_answer))
                break

            steps.append(
                self._correction_step(
                    step_index=_step_idx,
                    rationale=rationale,
                    action_input=action,
                    error="invalid_action",
                    searches_used=searches_used,
                    visits_used=visits_used,
                )
            )

        if local_answer is None:
            local_answer = await self._forced_answer(spec, steps, searcher_id)
            steps.append(
                SearchStep(
                    step_index=len(steps) + 1,
                    action="ANSWER",
                    rationale="Forced answer after Searcher step budget exhausted.",
                    observation=local_answer,
                )
            )

        finished_at = utc_now_iso()
        trajectory = SearchTrajectory(
            searcher_id=searcher_id,
            query=spec.query,
            angle=spec.angle,
            why=spec.why,
            target_claim_or_aspect=spec.target_claim_or_aspect,
            expected_evidence=spec.expected_evidence,
            search_language=spec.search_language,
            source_preference=spec.source_preference,
            entity_aliases=spec.entity_aliases,
            avoid_scope=spec.avoid_scope,
            must_verify=spec.must_verify,
            starter_queries=spec.starter_queries,
            priority=spec.priority,
            steps=steps,
            results=[],
            local_answer=local_answer,
            started_at=started_at,
            finished_at=finished_at,
        )
        if self.logger:
            self.logger.log(
                "searcher_finish",
                searcher_id=searcher_id,
                query=spec.query,
                mode="react",
                searches_used=searches_used,
                visits_used=visits_used,
                steps=len(steps),
            )
        return trajectory

    async def _forced_answer(
        self,
        spec: QuerySpec,
        steps: list[SearchStep],
        searcher_id: str,
    ) -> dict:
        state = self._trajectory_state(spec, steps)
        try:
            messages = react_searcher_forced_answer_prompt(spec.query, state)
            data, response = await self.llm.generate_json_response(
                messages,
                model=self.config.searcher_model,
                temperature=0.0,
                max_tokens=self._searcher_max_tokens(self.config.searcher_forced_answer_max_tokens),
                enable_thinking=self.config.searcher_enable_thinking,
                label="searcher_react_forced_answer",
            )
            if self.logger:
                self.logger.log(
                    "searcher_llm_forced_answer",
                    searcher_id=searcher_id,
                    query=spec.query,
                    messages=messages,
                    raw_output=response.content,
                    reasoning_content=response.reasoning_content,
                    parsed_output=data,
                    prompt_tokens=response.prompt_tokens,
                    completion_tokens=response.completion_tokens,
                    total_tokens=response.total_tokens,
                    usage=response.usage,
                    enable_thinking=self.config.searcher_enable_thinking,
                )
            return self._validate_local_answer(self._local_answer_from_action(data), steps, spec.query)
        except Exception as exc:  # noqa: BLE001
            response = self._response_from_exception(exc)
            if self.logger and response is not None:
                self.logger.log(
                    "searcher_llm_forced_answer_failed_response",
                    searcher_id=searcher_id,
                    query=spec.query,
                    messages=messages if "messages" in locals() else None,
                    raw_output=response.content,
                    reasoning_content=response.reasoning_content,
                    prompt_tokens=response.prompt_tokens,
                    completion_tokens=response.completion_tokens,
                    total_tokens=response.total_tokens,
                    usage=response.usage,
                    enable_thinking=self.config.searcher_enable_thinking,
                )
            if self.logger:
                self.logger.log("searcher_react_forced_answer_fallback", searcher_id=searcher_id, error=str(exc))
            visited_urls = []
            evidence_bits = []
            for step in steps:
                if step.action != "VISIT" or not isinstance(step.observation, dict):
                    continue
                url = step.observation.get("url")
                if url:
                    visited_urls.append(url)
                text = step.observation.get("page_text")
                if text:
                    evidence_bits.append(text[:240])
            return {
                "local_answer": " ".join(evidence_bits)[:900]
                or "Searcher did not extract enough visited evidence for a confident local answer.",
                "key_claims": [
                    {
                        "claim": f"Visited search results may contain evidence for '{spec.query}'.",
                        "evidence_urls": visited_urls[:4],
                        "rationale": "Fallback answer after forced answer generation failed.",
                        "confidence": 0.2,
                        "unresolved": True,
                    }
                ],
                "unresolved_questions": ["Navigator should verify this Searcher fallback."],
            }

    @staticmethod
    def _result_id(index: int) -> str:
        return f"R{index}"

    @staticmethod
    def _result_key(result: SearchResult) -> tuple[str, str, str, str, str, str]:
        return (
            result.title or "",
            result.url or "",
            result.source or "",
            result.published_time or "",
            result.snippet or "",
            result.summary or "",
        )

    @classmethod
    def _get_or_create_result_id(
        cls,
        result: SearchResult,
        result_cache: dict[str, SearchResult],
        result_key_to_id: dict[tuple[str, str, str, str, str, str], str],
        result_order: list[str],
    ) -> str:
        key = cls._result_key(result)
        if key in result_key_to_id:
            return result_key_to_id[key]
        result_id = cls._result_id(len(result_order) + 1)
        result_cache[result_id] = result
        result_order.append(result_id)
        result_key_to_id[key] = result_id
        return result_id

    @staticmethod
    def _shallow_result(result_id: str, result: SearchResult) -> dict:
        return {
            "result_id": result_id,
            "rank": result.rank,
            "title": result.title,
            "url": result.url,
            "source": result.source,
            "published_time": result.published_time,
            "snippet": result.snippet,
        }

    async def _visit_observation(
        self,
        result_id: str | None,
        url: str | None,
        result: SearchResult | None,
        spec: QuerySpec,
        visit_goal: str,
        searcher_id: str,
    ) -> dict:
        if result is None:
            return {
                "result_id": result_id,
                "url": url,
                "visit_status": "not_found_in_search_cache",
                "page_text": "",
            }
        try:
            visit = await self.visit_provider.visit(result, result_id=result_id, goal=visit_goal)
            observation = visit.to_observation(result_id=result_id)
            return await self._extract_visit_observation(observation, result, spec, visit_goal, searcher_id)
        except Exception as exc:  # noqa: BLE001
            if self.logger:
                self.logger.log("visit_failed", result_id=result_id, url=result.url, provider=self.config.visit_provider, error=str(exc))
            return {
                "result_id": result_id,
                "url": result.url,
                "page_text": "",
                "visit_status": "visit_failed",
                "visit_provider": self.config.visit_provider,
                "error": str(exc),
            }

    async def _extract_visit_observation(
        self,
        observation: dict,
        result: SearchResult,
        spec: QuerySpec,
        visit_goal: str,
        searcher_id: str,
    ) -> dict:
        raw_page_text = observation.get("page_text") or ""
        observation["goal"] = visit_goal
        observation["raw_page_text_chars"] = len(raw_page_text)
        if not raw_page_text:
            return observation

        page_text_view = token_budget_text(
            raw_page_text,
            max_tokens=self.config.searcher_visit_extraction_input_max_tokens,
        )
        messages = visit_extraction_prompt(
            assigned_question=spec.query,
            visit_goal=visit_goal,
            source_url=observation.get("url") or result.url,
            source_title=result.title,
            page_text=page_text_view,
        )
        try:
            data, response = await self.llm.generate_json_response(
                messages,
                model=self.config.summary_model,
                temperature=0.0,
                max_tokens=self._searcher_max_tokens(self.config.searcher_visit_extraction_max_tokens),
                enable_thinking=self.config.searcher_enable_thinking,
                label="searcher_visit_extraction",
            )
            extracted = self._format_visit_extraction(observation.get("url") or result.url, visit_goal, data)
            if self.logger:
                self.logger.log(
                    "searcher_visit_extraction",
                    searcher_id=searcher_id,
                    url=observation.get("url") or result.url,
                    result_id=observation.get("result_id"),
                    goal=visit_goal,
                    messages=messages,
                    raw_output=response.content,
                    reasoning_content=response.reasoning_content,
                    parsed_output=data,
                    prompt_tokens=response.prompt_tokens,
                    completion_tokens=response.completion_tokens,
                    total_tokens=response.total_tokens,
                    usage=response.usage,
                    raw_page_text_chars=len(raw_page_text),
                    extracted_chars=len(extracted),
                )
            return {
                **observation,
                "page_text": extracted,
                "visit_extraction": data,
                "page_text_chars_original": len(raw_page_text),
            }
        except Exception as exc:  # noqa: BLE001
            response = self._response_from_exception(exc)
            if self.logger:
                self.logger.log(
                    "searcher_visit_extraction_fallback",
                    searcher_id=searcher_id,
                    url=observation.get("url") or result.url,
                    result_id=observation.get("result_id"),
                    goal=visit_goal,
                    error=str(exc),
                    raw_output=response.content if response else None,
                    reasoning_content=response.reasoning_content if response else None,
                )
            fallback_text = token_budget_text(
                raw_page_text,
                max_tokens=self.config.searcher_visit_extraction_input_max_tokens,
            )
            return {
                **observation,
                "page_text": fallback_text,
                "visit_extraction": {
                    "rationale": "Visit extraction failed; returned focused reader text fallback.",
                    "evidence": fallback_text,
                    "summary": "Extraction failed.",
                    "relevance": "medium",
                    "missing": "Structured visit extraction failed.",
                },
                "page_text_chars_original": len(raw_page_text),
            }

    @staticmethod
    def _format_visit_extraction(url: str, goal: str, data: dict) -> str:
        return (
            f"The useful information in {url} for visit goal {goal} is as follows:\n\n"
            f"Relevance: {data.get('relevance') or ''}\n\n"
            f"Rationale:\n{data.get('rationale') or ''}\n\n"
            f"Evidence in page:\n{data.get('evidence') or ''}\n\n"
            f"Summary:\n{data.get('summary') or ''}\n\n"
            f"Missing:\n{data.get('missing') or 'None'}"
        )

    @classmethod
    def _resolve_result(
        cls,
        action: dict,
        result_cache: dict[str, SearchResult],
        result_order: list[str],
        steps: list[SearchStep],
    ) -> SearchResult | None:
        result_id = action.get("result_id")
        if result_id and result_id in result_cache:
            return result_cache[result_id]
        url = action.get("url")
        if isinstance(url, str) and url.startswith(("http://", "https://")):
            return SearchResult(title="Direct URL from Searcher action", url=url, source=None, rank=0)
        return None

    @staticmethod
    def _local_answer_from_action(action: dict) -> dict:
        return {
            "local_answer": action.get("local_answer") or "No confident local answer.",
            "key_claims": action.get("key_claims") or [],
            "unresolved_questions": action.get("unresolved_questions") or [],
        }

    @classmethod
    def _validate_local_answer(cls, answer: dict, steps: list[SearchStep], assigned_query: str) -> dict:
        visited_urls = cls._visited_urls(steps)
        unresolved_questions = list(answer.get("unresolved_questions") or [])
        cleaned_claims = []
        for claim in answer.get("key_claims") or []:
            if not isinstance(claim, dict):
                continue
            evidence_urls = [url for url in claim.get("evidence_urls") or [] if isinstance(url, str)]
            visited_evidence_urls = [url for url in evidence_urls if cls._url_matches_visited(url, visited_urls)]
            cleaned = dict(claim)
            cleaned["evidence_urls"] = visited_evidence_urls
            if not visited_evidence_urls:
                cleaned["unresolved"] = True
                cleaned["confidence"] = min(cls._safe_float(cleaned.get("confidence")), 0.2)
                rationale = cleaned.get("rationale") or ""
                if "visited evidence" not in rationale.lower():
                    cleaned["rationale"] = (rationale + " No cited URL was visited by this Searcher.").strip()
                unresolved_questions.append(f"Need visited evidence for claim: {cleaned.get('claim') or assigned_query}")
            cleaned_claims.append(cleaned)
        answer["key_claims"] = cleaned_claims
        if not visited_urls and cleaned_claims:
            answer["local_answer"] = (
                "This assigned research question remains unresolved because the Searcher has no visited evidence."
            )
        answer["unresolved_questions"] = list(dict.fromkeys(str(item) for item in unresolved_questions if item))
        return answer

    @staticmethod
    def _visited_urls(steps: list[SearchStep]) -> set[str]:
        urls: set[str] = set()
        for step in steps:
            if step.action != "VISIT" or not isinstance(step.observation, dict):
                continue
            url = step.observation.get("url")
            if isinstance(url, str) and url:
                urls.add(normalize_url(url))
        return urls

    @staticmethod
    def _url_matches_visited(url: str, visited_urls: set[str]) -> bool:
        clean = normalize_url(url)
        return clean in visited_urls

    @staticmethod
    def _safe_float(value: object, default: float = 0.0) -> float:
        try:
            return float(value or default)
        except (TypeError, ValueError):
            return default

    @staticmethod
    def _fallback_next_action(
        query: str,
        searches_used: int,
        result_order: list[str],
        visited_result_ids: set[str],
    ) -> dict:
        if searches_used == 0:
            return {"rationale": "Fallback starts with a direct search.", "action": "SEARCH", "query": query}
        for result_id in result_order:
            if result_id not in visited_result_ids:
                return {"rationale": "Fallback visits the next unvisited cached result.", "action": "VISIT", "result_id": result_id}
        return {
            "rationale": "Fallback answers conservatively.",
            "action": "ANSWER",
            "local_answer": "No further unvisited search results are available for a confident local answer.",
            "key_claims": [],
            "unresolved_questions": [query],
        }

    @staticmethod
    def _response_from_exception(exc: Exception) -> LLMTextResponse | None:
        if isinstance(exc, LLMJSONParseError):
            return exc.response
        return None

    @staticmethod
    def _normalize_search_query(query: str) -> str:
        return " ".join((query or "").casefold().split())

    @staticmethod
    def _searched_queries(steps: list[SearchStep]) -> list[str]:
        queries: list[str] = []
        seen: set[str] = set()
        for step in steps:
            if step.action != "SEARCH" or not step.query:
                continue
            key = ReActSearcher._normalize_search_query(step.query)
            if key in seen:
                continue
            seen.add(key)
            queries.append(step.query)
        return queries

    def _searcher_max_tokens(self, base: int) -> int:
        if not self.config.searcher_enable_thinking:
            return base
        multiplier = max(1.0, self.config.searcher_thinking_token_multiplier)
        expanded = max(base, int(base * multiplier))
        if self.config.json_retry_max_tokens > 0:
            return min(self.config.json_retry_max_tokens, expanded)
        return expanded

    @staticmethod
    def _correction_step(
        *,
        step_index: int,
        rationale: str,
        action_input: dict,
        error: str,
        searches_used: int,
        visits_used: int,
        extra: dict | None = None,
    ) -> SearchStep:
        action_name = str(action_input.get("action") or "").upper()
        observation = {
            "error": error,
            "requested_action": action_name,
            "requested_result_id": action_input.get("result_id"),
            "searches_used": searches_used,
            "visits_used": visits_used,
        }
        if extra:
            observation.update(extra)
        return SearchStep(
            step_index=step_index,
            action="CORRECTION",
            rationale=rationale,
            action_input=action_input,
            observation=observation,
        )

    def _trajectory_state(
        self,
        spec: QuerySpec,
        steps: list[SearchStep],
    ) -> dict:
        compact_steps = []
        for step in steps:
            obs = step.observation
            if step.action == "VISIT" and isinstance(obs, dict):
                obs = {
                    "result_id": obs.get("result_id"),
                    "url": obs.get("url"),
                    "page_text": obs.get("page_text") or "",
                    "page_text_chars_original": obs.get("page_text_chars_original") or len(obs.get("page_text") or ""),
                    "raw_page_text_chars": obs.get("raw_page_text_chars"),
                    "goal": obs.get("goal"),
                    "visit_extraction": obs.get("visit_extraction"),
                    "links": obs.get("links") or [],
                    "tables": obs.get("tables") or [],
                    "data_endpoints": obs.get("data_endpoints") or [],
                    "visit_status": obs.get("visit_status"),
                    "visit_provider": obs.get("visit_provider"),
                    "error": obs.get("error"),
                }
            compact_steps.append(
                {
                    "action": step.action,
                    "rationale": step.rationale,
                    "query": step.query,
                    "result_id": step.result_id,
                    "url": step.url,
                    "observation": obs,
                }
            )
        return {
            "assigned_question": spec.query,
            "research_focus": spec.angle,
            "why": spec.why,
            "target_claim_or_aspect": spec.target_claim_or_aspect,
            "expected_evidence": spec.expected_evidence,
            "search_language": spec.search_language,
            "source_preference": spec.source_preference,
            "entity_aliases": spec.entity_aliases,
            "avoid_scope": spec.avoid_scope,
            "must_verify": spec.must_verify,
            "starter_queries": spec.starter_queries,
            "priority": spec.priority,
            "angle": spec.angle,
            "steps": compact_steps,
        }
