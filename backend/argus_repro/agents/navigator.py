from __future__ import annotations

import asyncio
import re
from pathlib import Path
from typing import Any

from ..core.config import ArgusConfig
from ..graph.builder import GraphBuilder, graph_stats
from ..providers.llm_client import LLMClient
from ..core.logging_utils import RunLogger
from ..core.run_paths import RunPaths
from .prompts import (
    followup_prompt,
    graph_compaction_prompt,
    graph_extraction_prompt,
    initial_query_prompt,
    synthesis_prompt,
    verification_prompt,
)
from ..core.schemas import EvidenceGraph, FinalAnswer, FinalClaim, QuerySpec, SearchTrajectory
from .searcher import ReActSearcher
from ..core.utils import append_jsonl, utc_now_iso, write_json


class Navigator:
    def __init__(self, config: ArgusConfig, llm: LLMClient, logger: RunLogger | None = None):
        self.config = config
        self.llm = llm
        self.logger = logger

    async def generate_initial_queries(self, question: str, max_dispatch: int, remaining_budget: int) -> list[QuerySpec]:
        cap = max(0, min(max_dispatch, remaining_budget))
        if cap <= 0:
            return []
        try:
            data = await self._generate_json_logged(
                "navigator_initial_queries",
                initial_query_prompt(question, cap, remaining_budget),
                model=self.config.navigator_planning_model,
                temperature=0.5,
                max_tokens=self.config.navigator_initial_query_max_tokens,
            )
            specs = [QuerySpec.model_validate(item) for item in data.get("queries", [])]
        except Exception as exc:  # noqa: BLE001
            if self.logger:
                self.logger.log("navigator_initial_queries_fallback", error=str(exc))
            specs = [
                QuerySpec(
                    query=question,
                    angle="Fallback standalone research question",
                    why="Initial query generation failed; use the original question as a self-contained task.",
                    target_claim_or_aspect="Answer the original question directly.",
                    expected_evidence="Visited authoritative web evidence sufficient to answer the question.",
                    source_preference="authoritative primary or high-quality secondary source",
                    priority="high",
                )
            ]
        return self._sanitize_initial_queries(question, self._dedupe_queries(specs))[:cap]

    async def extract_graph(
        self,
        question: str,
        trajectory: SearchTrajectory,
        current_graph: EvidenceGraph,
    ) -> dict[str, Any]:
        try:
            return await self._generate_json_logged(
                "navigator_graph_extraction",
                graph_extraction_prompt(question, trajectory, current_graph, self.config),
                model=self.config.graph_extraction_model,
                temperature=0.0,
                max_tokens=self.config.navigator_graph_extraction_max_tokens,
                context={"searcher_id": trajectory.searcher_id, "graph_stats_before": graph_stats(current_graph)},
            )
        except Exception as exc:  # noqa: BLE001
            if self.logger:
                self.logger.log(
                    "navigator_graph_extraction_fallback",
                    searcher_id=trajectory.searcher_id,
                    query=trajectory.query,
                    error=str(exc),
                )
            return self._fallback_partial_graph(trajectory)

    async def verify_graph(self, question: str, graph: EvidenceGraph) -> dict[str, Any]:
        try:
            return await self._generate_json_logged(
                "navigator_verification",
                verification_prompt(question, graph, self.config),
                model=self.config.verification_model,
                temperature=0.0,
                max_tokens=self.config.navigator_verification_max_tokens,
                context={"graph_stats_before": graph_stats(graph)},
            )
        except Exception as exc:  # noqa: BLE001
            if self.logger:
                self.logger.log(
                    "navigator_verification_fallback",
                    error=str(exc),
                    evidence_nodes=len(graph.evidence_nodes),
                    claim_nodes=len(graph.claim_nodes),
                )
            return {
                "claim_updates": [],
                "missing_aspects": [
                    {
                        "aspect": "Graph-level verification could not be parsed successfully.",
                        "why_missing": "The Navigator verification JSON output was invalid; continue conservatively.",
                        "suggested_queries": [],
                        "priority": "high",
                    }
                ],
                "answer_path_requirements": [
                    {
                        "requirement": "Verify all bridge facts required to answer the original question.",
                        "covered_by_claim_ids": [],
                        "status": "missing",
                        "needed_query": "Find authoritative evidence for every bridge fact required by the original question.",
                    }
                ],
                "sufficient": False,
                "stop_reason": "Verification fallback used because JSON parsing failed.",
            }

    async def compact_graph(self, question: str, graph: EvidenceGraph) -> dict[str, Any]:
        if len(graph.claim_nodes) < 2:
            return {"merge_groups": []}
        try:
            return await self._generate_json_logged(
                "navigator_graph_compaction",
                graph_compaction_prompt(question, graph),
                model=self.config.graph_compaction_model,
                temperature=0.0,
                max_tokens=self.config.navigator_compaction_max_tokens,
                context={"graph_stats_before": graph_stats(graph)},
            )
        except Exception as exc:  # noqa: BLE001
            if self.logger:
                self.logger.log("navigator_graph_compaction_fallback", error=str(exc))
            return {"merge_groups": []}

    async def generate_followups(
        self,
        question: str,
        graph: EvidenceGraph,
        *,
        max_dispatch: int,
        remaining_budget: int,
    ) -> list[QuerySpec]:
        cap = max(0, min(max_dispatch, remaining_budget))
        if cap <= 0:
            return []
        try:
            data = await self._generate_json_logged(
                "navigator_followups",
                followup_prompt(question, graph, max_dispatch=cap, remaining_budget=remaining_budget),
                model=self.config.navigator_planning_model,
                temperature=0.2,
                max_tokens=self.config.navigator_followup_max_tokens,
                context={"graph_stats_before": graph_stats(graph), "remaining_budget": remaining_budget},
            )
            if data.get("continue_search") is False:
                return []
            specs = [QuerySpec.model_validate(item) for item in data.get("queries", [])]
        except Exception as exc:  # noqa: BLE001
            if self.logger:
                self.logger.log("navigator_followups_fallback", error=str(exc))
            specs = self._fallback_followups(graph)
        existing = set()
        for ev in graph.evidence_nodes:
            existing.update(q.lower().strip() for q in ev.search_queries)
        return [q for q in self._dedupe_queries(specs) if q.query.lower().strip() not in existing][:cap]

    async def synthesize(self, question: str, graph: EvidenceGraph) -> FinalAnswer:
        try:
            data = await self._generate_json_logged(
                "navigator_synthesis",
                synthesis_prompt(question, graph),
                model=self.config.synthesis_model,
                temperature=0.2,
                max_tokens=self.config.navigator_synthesis_max_tokens,
                context={"graph_stats_before": graph_stats(graph)},
            )
            return self._validate_final_answer(FinalAnswer.model_validate(data), graph, question)
        except Exception as exc:  # noqa: BLE001
            if self.logger:
                self.logger.log("navigator_synthesis_fallback", error=str(exc))
            return self._validate_final_answer(self._fallback_final_answer(question, graph), graph, question)

    async def _generate_json_logged(
        self,
        label: str,
        messages: list[dict[str, str]],
        *,
        model: str,
        temperature: float,
        max_tokens: int,
        context: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        data, response = await self.llm.generate_json_response(
            messages,
            model=model,
            temperature=temperature,
            max_tokens=self._navigator_max_tokens(max_tokens),
            enable_thinking=self.config.navigator_enable_thinking,
            label=label,
        )
        if self.logger:
            self.logger.log(
                "navigator_llm_stage",
                label=label,
                messages=messages,
                raw_output=response.content,
                reasoning_content=response.reasoning_content,
                parsed_output=data,
                context=context or {},
                prompt_tokens=response.prompt_tokens,
                completion_tokens=response.completion_tokens,
                total_tokens=response.total_tokens,
                usage=response.usage,
                enable_thinking=self.config.navigator_enable_thinking,
                model=model,
            )
        return data

    def _navigator_max_tokens(self, base: int) -> int:
        if not self.config.navigator_enable_thinking:
            return base
        multiplier = max(1.0, self.config.navigator_thinking_token_multiplier)
        expanded = int(base * multiplier)
        if self.config.json_retry_max_tokens > 0:
            return min(self.config.json_retry_max_tokens, expanded)
        return expanded

    @staticmethod
    def _dedupe_queries(specs: list[QuerySpec]) -> list[QuerySpec]:
        seen: set[str] = set()
        out: list[QuerySpec] = []
        for spec in specs:
            key = " ".join(spec.query.lower().split())
            if not key or key in seen:
                continue
            seen.add(key)
            out.append(spec)
        return out

    @classmethod
    def _sanitize_initial_queries(cls, question: str, specs: list[QuerySpec]) -> list[QuerySpec]:
        out: list[QuerySpec] = []
        anchor_terms = cls._question_anchor_terms(question)
        for spec in specs:
            spec.expected_evidence = (
                "Authoritative visited-source evidence sufficient to answer the assigned research question; "
                "do not rely on search-result snippets or unverified prior knowledge."
            )
            spec.entity_aliases = cls._keep_anchor_items(spec.entity_aliases, anchor_terms)
            spec.starter_queries = cls._keep_anchor_items(spec.starter_queries, anchor_terms)
            if cls._looks_like_same_batch_downstream_leak(question, spec):
                continue
            out.append(spec)
        return out or specs[:1]

    @staticmethod
    def _keep_anchor_items(items: list[str], anchor_terms: set[str]) -> list[str]:
        if not anchor_terms:
            return items
        out: list[str] = []
        for item in items:
            text = str(item).lower()
            if any(term in text for term in anchor_terms):
                out.append(str(item))
        return out

    @staticmethod
    def _looks_like_same_batch_downstream_leak(question: str, spec: QuerySpec) -> bool:
        text = " ".join(
            str(item or "")
            for item in (
                spec.query,
                spec.angle,
                spec.why,
                spec.target_claim_or_aspect,
                spec.expected_evidence,
                spec.avoid_scope,
            )
        ).lower()
        dependency_markers = (
            "once the",
            "after confirming",
            "after the",
            "from the first query",
            "from the first searcher",
            "from the previous",
            "general knowledge",
            "given the",
            "known ",
            "\u5df2\u77e5",
            "\u786e\u8ba4\u540e",
            "\u7b2c\u4e00\u8df3",
        )
        if not any(marker in text for marker in dependency_markers):
            return False
        anchor_terms = Navigator._question_anchor_terms(question)
        if not anchor_terms:
            return False
        return not any(term in text for term in anchor_terms)

    @staticmethod
    def _question_anchor_terms(question: str) -> set[str]:
        lower = question.lower()
        terms = {term for term in re.findall(r"[a-zA-Z][a-zA-Z0-9_-]{3,}", lower)}
        generic_latin = {
            "what",
            "which",
            "where",
            "when",
            "whose",
            "city",
            "state",
            "capital",
            "located",
            "headquarters",
            "official",
        }
        terms -= generic_latin
        cjk_runs = re.findall(r"[\u4e00-\u9fff]{2,}", question)
        generic_cjk = {
            "\u6240\u5728",
            "\u57ce\u5e02",
            "\u9996\u5e9c",
            "\u603b\u90e8",
            "\u4ec0\u4e48",
            "\u54ea\u4e2a",
            "\u7684\u662f",
            "\u6240\u5728\u5dde",
        }
        for run in cjk_runs:
            if run not in generic_cjk:
                if len(run) <= 4:
                    terms.add(run.lower())
                else:
                    for size in (2, 3, 4):
                        for idx in range(0, len(run) - size + 1):
                            token = run[idx : idx + size]
                            if token not in generic_cjk:
                                terms.add(token.lower())
        return terms

    @staticmethod
    def _fallback_followups(graph: EvidenceGraph) -> list[QuerySpec]:
        specs: list[QuerySpec] = []
        for requirement in graph.answer_path_requirements:
            if requirement.status != "covered":
                specs.append(
                    QuerySpec(
                        query=requirement.needed_query or requirement.requirement,
                        angle=f"Resolve answer path requirement: {requirement.requirement}",
                        why="The answer path is incomplete.",
                        target_claim_or_aspect=requirement.requirement,
                        expected_evidence="Visited evidence that covers this required bridge fact.",
                        source_preference="authoritative source",
                        priority="high" if requirement.status == "missing" else "medium",
                    )
                )
        if specs:
            return specs
        for aspect in graph.missing_aspects:
            query = (aspect.suggested_queries or [aspect.aspect])[0]
            specs.append(
                QuerySpec(
                    query=query,
                    angle=f"Resolve missing aspect: {aspect.aspect}",
                    why=aspect.why_missing,
                    target_claim_or_aspect=aspect.aspect,
                    expected_evidence="Visited evidence that resolves this missing aspect.",
                    source_preference="authoritative source",
                    priority=aspect.priority,
                )
            )
        if specs:
            return specs
        for claim in graph.claim_nodes:
            if claim.status == "unverified":
                specs.append(
                    QuerySpec(
                        query=f"Find authoritative evidence for or against this claim: {claim.claim}",
                        angle="Fallback verification for unverified claim",
                        why=claim.needed_verification or "Claim remains unverified.",
                        target_claim_or_aspect=claim.claim,
                        expected_evidence="Visited evidence that supports or contradicts the claim.",
                        source_preference="authoritative independent source",
                        priority="high",
                    )
                )
        return specs

    @staticmethod
    def _validate_final_answer(answer: FinalAnswer, graph: EvidenceGraph, question: str = "") -> FinalAnswer:
        valid_eids = {ev.id for ev in graph.evidence_nodes}
        supported_eids = Navigator._supported_trace_evidence_ids(graph)
        uncertainties = list(answer.uncertainties)
        incomplete_requirements = [req for req in graph.answer_path_requirements if req.status != "covered"]
        for claim in answer.key_claims:
            claim.evidence_ids = [eid for eid in claim.evidence_ids if eid in valid_eids]
            if claim.status == "supported" and not claim.evidence_ids:
                claim.status = "uncertain"
                claim.source_trace_complete = False
                claim.missing_evidence_reason = "Missing valid evidence id."
                uncertainties.append(f"Missing valid evidence id for final claim: {claim.claim}")
            elif claim.status == "supported":
                if not any(eid in supported_eids for eid in claim.evidence_ids):
                    claim.status = "uncertain"
                    claim.source_trace_complete = False
                    claim.missing_evidence_reason = "Cited evidence is not tied to a supported graph claim."
                    uncertainties.append(f"Final claim cites evidence not tied to a supported graph claim: {claim.claim}")
                else:
                    claim.source_trace_complete = True
                    claim.missing_evidence_reason = None
            else:
                claim.source_trace_complete = bool(claim.evidence_ids and any(eid in supported_eids for eid in claim.evidence_ids))
            if (not graph.sufficient or incomplete_requirements) and claim.status == "supported":
                claim.status = "partially_supported"
                claim.missing_evidence_reason = (
                    "The graph is not sufficient for the full original question; this claim is only a partial current-evidence result."
                )
                uncertainties.append(f"Full answer path is incomplete for final claim: {claim.claim}")
        cited = {claim.evidence_ids[0] for claim in answer.key_claims if claim.evidence_ids}
        answer.citations = [citation for citation in answer.citations if citation.get("evidence_id") in valid_eids]
        for eid in cited:
            if not any(citation.get("evidence_id") == eid for citation in answer.citations):
                ev = next(ev for ev in graph.evidence_nodes if ev.id == eid)
                answer.citations.append({"evidence_id": eid, "url": ev.source_url, "title": ev.source_title})
        if not graph.sufficient or incomplete_requirements:
            for req in incomplete_requirements:
                uncertainties.append(f"Incomplete answer path requirement ({req.status}): {req.requirement}")
            prefix = Navigator._insufficient_answer_prefix(question)
            if not answer.answer.startswith(prefix):
                answer.answer = f"{prefix}{answer.answer}"
        answer.uncertainties = list(dict.fromkeys(uncertainties))
        return answer

    @staticmethod
    def _insufficient_answer_prefix(question: str) -> str:
        cjk = sum(1 for ch in question if "\u4e00" <= ch <= "\u9fff")
        latin = sum(1 for ch in question if ("a" <= ch.lower() <= "z"))
        if cjk >= latin and cjk > 0:
            return (
                "\u73b0\u6709\u8bc1\u636e\u56fe\u5c1a\u4e0d\u8db3\u4ee5\u4e25\u683c\u56de\u7b54"
                "\u539f\u95ee\u9898\uff1b\u4ee5\u4e0b\u53ea\u662f\u5f53\u524d\u8bc1\u636e"
                "\u4e2d\u7684\u5019\u9009\u6216\u90e8\u5206\u7ed3\u8bba\uff0c\u4e0d\u80fd"
                "\u89c6\u4e3a\u6700\u7ec8\u786e\u5b9a\u7b54\u6848\uff1a"
            )
        return (
            "The current evidence graph is not sufficient to answer the original question rigorously; "
            "the following is only a partial or candidate conclusion from current evidence, not a final certain answer: "
        )

    @staticmethod
    def _supported_trace_evidence_ids(graph: EvidenceGraph) -> set[str]:
        claims = {claim.id: claim for claim in graph.claim_nodes}
        supported_eids: set[str] = set()

        def collect(cid: str, seen: set[str] | None = None) -> set[str]:
            seen = seen or set()
            if cid in seen:
                return set()
            seen.add(cid)
            claim = claims.get(cid)
            if not claim or claim.status != "supported":
                return set()
            out = set(claim.supporting_evidence_ids)
            for child_cid in claim.supporting_claim_ids:
                out.update(collect(child_cid, seen))
            return out

        for cid in claims:
            supported_eids.update(collect(cid))
        return supported_eids

    @staticmethod
    def _fallback_final_answer(question: str, graph: EvidenceGraph) -> FinalAnswer:
        evidence_by_id = {ev.id: ev for ev in graph.evidence_nodes}
        supported = [claim for claim in graph.claim_nodes if claim.status == "supported" and claim.supporting_evidence_ids]
        if not supported:
            return FinalAnswer(
                answer="Insufficient supported evidence is available to answer the question.",
                key_claims=[],
                uncertainties=[f"Could not synthesize a supported answer for: {question}"],
                citations=[],
            )
        key_claims = [
            FinalClaim(claim=claim.claim, evidence_ids=claim.supporting_evidence_ids[:4], status="supported")
            for claim in supported[:8]
        ]
        citations = []
        seen: set[str] = set()
        for claim in key_claims:
            for eid in claim.evidence_ids:
                ev = evidence_by_id.get(eid)
                if ev and eid not in seen:
                    citations.append({"evidence_id": eid, "url": ev.source_url, "title": ev.source_title})
                    seen.add(eid)
        return FinalAnswer(
            answer=" ".join(claim.claim for claim in supported[:4]),
            key_claims=key_claims,
            uncertainties=["Fallback synthesis used supported graph claims because LLM synthesis failed."],
            citations=citations,
        )

    @staticmethod
    def _fallback_partial_graph(trajectory: SearchTrajectory) -> dict[str, Any]:
        evidence_nodes = []
        seen_urls: set[str] = set()
        for step in trajectory.steps:
            if step.action != "VISIT" or not isinstance(step.observation, dict):
                continue
            url = step.observation.get("url")
            if not url or url in seen_urls:
                continue
            text = step.observation.get("page_text") or ""
            if not text and isinstance(step.observation.get("visit_extraction"), dict):
                extraction = step.observation["visit_extraction"]
                text = extraction.get("evidence") or extraction.get("summary") or ""
            if not text:
                continue
            seen_urls.add(url)
            evidence_nodes.append(
                {
                    "existing_id": None,
                    "source_url": url,
                    "source_title": step.observation.get("title") or "",
                    "source_rank": None,
                    "source": None,
                    "text": text,
                    "snippet": "",
                    "summary": text,
                    "published_time": None,
                    "source_type": "web",
                    "evidence_origin": step.observation.get("evidence_origin") or "visited_page",
                }
            )
            if len(evidence_nodes) >= 6:
                break
        if not evidence_nodes and trajectory.results:
            for result in trajectory.results[:6]:
                if not result.url or result.url in seen_urls:
                    continue
                seen_urls.add(result.url)
                evidence_nodes.append(
                    {
                        "existing_id": None,
                        "source_url": result.url,
                        "source_title": result.title,
                        "source_rank": result.rank,
                        "source": result.source,
                        "text": result.summary or result.snippet or result.title,
                        "snippet": result.snippet,
                        "summary": result.summary,
                        "published_time": result.published_time,
                        "source_type": "web",
                        "evidence_origin": "search_summary" if result.summary else "search_snippet",
                    }
                )
        local = trajectory.local_answer
        if hasattr(local, "model_dump"):
            local_data = local.model_dump()
        elif isinstance(local, dict):
            local_data = local
        else:
            local_data = {}
        claim_nodes = []
        edges = []
        for item in local_data.get("key_claims", [])[:8]:
            claim = item.get("claim")
            if not claim:
                continue
            evidence_urls = item.get("evidence_urls") or []
            claim_nodes.append(
                {
                    "existing_id": None,
                    "merge_with_claim_id": None,
                    "canonical_claim": claim,
                    "claim": claim,
                    "status": "unverified" if item.get("unresolved") else "supported",
                    "confidence": item.get("confidence") or 0.0,
                    "rationale": item.get("rationale") or "Fallback graph extraction from Searcher local claims.",
                    "needed_verification": "Needs Navigator verification from the whole graph.",
                    "supporting_source_urls": evidence_urls,
                    "contradicting_source_urls": [],
                }
            )
            for url in evidence_urls:
                edges.append(
                    {
                        "from_evidence_id": None,
                        "from_source_url": url,
                        "to_claim_id": None,
                        "to_claim": claim,
                        "relation": "support",
                        "rationale": "Fallback support edge from Searcher local answer.",
                        "confidence": item.get("confidence") or 0.0,
                    }
                )
        return {
            "searcher_id": trajectory.searcher_id,
            "query": trajectory.query,
            "evidence_nodes": evidence_nodes,
            "claim_nodes": claim_nodes,
            "edges": edges,
            "missing_aspects": [
                {
                    "aspect": "Navigator fallback used; verify coverage against the original question.",
                    "why_missing": "The LLM graph extraction output was invalid, so this partial graph is conservative.",
                    "suggested_queries": [],
                    "priority": "medium",
                }
            ],
        }


class ArgusReproRunner:
    def __init__(
        self,
        config: ArgusConfig,
        navigator: Navigator,
        searcher: ReActSearcher,
        run_dir: Path,
        logger: RunLogger,
    ):
        self.config = config
        self.navigator = navigator
        self.searcher = searcher
        self.run_dir = run_dir
        self.paths = RunPaths(run_dir)
        self.paths.ensure()
        self.logger = logger
        self._searcher_sem = asyncio.Semaphore(max(1, config.searcher_concurrency))

    async def run_argus_repro(
        self,
        question: str,
        *,
        k: int | None = None,
        max_rounds: int | None = None,
    ) -> dict[str, Any]:
        initial_cap = k or self.config.max_initial_dispatch
        max_rounds = max_rounds if max_rounds is not None else self.config.max_rounds
        builder = GraphBuilder(question, max_searcher_calls=self.config.max_searcher_calls)
        write_json(self.paths.question, {"question": question})

        initial_queries = await self.navigator.generate_initial_queries(
            question,
            max_dispatch=initial_cap,
            remaining_budget=builder.graph.max_searcher_calls,
        )
        write_json(self.paths.initial_queries, [q.model_dump() for q in initial_queries])
        await self._dispatch_observe(question, initial_queries, builder, round_id=0)
        observed_since_verification = True
        await self._compact_observed_graph(question, builder, round_id=0)
        write_json(self.paths.graph_observed(0), builder.graph.model_dump())

        total_rounds = max(1, max_rounds)
        for round_id in range(1, total_rounds):
            verification = await self.navigator.verify_graph(question, builder.graph)
            builder.apply_verification(verification)
            observed_since_verification = False
            builder.mark_round_complete(round_id)
            write_json(self.paths.graph_verified(round_id), builder.graph.model_dump())
            self.logger.log("round_verified", round_id=round_id, stats=graph_stats(builder.graph))

            if builder.graph.sufficient:
                builder.graph.stop_reason = builder.graph.stop_reason or "Navigator marked the graph sufficient."
                break
            if builder.graph.searcher_call_count >= builder.graph.max_searcher_calls:
                builder.graph.stop_reason = "Searcher call budget exhausted."
                break

            remaining_budget = builder.graph.max_searcher_calls - builder.graph.searcher_call_count
            followups = await self.navigator.generate_followups(
                question,
                builder.graph,
                max_dispatch=self.config.max_dispatch_per_round,
                remaining_budget=remaining_budget,
            )
            write_json(self.paths.followups(round_id), [q.model_dump() for q in followups])
            if not followups:
                builder.graph.stop_reason = builder.graph.stop_reason or "Navigator generated no useful follow-up queries."
                break
            await self._dispatch_observe(question, followups, builder, round_id=round_id)
            observed_since_verification = True
            await self._compact_observed_graph(question, builder, round_id=round_id)
            write_json(self.paths.graph_observed(round_id), builder.graph.model_dump())

        if observed_since_verification:
            verification = await self.navigator.verify_graph(question, builder.graph)
            builder.apply_verification(verification)
            write_json(self.paths.graph_final_verified, builder.graph.model_dump())
            self.logger.log("final_verified", stats=graph_stats(builder.graph))

        final_answer = await self.navigator.synthesize(question, builder.graph)
        write_json(self.paths.final_graph, builder.graph.model_dump())
        write_json(self.paths.final_answer_json, final_answer.model_dump())
        self._write_markdown(final_answer, builder.graph)
        return {"question": question, "graph": builder.graph, "final_answer": final_answer}

    async def _dispatch_observe(
        self,
        question: str,
        queries: list[QuerySpec],
        builder: GraphBuilder,
        *,
        round_id: int,
    ) -> None:
        remaining = builder.graph.max_searcher_calls - builder.graph.searcher_call_count
        queries = queries[:remaining]
        if not queries:
            self.logger.log("round_observed", round_id=round_id, queries=0, stats=graph_stats(builder.graph))
            return

        builder.increment_searcher_calls(len(queries))
        self.logger.log(
            "serial_window_observation_started",
            round_id=round_id,
            queries=len(queries),
            window_size=self.config.trajectory_window_size,
            window_stride=self.config.trajectory_window_stride,
        )

        tasks: list[asyncio.Task[tuple[int, QuerySpec, SearchTrajectory | None, str | None]]] = []
        for idx, spec in enumerate(queries, start=1):
            tasks.append(asyncio.create_task(self._run_one_searcher_result(spec, prefix=f"r{round_id}", idx=idx)))

        processed = 0
        for done in asyncio.as_completed(tasks):
            _idx, spec, trajectory, error = await done
            if error or trajectory is None:
                self.logger.log(
                    "searcher_unhandled_error",
                    round_id=round_id,
                    query=spec.query,
                    error=error or "Searcher returned no trajectory.",
                )
                continue

            processed += 1
            append_jsonl(self.paths.trajectories_jsonl, trajectory.model_dump())
            self.logger.log(
                "serial_window_trajectory_received",
                round_id=round_id,
                searcher_id=trajectory.searcher_id,
                query=trajectory.query,
                processed=processed,
                total=len(queries),
                steps=len(trajectory.steps),
            )
            await self._observe_trajectory_windows(question, trajectory, builder, round_id=round_id)
            self.logger.log(
                "serial_window_trajectory_observed",
                round_id=round_id,
                searcher_id=trajectory.searcher_id,
                stats=graph_stats(builder.graph),
            )

        self.logger.log("round_observed", round_id=round_id, queries=len(queries), stats=graph_stats(builder.graph))

    async def _observe_trajectory_windows(
        self,
        question: str,
        trajectory: SearchTrajectory,
        builder: GraphBuilder,
        *,
        round_id: int,
    ) -> None:
        windows = self._trajectory_windows(trajectory)
        for window_idx, window in enumerate(windows, start=1):
            graph_snapshot = builder.graph.model_copy(deep=True)
            try:
                partial = await self.navigator.extract_graph(question, window, graph_snapshot)
            except Exception as exc:  # noqa: BLE001
                self.logger.log(
                    "serial_window_graph_extraction_unhandled_error",
                    round_id=round_id,
                    searcher_id=trajectory.searcher_id,
                    window_idx=window_idx,
                    error=str(exc),
                )
                partial = self.navigator._fallback_partial_graph(window)
            partial.setdefault("searcher_id", trajectory.searcher_id)
            partial.setdefault("query", trajectory.query)
            clean_partial = self._sanitize_clean_partial(partial, graph_snapshot)
            append_jsonl(
                self.paths.graph_partials,
                {
                    "searcher_id": trajectory.searcher_id,
                    "round_id": round_id,
                    "stage": "serial_window",
                    "window_idx": window_idx,
                    "window_count": len(windows),
                    "step_start": window.steps[0].action_input.get("_window_step_start") if window.steps else 0,
                    "step_end": window.steps[-1].action_input.get("_window_step_end") if window.steps else 0,
                    "partial": clean_partial,
                },
            )
            builder.merge_partial(clean_partial, window)
            self.logger.log(
                "serial_window_graph_updated",
                round_id=round_id,
                searcher_id=trajectory.searcher_id,
                window_idx=window_idx,
                window_count=len(windows),
                stats=graph_stats(builder.graph),
            )

    async def _compact_observed_graph(self, question: str, builder: GraphBuilder, *, round_id: int) -> None:
        try:
            update = await self.navigator.compact_graph(question, builder.graph)
        except Exception as exc:  # noqa: BLE001
            self.logger.log("graph_compaction_failed", round_id=round_id, error=str(exc))
            return
        append_jsonl(self.paths.graph_compactions, {"round_id": round_id, "update": update})
        before = graph_stats(builder.graph)
        builder.apply_compaction(update)
        after = graph_stats(builder.graph)
        self.logger.log("graph_compacted", round_id=round_id, before=before, after=after)

    def _sanitize_clean_partial(self, clean_partial: dict[str, Any], graph_snapshot: EvidenceGraph) -> dict[str, Any]:
        valid_eids = {ev.id for ev in graph_snapshot.evidence_nodes}
        valid_cids = {claim.id for claim in graph_snapshot.claim_nodes}
        invalid_refs: list[dict[str, str]] = []

        for ev in clean_partial.get("evidence_nodes", []) or []:
            existing_id = ev.get("existing_id")
            if existing_id and existing_id not in valid_eids:
                invalid_refs.append({"field": "evidence.existing_id", "value": str(existing_id)})
                ev["existing_id"] = None

        for claim in clean_partial.get("claim_nodes", []) or []:
            for field in ("existing_id", "merge_with_claim_id"):
                cid = claim.get(field)
                if cid and cid not in valid_cids:
                    invalid_refs.append({"field": f"claim.{field}", "value": str(cid)})
                    claim[field] = None

        for edge in clean_partial.get("edges", []) or []:
            eid = edge.get("from_evidence_id")
            if eid and eid not in valid_eids:
                invalid_refs.append({"field": "edge.from_evidence_id", "value": str(eid)})
                edge["from_evidence_id"] = None
            from_cid = edge.get("from_claim_id")
            if from_cid and from_cid not in valid_cids:
                invalid_refs.append({"field": "edge.from_claim_id", "value": str(from_cid)})
                edge["from_claim_id"] = None
            cid = edge.get("to_claim_id")
            if cid and cid not in valid_cids:
                invalid_refs.append({"field": "edge.to_claim_id", "value": str(cid)})
                edge["to_claim_id"] = None

        if invalid_refs:
            self.logger.log("graph_partial_sanitized_invalid_refs", invalid_refs=invalid_refs)
        return clean_partial

    async def _run_one_searcher(self, spec: QuerySpec, *, prefix: str, idx: int) -> SearchTrajectory:
        async with self._searcher_sem:
            sid = f"{prefix}_S{idx}_{utc_now_iso()}"
            return await self.searcher.run(spec, sid)

    async def _run_one_searcher_result(
        self,
        spec: QuerySpec,
        *,
        prefix: str,
        idx: int,
    ) -> tuple[int, QuerySpec, SearchTrajectory | None, str | None]:
        try:
            trajectory = await self._run_one_searcher(spec, prefix=prefix, idx=idx)
            return idx, spec, trajectory, None
        except Exception as exc:  # noqa: BLE001
            return idx, spec, None, str(exc)

    def _trajectory_windows(self, trajectory: SearchTrajectory) -> list[SearchTrajectory]:
        steps = trajectory.steps
        if not steps:
            return [trajectory]

        window_size = max(1, self.config.trajectory_window_size)
        stride = max(1, self.config.trajectory_window_stride)
        if len(steps) <= window_size:
            return [self._trajectory_window(trajectory, 0, len(steps), include_answer=True, window_id=None)]

        windows: list[SearchTrajectory] = []
        start = 0
        seen_ranges: set[tuple[int, int]] = set()
        while start < len(steps):
            end = min(len(steps), start + window_size)
            if (start, end) in seen_ranges:
                break
            seen_ranges.add((start, end))
            includes_answer = any(step.action == "ANSWER" for step in steps[start:end]) or end == len(steps)
            windows.append(self._trajectory_window(trajectory, start, end, include_answer=includes_answer, window_id=len(windows) + 1))
            if end == len(steps):
                break
            start += stride
        return windows

    @staticmethod
    def _trajectory_window(
        trajectory: SearchTrajectory,
        start: int,
        end: int,
        *,
        include_answer: bool,
        window_id: int | None,
    ) -> SearchTrajectory:
        window_steps = []
        for step in trajectory.steps[start:end]:
            copied = step.model_copy(deep=True)
            copied.action_input = dict(copied.action_input or {})
            copied.action_input["_window_step_start"] = start
            copied.action_input["_window_step_end"] = end
            window_steps.append(copied)
        searcher_id = trajectory.searcher_id if window_id is None else f"{trajectory.searcher_id}_W{window_id}"
        return trajectory.model_copy(
            deep=True,
            update={
                "searcher_id": searcher_id,
                "steps": window_steps,
                "local_answer": trajectory.local_answer if include_answer else None,
            },
        )

    def _write_markdown(self, final_answer: FinalAnswer, graph: EvidenceGraph) -> None:
        lines = ["# Answer", "", final_answer.answer, "", "# Key Claims"]
        for claim in final_answer.key_claims:
            lines.append(f"- Claim: {claim.claim}")
            lines.append(f"  - Status: {claim.status}")
            lines.append(f"  - Evidence: {', '.join(claim.evidence_ids) if claim.evidence_ids else 'None'}")
            lines.append(f"  - Source trace complete: {claim.source_trace_complete}")
            if claim.missing_evidence_reason:
                lines.append(f"  - Missing evidence reason: {claim.missing_evidence_reason}")
        lines.extend(["", "# Uncertainties"])
        for item in final_answer.uncertainties:
            lines.append(f"- {item}")
        lines.extend(["", "# Sources"])
        ev_by_id = {ev.id: ev for ev in graph.evidence_nodes}
        for citation in final_answer.citations:
            eid = citation.get("evidence_id", "")
            ev = ev_by_id.get(eid)
            if ev:
                lines.append(f"- {eid}: {ev.source_title} - {ev.source_url}")
            else:
                lines.append(f"- {eid}: {citation.get('title', '')} - {citation.get('url', '')}")
        self.paths.final_answer_markdown.write_text("\n".join(lines) + "\n", encoding="utf-8")
