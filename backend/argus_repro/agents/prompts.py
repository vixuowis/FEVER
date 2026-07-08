from __future__ import annotations

import json
from typing import Any

from ..core.schemas import EvidenceGraph, SearchTrajectory


SYSTEM_JSON = (
    "You are a rigorous deep-research agent component. "
    "Return valid JSON only. Do not include markdown fences. "
    "Preserve the natural language of the question and source evidence when possible. "
    "For final answers, use the same language as the original question unless the question asks otherwise."
)


def _json(data: Any) -> str:
    if hasattr(data, "model_dump"):
        data = data.model_dump()
    elif isinstance(data, list):
        data = [item.model_dump() if hasattr(item, "model_dump") else item for item in data]
    elif isinstance(data, dict):
        data = {key: value.model_dump() if hasattr(value, "model_dump") else value for key, value in data.items()}
    return json.dumps(data, ensure_ascii=False, indent=2)


def initial_query_prompt(question: str, max_dispatch: int, remaining_budget: int) -> list[dict[str, str]]:
    return [
        {"role": "system", "content": SYSTEM_JSON},
        {
            "role": "user",
            "content": f"""You are the Navigator in Argus.

Original question:
{question}

You may dispatch up to {max_dispatch} initial stateless Searchers now. The total remaining Searcher budget is {remaining_budget}.

Choose the number of initial Searchers yourself. Use enough complementary queries to cover distinct evidence angles, but do not pad with low-value duplicates. For simple questions, 1-2 queries may be enough; for multi-hop, ambiguous, or entity-disambiguation questions, use more.

Each query is an assigned research question for an independent Searcher. The Searcher will not see the original question unless you include the necessary entities, constraints, dates, locations, and target evidence in the assigned question or metadata.

Task design rules:
- Each assigned research question must be self-contained and directly answerable.
- Do not create generic template queries whose meaning depends on unstated upstream context.
- For dependent multi-hop questions with unknown intermediate entities, prioritize discovering the bottleneck unknowns first. Do not dispatch downstream tasks that require an unknown intermediate value unless the task is explicitly framed as verifying a named hypothesis, not as a settled fact.
- At the initial stage, your own world knowledge is not verified evidence. If an intermediate entity/value is not stated in the original question, do not treat it as known in any initial query or metadata. Wait for follow-up rounds after the graph contains supported evidence for that intermediate value.
- Do not create an initial Searcher for a downstream hop whose input must come from another initial Searcher in the same batch. Same-batch Searchers cannot see each other's results.
- Hard constraint for initial dispatch: query, angle, why, target_claim_or_aspect, expected_evidence, entity_aliases, starter_queries, and avoid_scope may mention only entities literally present in the original question, their direct aliases/translations, and generic relation names. They must not mention candidate answer entities that are not in the original question.
- Use starter_queries only as optional search-string suggestions; the assigned question remains the Searcher's actual task.
- Do not smuggle unverified answers into query, angle, why, target_claim_or_aspect, expected_evidence, source_preference, or avoid_scope. Metadata must describe the evidence needed or the hypothesis being tested, not assert an unknown value as fact.

Search language guidance:
- Write each query in the language most likely to retrieve authoritative evidence.
- Prefer preserving original entity names, local-language names, and wording from the question when they matter for recall.
- Add alternative-language aliases only when they are likely to improve recall or disambiguation.
- For statistical/report questions, include official data portals, indicator pages, tables, APIs, and downloadable datasets in addition to report titles or PDFs.

Return JSON:
{{
  "why_this_many": "short budget and coverage rationale",
  "queries": [
    {{
      "query": "self-contained assigned research question",
      "angle": "research angle",
      "why": "why this task is needed",
      "target_claim_or_aspect": "claim/aspect to establish or refute; do not prefill unverified answer values unless explicitly verifying a hypothesis",
      "expected_evidence": "evidence type that would resolve the task; do not prefill unverified answer values",
      "search_language": "zh|en|mixed|local|source_native",
      "source_preference": "preferred authoritative source type",
      "entity_aliases": ["important aliases to preserve or try"],
      "avoid_scope": "what not to answer or conflate",
      "must_verify": true,
      "starter_queries": ["optional concrete web search string"],
      "priority": "high|medium|low"
    }}
  ]
}}""",
        },
    ]


def react_searcher_action_prompt(
    query: str,
    trajectory_state: dict[str, Any],
    *,
    remaining_steps: int,
) -> list[dict[str, str]]:
    return [
        {"role": "system", "content": SYSTEM_JSON},
        {
            "role": "user",
            "content": f"""You are a stateless ReAct Searcher in Argus.

Assigned research question:
{query}

Current trajectory state:
{_json(trajectory_state)}

Remaining budgets inside this Searcher:
- steps: {remaining_steps}

Allowed actions:
- SEARCH: issue one focused web query. Bocha returns title, URL, source, date, and snippet only.
- VISIT: inspect one previously returned search result, or follow a concrete http(s) URL. Prefer result_id from SEARCH observations when available. Include a specific goal for what information to extract from the page. VISIT returns goal-focused evidence and summary extracted from the configured webpage reader.
- ANSWER: finish the Searcher with a concise local answer and source-grounded atomic claims.

Policy:
- Use SEARCH to find candidate sources.
- Be persistent within your assigned step budget. If one query has weak recall, reformulate with broader terms, exact entity names, aliases, source-specific wording, local-language terms, or authoritative site names.
- Do not repeat the same SEARCH query. This Bocha /web-search integration does not expose pagination in this harness, so identical queries return the same top results. If prior results did not resolve a gap, VISIT relevant unvisited results, reformulate materially, or ANSWER with the gap marked unresolved.
- If the previous step is a CORRECTION with duplicate_search_query, do not issue that query again.
- Treat the assigned research question, research focus, evidence target, source preference, and avoid_scope as hard task boundaries. Do not broaden the task beyond them.
- Starter queries are optional suggestions; rewrite SEARCH queries when better source-specific wording or aliases will retrieve stronger evidence.
- For SEARCH queries, use the language most likely to retrieve authoritative evidence. Preserve original/local entity names when useful, and use aliases only when they improve recall or disambiguation.
- Search language serves authoritative source retrieval, not final answer language.
- For statistical/report questions, search both the report title and the underlying official data portal or indicator/table names. Report landing pages often link to data pages that contain the exact values.
- Use VISIT for the most relevant and authoritative results before making important claims. Choose result_id values from prior SEARCH observations when available. Use url only for concrete authoritative http(s) pages, APIs, or downloadable files when result_id is unavailable. If any search result is available, do not ANSWER before at least one VISIT.
- For VISIT, write a concrete goal that names the exact missing fact, entity relation, date, ranking, list, table row, numeric value, source link, or contradiction to extract from that page.
- When visited pages expose Download Data, CSV, ZIP, API, or dataset links needed for exact values, VISIT that concrete link before answering.
- If page_text contains markdown links, image links, report/download links, or data links, copy the exact URL shown in page_text for VISIT. Do not rewrite, normalize, or guess alternate download URLs.
- VISIT observations may include structured "links", "tables", and "data_endpoints". Treat these as actionable next-hop candidates. For numeric, statistical, table, benchmark, or report questions, prefer VISITing relevant data_endpoints or download links over repeating broad SEARCH queries.
- If a data/API/table VISIT returns no rows or an error, inspect its field names, endpoint hints, and linked documentation before concluding the value is unavailable.
- Prefer ANSWER once enough visited evidence exists or no remaining action can improve the result.
- Before ANSWER, check whether visited evidence directly supports the assigned research question. Cross-check important bridge facts when budget allows.
- Do not invent facts. Mark weak, indirect, conflicting, or search-only evidence as unresolved in ANSWER.
- In ANSWER, key_claims must be grounded in VISIT observations. SEARCH snippets are discovery metadata, not strong evidence.
- The local answer must answer only the assigned research question.

Return JSON for exactly one next action:
{{
  "rationale": "short action rationale",
  "action": "SEARCH|VISIT|ANSWER",
  "query": "required only for SEARCH",
  "result_id": "R1, R2, ... preferred for VISIT when available",
  "url": "required for VISIT only when following a concrete URL instead of a result_id",
  "goal": "required for VISIT: the exact information to extract from this source",
  "local_answer": "required only for ANSWER",
  "key_claims": [
    {{
      "claim": "atomic factual claim",
      "evidence_urls": ["https://..."],
      "rationale": "short grounding rationale",
      "confidence": 0.0,
      "unresolved": false
    }}
  ],
  "unresolved_questions": ["..."]
}}""",
        },
    ]


def react_searcher_forced_answer_prompt(query: str, trajectory_state: dict[str, Any]) -> list[dict[str, str]]:
    return [
        {"role": "system", "content": SYSTEM_JSON},
        {
            "role": "user",
            "content": f"""You are a stateless ReAct Searcher in Argus.

Assigned research question:
{query}

The Searcher step budget is exhausted. Produce the best conservative local answer from the existing trajectory only.
If there is no visited evidence, say that the assigned question remains unresolved and do not create supported factual key_claims.
SEARCH snippets are discovery metadata only; claims based only on them must be unresolved with low confidence.

Current trajectory state:
{_json(trajectory_state)}

Return JSON:
{{
  "local_answer": "short answer to the assigned research question, with uncertainty if needed",
  "key_claims": [
    {{
      "claim": "atomic factual claim",
      "evidence_urls": ["https://..."],
      "rationale": "why the visited observations support or fail to support the claim",
      "confidence": 0.0,
      "unresolved": false
    }}
  ],
  "unresolved_questions": ["..."]
}}""",
        },
    ]


def visit_extraction_prompt(
    *,
    assigned_question: str,
    visit_goal: str,
    source_url: str,
    source_title: str,
    page_text: str,
) -> list[dict[str, str]]:
    return [
        {"role": "system", "content": SYSTEM_JSON},
        {
            "role": "user",
            "content": f"""You are the VISIT extraction component for a ReAct Searcher.

Assigned research question:
{assigned_question}

VISIT goal:
{visit_goal}

Source URL:
{source_url}

Source title:
{source_title}

Reader content:
{page_text}

Task:
- Locate the specific sections, data rows, links, or statements that directly help the VISIT goal.
- Use only information explicitly present in Reader content. The model cannot access the URL, webpage, file, archive, API, or download beyond the Reader content shown above.
- Do not infer, repair, contradict, or complete file structure from the Source URL, Source title, VISIT goal, known dataset conventions, or prior knowledge. If Reader content says a file/member/row is absent or unreadable, treat it as absent or unreadable.
- Preserve original numeric values, dates, entity names, URLs, table row labels, and surrounding context needed for verification.
- Prefer preserving relevant original context over aggressive summarization. For lists, tables, rankings, timelines, names, numeric values, and quoted source claims, keep enough surrounding text for downstream verification.
- If the page has download/data/API/PDF links relevant to the goal, include the exact URLs in evidence.
- Do not invent information. If Reader content does not contain the target data, set relevance to "none" or "low", put the gap in missing, and do not output target values.
- Keep evidence detailed enough for downstream graph extraction, but do not include unrelated page text.

Return JSON:
{{
  "rationale": "how you found or failed to find goal-relevant content",
  "evidence": "goal-relevant original text, rows, links, or concise quoted/paraphrased evidence",
  "summary": "concise conclusion about what this source contributes to the VISIT goal",
  "relevance": "high|medium|low|none",
  "missing": "what target information is still missing from this page, or null"
}}""",
        },
    ]


def graph_index_for_extraction(graph: EvidenceGraph) -> dict[str, Any]:
    return {
        "evidence_index": [
            {
                "id": ev.id,
                "url": ev.source_url,
                "title": ev.source_title,
                "source": ev.source,
                "text": ev.text,
                "snippet": ev.snippet,
                "summary": ev.summary,
                "evidence_origin": ev.evidence_origin,
            }
            for ev in graph.evidence_nodes
        ],
        "claim_index": [
            {
                "id": claim.id,
                "claim": claim.claim,
                "status": claim.status,
                "confidence": claim.confidence,
                "rationale": claim.rationale,
                "supporting_evidence_ids": claim.supporting_evidence_ids,
                "supporting_claim_ids": claim.supporting_claim_ids,
                "contradicting_evidence_ids": claim.contradicting_evidence_ids,
                "contradicting_claim_ids": claim.contradicting_claim_ids,
            }
            for claim in graph.claim_nodes
        ],
        "edge_index": [
            {
                "id": edge.id,
                "from_id": edge.from_id,
                "to_id": edge.to_id,
                "relation": edge.relation,
                "rationale": edge.rationale,
                "confidence": edge.confidence,
            }
            for edge in graph.edges
        ],
        "missing_aspects": [
            {
                "id": aspect.id,
                "aspect": aspect.aspect,
                "why_missing": aspect.why_missing,
                "suggested_queries": aspect.suggested_queries,
                "priority": aspect.priority,
            }
            for aspect in graph.missing_aspects
        ],
        "answer_path_requirements": [
            {
                "id": requirement.id,
                "requirement": requirement.requirement,
                "covered_by_claim_ids": requirement.covered_by_claim_ids,
                "status": requirement.status,
                "needed_query": requirement.needed_query,
            }
            for requirement in graph.answer_path_requirements
        ],
    }


def _compact_trajectory_for_extraction(trajectory: SearchTrajectory, config: Any | None = None) -> dict[str, Any]:
    local_answer = trajectory.local_answer
    if hasattr(local_answer, "model_dump"):
        local_answer = local_answer.model_dump()
    steps = []
    for step in trajectory.steps:
        obs = step.observation
        if step.action == "SEARCH" and isinstance(obs, list):
            obs = [
                {
                    "result_id": item.get("result_id"),
                    "rank": item.get("rank"),
                    "title": item.get("title"),
                    "url": item.get("url"),
                    "source": item.get("source"),
                    "published_time": item.get("published_time"),
                    "snippet": item.get("snippet") or "",
                }
                for item in obs
                if isinstance(item, dict)
            ]
        elif step.action == "VISIT" and isinstance(obs, dict):
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
        elif step.action == "CORRECTION" and isinstance(obs, dict):
            obs = {
                "error": obs.get("error"),
                "requested_action": obs.get("requested_action"),
                "requested_result_id": obs.get("requested_result_id"),
            }
        steps.append(
            {
                "action": step.action,
                "rationale": step.rationale,
                "query": step.query,
                "result_id": step.result_id,
                "url": step.url,
                "action_input": step.action_input,
                "observation": obs,
            }
        )
    return {
        "searcher_id": trajectory.searcher_id,
        "query": trajectory.query,
        "angle": trajectory.angle,
        "why": trajectory.why,
        "target_claim_or_aspect": trajectory.target_claim_or_aspect,
        "expected_evidence": trajectory.expected_evidence,
        "search_language": trajectory.search_language,
        "source_preference": trajectory.source_preference,
        "entity_aliases": trajectory.entity_aliases,
        "avoid_scope": trajectory.avoid_scope,
        "must_verify": trajectory.must_verify,
        "starter_queries": trajectory.starter_queries,
        "priority": trajectory.priority,
        "steps": steps,
        "local_answer": local_answer,
    }


def graph_extraction_prompt(
    question: str,
    trajectory: SearchTrajectory,
    current_graph: EvidenceGraph,
    config: Any | None = None,
) -> list[dict[str, str]]:
    compact_trajectory = _compact_trajectory_for_extraction(trajectory, config)
    return [
        {"role": "system", "content": SYSTEM_JSON},
        {
            "role": "user",
            "content": f"""You are the Navigator in Argus. Parse one Searcher trajectory into graph update operations.

Original question:
{question}

Current evidence graph index:
{_json(graph_index_for_extraction(current_graph))}

Searcher trajectory:
{_json(compact_trajectory)}

Task:
- Extract only new evidence nodes, new claim nodes, and new edges from this Searcher trajectory window.
- Use the current graph index as the graph snapshot available before this trajectory window is merged. Existing evidence/claim ids in that index may be referenced in edges, but should not be re-output as new nodes.
- Use the current missing_aspects and answer_path_requirements only as relevance hints for what evidence/claims matter. Do not output missing_aspects; global missing aspects are computed only by graph verification.
- Add only new evidence nodes directly relevant to the original question, the assigned Searcher question, current relevance hints, or claims cited by the local answer.
- For ReAct trajectories, evidence should come primarily from VISIT observation page_text fields, which contain goal-focused extracted evidence and summaries. SEARCH snippets are discovery metadata for planning; use them as evidence only when no VISIT evidence exists, and then mark claims unverified unless corroborated.
- Set evidence_origin to "visited_page" for VISIT page_text, "downloaded_file" for local download readers, "search_snippet" for SEARCH-only fallback evidence.
- CORRECTION steps are control-flow/error records only. Do not use them as evidence.
- Evidence nodes are not URLs. An evidence node is a specific source-grounded span, table row, API row, file member excerpt, page section, or downloaded-file excerpt that can be cited later.
- The same URL may produce multiple evidence nodes if the cited text/span differs. If the current graph already has the same URL and same specific evidence text/span, reference the existing E id in edges instead of outputting a duplicate new evidence node.
- Add new claim nodes only for atomic factual claims grounded in evidence and useful for the answer path or for resolving a targeted uncertainty. If an equivalent claim already appears in the current graph index, reference the existing C id in edges instead of outputting a duplicate new claim node.
- Prefer claims that form bridge facts: entity identity, relation, date, location, membership/status, numeric value, list item, source-provided derived value, or contradiction resolution.
- For numeric dataset evidence, preserve machine-readable numeric_value fields in evidence text and claims when present. If display_value and numeric_value differ by rounding, use numeric_value for calculations and mention the displayed/rounded value separately only when needed.
- Do not recompute from rounded display values when machine-readable numeric fields are available. If the source explicitly provides a derived value, preserve it with its source context.
- Create support or contradict edges from evidence to claims, and when useful from existing claims to other claims. Edges may reference existing global ids from the graph index (E*, C*) or local ids introduced in this JSON (e*, c*).
- Use local_id values for newly output nodes. Use stable local ids such as "e1", "e2", "c1", "c2". Do not invent global E*/C* ids.
- If new evidence supports or contradicts an existing claim, create an edge from the new evidence local_id to the existing C id.
- If an existing evidence node supports or contradicts a new claim, create an edge from the existing E id to the new claim local_id.
- Preserve the natural language of source evidence when useful. Do not translate solely for normalization.

Node boundary:
- new_evidence_nodes are source-grounded observations: URL/title/source metadata plus the specific source text or extracted page/file content. Do not put inferred facts in evidence text unless explicitly present in the source.
- new_claim_nodes are atomic propositions inferred from evidence nodes. A claim should normally be one fact with one subject-relation-object/value/date scope.
- new_edges explain support or contradiction between evidence/claims and claims. Do not use an edge to introduce a factual claim absent from new_claim_nodes or the existing claim_index.

Status policy:
- supported: the claim is directly supported by visited/downloaded evidence in this trajectory, or new evidence directly supports an existing claim.
- contradicted: the trajectory contains evidence that conflicts with a claim.
- unverified: the claim is plausible but only search-result-based, indirect, weak, or not clearly supported.

Do not overstate confidence. Do not merge unrelated facts. Keep the partial graph compact: at most 4 new evidence nodes, at most 5 new claim nodes, at most 8 new edges, and concise rationales under 25 words.
Use only these source_type values: web, news, paper, unknown. Newspapers, media sites, press articles, and financial news pages are "news"; PDFs/reports/research papers are "paper".

Return JSON:
{{
  "new_evidence_nodes": [
    {{
      "local_id": "e1",
      "source_url": "...",
      "source_title": "...",
      "source_rank": 1,
      "source": "...",
      "text": "concise evidence text",
      "snippet": "relevant snippet or paraphrase",
      "summary": "relevant summary or paraphrase",
      "published_time": null,
      "source_type": "web|news|paper|unknown",
      "evidence_origin": "visited_page|downloaded_file|search_snippet|unknown"
    }}
  ],
  "new_claim_nodes": [
    {{
      "local_id": "c1",
      "claim": "atomic factual claim",
      "status": "supported|contradicted|unverified",
      "confidence": 0.0,
      "rationale": "...",
      "needed_verification": null
    }}
  ],
  "new_edges": [
    {{
      "from_ref": "e1|E1|c1|C1",
      "to_ref": "c1|C1",
      "relation": "support|contradict|context",
      "rationale": "...",
      "confidence": 0.0
    }}
  ]
}}""",
        },
    ]


def verification_prompt(question: str, graph: EvidenceGraph, config: Any | None = None) -> list[dict[str, str]]:
    evidence_by_id = {ev.id: ev for ev in graph.evidence_nodes}
    compact = {
        "question": graph.question,
        "searcher_call_count": graph.searcher_call_count,
        "max_searcher_calls": graph.max_searcher_calls,
        "claims": [],
        "missing_aspects": [
            {
                "id": aspect.id,
                "aspect": aspect.aspect,
                "why_missing": aspect.why_missing,
                "priority": aspect.priority,
            }
            for aspect in graph.missing_aspects
        ],
    }
    for claim in graph.claim_nodes:
        supporting = []
        for eid in claim.supporting_evidence_ids:
            ev = evidence_by_id.get(eid)
            if not ev:
                continue
            supporting.append(
                {
                    "evidence_id": eid,
                    "url": ev.source_url,
                    "title": ev.source_title,
                    "source": ev.source,
                    "evidence_origin": ev.evidence_origin,
                    "text": ev.text or ev.summary or ev.snippet or "",
                }
            )
        contradicting = []
        for eid in claim.contradicting_evidence_ids:
            ev = evidence_by_id.get(eid)
            if not ev:
                continue
            contradicting.append(
                {
                    "evidence_id": eid,
                    "url": ev.source_url,
                    "title": ev.source_title,
                    "source": ev.source,
                    "evidence_origin": ev.evidence_origin,
                    "text": ev.text or ev.summary or ev.snippet or "",
                }
            )
        compact["claims"].append(
            {
                "id": claim.id,
                "claim": claim.claim,
                "current_status": claim.status,
                "confidence": claim.confidence,
                "supporting": supporting,
                "supporting_claim_ids": claim.supporting_claim_ids,
                "contradicting": contradicting,
                "contradicting_claim_ids": claim.contradicting_claim_ids,
                "originating_searcher_ids": claim.originating_searcher_ids,
            }
        )
    return [
        {"role": "system", "content": SYSTEM_JSON},
        {
            "role": "user",
            "content": f"""You are the Navigator in Argus. Verify the current shared evidence graph as a whole.

Original question:
{question}

Compact graph view:
{_json(compact)}

Relabel each claim using graph-level judgment:
- supported: clear relevant visited or downloaded evidence for the claim, with an evidence standard appropriate to the fact type.
- contradicted: evidence conflicts with the claim.
- unverified: weak, indirect, search-result-only, low-authority for the fact type, or not enough evidence.

Evidence standard:
- Stable encyclopedic facts such as geography, headquarters location, official title, birth place, membership/status, and historical facts can be supported by one direct visited authoritative or reputable reference source, or by multiple consistent visited secondary sources.
- Volatile, recent, numeric, ranked, legal, medical, financial, benchmark, or calculation-critical facts require stronger evidence: primary/official data, source-diverse visited evidence, or explicit machine-readable values when available.
- Search snippets are discovery metadata. They may explain why a claim needs follow-up, but should not make a required bridge fact supported unless corroborated by visited/downloaded evidence.
- Low-authority or user-generated pages may support exploration, but should not be the sole support for an important bridge fact when better sources are reasonably expected.
- A source phrase such as "Redmond, Washington", "Chicago, Illinois", or an infobox field "Capital: Springfield" is direct evidence for ordinary geography if it comes from a reputable visited source.

Also identify missing aspects of the original question that no supported claim covers. Decide whether the graph is sufficient for final synthesis. Be conservative.

Answer path requirements:
- Identify the bridge facts needed to answer the original question before deciding sufficiency.
- Every required bridge fact must be covered by supported claims with concrete evidence ids.
- Claim-to-claim support may explain derived facts, but sufficient final answer paths must still trace back to concrete evidence ids.
- If any required bridge fact is missing, weak, contradicted, or only supported by search-result metadata, sufficient must be false and missing_aspects should request targeted evidence.
- Do not output a missing_aspect for a bridge fact that is already covered by supported claims in answer_path_requirements.
- A missing_aspect must be an actionable unresolved gap. If no additional evidence is needed or no targeted follow-up query is appropriate, do not include it.
- Do not require unnecessary extra corroboration for stable low-risk facts that already have direct visited reputable evidence. Spend more budget only when the evidence is weak for the fact type, conflicting, ambiguous, or answer-critical in a high-risk/numeric setting.
- Return answer_path_requirements explicitly. It is part of the machine-checked sufficiency contract.

Keep the output compact. Include claim_updates only for claims that are relevant to answering the original question, claims whose status/evidence assignment should change, or claims needed to explain why the graph is insufficient. Do not enumerate background-only claims that do not affect the answer.

Return JSON:
{{
  "claim_updates": [
    {{
      "id": "C1",
      "status": "supported|contradicted|unverified",
      "confidence": 0.0,
      "rationale": "...",
      "needed_verification": null,
      "supporting_evidence_ids": ["E1"],
      "supporting_claim_ids": ["C2"],
      "contradicting_evidence_ids": [],
      "contradicting_claim_ids": []
    }}
  ],
  "missing_aspects": [
    {{
      "aspect": "...",
      "why_missing": "...",
      "suggested_queries": ["..."],
      "priority": "high|medium|low"
    }}
  ],
  "answer_path_requirements": [
    {{
      "requirement": "bridge fact required to answer the original question",
      "covered_by_claim_ids": ["C1"],
      "status": "covered|missing|weak|contradicted",
      "needed_query": "self-contained query if not covered"
    }}
  ],
  "sufficient": false,
  "stop_reason": "why the graph is sufficient or why it still needs more searches"
}}""",
        },
    ]


def graph_compaction_prompt(question: str, graph: EvidenceGraph) -> list[dict[str, str]]:
    compact = {
        "claims": [
            {
                "id": claim.id,
                "claim": claim.claim,
                "status": claim.status,
                "confidence": claim.confidence,
                "supporting_evidence_ids": claim.supporting_evidence_ids,
                "supporting_claim_ids": claim.supporting_claim_ids,
                "contradicting_evidence_ids": claim.contradicting_evidence_ids,
                "contradicting_claim_ids": claim.contradicting_claim_ids,
            }
            for claim in graph.claim_nodes
        ],
        "edges": [
            {
                "from_id": edge.from_id,
                "to_id": edge.to_id,
                "relation": edge.relation,
            }
            for edge in graph.edges
        ],
    }
    return [
        {"role": "system", "content": SYSTEM_JSON},
        {
            "role": "user",
            "content": f"""You are the Navigator in Argus. Compact semantically duplicate claims in the current graph.

Original question:
{question}

Current claim/edge index:
{_json(compact)}

Find only claims that state the same atomic factual proposition.

Merge policy:
- Merge paraphrases, aliases, translation variants, and wording variants only when they preserve the same subject, relation, object/value, date/time scope, qualifier, and polarity.
- Do not merge claims merely because they imply the same final answer.
- Do not merge upstream and downstream bridge facts in the same reasoning chain, such as "X is headquartered in Y" and "Y is in state Z".
- Do not merge evidence availability claims with factual answer claims.
- Do not merge claims that add or change dates, award/selection context, historical context, ordinal numbers, entity, relation, polarity, source scope, or required evidence.
- Prefer the supported claim with the clearest evidence path as keep_claim_id. If statuses differ, keep the status that is best justified by evidence and explain the conflict in rationale.
- The graph builder will preserve evidence and edge references during merge, so merge_groups should include every duplicate claim id that should be redirected to keep_claim_id.

Return JSON:
{{
  "merge_groups": [
    {{
      "canonical_claim": "best concise wording",
      "keep_claim_id": "C1",
      "merge_claim_ids": ["C2", "C3"],
      "rationale": "why these claims are equivalent"
    }}
  ]
}}""",
        },
    ]


def followup_prompt(
    question: str,
    graph: EvidenceGraph,
    *,
    max_dispatch: int,
    remaining_budget: int,
) -> list[dict[str, str]]:
    return [
        {"role": "system", "content": SYSTEM_JSON},
        {
            "role": "user",
            "content": f"""You are the Navigator in Argus. Generate one batch of targeted verification queries from the whole graph.

Original question:
{question}

Verified graph:
{_json(graph)}

Only generate queries for:
1. missing, weak, or contradicted answer_path_requirements;
2. high-priority missing aspects of the original question;
3. answer-relevant unverified claims that need independent corroboration;
4. answer-relevant contradicted claims that need authoritative conflict resolution.

You may dispatch up to {max_dispatch} Searchers in this batch. Total remaining Searcher budget is {remaining_budget}. Choose the batch size yourself; do not use the full cap unless each query targets a distinct high-value gap.

Follow-up query policy:
- Target the smallest unresolved gap that can change the final answer. Do not spend budget on background claims that are not on the answer path.
- If a candidate claim already exists, frame the task as verify/refute that named hypothesis and ask for source-grounded evidence.
- If the missing item is still an unknown entity/value, frame the task as discovery and do not prefill the unknown answer.
- If the gap is authority weakness, request the needed source type explicitly, such as official site, primary data, reputable reference, or source-diverse corroboration.
- Do not duplicate prior search queries. Each query must be self-contained, not a claim id like "verify C12".
- Prefer precise queries likely to retrieve source-grounded evidence. Use the language most likely to retrieve authoritative evidence, preserving original/local entity names when useful and adding aliases only when they improve recall or disambiguation.
- For statistical/report questions, target official data portals, indicator pages, tables, APIs, and downloadable datasets, not only report titles.
- Do not smuggle unverified answers into query, angle, why, target_claim_or_aspect, expected_evidence, source_preference, or avoid_scope; describe the evidence needed or the hypothesis being tested, not an assumed unknown value, unless explicitly verifying a named hypothesis.
- If no useful answer-path query remains, set continue_search to false and return an empty query list.

Return JSON:
{{
  "continue_search": true,
  "sufficient": false,
  "stop_reason": "why to continue or stop",
  "budget_reasoning": "why this many follow-up Searchers are worth spending",
  "queries": [
    {{
      "query": "...",
      "angle": "...",
      "why": "...",
      "target_claim_or_aspect": "claim/aspect to establish or refute; do not prefill unverified answer values unless explicitly verifying a hypothesis",
      "expected_evidence": "evidence type that would resolve the task; do not prefill unverified answer values",
      "search_language": "zh|en|mixed|local|source_native",
      "source_preference": "preferred authoritative source type",
      "entity_aliases": ["important aliases to preserve or try"],
      "avoid_scope": "what not to answer or conflate",
      "must_verify": true,
      "starter_queries": ["optional concrete web search string"],
      "priority": "high|medium|low"
    }}
  ]
}}""",
        },
    ]


def synthesis_prompt(question: str, graph: EvidenceGraph) -> list[dict[str, str]]:
    return [
        {
            "role": "system",
            "content": (
                "You are the final synthesis policy in Argus. Return valid JSON only. "
                "Use the language that best matches the user's question. Preserve source/entity names in their "
                "original or commonly used form. Do not translate names solely for normalization. "
                "You may use only the original question and the evidence graph. "
                "Do not rely on raw Searcher trajectories or outside knowledge."
            ),
        },
        {
            "role": "user",
            "content": f"""Original question:
{question}

Completed evidence graph:
{_json(graph)}

Synthesize the final answer from the answer path, not from all background graph facts. Every important factual claim must cite evidence IDs from the graph. Do not treat contradicted or unverified claims as certain. If evidence is insufficient, say exactly what remains uncertain.
If graph.sufficient is false, or any answer_path_requirements item is missing, weak, or contradicted, do not present a definitive final answer. Start with an insufficiency statement, report only partial current-evidence conclusions, and mark affected key_claims as partially_supported or uncertain rather than supported.
If the evidence graph is sufficient, start with the direct final answer before any explanation. Then give the shortest evidence chain needed to answer the question, following answer_path_requirements.
If there are answer-relevant contradicted claims, briefly state which claim was rejected and which supported claim/evidence resolved the conflict.
Low-priority missing_aspects do not block a sufficient answer, but include them in uncertainties if they materially affect interpretation or scope.
For calculation questions, include the formula using the supported numbers.
If the question asks for integer parts and also asks for a change/difference, compute the change from the supported original decimal values, then round the final change as requested. Do not compute the change from the integer parts unless the question explicitly asks for that.

Return JSON:
{{
  "answer": "final answer in prose",
  "key_claims": [
    {{
      "claim": "...",
      "evidence_ids": ["E1", "E3"],
      "status": "supported|partially_supported|uncertain|contradicted",
      "source_trace_complete": true,
      "missing_evidence_reason": null
    }}
  ],
  "uncertainties": ["..."],
  "citations": [
    {{"evidence_id": "E1", "url": "...", "title": "..."}}
  ]
}}""",
        },
    ]
