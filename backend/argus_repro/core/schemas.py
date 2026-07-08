from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field


ClaimStatus = Literal["supported", "contradicted", "unverified"]
EdgeRelation = Literal["support", "contradict", "context"]


class SearchResult(BaseModel):
    title: str = ""
    url: str = ""
    snippet: str | None = None
    summary: str | None = None
    content: str | None = None
    published_time: str | None = None
    source: str | None = None
    rank: int = 0
    raw: dict[str, Any] = Field(default_factory=dict)


class SearchStep(BaseModel):
    step_index: int | None = None
    action: Literal["SEARCH", "VISIT", "ANSWER", "CORRECTION"]
    rationale: str | None = None
    query: str | None = None
    url: str | None = None
    result_id: str | None = None
    action_input: dict[str, Any] = Field(default_factory=dict)
    observation: Any = None


class LocalClaim(BaseModel):
    claim: str
    evidence_urls: list[str] = Field(default_factory=list)
    rationale: str = ""
    confidence: float = 0.0
    unresolved: bool = False


class LocalAnswer(BaseModel):
    local_answer: str
    key_claims: list[LocalClaim] = Field(default_factory=list)
    unresolved_questions: list[str] = Field(default_factory=list)


class SearchTrajectory(BaseModel):
    searcher_id: str
    query: str
    angle: str | None = None
    why: str | None = None
    target_claim_or_aspect: str | None = None
    expected_evidence: str | None = None
    search_language: str | None = None
    source_preference: str | None = None
    entity_aliases: list[str] = Field(default_factory=list)
    avoid_scope: str | None = None
    must_verify: bool = True
    starter_queries: list[str] = Field(default_factory=list)
    priority: Literal["high", "medium", "low"] = "medium"
    steps: list[SearchStep] = Field(default_factory=list)
    results: list[SearchResult] = Field(default_factory=list)
    local_answer: LocalAnswer | dict[str, Any] | None = None
    started_at: str
    finished_at: str


class EvidenceNode(BaseModel):
    id: str
    searcher_ids: list[str] = Field(default_factory=list)
    search_queries: list[str] = Field(default_factory=list)
    source_url: str
    source_title: str = ""
    source_rank: int | None = None
    source: str | None = None
    source_fingerprint: str
    text: str
    snippet: str | None = None
    summary: str | None = None
    published_time: str | None = None
    retrieved_at: str
    source_type: Literal["web", "news", "paper", "unknown"] = "web"
    evidence_origin: Literal["visited_page", "downloaded_file", "search_snippet", "search_summary", "unknown"] = "unknown"
    raw: dict[str, Any] = Field(default_factory=dict)


class ClaimNode(BaseModel):
    id: str
    claim: str
    status: ClaimStatus = "unverified"
    confidence: float = 0.0
    rationale: str = ""
    needed_verification: str | None = None
    supporting_evidence_ids: list[str] = Field(default_factory=list)
    supporting_claim_ids: list[str] = Field(default_factory=list)
    contradicting_evidence_ids: list[str] = Field(default_factory=list)
    contradicting_claim_ids: list[str] = Field(default_factory=list)
    originating_searcher_ids: list[str] = Field(default_factory=list)
    merged_claim_ids: list[str] = Field(default_factory=list)
    merge_history: list[dict[str, Any]] = Field(default_factory=list)


class GraphEdge(BaseModel):
    id: str
    from_id: str
    to_id: str
    relation: EdgeRelation
    rationale: str = ""
    confidence: float = 0.0


class MissingAspect(BaseModel):
    id: str
    aspect: str
    why_missing: str
    suggested_queries: list[str] = Field(default_factory=list)
    priority: Literal["high", "medium", "low"] = "medium"


class AnswerPathRequirement(BaseModel):
    id: str
    requirement: str
    covered_by_claim_ids: list[str] = Field(default_factory=list)
    status: Literal["covered", "missing", "weak", "contradicted"] = "missing"
    needed_query: str | None = None


class EvidenceGraph(BaseModel):
    question: str
    evidence_nodes: list[EvidenceNode] = Field(default_factory=list)
    claim_nodes: list[ClaimNode] = Field(default_factory=list)
    edges: list[GraphEdge] = Field(default_factory=list)
    missing_aspects: list[MissingAspect] = Field(default_factory=list)
    answer_path_requirements: list[AnswerPathRequirement] = Field(default_factory=list)
    rounds_completed: int = 0
    searcher_call_count: int = 0
    max_searcher_calls: int = 60
    sufficient: bool = False
    stop_reason: str | None = None


class QuerySpec(BaseModel):
    query: str
    angle: str = ""
    why: str = ""
    target_claim_or_aspect: str | None = None
    expected_evidence: str | None = None
    search_language: Literal["zh", "en", "mixed", "local", "source_native"] | None = None
    source_preference: str | None = None
    entity_aliases: list[str] = Field(default_factory=list)
    avoid_scope: str | None = None
    must_verify: bool = True
    starter_queries: list[str] = Field(default_factory=list)
    priority: Literal["high", "medium", "low"] = "medium"


class FinalClaim(BaseModel):
    claim: str
    evidence_ids: list[str] = Field(default_factory=list)
    status: Literal["supported", "partially_supported", "uncertain", "contradicted"]
    source_trace_complete: bool = False
    missing_evidence_reason: str | None = None


class FinalAnswer(BaseModel):
    answer: str
    key_claims: list[FinalClaim] = Field(default_factory=list)
    uncertainties: list[str] = Field(default_factory=list)
    citations: list[dict[str, str]] = Field(default_factory=list)
