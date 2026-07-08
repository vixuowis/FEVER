const state = {
  activeRun: null,
  activeJob: null,
  snapshot: null,
  pollTimer: null,
  graphViewBox: null,
  graphMode: "answer",
  graphFilter: "",
  timelineKind: "all",
  timelineFilter: "",
  spec: null,
};

const $ = (id) => document.getElementById(id);


function json(value) {
  return JSON.stringify(value ?? null, null, 2);
}

async function api(path, options) {
  const response = await fetch(path, options);
  if (!response.ok) throw new Error(await response.text());
  return response.json();
}

function setStatus(text) {
  $("job-status").textContent = text;
}

function basename(path) {
  return String(path || "").split("/").filter(Boolean).pop() || "";
}

function formatTime(ts) {
  if (!ts) return "";
  const date = new Date(ts);
  if (Number.isNaN(date.getTime())) return String(ts);
  return date.toLocaleTimeString("zh-CN", { hour12: false });
}

function truncateText(value, max = 96) {
  const text = String(value ?? "");
  return text.length > max ? `${text.slice(0, max - 1)}...` : text;
}

function initialQueries(snapshot) {
  const value = snapshot.initial_queries;
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.queries)) return value.queries;
  return [];
}

function roundFromSearcherId(searcherId) {
  const match = String(searcherId || "").match(/^r(\d+)_/);
  return match ? match[1] : "?";
}

function shortSearcherId(searcherId) {
  const value = String(searcherId || "Searcher");
  const match = value.match(/^(r\d+_S\d+)/);
  return match ? match[1] : value;
}

function groupTrajectoriesByRound(trajectories) {
  return trajectories.reduce((acc, traj) => {
    const roundId = roundFromSearcherId(traj.searcher_id);
    if (!acc[roundId]) acc[roundId] = [];
    acc[roundId].push(traj);
    return acc;
  }, {});
}

function eventsFor(snapshot, predicate) {
  return (snapshot.normalized_events || snapshot.events || []).filter(predicate);
}

function latestEvent(snapshot) {
  const events = snapshot.normalized_events || snapshot.events || [];
  return events.length ? events[events.length - 1] : null;
}

function isRunComplete(snapshot) {
  return Boolean(snapshot.final_answer?.answer);
}

function badges(snapshot) {
  const items = [];
  const events = snapshot.events || [];
  const graph = snapshot.graph || {};
  const evalResult = snapshot.benchmark_eval;
  const last = latestEvent(snapshot);
  items.push(`<span class="badge">${events.length} events</span>`);
  if (last) items.push(`<span class="badge">last ${escapeHtml(formatTime(last.ts))}</span>`);
  items.push(`<span class="badge ${isRunComplete(snapshot) ? "ok" : ""}">${isRunComplete(snapshot) ? "finished" : "partial"}</span>`);
  if (graph.claim_nodes) items.push(`<span class="badge">${graph.claim_nodes.length} claims</span>`);
  if (graph.evidence_nodes) items.push(`<span class="badge">${graph.evidence_nodes.length} evidence</span>`);
  if (evalResult) items.push(`<span class="badge ${evalResult.correct ? "ok" : "bad"}">score ${evalResult.score}</span>`);
  $("run-badges").innerHTML = items.join("");
}

function renderOverview(snapshot) {
  const question = snapshot.question?.question || snapshot.graph?.question || "";
  $("run-health").innerHTML = renderHealthItems(runHealth(snapshot));
  $("run-progress").innerHTML = renderProgress(snapshot);
  $("question-view").textContent = question;
  $("answer-view").textContent = snapshot.final_answer
    ? snapshot.final_answer.answer || json(snapshot.final_answer)
    : "No final answer yet.";
  const queries = initialQueries(snapshot);
  $("initial-queries").innerHTML = queries
    .map((q, idx) => `<span class="chip">Q${idx + 1}: ${escapeHtml(q.query || q)}</span>`)
    .join("");
  $("run-settings").innerHTML = renderRunSettings(snapshot);
}

function runHealth(snapshot) {
  const graph = snapshot.graph || {};
  const events = snapshot.normalized_events || snapshot.events || [];
  const answer = snapshot.final_answer;
  const hasAnswer = Boolean(answer?.answer);
  const verificationSeen = hasVerification(snapshot);
  const missing = graph.missing_aspects || [];
  const unverified = (graph.claim_nodes || []).filter((claim) => claim.status === "unverified");
  const contradicted = (graph.claim_nodes || []).filter((claim) => claim.status === "contradicted");
  const warningEvents = events.filter((event) => event.error || String(event.event || "").includes("failed") || String(event.event || "").includes("fallback"));
  const hardFailure = !hasAnswer && warningEvents.some((event) => String(event.event || "").includes("unhandled") || String(event.event || "").includes("failed"));
  const verificationItem = verificationSeen
    ? {
        level: graph.sufficient ? "ok" : "warn",
        title: graph.sufficient ? "Verification says sufficient" : "Verification says insufficient",
        detail: graph.stop_reason || "The latest graph verification has completed.",
      }
    : {
        level: "warn",
        title: "Verification pending",
        detail: "No graph verification result is available in the loaded run state yet.",
      };
  return [
    {
      level: hasAnswer ? "ok" : "warn",
      title: hasAnswer ? "Answer ready" : "Answer pending",
      detail: answer?.answer || "The run has not reached final synthesis yet.",
    },
    verificationItem,
    {
      level: missing.length ? "bad" : "ok",
      title: missing.length ? `${missing.length} missing aspect${missing.length === 1 ? "" : "s"}` : "No missing aspects",
      detail: missing.slice(0, 4).map((item) => item.aspect).join(" | ") || "Verification did not leave unresolved answer-path gaps.",
    },
    {
      level: unverified.length ? "warn" : "ok",
      title: unverified.length ? `${unverified.length} unverified claim${unverified.length === 1 ? "" : "s"}` : "No unverified claims",
      detail: unverified.slice(0, 4).map((claim) => claim.claim).join(" | ") || "All visible graph claims are either supported or contradicted.",
    },
    {
      level: contradicted.length ? "warn" : "ok",
      title: contradicted.length ? `${contradicted.length} contradicted claim${contradicted.length === 1 ? "" : "s"}` : "No contradicted claims",
      detail: contradicted.slice(0, 4).map((claim) => claim.claim).join(" | ") || "No contradiction has been marked in the graph.",
    },
    {
      level: hardFailure ? "bad" : warningEvents.length ? "warn" : "ok",
      title: warningEvents.length ? `${warningEvents.length} runtime warning${warningEvents.length === 1 ? "" : "s"}` : "No runtime warnings",
      detail: warningEvents.slice(-3).map((event) => event.error || event.event).join(" | ") || "No fallback or failed tool/LLM stages are visible in the loaded events.",
    },
  ];
}

function hasVerification(snapshot) {
  const graph = snapshot.graph || {};
  const events = snapshot.normalized_events || snapshot.events || [];
  if (snapshot.graph_snapshots?.some((snap) => String(snap.name || "").includes("verified"))) return true;
  if (events.some((event) => ["round_verified", "final_verified"].includes(event.event) || event.label === "navigator_verification")) return true;
  return graph.sufficient === true || Boolean(graph.stop_reason);
}


function renderHealthItems(items) {
  return items
    .map((item) => `<div class="health-item ${escapeAttr(item.level)}">
      <span class="mark-small">${item.level === "ok" ? "✓" : item.level === "bad" ? "!" : "!"}</span>
      <div><strong>${escapeHtml(item.title)}</strong><span>${escapeHtml(truncateText(item.detail, 260))}</span></div>
    </div>`)
    .join("");
}

function renderProgress(snapshot) {
  const events = snapshot.normalized_events || snapshot.events || [];
  const trajectories = snapshot.trajectories || [];
  const partials = snapshot.partials || [];
  const rounds = [...new Set([
    ...trajectories.map((traj) => roundFromSearcherId(traj.searcher_id)),
    ...partials.map((partial) => String(partial.round_id ?? "?")),
  ])].filter((item) => item !== "?").sort((a, b) => Number(a) - Number(b));
  const initialCount = initialQueries(snapshot).length;
  const roundCards = rounds.map((roundId) => {
    const roundTrajs = trajectories.filter((traj) => roundFromSearcherId(traj.searcher_id) === roundId);
    const roundPartials = partials.filter((partial) => String(partial.round_id) === String(roundId));
    const roundEvents = events.filter((event) => String(event.round_id) === String(roundId));
    const searches = roundEvents.filter((event) => event.phase === "search").length;
    const visits = roundEvents.filter((event) => event.phase === "visit").length;
    const verified = roundEvents.some((event) => event.event === "round_verified") || (roundId === rounds.at(-1) && events.some((event) => event.event === "final_verified"));
    return `<div class="round-progress-card">
      <strong>Round ${escapeHtml(roundId)}</strong>
      <span>${roundTrajs.length} Searchers finished</span>
      <span>${roundPartials.length} trajectory windows extracted</span>
      <span>${searches} search events, ${visits} visit events</span>
      <span>${verified ? "verification completed" : "verification pending"}</span>
    </div>`;
  }).join("");
  const finalLine = snapshot.final_answer
    ? `<div class="round-progress-card ok"><strong>Final synthesis</strong><span>Final answer is available.</span></div>`
    : `<div class="round-progress-card warn"><strong>Final synthesis</strong><span>Waiting for the graph to be verified.</span></div>`;
  const planLine = `<div class="round-progress-card ${initialCount ? "ok" : "warn"}"><strong>Initial planning</strong><span>${initialCount || 0} Searcher task${initialCount === 1 ? "" : "s"} generated</span></div>`;
  return planLine + roundCards + finalLine;
}


function renderRunSettings(snapshot) {
  const cfg = snapshot.config || {};
  const req = snapshot.run_request || {};
  const rows = [
    ["Searcher model", cfg.searcher_model || cfg.llm_model || "server configured"],
    ["Summary model", cfg.summary_model || cfg.llm_model || "server configured"],
    ["Graph extraction", cfg.graph_extraction_model || cfg.llm_model || "server configured"],
    ["Verification model", cfg.verification_model || cfg.llm_model || "server configured"],
    ["Final synthesis", cfg.synthesis_model || cfg.llm_model || "server configured"],
    ["Judge model", cfg.judge_model || "server configured"],
    ["Navigator thinking", boolText(cfg.navigator_enable_thinking)],
    ["Searcher thinking", boolText(cfg.searcher_enable_thinking)],
    ["Initial Searchers", req.k ?? cfg.max_initial_dispatch ?? ""],
    ["Max Rounds", req.max_rounds ?? cfg.max_rounds ?? ""],
    ["Total Searchers", cfg.max_searcher_calls ?? ""],
    ["Follow-up Batch", cfg.max_dispatch_per_round ?? ""],
    ["Searcher Steps", cfg.max_searcher_steps ?? ""],
    ["Searcher Concurrency", cfg.searcher_concurrency ?? ""],
    ["Trajectory Window", `${cfg.trajectory_window_size ?? ""} / stride ${cfg.trajectory_window_stride ?? ""}`],
  ];
  return rows.map(([key, value]) => `<div><strong>${escapeHtml(key)}</strong><span>${escapeHtml(value)}</span></div>`).join("");
}


function boolText(value) {
  return value ? "on" : "off";
}

function renderAnswer(snapshot) {
  const answer = snapshot.final_answer;
  const graph = snapshot.graph || {};
  if (!answer) {
    $("answer-rich").innerHTML = `<div class="empty">No final answer yet.</div>`;
    $("answer-audit").innerHTML = renderHealthItems([{ level: "warn", title: "Final answer pending", detail: "Run has not completed synthesis." }]);
    $("answer-sources").innerHTML = "";
    return;
  }
  $("answer-rich").innerHTML = `<div class="answer-text">${linkEvidenceRefs(escapeHtml(answer.answer || ""))}</div>
    <h2>Key Claims</h2>
    ${(answer.key_claims || []).map(renderFinalClaim).join("") || `<div class="empty">No key claims.</div>`}
    ${(answer.uncertainties || []).length ? `<h2>Uncertainties</h2>${(answer.uncertainties || []).map((item) => `<div class="health-item warn"><span class="mark-small">!</span><div><strong>Uncertainty</strong><span>${escapeHtml(item)}</span></div></div>`).join("")}` : ""}`;
  $("answer-audit").innerHTML = renderHealthItems(answerAudit(snapshot));
  const evidenceById = new Map((graph.evidence_nodes || []).map((ev) => [ev.id, ev]));
  $("answer-sources").innerHTML = (answer.citations || [])
    .map((citation) => {
      const ev = evidenceById.get(citation.evidence_id) || citation;
      return `<div class="source-card">
        <strong>${escapeHtml(citation.evidence_id || "")}: ${escapeHtml(ev.source_title || ev.title || "")}</strong>
        <span>${escapeHtml(ev.source_url || ev.url || "")}</span>
      </div>`;
    })
    .join("") || `<div class="empty">No citations.</div>`;
}

function renderFinalClaim(claim) {
  const ids = claim.evidence_ids || [];
  return `<div class="claim-card ${escapeAttr(claim.status || "")}">
    <strong>${escapeHtml(claim.claim || "")}</strong>
    <span>Status: ${escapeHtml(claim.status || "")}</span><br />
    <span>Evidence: ${ids.map((eid) => `<span class="citation-chip">${escapeHtml(eid)}</span>`).join("") || "None"}</span><br />
    <span>Source trace: ${claim.source_trace_complete ? "complete" : "incomplete"}</span>
    ${claim.missing_evidence_reason ? `<br /><span>Issue: ${escapeHtml(claim.missing_evidence_reason)}</span>` : ""}
  </div>`;
}

function answerAudit(snapshot) {
  const graph = snapshot.graph || {};
  const answer = snapshot.final_answer || {};
  const evidenceIds = new Set((graph.evidence_nodes || []).map((ev) => ev.id));
  const claims = answer.key_claims || [];
  const citedIds = [...new Set(claims.flatMap((claim) => claim.evidence_ids || []))];
  const missingEvidence = claims.filter((claim) => claim.status === "supported" && !(claim.evidence_ids || []).length);
  const invalidEvidence = claims.filter((claim) => (claim.evidence_ids || []).some((eid) => !evidenceIds.has(eid)));
  return [
    { level: citedIds.length ? "ok" : "warn", title: `${citedIds.length} evidence citation${citedIds.length === 1 ? "" : "s"}`, detail: citedIds.join(", ") || "The final answer has not cited graph evidence yet." },
    { level: missingEvidence.length ? "bad" : "ok", title: missingEvidence.length ? "Supported claim missing citation" : "Supported claims cite evidence", detail: missingEvidence.map((c) => c.claim).join(" | ") || "Every supported final claim points to evidence in the graph." },
    { level: invalidEvidence.length ? "bad" : "ok", title: invalidEvidence.length ? "Citation points to missing evidence" : "Citations exist in the graph", detail: invalidEvidence.map((c) => c.claim).join(" | ") || "Each cited evidence ID can be found in the graph." },
    { level: (answer.uncertainties || []).length ? "warn" : "ok", title: (answer.uncertainties || []).length ? "Answer reports uncertainty" : "No answer uncertainty", detail: (answer.uncertainties || []).join(" | ") || "The final answer did not report unresolved uncertainty." },
  ];
}


function linkEvidenceRefs(text) {
  return text.replace(/\b(E\d+)\b/g, '<span class="citation-chip">$1</span>');
}

function eventSummary(event) {
  const parts = [];
  if (event.phase) parts.push(event.phase);
  if (event.round_id !== undefined) parts.push(`round ${event.round_id}`);
  if (event.agent_type) parts.push(event.agent_type);
  if (event.searcher_id) parts.push(shortSearcherId(event.searcher_id));
  if (event.step_index !== undefined) parts.push(`step ${event.step_index}`);
  if (event.window_idx !== undefined) parts.push(`window ${event.window_idx}/${event.window_count || "?"}`);
  if (event.query) parts.push(truncateText(event.query, 90));
  if (event.returned !== undefined) parts.push(`${event.returned} results`);
  if (event.chars !== undefined) parts.push(`${event.chars} chars`);
  if (event.stats) {
    parts.push(`${event.stats.claim_nodes || 0} claims`);
    parts.push(`${event.stats.evidence_nodes || 0} evidence`);
  }
  if (event.error) parts.push(event.error);
  return parts.join(" | ");
}

function renderTimeline(snapshot) {
  const sourceEvents = snapshot.normalized_events || snapshot.events || [];
  const rows = sourceEvents
    .map((event, idx) => ({ ...event, _idx: idx }))
    .filter((event) => {
      const kind = eventCategory(event);
      const text = `${event.event || ""} ${event.label || ""} ${event.agent_type || ""} ${event.phase || ""} ${event.searcher_id || ""} ${event.query || ""} ${event.error || ""}`.toLowerCase();
      const okKind = state.timelineKind === "all" || kind === state.timelineKind;
      const okText = !state.timelineFilter || text.includes(state.timelineFilter.toLowerCase());
      return okKind && okText;
    })
    .slice()
    .reverse();
  $("timeline-list").innerHTML = rows
    .map((event, displayIdx) => `<button class="event ${escapeAttr(eventCategory(event))} ${event.error ? "error" : ""}" data-display-idx="${displayIdx}" type="button">
      <span class="event-time">${escapeHtml(formatTime(event.ts))}</span>
      <span class="type" title="${escapeAttr(event.event || "")}">${escapeHtml(friendlyEventName(event))}</span>
      <span class="meta">${escapeHtml(eventSummary(event))}</span>
    </button>`)
    .join("");
  $("timeline-list").querySelectorAll("[data-display-idx]").forEach((button) => {
    button.addEventListener("click", () => {
      const event = rows[Number(button.dataset.displayIdx)];
      $("timeline-detail").innerHTML = renderEventDetail(event);
    });
  });
}

function friendlyEventName(event) {
  const name = String(event.event || "");
  const label = String(event.label || "");
  if (name === "navigator_llm_stage") return label.replace("navigator_", "nav ");
  if (name === "searcher_llm_step") return "Searcher LLM";
  if (name === "serial_window_trajectory_observed") return "Trajectory observed";
  if (name === "serial_window_trajectory_received") return "Trajectory returned";
  if (name === "serial_window_graph_updated") return "Graph updated";
  if (name === "serial_window_observation_started") return "Round started";
  if (name === "searcher_search_tool_result") return "Search result";
  if (name === "searcher_visit_tool_result") return "Visit result";
  return truncateText(name, 28);
}

function eventCategory(event) {
  if (event.phase === "search") return "search";
  if (event.phase === "visit") return "visit";
  if (event.agent_type === "navigator") return "navigator";
  if (event.agent_type === "searcher") return "searcher";
  const name = String(event.event || "");
  const label = String(event.label || "");
  if (event.error || name.includes("failed") || name.includes("fallback")) return "error";
  if (name.includes("visit")) return "visit";
  if (name.includes("bocha") || name.includes("search")) return "search";
  if (name.includes("graph") || name.includes("round_") || name.includes("serial_window")) return "graph";
  if (name.includes("searcher")) return "searcher";
  if (label.includes("navigator") || name.includes("navigator")) return "navigator";
  if (name === "llm_call") return "llm";
  return "other";
}

function renderEventDetail(event) {
  if (!event) return "Select an event.";
  const rows = [
    ["Agent", event.agent_id],
    ["Category", eventCategory(event)],
    ["Phase", event.phase],
    ["Round", event.round_id],
    ["Label", event.label],
    ["Searcher", event.searcher_id ? shortSearcherId(event.searcher_id) : ""],
    ["Window", event.window_idx ? `${event.window_idx}/${event.window_count || "?"}` : ""],
    ["Tokens", tokenSummary(event)],
    ["Error", event.error],
  ].filter(([, value]) => value !== undefined && value !== null && value !== "");
  return `<div class="detail-title">${escapeHtml(event.event || "Event")}</div>
    <div class="detail-subtitle">${escapeHtml(formatTime(event.ts))}</div>
    <div class="detail-lines">
      ${rows.map(([key, value]) => `<div><strong>${escapeHtml(key)}</strong><span>${escapeHtml(value)}</span></div>`).join("")}
    </div>${detailsJson("Event JSON", stripHeavyFields(event))}`;
}

function tokenSummary(event) {
  if (event.total_tokens === undefined) return "";
  return `${event.prompt_tokens || 0} prompt + ${event.completion_tokens || 0} completion = ${event.total_tokens}`;
}

function renderSearchers(snapshot) {
  const grouped = groupTrajectoriesByRound(snapshot.trajectories || []);
  $("searcher-list").innerHTML =
    Object.entries(grouped)
      .map(([roundId, roundTrajs]) => {
        const items = roundTrajs
          .map((traj) => {
            const steps = (traj.steps || []).map(renderSearcherStep).join("");
            return `<details class="trace-card">
              <summary>
                <span class="round-label">Round ${escapeHtml(roundId)}</span>
                <strong>${escapeHtml(shortSearcherId(traj.searcher_id))}</strong>
                <span>${escapeHtml(traj.query || "")}</span>
              </summary>
              <div class="trace-body">
                <div class="summary-grid">
                  <div><strong>Steps</strong><span>${(traj.steps || []).length}</span></div>
                  <div><strong>Target</strong><span>${escapeHtml(traj.target_claim_or_aspect || traj.expected_evidence || "")}</span></div>
                  <div><strong>Source Preference</strong><span>${escapeHtml(traj.source_preference || "")}</span></div>
                  <div><strong>Search / Visit</strong><span>${searcherCounts(traj).searches} / ${searcherCounts(traj).visits}</span></div>
                  <div><strong>Answer</strong><span>${escapeHtml(truncateText(traj.local_answer?.local_answer || traj.local_answer?.answer || "", 160))}</span></div>
                </div>
                <details class="debug-details"><summary>Debug metadata</summary><pre>${escapeHtml(json({ searcher_id: traj.searcher_id, query: traj.query, angle: traj.angle, why: traj.why, local_answer: traj.local_answer }))}</pre></details>
                ${steps}
              </div>
            </details>`;
          })
          .join("");
        return `<article class="panel">
          <h2>Round ${escapeHtml(roundId)} Searchers</h2>
          <div class="trace-list">${items}</div>
        </article>`;
      })
      .join("") || `<article class="panel"><h2>No Searcher trajectories yet</h2></article>`;
}

function searcherCounts(traj) {
  const steps = traj.steps || [];
  return {
    searches: steps.filter((step) => step.action === "SEARCH").length,
    visits: steps.filter((step) => step.action === "VISIT").length,
    corrections: steps.filter((step) => step.action === "CORRECTION").length,
  };
}

function renderSearcherStep(step, idx) {
  const action = safeActionClass(step.action);
  const stepIndex = step.step_index || idx + 1;
  const obs = step.observation;
  const obsSummary = Array.isArray(obs)
    ? `${obs.length} search results`
    : obs?.page_text
      ? `${obs.url || ""} | ${obs.page_text.length} chars`
      : obs?.local_answer || obs?.error || "";
  return `<details class="step">
    <summary>
      <span class="action ${action}">${escapeHtml(step.action || "")}</span>
      <strong>Step ${stepIndex}</strong>
      <span class="meta">${escapeHtml(truncateText(step.query || step.url || step.result_id || obsSummary, 140))}</span>
    </summary>
    <div class="step-readable">
      <p>${escapeHtml(step.rationale || "")}</p>
      <pre>${escapeHtml(json({ action_input: step.action_input, observation: trimObservation(obs) }))}</pre>
    </div>
  </details>`;
}

function safeActionClass(action) {
  const value = String(action || "").toLowerCase();
  return ["search", "visit", "answer", "correction"].includes(value) ? value : "unknown";
}

function renderWorkflow(snapshot) {
  const workflow = buildWorkflowStages(snapshot);
  $("workflow-board").innerHTML = workflow.stages.map(renderWorkflowStage).join("");
  $("workflow-board").querySelectorAll("[data-workflow-node]").forEach((button) => {
    button.addEventListener("click", () => {
      const node = workflow.nodes.get(button.dataset.workflowNode);
      $("workflow-detail").dataset.selected = button.dataset.workflowNode;
      $("workflow-detail").innerHTML = renderNodeDetail(node);
    });
  });
  const selectedNodeId = $("workflow-detail").dataset.selected;
  if (selectedNodeId && workflow.nodes.has(selectedNodeId)) {
    $("workflow-detail").innerHTML = renderNodeDetail(workflow.nodes.get(selectedNodeId));
  }
}

function renderGraph(snapshot) {
  const graph = snapshot.graph || {};
  const filtered = graphForMode(snapshot, state.graphMode, state.graphFilter);
  const evidence = filtered.evidence;
  const claims = filtered.claims;
  const edges = filtered.edges;
  $("graph-stats").innerHTML = [
    ["Evidence", `${evidence.length}/${(graph.evidence_nodes || []).length}`],
    ["Claims", `${claims.length}/${(graph.claim_nodes || []).length}`],
    ["Edges", `${edges.length}/${(graph.edges || []).length}`],
    ["Missing", (graph.missing_aspects || []).length],
  ]
    .map(([label, count]) => `<div class="stat"><strong>${count}</strong><span>${label}</span></div>`)
    .join("");
  $("graph-detail").innerHTML = `<div class="detail-title">Evidence Graph</div>
    <div class="detail-subtitle">${escapeHtml(graphModeDescription(state.graphMode))}</div>
    <div class="detail-lines">
      <div><strong>Mode</strong><span>${escapeHtml(state.graphMode)}</span></div>
      <div><strong>Claims</strong><span>${claims.length}</span></div>
      <div><strong>Evidence</strong><span>${evidence.length}</span></div>
      <div><strong>Edges</strong><span>${edges.length}</span></div>
      <div><strong>Missing aspects</strong><span>${(graph.missing_aspects || []).length}</span></div>
      <div><strong>Stop reason</strong><span>${escapeHtml(graph.stop_reason || "")}</span></div>
    </div>${renderGraphLegend()}${renderMissingAspects(graph.missing_aspects || [])}`;
  drawGraph(evidence, claims, edges);
}

function graphModeDescription(mode) {
  if (mode === "answer") return "Evidence and claims cited by the final answer.";
  if (mode === "problems") return "Unverified, contradicted, and unresolved graph items.";
  return "Complete Navigator evidence graph.";
}

function renderGraphLegend() {
  return `<div class="graph-legend">
    <span><i class="edge-swatch support"></i>support</span>
    <span><i class="edge-swatch contradict"></i>contradict</span>
    <span><i class="edge-swatch context"></i>context relation</span>
    <span><i class="node-swatch supported"></i>supported claim</span>
    <span><i class="node-swatch unverified"></i>unverified claim</span>
    <span><i class="node-swatch contradicted"></i>contradicted claim</span>
    <em>Context edges are background links, not direct support.</em>
  </div>`;
}

function renderMissingAspects(items) {
  if (!items.length) return "";
  return `<div class="graph-issues">
    <div class="detail-title small">Missing Aspects</div>
    ${items.map((item) => `<div class="graph-issue ${escapeAttr(item.priority || "medium")}">
      <strong>${escapeHtml(item.aspect || "")}</strong>
      <span>${escapeHtml(item.why_missing || "")}</span>
      ${(item.suggested_queries || []).length ? `<em>${escapeHtml((item.suggested_queries || []).join(" | "))}</em>` : ""}
    </div>`).join("")}
  </div>`;
}

function graphForMode(snapshot, mode, filterText = "") {
  const graph = snapshot.graph || {};
  const allEvidence = graph.evidence_nodes || [];
  const allClaims = graph.claim_nodes || [];
  const allEdges = graph.edges || [];
  const evidenceById = new Map(allEvidence.map((item) => [item.id, item]));
  const claimById = new Map(allClaims.map((item) => [item.id, item]));
  const wantedEvidence = new Set();
  const wantedClaims = new Set();
  const wantedEdges = new Set();

  function addClaimTrace(cid) {
    if (!cid || wantedClaims.has(cid)) return;
    const claim = claimById.get(cid);
    if (!claim) return;
    wantedClaims.add(cid);
    (claim.supporting_evidence_ids || []).forEach((eid) => wantedEvidence.add(eid));
    (claim.contradicting_evidence_ids || []).forEach((eid) => wantedEvidence.add(eid));
    (claim.supporting_claim_ids || []).forEach(addClaimTrace);
    (claim.contradicting_claim_ids || []).forEach(addClaimTrace);
  }

  if (mode === "answer") {
    for (const finalClaim of snapshot.final_answer?.key_claims || []) {
      for (const eid of finalClaim.evidence_ids || []) wantedEvidence.add(eid);
      for (const claim of allClaims) {
        const related = (claim.supporting_evidence_ids || []).some((eid) => (finalClaim.evidence_ids || []).includes(eid));
        if (related || String(finalClaim.claim || "").includes(claim.claim || "")) addClaimTrace(claim.id);
      }
    }
    if (!wantedEvidence.size && !wantedClaims.size) {
      allClaims.filter((claim) => claim.status === "supported").slice(0, 8).forEach((claim) => addClaimTrace(claim.id));
    }
  } else if (mode === "problems") {
    allClaims
      .filter((claim) => claim.status === "unverified" || claim.status === "contradicted")
      .forEach((claim) => addClaimTrace(claim.id));
    if ((graph.missing_aspects || []).length && !wantedClaims.size) {
      allClaims.filter((claim) => claim.status !== "supported").slice(0, 10).forEach((claim) => addClaimTrace(claim.id));
    }
  } else {
    allEvidence.forEach((ev) => wantedEvidence.add(ev.id));
    allClaims.forEach((claim) => wantedClaims.add(claim.id));
  }

  for (const edge of allEdges) {
    if (wantedClaims.has(edge.to_id) && (wantedEvidence.has(edge.from_id) || wantedClaims.has(edge.from_id))) {
      wantedEdges.add(edge.id);
      if (evidenceById.has(edge.from_id)) wantedEvidence.add(edge.from_id);
      if (claimById.has(edge.from_id)) wantedClaims.add(edge.from_id);
    }
  }

  let evidence = allEvidence.filter((ev) => wantedEvidence.has(ev.id));
  let claims = allClaims.filter((claim) => wantedClaims.has(claim.id));
  let edges = allEdges.filter((edge) => wantedEdges.has(edge.id));
  const needle = String(filterText || "").trim().toLowerCase();
  if (needle) {
    evidence = evidence.filter((ev) => graphText(ev).includes(needle));
    claims = claims.filter((claim) => graphText(claim).includes(needle));
    const evIds = new Set(evidence.map((ev) => ev.id));
    const claimIds = new Set(claims.map((claim) => claim.id));
    edges = edges.filter((edge) => claimIds.has(edge.to_id) && (evIds.has(edge.from_id) || claimIds.has(edge.from_id)));
  }
  return { evidence, claims, edges };
}

function graphText(item) {
  return JSON.stringify(item || {}).toLowerCase();
}

function buildWorkflowStages(snapshot) {
  const question = snapshot.question?.question || snapshot.graph?.question || "";
  const queries = initialQueries(snapshot);
  const trajectories = snapshot.trajectories || [];
  const graph = snapshot.graph || {};
  const graphSnapshots = snapshot.graph_snapshots || [];
  const events = snapshot.events || [];
  const rounds = [...new Set(trajectories.map((traj) => roundFromSearcherId(traj.searcher_id)))]
    .sort((a, b) => Number(a) - Number(b));
  const nodes = new Map();
  const stages = [];

  function addStage(id, label, stageNodes) {
    stageNodes.forEach((node) => nodes.set(node.id, node));
    stages.push({ id, label, nodes: stageNodes });
  }

  const questionNode = {
    id: "question",
    label: "Original Question",
    sublabel: question,
    kind: "question",
    detailType: "question",
    detail: { question: snapshot.question || { question } },
  };
  addStage("stage_question", "Original Question", [questionNode]);

  const initialNavigator = {
    id: "navigator_plan",
    label: "Initial Planning",
    sublabel: `${queries.length} assigned research tasks`,
    kind: "navigator",
    detailType: "navigator",
    detail: {
      initial_queries: queries,
      llm_events: eventsFor(snapshot, (event) => event.label === "navigator_initial_queries" || event.label === "navigator_followups").slice(0, 3),
    },
  };
  const queryNodes = queries.map((query, idx) => ({
    id: `initial_query_${idx + 1}`,
    label: `Task ${idx + 1}`,
    sublabel: query.query || String(query),
    kind: "query",
    detailType: "query",
    detail: query,
  }));
  addStage("stage_plan", "Initial Planning", [initialNavigator, ...queryNodes]);

  rounds.forEach((roundId) => {
    const roundTrajs = trajectories.filter((traj) => roundFromSearcherId(traj.searcher_id) === roundId);
    const followups = snapshot.followups?.[roundId] || [];
    const roundEvents = events.filter((event) => String(event.round_id) === String(roundId));
    const roundPartials = (snapshot.partials || []).filter((partial) => String(partial.round_id) === String(roundId));
    const dispatchNode = {
      id: `dispatch_round_${roundId}`,
      label: roundId === "0" ? "Initial Dispatch" : `Follow-up Dispatch ${roundId}`,
      sublabel: `${roundTrajs.length} Searchers launched`,
      kind: "navigator",
      detailType: "navigator",
      detail: {
        round_id: roundId,
        queries: roundId === "0" ? queries : followups,
        events: roundEvents.filter((event) => event.event === "serial_window_observation_started"),
      },
    };
    const searcherNodes = roundTrajs.map((traj, idx) => ({
      id: `searcher_${roundId}_${idx + 1}`,
      label: shortSearcherId(traj.searcher_id),
      sublabel: `${searcherCounts(traj).searches} SEARCH, ${searcherCounts(traj).visits} VISIT | ${traj.query}`,
      kind: "searcher",
      detailType: "searcher",
      detail: { trajectory: traj, events: eventsFor(snapshot, (event) => event.searcher_id === traj.searcher_id) },
    }));
    const windowNodes = roundPartials.map((partial, idx) => ({
      id: `window_${roundId}_${idx + 1}`,
      label: `Extract W${partial.window_idx || idx + 1}`,
      sublabel: `${shortSearcherId(partial.searcher_id)} steps ${partial.step_start ?? "?"}-${partial.step_end ?? "?"}`,
      kind: "graph",
      detailType: "window",
      detail: {
        partial,
        events: events.filter(
          (event) =>
            event.searcher_id === partial.searcher_id &&
            Number(event.window_idx || 0) === Number(partial.window_idx || 0)
        ),
      },
    }));
    const observeNode = {
      id: `observe_round_${roundId}`,
      label: `Merge Round ${roundId}`,
      sublabel: `${roundEvents.filter((event) => event.event === "serial_window_graph_updated").length} graph updates`,
      kind: "navigator",
      detailType: "navigator",
      detail: {
        round_id: roundId,
        events: roundEvents.filter((event) => event.event.includes("serial_window") || event.label === "navigator_graph_extraction"),
        graph_snapshots: graphSnapshots.filter((snap) => snap.name.includes(`round_${roundId}_observed`)),
      },
    };
    const compactNode = {
      id: `compact_round_${roundId}`,
      label: `Claim Compaction ${roundId}`,
      sublabel: `${roundEvents.filter((event) => event.event === "graph_compacted").length} compaction events`,
      kind: "graph",
      detailType: "navigator",
      detail: {
        round_id: roundId,
        events: roundEvents.filter((event) => event.event.includes("compact") || event.label === "navigator_graph_compaction"),
        graph_snapshots: graphSnapshots.filter((snap) => snap.name.includes(`round_${roundId}`)),
      },
    };
    const verifyNode = {
      id: `verify_round_${roundId}`,
      label: `Verify Graph ${roundId}`,
      sublabel: graphSnapshots.find((snap) => snap.name === `round_${Number(roundId) + 1}_verified`)?.graph?.stop_reason || "verification state",
      kind: "navigator",
      detailType: "graph",
      detail: {
        graph: graphSnapshots.find((snap) => snap.name === `round_${Number(roundId) + 1}_verified`)?.graph || graph,
        events: roundEvents.filter((event) => event.event === "round_verified" || event.label === "navigator_verification"),
      },
    };
    const followupNodes = followups.map((query, idx) => ({
      id: `followup_${roundId}_${idx + 1}`,
      label: `Follow-up Task ${idx + 1}`,
      sublabel: query.query || String(query),
      kind: "query",
      detailType: "query",
      detail: query,
    }));
    const roundNodes = [dispatchNode, ...followupNodes, ...searcherNodes, ...windowNodes, observeNode, compactNode, verifyNode];
    addStage(`stage_round_${roundId}`, `Round ${roundId}`, roundNodes);
  });

  const graphNode = {
    id: "final_graph",
    label: "Evidence Graph",
    sublabel: `${(graph.claim_nodes || []).length} claims, ${(graph.evidence_nodes || []).length} evidence`,
    kind: "graph",
    detailType: "graph",
    detail: { graph, graph_snapshots: graphSnapshots },
  };
  const answerNode = {
    id: "final_answer",
    label: "Final Answer",
    sublabel: snapshot.final_answer?.answer || "pending",
    kind: "answer",
    detailType: "answer",
    detail: snapshot.final_answer || { status: "pending" },
  };
  addStage("stage_final", "Final Synthesis", [graphNode, answerNode]);
  return { stages, nodes };
}

function renderWorkflowStage(stage) {
  return `<section class="workflow-stage">
    <div class="workflow-stage-title">${escapeHtml(stage.label)}</div>
    <div class="workflow-stage-nodes">${stage.nodes.map(renderWorkflowButton).join("")}</div>
  </section>`;
}

function renderWorkflowButton(node) {
  return `<button class="workflow-card ${escapeAttr(node.kind)}" data-workflow-node="${escapeAttr(node.id)}" type="button">
    <strong>${escapeHtml(node.label)}</strong>
    <span>${escapeHtml(truncateText(node.sublabel, 120))}</span>
  </button>`;
}

function renderNodeDetail(node) {
  if (!node) return "Select a node in the workflow.";
  const d = node.detail || {};
  const header = `<div class="detail-title">${escapeHtml(node.label)}</div><div class="detail-subtitle">${escapeHtml(node.sublabel || "")}</div>`;
  if (node.detailType === "searcher") {
    const traj = d.trajectory || {};
    const counts = searcherCounts(traj);
    return `${header}<div class="detail-lines">
      <div><strong>Assigned task</strong><span>${escapeHtml(traj.query || "")}</span></div>
      <div><strong>Evidence target</strong><span>${escapeHtml(traj.expected_evidence || traj.target_claim_or_aspect || "")}</span></div>
      <div><strong>Search / Visit</strong><span>${counts.searches} searches, ${counts.visits} visits</span></div>
      <div><strong>Steps</strong><span>${(traj.steps || []).length}</span></div>
      <div><strong>Local answer</strong><span>${escapeHtml(traj.local_answer?.local_answer || "")}</span></div>
    </div>${detailsJson("Full Searcher Trace", d)}`;
  }
  if (node.detailType === "query") {
    return `${header}<div class="detail-lines">
      <div><strong>Assigned task</strong><span>${escapeHtml(d.query || "")}</span></div>
      <div><strong>Target</strong><span>${escapeHtml(d.target_claim_or_aspect || "")}</span></div>
      <div><strong>Expected evidence</strong><span>${escapeHtml(d.expected_evidence || "")}</span></div>
      <div><strong>Source preference</strong><span>${escapeHtml(d.source_preference || "")}</span></div>
      <div><strong>Priority</strong><span>${escapeHtml(d.priority || "")}</span></div>
    </div>${detailsJson("Full Task JSON", d)}`;
  }
  if (node.detailType === "navigator") {
    const queries = d.initial_queries || d.followups || d.queries || [];
    const lines = [
      d.round_id !== undefined ? ["Round", d.round_id] : null,
      queries.length ? ["Tasks generated", queries.length] : null,
      (d.events || []).length ? ["Related events", (d.events || []).length] : null,
      (d.graph_snapshots || []).length ? ["Graph snapshots", (d.graph_snapshots || []).length] : null,
    ].filter(Boolean);
    return `${header}${renderDetailLines(lines)}${renderQueryList(queries)}${detailsJson("Debug JSON", d)}`;
  }
  if (node.detailType === "window") {
    const partial = d.partial || {};
    const update = partial.partial || {};
    const evidence = update.new_evidence_nodes || update.evidence_nodes || [];
    const claims = update.new_claim_nodes || update.claim_nodes || [];
    const edges = update.new_edges || update.edges || [];
    return `${header}<div class="detail-lines">
      <div><strong>Searcher</strong><span>${escapeHtml(partial.searcher_id || "")}</span></div>
      <div><strong>Window</strong><span>${escapeHtml(`${partial.window_idx || ""}/${partial.window_count || ""}`)}</span></div>
      <div><strong>Steps</strong><span>${escapeHtml(`${partial.step_start ?? ""}-${partial.step_end ?? ""}`)}</span></div>
      <div><strong>New evidence</strong><span>${evidence.length}</span></div>
      <div><strong>New claims</strong><span>${claims.length}</span></div>
      <div><strong>Edges</strong><span>${edges.length}</span></div>
    </div>${renderPartialUpdate(update)}${detailsJson("Debug JSON", d)}`;
  }
  if (node.detailType === "graph") {
    const graph = d.graph || {};
    return `${header}<div class="detail-lines">
      <div><strong>Claims</strong><span>${(graph.claim_nodes || []).length}</span></div>
      <div><strong>Evidence</strong><span>${(graph.evidence_nodes || []).length}</span></div>
      <div><strong>Missing</strong><span>${(graph.missing_aspects || []).length}</span></div>
      <div><strong>Sufficient</strong><span>${escapeHtml(graph.sufficient ?? "")}</span></div>
    </div>${detailsJson("Full Graph State", d)}`;
  }
  if (node.detailType === "answer") {
    return `${header}<div class="answer-text">${linkEvidenceRefs(escapeHtml(d.answer || "pending"))}</div>
      ${(d.key_claims || []).map(renderFinalClaim).join("")}
      ${detailsJson("Full Answer JSON", d)}`;
  }
  return `${header}${detailsJson("Full Node JSON", d)}`;
}

function detailsJson(title, value) {
  return `<details><summary>${escapeHtml(title)}</summary><pre>${escapeHtml(json(value))}</pre></details>`;
}

function renderDetailLines(lines) {
  const visible = (lines || []).filter((line) => line && line[1] !== undefined && line[1] !== null && line[1] !== "");
  if (!visible.length) return "";
  return `<div class="detail-lines">${visible
    .map(([label, value]) => `<div><strong>${escapeHtml(label)}</strong><span>${escapeHtml(value)}</span></div>`)
    .join("")}</div>`;
}

function renderQueryList(queries) {
  if (!queries || !queries.length) return "";
  return `<div class="mini-list">${queries
    .map((query, idx) => `<div class="mini-item">
      <strong>Task ${idx + 1}</strong>
      <span>${escapeHtml(query.query || String(query))}</span>
      ${query.expected_evidence ? `<em>${escapeHtml(query.expected_evidence)}</em>` : ""}
    </div>`)
    .join("")}</div>`;
}

function renderPartialUpdate(update) {
  const evidence = update.new_evidence_nodes || update.evidence_nodes || [];
  const claims = update.new_claim_nodes || update.claim_nodes || [];
  const edges = update.new_edges || update.edges || [];
  return `<div class="mini-list">
    ${evidence.map((item, idx) => `<div class="mini-item evidence"><strong>${escapeHtml(item.local_id || `E +${idx + 1}`)}</strong><span>${escapeHtml(item.source_title || item.source_url || "")}</span><em>${escapeHtml(truncateText(item.text || item.summary || item.snippet || "", 180))}</em></div>`).join("")}
    ${claims.map((item, idx) => `<div class="mini-item claim"><strong>${escapeHtml(item.local_id || `C +${idx + 1}`)}</strong><span>${escapeHtml(item.claim || "")}</span><em>${escapeHtml(item.status || "")}</em></div>`).join("")}
    ${edges.map((item, idx) => `<div class="mini-item edge"><strong>Edge +${idx + 1}</strong><span>${escapeHtml(item.relation || "")}: ${escapeHtml(item.from_ref || item.from_source_url || item.from_evidence_id || item.from_claim_id || "")} -> ${escapeHtml(item.to_ref || item.to_claim_id || item.to_claim || "")}</span></div>`).join("")}
  </div>`;
}

function drawGraph(evidence, claims, edges) {
  const svg = $("graph-svg");
  const layout = graphLayout(evidence, claims, edges);
  const { width, height, evPos, clPos } = layout;
  const edgeSvg = edges
    .map((edge) => {
      const from = evPos.get(edge.from_id) || clPos.get(edge.from_id);
      const to = clPos.get(edge.to_id);
      if (!from || !to) return "";
      const fromIsClaim = clPos.has(edge.from_id);
      const sameColumn = fromIsClaim && Math.abs(from.x - to.x) < 8;
      const startX = from.x + 126;
      const endX = to.x - 126;
      const curve = sameColumn
        ? `M${startX},${from.y} C${startX + 90},${from.y - 44} ${endX + 90},${to.y + 44} ${endX},${to.y}`
        : `M${startX},${from.y} C${startX + 120},${from.y} ${endX - 120},${to.y} ${endX},${to.y}`;
      const typeClass = fromIsClaim ? "claim-edge" : "evidence-edge";
      return `<path class="graph-edge ${escapeAttr(edge.relation || "context")} ${typeClass}" data-graph-edge="${escapeAttr(edge.id)}" d="${curve}" fill="none" stroke-width="2.2" marker-end="url(#arrow-${escapeAttr(edge.relation || "context")})"><title>${escapeHtml(edge.id)} ${escapeHtml(edge.relation || "")}: ${escapeHtml(edge.from_id || "")} -> ${escapeHtml(edge.to_id || "")}. ${escapeHtml(edge.rationale || "")}</title></path>`;
    })
    .join("");
  const evSvg = evidence.map((e) => graphNodeSvg(evPos.get(e.id), "evidence", e.id, e.source_title || e.source_url || "Evidence", e.evidence_origin)).join("");
  const clSvg = claims.map((c) => graphNodeSvg(clPos.get(c.id), c.status || "claim", c.id, c.claim, c.status)).join("");
  setSvgViewBox(svg, "graphViewBox", width, height);
  svg.innerHTML = `<defs>
    <marker id="arrow-support" markerWidth="10" markerHeight="8" refX="9" refY="4" orient="auto"><path d="M0,0 L10,4 L0,8 Z" fill="#3f8f54"/></marker>
    <marker id="arrow-contradict" markerWidth="10" markerHeight="8" refX="9" refY="4" orient="auto"><path d="M0,0 L10,4 L0,8 Z" fill="#b84a4a"/></marker>
    <marker id="arrow-context" markerWidth="10" markerHeight="8" refX="9" refY="4" orient="auto"><path d="M0,0 L10,4 L0,8 Z" fill="#9da8b5"/></marker>
  </defs>${edgeSvg}${evSvg}${clSvg}`;
  const evidenceById = new Map(evidence.map((item) => [item.id, item]));
  const claimById = new Map(claims.map((item) => [item.id, item]));
  const edgeById = new Map(edges.map((item) => [item.id, item]));
  svg.querySelectorAll("[data-graph-node]").forEach((el) => {
    el.addEventListener("click", () => {
      const id = el.dataset.graphNode;
      const item = evidenceById.get(id) || claimById.get(id);
      $("graph-detail").innerHTML = renderGraphDetail(id, item);
    });
  });
  svg.querySelectorAll("[data-graph-edge]").forEach((el) => {
    el.addEventListener("click", () => {
      const edge = edgeById.get(el.dataset.graphEdge);
      $("graph-detail").innerHTML = renderEdgeDetail(edge);
    });
  });
  enablePan(svg, "graphViewBox");
}

function graphLayout(evidence, claims, edges) {
  const nodeW = 252;
  const xPad = 170;
  const yPad = 70;
  const colGap = 320;
  const rowGap = 92;
  const evidenceCol = 0;
  const claimDepth = claimDepths(claims, edges);
  const maxDepth = Math.max(0, ...[...claimDepth.values()]);
  const columns = new Map();
  for (const claim of claims) {
    const col = 1 + (claimDepth.get(claim.id) || 0);
    if (!columns.has(col)) columns.set(col, []);
    columns.get(col).push(claim);
  }
  const evColumnItems = evidence;
  const maxRows = Math.max(evColumnItems.length, ...[...columns.values()].map((items) => items.length), 3);
  const width = Math.max(860, xPad * 2 + (maxDepth + 1) * colGap + nodeW);
  const height = Math.max(420, yPad * 2 + (maxRows - 1) * rowGap);
  const evPos = new Map();
  const clPos = new Map();
  placeColumn(evColumnItems, evidenceCol, evPos, height, xPad, yPad, rowGap, colGap);
  for (const [col, items] of columns.entries()) {
    const sorted = [...items].sort((a, b) => claimSortKey(a).localeCompare(claimSortKey(b)));
    placeColumn(sorted, col, clPos, height, xPad, yPad, rowGap, colGap);
  }
  return { width, height, evPos, clPos };
}

function placeColumn(items, col, target, height, xPad, yPad, rowGap, colGap) {
  const total = Math.max(items.length - 1, 0) * rowGap;
  const startY = Math.max(yPad, (height - total) / 2);
  items.forEach((item, idx) => {
    target.set(item.id, { x: xPad + col * colGap, y: startY + idx * rowGap, item });
  });
}

function claimDepths(claims, edges) {
  const claimIds = new Set(claims.map((claim) => claim.id));
  const incomingClaimEdges = new Map(claims.map((claim) => [claim.id, []]));
  for (const edge of edges) {
    if (claimIds.has(edge.from_id) && claimIds.has(edge.to_id)) {
      incomingClaimEdges.get(edge.to_id)?.push(edge.from_id);
    }
  }
  const memo = new Map();
  function depth(cid, path = new Set()) {
    if (memo.has(cid)) return memo.get(cid);
    if (path.has(cid)) return 0;
    path.add(cid);
    const parents = incomingClaimEdges.get(cid) || [];
    const value = parents.length ? 1 + Math.max(...parents.map((parent) => depth(parent, new Set(path)))) : 0;
    memo.set(cid, value);
    return value;
  }
  for (const claim of claims) depth(claim.id);
  return memo;
}

function claimSortKey(claim) {
  const statusRank = { supported: "0", unverified: "1", contradicted: "2" }[claim.status] || "3";
  return `${statusRank}:${claim.id || ""}:${claim.claim || ""}`;
}

function graphNodeSvg(pos, kind, id, text, meta = "") {
  if (!pos) return "";
  const fill = kind === "supported" ? "#eef8f0" : kind === "unverified" ? "#fff7e8" : kind === "contradicted" ? "#fff1f1" : "#eef5f7";
  const stroke = kind === "supported" ? "#8bc29b" : kind === "unverified" ? "#d9b875" : kind === "contradicted" ? "#d98a8a" : "#9cb5bf";
  return `<g class="graph-node" data-graph-node="${escapeAttr(id)}">
    <rect x="${pos.x - 126}" y="${pos.y - 34}" width="252" height="68" rx="6" fill="${fill}" stroke="${stroke}" />
    <title>${escapeHtml(id)}: ${escapeHtml(text)}</title>
    <text x="${pos.x - 114}" y="${pos.y - 12}" font-size="12" font-weight="700" fill="#20242a">${escapeSvg(truncateText(`${id}: ${text}`, 38))}</text>
    <text x="${pos.x - 114}" y="${pos.y + 8}" font-size="11" fill="#69727f">${escapeSvg(truncateText(text, 42))}</text>
    <text x="${pos.x - 114}" y="${pos.y + 26}" font-size="10" fill="#69727f">${escapeSvg(String(meta || ""))}</text>
  </g>`;
}

function renderGraphDetail(id, item) {
  if (!item) {
    return `<div class="detail-title">Graph</div><p>Select a graph node.</p>`;
  }
  if (item.source_url) {
    return `<div class="detail-title">${escapeHtml(id)}</div>
      <div class="detail-subtitle">${escapeHtml(item.source_title || item.source_url)}</div>
      <div class="detail-lines">
        <div><strong>URL</strong><span>${escapeHtml(item.source_url)}</span></div>
        <div><strong>Source</strong><span>${escapeHtml(item.source || "")}</span></div>
        <div><strong>Text</strong><span>${escapeHtml(item.text || "")}</span></div>
      </div>${detailsJson("Full Evidence JSON", item)}`;
  }
  return `<div class="detail-title">${escapeHtml(id)}</div>
    <div class="detail-subtitle">${escapeHtml(item.claim || "")}</div>
    <div class="detail-lines">
      <div><strong>Status</strong><span>${escapeHtml(item.status || "")}</span></div>
      <div><strong>Confidence</strong><span>${escapeHtml(item.confidence ?? "")}</span></div>
      <div><strong>Supporting evidence</strong><span>${escapeHtml((item.supporting_evidence_ids || []).join(", ") || "None")}</span></div>
      <div><strong>Supporting claims</strong><span>${escapeHtml((item.supporting_claim_ids || []).join(", ") || "None")}</span></div>
      <div><strong>Contradicting evidence</strong><span>${escapeHtml((item.contradicting_evidence_ids || []).join(", ") || "None")}</span></div>
      <div><strong>Contradicting claims</strong><span>${escapeHtml((item.contradicting_claim_ids || []).join(", ") || "None")}</span></div>
      <div><strong>Rationale</strong><span>${escapeHtml(item.rationale || "")}</span></div>
    </div>${detailsJson("Full Claim JSON", item)}`;
}

function renderEdgeDetail(edge) {
  if (!edge) return `<div class="detail-title">Edge</div><p>Select an edge.</p>`;
  const graph = state.snapshot?.graph || {};
  const claimIds = new Set((graph.claim_nodes || []).map((claim) => claim.id));
  const edgeType = claimIds.has(edge.from_id) ? "Claim → Claim" : "Evidence → Claim";
  return `<div class="detail-title">${escapeHtml(edge.id || "Edge")}</div>
    <div class="detail-lines">
      <div><strong>Relation</strong><span>${escapeHtml(edge.relation || "")}</span></div>
      <div><strong>Type</strong><span>${escapeHtml(edgeType)}</span></div>
      <div><strong>From</strong><span>${escapeHtml(edge.from_id || "")}</span></div>
      <div><strong>To</strong><span>${escapeHtml(edge.to_id || "")}</span></div>
      <div><strong>Confidence</strong><span>${escapeHtml(edge.confidence ?? "")}</span></div>
      <div><strong>Rationale</strong><span>${escapeHtml(edge.rationale || "")}</span></div>
    </div>${detailsJson("Full Edge JSON", edge)}`;
}

function setSvgViewBox(svg, key, width, height) {
  if (!state[key]) state[key] = { x: 0, y: 0, width, height };
  state[key].width = Math.max(state[key].width, width);
  state[key].height = Math.max(state[key].height, height);
  svg.setAttribute("viewBox", `${state[key].x} ${state[key].y} ${state[key].width} ${state[key].height}`);
}

function enablePan(svg, key) {
  if (svg.dataset.panReady) return;
  svg.dataset.panReady = "true";
  let start = null;
  svg.addEventListener("pointerdown", (event) => {
    if (event.target.closest("[data-graph-node]")) return;
    start = { x: event.clientX, y: event.clientY, box: { ...state[key] } };
    svg.setPointerCapture(event.pointerId);
  });
  svg.addEventListener("pointermove", (event) => {
    if (!start) return;
    const scaleX = state[key].width / Math.max(svg.clientWidth, 1);
    const scaleY = state[key].height / Math.max(svg.clientHeight, 1);
    state[key].x = start.box.x - (event.clientX - start.x) * scaleX;
    state[key].y = start.box.y - (event.clientY - start.y) * scaleY;
    svg.setAttribute("viewBox", `${state[key].x} ${state[key].y} ${state[key].width} ${state[key].height}`);
  });
  svg.addEventListener("pointerup", () => {
    start = null;
  });
  svg.addEventListener("wheel", (event) => {
    event.preventDefault();
    const factor = event.deltaY > 0 ? 1.12 : 0.9;
    state[key].width *= factor;
    state[key].height *= factor;
    svg.setAttribute("viewBox", `${state[key].x} ${state[key].y} ${state[key].width} ${state[key].height}`);
  });
}

function renderRaw(snapshot) {
  $("raw-json").textContent = json(snapshot);
}

function renderSpec() {
  const spec = state.spec;
  if (!spec) {
    ["spec-roles", "spec-prompts", "spec-schemas"].forEach((id) => {
      $(id).innerHTML = `<div class="empty">Loading spec...</div>`;
    });
    return;
  }
  $("spec-roles").innerHTML = (spec.roles || []).map(renderRoleSpec).join("");
  $("spec-prompts").innerHTML = (spec.prompts || []).map(renderPromptSpec).join("");
  $("spec-schemas").innerHTML = (spec.schemas || []).map(renderSchemaSpec).join("");
}


function renderRoleSpec(item) {
  return `<div class="spec-card open"><strong>${escapeHtml(item.name)}</strong><span>${escapeHtml(item.summary)}</span></div>`;
}

function renderPromptSpec(item) {
  return `<details class="spec-card prompt-spec">
    <summary><strong>${escapeHtml(item.name)}</strong><span>${escapeHtml(item.summary)}</span></summary>
    <div class="spec-section-title">Full prompt template source</div>
    <pre class="prompt-source">${escapeHtml(item.source || "")}</pre>
  </details>`;
}

function renderSchemaSpec(item) {
  return `<details class="spec-card schema-spec">
    <summary><strong>${escapeHtml(item.name)}</strong><span>${(item.fields || []).length} fields</span></summary>
    <table class="schema-table">
      <thead><tr><th>Field</th><th>Type</th><th>Required</th></tr></thead>
      <tbody>${(item.fields || []).map((field) => `<tr><td>${escapeHtml(field.name)}</td><td>${escapeHtml(field.type)}</td><td>${field.required ? "yes" : "no"}</td></tr>`).join("")}</tbody>
    </table>
  </details>`;
}

function render(snapshot, { preservePanels = false } = {}) {
  state.snapshot = snapshot;
  $("run-title").textContent = snapshot.run_id;
  $("run-path").textContent = `Output: outputs/${snapshot.run_id}`;
  badges(snapshot);
  renderOverview(snapshot);
  renderAnswer(snapshot);
  renderWorkflow(snapshot);
  renderTimeline(snapshot);
  renderSearchers(snapshot);
  renderGraph(snapshot);
  renderSpec();
  renderRaw(snapshot);
  if (!preservePanels) {
    delete $("workflow-detail").dataset.selected;
    $("workflow-detail").textContent = "Select a node in the workflow.";
  }
}

async function loadRuns() {
  const data = await api("/api/runs");
  $("run-list").innerHTML = data.runs
    .map((run) => `<button class="run-item" data-run="${run.run_id}">
      <strong>${escapeHtml(run.run_id)}</strong>
      <span>${run.has_answer ? "answer" : "running/partial"}${run.has_eval ? " | eval" : ""}</span>
    </button>`)
    .join("");
  document.querySelectorAll(".run-item").forEach((button) => {
    button.addEventListener("click", () => loadRun(button.dataset.run, { stopLive: true }));
  });
}

async function loadJobs() {
  let data;
  try {
    data = await api("/api/jobs");
  } catch (_err) {
    $("job-list").innerHTML = `<div class="empty">Live job list will be available after the frontend server restarts. Running/partial runs still appear below.</div>`;
    return;
  }
  const jobs = data.jobs || [];
  $("job-list").innerHTML = jobs.length
    ? jobs
        .slice()
        .reverse()
        .map((job) => `<button class="run-item" data-job="${job.job_id}">
          <strong>${escapeHtml(job.status)} | ${escapeHtml(job.job_id)}</strong>
          <span>${escapeHtml(truncateText(job.question || job.run_dir || job.error || "", 80))}</span>
        </button>`)
        .join("")
    : `<div class="empty">No live jobs in this server session.</div>`;
  $("job-list").querySelectorAll("[data-job]").forEach((button) => {
    button.addEventListener("click", () => {
      state.activeJob = button.dataset.job;
      pollJob(state.activeJob).catch((err) => setStatus(err.message));
    });
  });
}

async function loadSpec() {
  state.spec = await api("/api/spec");
  renderSpec();
}

async function loadRun(runId, { stopLive = false } = {}) {
  if (stopLive && state.pollTimer) {
    clearTimeout(state.pollTimer);
    state.pollTimer = null;
    state.activeJob = null;
  }
  state.activeRun = runId;
  state.graphViewBox = null;
  const snapshot = await api(`/api/runs/${encodeURIComponent(runId)}`);
  render(snapshot);
}

async function pollJob(jobId) {
  if (state.pollTimer) clearTimeout(state.pollTimer);
  const data = await api(`/api/jobs/${jobId}`);
  const job = data.job;
  await loadJobs().catch(() => {});
  setStatus(`${job.status}${job.run_dir ? ` | ${job.run_dir}` : ""}`);
  const runId = basename(job.run_dir);
  if (data.snapshot && state.activeJob === jobId) {
    if (!state.activeRun || state.activeRun === runId) {
      state.activeRun = runId;
      render(data.snapshot, { preservePanels: true });
    }
  }
  if (job.status === "finished" || job.status === "failed") {
    await loadRuns();
    return;
  }
  state.pollTimer = setTimeout(() => pollJob(jobId).catch((err) => setStatus(err.message)), 2500);
}

function trimObservation(observation) {
  if (observation && typeof observation === "object" && !Array.isArray(observation)) {
    const copy = { ...observation };
    if (typeof copy.page_text === "string" && copy.page_text.length > 1800) {
      copy.page_text = `${copy.page_text.slice(0, 1800)}...`;
    }
    return copy;
  }
  return observation;
}

function stripHeavyFields(event) {
  const copy = { ...event };
  delete copy.messages;
  delete copy.raw_output;
  delete copy.reasoning_content;
  return copy;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function escapeSvg(value) {
  return escapeHtml(value).replaceAll("'", "&apos;");
}

function escapeAttr(value) {
  return escapeHtml(value).replaceAll("'", "&#39;");
}

document.querySelectorAll(".tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((item) => item.classList.remove("active"));
    document.querySelectorAll(".tab-panel").forEach((item) => item.classList.remove("active"));
    tab.classList.add("active");
    $(tab.dataset.tab).classList.add("active");
  });
});

$("refresh-runs").addEventListener("click", () => loadRuns().catch((err) => setStatus(err.message)));
$("refresh-jobs").addEventListener("click", () => loadJobs().catch((err) => setStatus(err.message)));

$("timeline-kind").addEventListener("change", () => {
  state.timelineKind = $("timeline-kind").value;
  if (state.snapshot) renderTimeline(state.snapshot);
});

$("timeline-filter").addEventListener("input", () => {
  state.timelineFilter = $("timeline-filter").value;
  if (state.snapshot) renderTimeline(state.snapshot);
});

$("graph-mode").addEventListener("change", () => {
  state.graphMode = $("graph-mode").value;
  state.graphViewBox = null;
  if (state.snapshot) renderGraph(state.snapshot);
});

$("graph-filter").addEventListener("input", () => {
  state.graphFilter = $("graph-filter").value;
  state.graphViewBox = null;
  if (state.snapshot) renderGraph(state.snapshot);
});

$("run-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (state.pollTimer) clearTimeout(state.pollTimer);
  const body = {
    question: $("question").value,
    k: $("k").value ? Number($("k").value) : null,
    max_rounds: $("max-rounds").value ? Number($("max-rounds").value) : null,
    max_searcher_calls: valueNumber("max-searcher-calls"),
    max_dispatch_per_round: valueNumber("max-dispatch-per-round"),
    max_searcher_steps: valueNumber("max-searcher-steps"),
    searcher_concurrency: valueNumber("searcher-concurrency"),
    trajectory_window_size: valueNumber("trajectory-window-size"),
    trajectory_window_stride: valueNumber("trajectory-window-stride"),
    searcher_enable_thinking: $("searcher-thinking").checked,
    navigator_enable_thinking: $("navigator-thinking").checked,
  };
  setStatus("Starting...");
  const data = await api("/api/jobs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  state.activeJob = data.job.job_id;
  state.activeRun = null;
  await loadJobs();
  pollJob(state.activeJob).catch((err) => setStatus(err.message));
});

function valueNumber(id) {
  const value = $(id).value;
  return value ? Number(value) : null;
}

Promise.all([loadRuns(), loadJobs(), loadSpec()])
  .then(async () => {
    const first = document.querySelector(".run-item[data-run]");
    if (first) await loadRun(first.dataset.run);
  })
  .catch((err) => setStatus(err.message));
