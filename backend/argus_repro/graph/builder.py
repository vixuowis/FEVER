from __future__ import annotations

import hashlib
from collections import defaultdict
from typing import Any

from ..core.schemas import AnswerPathRequirement, ClaimNode, EvidenceGraph, EvidenceNode, GraphEdge, MissingAspect, SearchTrajectory
from ..core.utils import normalize_url, utc_now_iso


def source_fingerprint(url: str) -> str:
    clean = normalize_url(url)
    return hashlib.sha256(clean.encode("utf-8")).hexdigest()[:16]


def evidence_fingerprint(url: str, text: str) -> str:
    clean_url = normalize_url(url)
    clean_text = " ".join((text or "").lower().split())
    return hashlib.sha256(f"{clean_url}\n{clean_text}".encode("utf-8")).hexdigest()[:16]


def claim_fingerprint(claim: str) -> str:
    normalized = " ".join((claim or "").lower().split())
    return hashlib.sha256(normalized.encode("utf-8")).hexdigest()[:16]


class GraphBuilder:
    def __init__(self, question: str, max_searcher_calls: int = 60):
        self.graph = EvidenceGraph(question=question, max_searcher_calls=max_searcher_calls)
        self._evidence_by_fp: dict[str, str] = {}
        self._evidence_ids_by_url: dict[str, list[str]] = defaultdict(list)
        self._claim_by_fp: dict[str, str] = {}
        self._edge_keys: set[tuple[str, str, str]] = set()
        self._missing_seen: set[str] = set()
        self._next_claim_num = 1

    @classmethod
    def from_graph(cls, graph: EvidenceGraph) -> "GraphBuilder":
        builder = cls(graph.question, graph.max_searcher_calls)
        builder.graph = graph
        for ev in graph.evidence_nodes:
            builder._evidence_by_fp[ev.source_fingerprint] = ev.id
            builder._evidence_ids_by_url[normalize_url(ev.source_url)].append(ev.id)
        for claim in graph.claim_nodes:
            builder._claim_by_fp[claim_fingerprint(claim.claim)] = claim.id
        builder._next_claim_num = builder._max_id_num("C", [claim.id for claim in graph.claim_nodes]) + 1
        for edge in graph.edges:
            builder._edge_keys.add((edge.from_id, edge.to_id, edge.relation))
        for aspect in graph.missing_aspects:
            builder._missing_seen.add(aspect.aspect.lower())
        return builder

    def merge_partial(self, partial: dict[str, Any], trajectory: SearchTrajectory) -> EvidenceGraph:
        trajectory_url_origins = self._trajectory_url_origins(trajectory)
        source_url_to_eid: dict[str, str] = {}
        local_evidence_to_eid: dict[str, str] = {}
        local_claim_to_cid: dict[str, str] = {}

        evidence_items = partial.get("new_evidence_nodes")
        if evidence_items is None:
            evidence_items = partial.get("evidence_nodes", [])
        for item in evidence_items or []:
            url = normalize_url(item.get("source_url") or "")
            if not url:
                continue
            local_id = self._clean_optional_string(item.get("local_id"))
            text = item.get("text") or item.get("summary") or item.get("snippet") or ""
            fp = evidence_fingerprint(url, text)
            hinted_id = self._clean_optional_string(item.get("existing_id"))
            hinted_ev = self._get_evidence_or_none(hinted_id) if hinted_id else None
            existing_id = hinted_id if hinted_ev and self._same_evidence_span(hinted_ev, text) else self._evidence_by_fp.get(fp)
            if existing_id:
                ev = self._get_evidence(existing_id)
                for sid in self._clean_string_list(item.get("originating_searcher_ids")) or [trajectory.searcher_id]:
                    if sid not in ev.searcher_ids:
                        ev.searcher_ids.append(sid)
                for query in self._clean_string_list(item.get("originating_queries")) or [trajectory.query]:
                    if query not in ev.search_queries:
                        ev.search_queries.append(query)
                if local_id:
                    local_evidence_to_eid[local_id] = existing_id
                source_url_to_eid[url] = existing_id
                continue
            eid = f"E{len(self.graph.evidence_nodes) + 1}"
            ev = EvidenceNode(
                id=eid,
                searcher_ids=self._clean_string_list(item.get("originating_searcher_ids")) or [trajectory.searcher_id],
                search_queries=self._clean_string_list(item.get("originating_queries")) or [trajectory.query],
                source_url=url,
                source_title=item.get("source_title") or "",
                source_rank=item.get("source_rank"),
                source=item.get("source"),
                source_fingerprint=fp,
                text=text,
                snippet=item.get("snippet"),
                summary=item.get("summary"),
                published_time=item.get("published_time"),
                retrieved_at=utc_now_iso(),
                source_type=self._clean_source_type(item.get("source_type")),
                evidence_origin=self._infer_evidence_origin(item, url, trajectory_url_origins),
                raw=item.get("raw") or {},
            )
            self.graph.evidence_nodes.append(ev)
            self._evidence_by_fp[fp] = eid
            self._evidence_ids_by_url[url].append(eid)
            if local_id:
                local_evidence_to_eid[local_id] = eid
            source_url_to_eid[url] = eid

        claim_text_to_cid: dict[str, str] = {}
        claim_items = partial.get("new_claim_nodes")
        if claim_items is None:
            claim_items = partial.get("claim_nodes", [])
        for item in claim_items or []:
            claim_text = (item.get("claim") or "").strip()
            if not claim_text:
                continue
            local_id = self._clean_optional_string(item.get("local_id"))
            fp = claim_fingerprint(claim_text)
            hinted_existing = self._clean_optional_string(item.get("existing_id"))
            hinted_merge = self._clean_optional_string(item.get("merge_with_claim_id"))
            existing_id = None
            for candidate in (hinted_existing, hinted_merge):
                if candidate and self._get_claim_or_none(candidate):
                    existing_id = candidate
                    break
            if not existing_id:
                existing_id = self._claim_by_fp.get(fp)
            supporting_ids = self._urls_to_eids(item.get("supporting_source_urls") or [], source_url_to_eid)
            contradicting_ids = self._urls_to_eids(item.get("contradicting_source_urls") or [], source_url_to_eid)
            supporting_claim_ids = self._valid_cids(item.get("supporting_claim_ids") or [])
            contradicting_claim_ids = self._valid_cids(item.get("contradicting_claim_ids") or [])
            if existing_id:
                claim = self._get_claim(existing_id)
                self._merge_unique(
                    claim.originating_searcher_ids,
                    self._clean_string_list(item.get("originating_searcher_ids")) or [trajectory.searcher_id],
                )
                self._merge_unique(claim.supporting_evidence_ids, supporting_ids)
                self._merge_unique(claim.contradicting_evidence_ids, contradicting_ids)
                self._merge_unique(claim.supporting_claim_ids, [cid for cid in supporting_claim_ids if cid != existing_id])
                self._merge_unique(claim.contradicting_claim_ids, [cid for cid in contradicting_claim_ids if cid != existing_id])
                canonical = self._clean_optional_string(item.get("canonical_claim"))
                if canonical and len(canonical) < len(claim.claim) + 80:
                    claim.claim = canonical
                    self._claim_by_fp[claim_fingerprint(canonical)] = existing_id
                rationale = self._clean_optional_string(item.get("rationale"))
                if rationale and rationale not in claim.rationale:
                    claim.rationale = f"{claim.rationale} {rationale}".strip()[:1200]
                confidence = self._clean_float(item.get("confidence"), claim.confidence)
                claim.confidence = max(claim.confidence, confidence)
                claim_text_to_cid[claim_text] = existing_id
                if local_id:
                    local_claim_to_cid[local_id] = existing_id
                continue
            cid = f"C{self._next_claim_num}"
            self._next_claim_num += 1
            status = self._clean_status(item.get("status"))
            if status == "supported" and not supporting_ids and not supporting_claim_ids:
                status = "unverified"
            if status == "supported" and supporting_ids and self._only_weak_evidence(supporting_ids):
                status = "unverified"
            claim = ClaimNode(
                id=cid,
                claim=claim_text,
                status=status,
                confidence=self._clean_float(item.get("confidence")),
                rationale=item.get("rationale") or "",
                needed_verification=self._clean_optional_string(item.get("needed_verification")),
                supporting_evidence_ids=supporting_ids,
                supporting_claim_ids=supporting_claim_ids,
                contradicting_evidence_ids=contradicting_ids,
                contradicting_claim_ids=contradicting_claim_ids,
                originating_searcher_ids=self._clean_string_list(item.get("originating_searcher_ids"))
                or [trajectory.searcher_id],
            )
            self.graph.claim_nodes.append(claim)
            self._claim_by_fp[fp] = cid
            claim_text_to_cid[claim_text] = cid
            if local_id:
                local_claim_to_cid[local_id] = cid

        edge_items = partial.get("new_edges")
        if edge_items is None:
            edge_items = partial.get("edges", [])
        for item in edge_items or []:
            hinted_from_id = self._clean_optional_string(item.get("from_evidence_id"))
            hinted_from_claim_id = self._clean_optional_string(item.get("from_claim_id"))
            from_url = normalize_url(item.get("from_source_url") or "")
            from_ref = self._clean_optional_string(item.get("from_ref"))
            to_ref = self._clean_optional_string(item.get("to_ref"))
            from_id = self._resolve_partial_ref(from_ref, local_evidence_to_eid, local_claim_to_cid)
            if not from_id and hinted_from_id and self._get_evidence_or_none(hinted_from_id):
                from_id = hinted_from_id
            elif not from_id and hinted_from_claim_id and self._get_claim_or_none(hinted_from_claim_id):
                from_id = hinted_from_claim_id
            elif not from_id:
                from_id = source_url_to_eid.get(from_url) or self._latest_evidence_id_for_url(from_url)
            hinted_to_id = self._clean_optional_string(item.get("to_claim_id"))
            to_claim = item.get("to_claim") or ""
            to_id = self._resolve_partial_ref(to_ref, local_evidence_to_eid, local_claim_to_cid, claim_only=True)
            if not to_id:
                to_id = (
                    hinted_to_id
                    if hinted_to_id and self._get_claim_or_none(hinted_to_id)
                    else claim_text_to_cid.get(to_claim) or self._claim_by_fp.get(claim_fingerprint(to_claim))
                )
            relation = item.get("relation") or "context"
            if not from_id or not to_id or relation not in {"support", "contradict", "context"}:
                continue
            self._add_edge(from_id, to_id, relation, item.get("rationale") or "", float(item.get("confidence") or 0.0))

        self._sync_claim_refs_from_edges()
        self._enforce_claim_status_invariants()
        # Partial extraction missing_aspects are local to one trajectory window.
        # Global missing aspects are recomputed by verification from the merged
        # graph so stale early gaps do not persist after later evidence resolves them.
        return self.graph

    def _resolve_partial_ref(
        self,
        ref: str | None,
        local_evidence_to_eid: dict[str, str],
        local_claim_to_cid: dict[str, str],
        *,
        claim_only: bool = False,
    ) -> str | None:
        if not ref:
            return None
        if ref in local_claim_to_cid:
            return local_claim_to_cid[ref]
        if not claim_only and ref in local_evidence_to_eid:
            return local_evidence_to_eid[ref]
        if self._get_claim_or_none(ref):
            return ref
        if not claim_only and self._get_evidence_or_none(ref):
            return ref
        return None

    def apply_verification(self, update: dict[str, Any]) -> EvidenceGraph:
        for item in update.get("claim_updates", []) or []:
            cid = item.get("id")
            if not cid:
                continue
            claim = self._get_claim_or_none(cid)
            if not claim:
                continue
            status = item.get("status")
            if status in {"supported", "contradicted", "unverified"}:
                claim.status = status
            claim.confidence = self._clean_float(item.get("confidence"), claim.confidence or 0.0)
            claim.rationale = item.get("rationale") or claim.rationale
            claim.needed_verification = self._clean_optional_string(item.get("needed_verification"))
            relation_fields = (
                "supporting_evidence_ids",
                "supporting_claim_ids",
                "contradicting_evidence_ids",
                "contradicting_claim_ids",
            )
            if any(field in item for field in relation_fields):
                self._replace_claim_relation_edges(
                    claim.id,
                    supporting_evidence_ids=self._valid_eids(item.get("supporting_evidence_ids") or []),
                    supporting_claim_ids=self._valid_cids(item.get("supporting_claim_ids") or [], exclude=claim.id),
                    contradicting_evidence_ids=self._valid_eids(item.get("contradicting_evidence_ids") or []),
                    contradicting_claim_ids=self._valid_cids(item.get("contradicting_claim_ids") or [], exclude=claim.id),
                    rationale=item.get("rationale") or "",
                    confidence=self._clean_float(item.get("confidence"), claim.confidence or 0.0),
                )
        self._rebuild_indexes()
        for item in update.get("claim_updates", []) or []:
            cid = item.get("id")
            claim = self._get_claim_or_none(cid) if cid else None
            if claim and claim.status == "supported" and not self._claim_has_concrete_support(claim.id):
                claim.status = "unverified"
        self.graph.missing_aspects = []
        self._missing_seen = set()
        self._merge_missing(update.get("missing_aspects") or [])
        self._apply_answer_path_requirements(update.get("answer_path_requirements") or [])
        self.graph.sufficient = bool(update.get("sufficient", False))
        if self.graph.sufficient and any(req.status != "covered" for req in self.graph.answer_path_requirements):
            self.graph.sufficient = False
            self.graph.stop_reason = "Verification reported incomplete answer path requirements."
        elif self.graph.sufficient and any(aspect.priority in {"high", "medium"} for aspect in self.graph.missing_aspects):
            self.graph.sufficient = False
            self.graph.stop_reason = "Verification reported remaining high/medium-priority missing aspects."
        else:
            self.graph.stop_reason = update.get("stop_reason")
        return self.graph

    def _replace_claim_relation_edges(
        self,
        cid: str,
        *,
        supporting_evidence_ids: list[str],
        supporting_claim_ids: list[str],
        contradicting_evidence_ids: list[str],
        contradicting_claim_ids: list[str],
        rationale: str,
        confidence: float,
    ) -> None:
        self.graph.edges = [
            edge
            for edge in self.graph.edges
            if not (edge.to_id == cid and edge.relation in {"support", "contradict"})
        ]
        self._edge_keys = {
            (edge.from_id, edge.to_id, edge.relation)
            for edge in self.graph.edges
        }
        for eid in supporting_evidence_ids:
            self._add_edge(eid, cid, "support", rationale, confidence)
        for supporting_cid in supporting_claim_ids:
            self._add_edge(supporting_cid, cid, "support", rationale, confidence)
        for eid in contradicting_evidence_ids:
            self._add_edge(eid, cid, "contradict", rationale, confidence)
        for contradicting_cid in contradicting_claim_ids:
            self._add_edge(contradicting_cid, cid, "contradict", rationale, confidence)

    def apply_compaction(self, update: dict[str, Any]) -> EvidenceGraph:
        for group in update.get("merge_groups", []) or []:
            keep_id = self._clean_optional_string(group.get("keep_claim_id"))
            if not keep_id or not self._get_claim_or_none(keep_id):
                continue
            merge_ids = [
                cid
                for cid in (group.get("merge_claim_ids") or [])
                if isinstance(cid, str) and cid != keep_id and self._get_claim_or_none(cid)
            ]
            if not merge_ids:
                continue
            keep = self._get_claim(keep_id)
            before_status = keep.status
            canonical = self._clean_optional_string(group.get("canonical_claim"))
            if canonical:
                keep.claim = canonical
            rationale = self._clean_optional_string(group.get("rationale"))
            if rationale:
                keep.rationale = f"{keep.rationale} Merge: {rationale}".strip()[:1200]
            keep.merge_history.append(
                {
                    "merge_claim_ids": merge_ids,
                    "rationale": rationale or "",
                    "status_before_merge": before_status,
                }
            )
            for merge_id in merge_ids:
                other = self._get_claim(merge_id)
                self._merge_unique(keep.merged_claim_ids, [merge_id, *other.merged_claim_ids])
                self._merge_unique(keep.supporting_evidence_ids, other.supporting_evidence_ids)
                self._merge_unique(keep.supporting_claim_ids, [cid for cid in other.supporting_claim_ids if cid != keep_id])
                self._merge_unique(keep.contradicting_evidence_ids, other.contradicting_evidence_ids)
                self._merge_unique(keep.contradicting_claim_ids, [cid for cid in other.contradicting_claim_ids if cid != keep_id])
                self._merge_unique(keep.originating_searcher_ids, other.originating_searcher_ids)
                keep.confidence = max(keep.confidence, other.confidence)
                for edge in self.graph.edges:
                    if edge.to_id == merge_id:
                        edge.to_id = keep_id
                    if edge.from_id == merge_id:
                        edge.from_id = keep_id
            self.graph.claim_nodes = [claim for claim in self.graph.claim_nodes if claim.id not in set(merge_ids)]
            self._rebuild_indexes()
        return self.graph

    def increment_searcher_calls(self, count: int) -> None:
        self.graph.searcher_call_count += count

    def mark_round_complete(self, round_id: int) -> None:
        self.graph.rounds_completed = max(self.graph.rounds_completed, round_id)

    def _add_edge(self, from_id: str, to_id: str, relation: str, rationale: str, confidence: float) -> None:
        key = (from_id, to_id, relation)
        if key in self._edge_keys:
            return
        edge = GraphEdge(
            id=f"A{len(self.graph.edges) + 1}",
            from_id=from_id,
            to_id=to_id,
            relation=relation,  # type: ignore[arg-type]
            rationale=rationale,
            confidence=confidence,
        )
        self.graph.edges.append(edge)
        self._edge_keys.add(key)

    def _rebuild_indexes(self) -> None:
        self._evidence_by_fp = {ev.source_fingerprint: ev.id for ev in self.graph.evidence_nodes}
        self._evidence_ids_by_url = defaultdict(list)
        for ev in self.graph.evidence_nodes:
            self._evidence_ids_by_url[normalize_url(ev.source_url)].append(ev.id)
        self._claim_by_fp = {claim_fingerprint(claim.claim): claim.id for claim in self.graph.claim_nodes}
        deduped_edges: list[GraphEdge] = []
        self._edge_keys = set()
        valid_claim_ids = {claim.id for claim in self.graph.claim_nodes}
        valid_node_ids = {ev.id for ev in self.graph.evidence_nodes} | valid_claim_ids
        for edge in self.graph.edges:
            if edge.from_id not in valid_node_ids or edge.to_id not in valid_claim_ids:
                continue
            key = (edge.from_id, edge.to_id, edge.relation)
            if key in self._edge_keys:
                continue
            edge.id = f"A{len(deduped_edges) + 1}"
            deduped_edges.append(edge)
            self._edge_keys.add(key)
        self.graph.edges = deduped_edges
        self._sync_claim_refs_from_edges()
        self._enforce_claim_status_invariants()

    def _merge_missing(self, items: list[dict[str, Any]]) -> None:
        for item in items:
            aspect = (item.get("aspect") or "").strip()
            if not aspect:
                continue
            if self._is_non_actionable_missing(item):
                continue
            key = aspect.lower()
            if key in self._missing_seen:
                continue
            self.graph.missing_aspects.append(
                MissingAspect(
                    id=f"M{len(self.graph.missing_aspects) + 1}",
                    aspect=aspect,
                    why_missing=item.get("why_missing") or "",
                    suggested_queries=item.get("suggested_queries") or [],
                    priority=item.get("priority") or "medium",
                )
            )
            self._missing_seen.add(key)

    @staticmethod
    def _is_non_actionable_missing(item: dict[str, Any]) -> bool:
        suggested = [query for query in item.get("suggested_queries") or [] if str(query).strip()]
        if suggested:
            return False
        text = f"{item.get('aspect') or ''} {item.get('why_missing') or ''}".lower()
        complete_markers = (
            "no additional evidence is needed",
            "no additional evidence needed",
            "answer path is complete",
            "path is complete",
            "already covered",
            "implicitly covered",
        )
        return any(marker in text for marker in complete_markers)

    def _apply_answer_path_requirements(self, items: list[dict[str, Any]]) -> None:
        self.graph.answer_path_requirements = []
        valid_claim_ids = {claim.id for claim in self.graph.claim_nodes}
        for item in items:
            requirement = (item.get("requirement") or "").strip()
            if not requirement:
                continue
            covered = [cid for cid in item.get("covered_by_claim_ids") or [] if cid in valid_claim_ids]
            status = item.get("status") if item.get("status") in {"covered", "missing", "weak", "contradicted"} else "missing"
            if status == "covered" and not covered:
                status = "missing"
            self.graph.answer_path_requirements.append(
                AnswerPathRequirement(
                    id=f"R{len(self.graph.answer_path_requirements) + 1}",
                    requirement=requirement,
                    covered_by_claim_ids=covered,
                    status=status,
                    needed_query=self._clean_optional_string(item.get("needed_query")),
                )
            )

    def _urls_to_eids(self, urls: list[str], source_url_to_eid: dict[str, str]) -> list[str]:
        ids: list[str] = []
        for url in urls:
            clean = normalize_url(url)
            eid = source_url_to_eid.get(clean) or self._latest_evidence_id_for_url(clean)
            if eid and eid not in ids:
                ids.append(eid)
        return ids

    def _valid_eids(self, ids: list[str]) -> list[str]:
        existing = {ev.id for ev in self.graph.evidence_nodes}
        return [eid for eid in ids if eid in existing]

    def _valid_cids(self, ids: list[str], exclude: str | None = None) -> list[str]:
        existing = {claim.id for claim in self.graph.claim_nodes}
        out: list[str] = []
        for cid in ids:
            if cid in existing and cid != exclude and cid not in out:
                out.append(cid)
        return out

    def _sync_claim_refs_from_edges(self) -> None:
        valid_eids = {ev.id for ev in self.graph.evidence_nodes}
        valid_cids = {claim.id for claim in self.graph.claim_nodes}
        claims = {claim.id: claim for claim in self.graph.claim_nodes}
        for claim in self.graph.claim_nodes:
            claim.supporting_evidence_ids = []
            claim.contradicting_evidence_ids = []
            claim.supporting_claim_ids = []
            claim.contradicting_claim_ids = []
        for edge in self.graph.edges:
            if edge.to_id not in valid_cids or edge.from_id == edge.to_id:
                continue
            target = claims[edge.to_id]
            if edge.from_id in valid_eids:
                if edge.relation == "support":
                    self._merge_unique(target.supporting_evidence_ids, [edge.from_id])
                elif edge.relation == "contradict":
                    self._merge_unique(target.contradicting_evidence_ids, [edge.from_id])
            elif edge.from_id in valid_cids:
                if edge.relation == "support":
                    self._merge_unique(target.supporting_claim_ids, [edge.from_id])
                elif edge.relation == "contradict":
                    self._merge_unique(target.contradicting_claim_ids, [edge.from_id])

    def _enforce_claim_status_invariants(self) -> None:
        for claim in self.graph.claim_nodes:
            claim.supporting_evidence_ids = self._valid_eids(claim.supporting_evidence_ids)
            claim.contradicting_evidence_ids = self._valid_eids(claim.contradicting_evidence_ids)
            claim.supporting_claim_ids = self._valid_cids(claim.supporting_claim_ids, exclude=claim.id)
            claim.contradicting_claim_ids = self._valid_cids(claim.contradicting_claim_ids, exclude=claim.id)
            if claim.status == "supported" and not self._claim_has_concrete_support(claim.id):
                claim.status = "unverified"

    def _claim_has_concrete_support(self, cid: str, seen: set[str] | None = None) -> bool:
        seen = seen or set()
        if cid in seen:
            return False
        seen.add(cid)
        claim = self._get_claim_or_none(cid)
        if not claim:
            return False
        if claim.supporting_evidence_ids and not self._only_weak_evidence(claim.supporting_evidence_ids):
            return True
        for supporting_cid in claim.supporting_claim_ids:
            supporting = self._get_claim_or_none(supporting_cid)
            if supporting and supporting.status == "supported" and self._claim_has_concrete_support(supporting_cid, seen):
                return True
        return False

    @classmethod
    def _trajectory_url_origins(cls, trajectory: SearchTrajectory) -> dict[str, str]:
        origins: dict[str, str] = {}
        for step in trajectory.steps:
            obs = step.observation
            if step.action == "VISIT" and isinstance(obs, dict):
                url = normalize_url(obs.get("url") or "")
                if not url:
                    continue
                status = str(obs.get("visit_status") or "")
                provider = str(obs.get("visit_provider") or "")
                if any(marker in status for marker in ("zip", "pdf", "download", "binary")) or provider in {
                    "zip_reader",
                    "pdf_reader",
                    "download_reader",
                }:
                    origins[url] = "downloaded_file"
                else:
                    origins[url] = "visited_page"
            elif step.action == "SEARCH" and isinstance(obs, list):
                for item in obs:
                    if not isinstance(item, dict):
                        continue
                    url = normalize_url(item.get("url") or "")
                    if url and url not in origins:
                        origins[url] = "search_summary" if item.get("search_summary") else "search_snippet"
        return origins

    def _infer_evidence_origin(self, item: dict[str, Any], normalized_url: str, trajectory_url_origins: dict[str, str]) -> str:
        inferred = trajectory_url_origins.get(normalized_url)
        if inferred:
            return inferred
        return self._clean_evidence_origin(item.get("evidence_origin"))

    def _only_weak_evidence(self, ids: list[str]) -> bool:
        if not ids:
            return True
        weak = {"search_snippet", "search_summary", "unknown"}
        origins = []
        for eid in ids:
            ev = self._get_evidence_or_none(eid)
            if ev:
                origins.append(ev.evidence_origin)
        return bool(origins) and all(origin in weak for origin in origins)

    def _latest_evidence_id_for_url(self, normalized_url: str) -> str | None:
        ids = self._evidence_ids_by_url.get(normalized_url) or []
        return ids[-1] if ids else None

    @staticmethod
    def _same_evidence_span(existing: EvidenceNode, text: str) -> bool:
        new_text = " ".join((text or "").lower().split())
        old_text = " ".join((existing.text or "").lower().split())
        if not new_text or not old_text:
            return not new_text and not old_text
        if new_text == old_text:
            return True
        shorter, longer = sorted((new_text, old_text), key=len)
        return len(shorter) >= 80 and shorter in longer

    def _get_evidence(self, eid: str) -> EvidenceNode:
        return next(ev for ev in self.graph.evidence_nodes if ev.id == eid)

    def _get_evidence_or_none(self, eid: str) -> EvidenceNode | None:
        for ev in self.graph.evidence_nodes:
            if ev.id == eid:
                return ev
        return None

    def _get_claim(self, cid: str) -> ClaimNode:
        return next(claim for claim in self.graph.claim_nodes if claim.id == cid)

    def _get_claim_or_none(self, cid: str) -> ClaimNode | None:
        for claim in self.graph.claim_nodes:
            if claim.id == cid:
                return claim
        return None

    @staticmethod
    def _merge_unique(target: list[str], values: list[str]) -> None:
        for value in values:
            if value not in target:
                target.append(value)

    @staticmethod
    def _clean_optional_string(value: Any) -> str | None:
        if value is None or value is False:
            return None
        if value is True:
            return "Needs verification."
        return str(value)

    @staticmethod
    def _clean_float(value: Any, default: float = 0.0) -> float:
        try:
            return float(value)
        except (TypeError, ValueError):
            return default

    @staticmethod
    def _clean_status(value: Any) -> str:
        if value in {"supported", "contradicted", "unverified"}:
            return value
        return "unverified"

    @staticmethod
    def _clean_evidence_origin(value: Any) -> str:
        if value in {"visited_page", "downloaded_file", "search_snippet", "search_summary", "unknown"}:
            return value
        return "unknown"

    @staticmethod
    def _clean_source_type(value: Any) -> str:
        raw = str(value or "").strip().lower()
        if raw in {"web", "website", "webpage", "site", "html", "page"}:
            return "web"
        if raw in {"news", "newspaper", "media", "article", "press", "press_release", "press-release"}:
            return "news"
        if raw in {"paper", "academic", "research_paper", "research-paper", "pdf", "report", "publication"}:
            return "paper"
        return "unknown"

    @staticmethod
    def _clean_string_list(value: Any) -> list[str]:
        if not isinstance(value, list):
            return []
        return [str(item) for item in value if item]

    @staticmethod
    def _max_id_num(prefix: str, existing_ids: list[str]) -> int:
        max_num = 0
        for item in existing_ids:
            if not item.startswith(prefix):
                continue
            try:
                max_num = max(max_num, int(item[len(prefix) :]))
            except ValueError:
                continue
        return max_num


def graph_stats(graph: EvidenceGraph) -> dict[str, int]:
    by_status: dict[str, int] = defaultdict(int)
    for claim in graph.claim_nodes:
        by_status[claim.status] += 1
    return {
        "evidence_nodes": len(graph.evidence_nodes),
        "claim_nodes": len(graph.claim_nodes),
        "edges": len(graph.edges),
        "missing_aspects": len(graph.missing_aspects),
        "supported_claims": by_status["supported"],
        "contradicted_claims": by_status["contradicted"],
        "unverified_claims": by_status["unverified"],
        "searcher_call_count": graph.searcher_call_count,
    }
