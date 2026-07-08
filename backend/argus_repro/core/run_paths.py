from __future__ import annotations

from pathlib import Path


class RunPaths:
    def __init__(self, run_dir: Path):
        self.run_dir = run_dir
        self.inputs = run_dir / "inputs"
        self.logs = run_dir / "logs"
        self.trajectories = run_dir / "trajectories"
        self.graph = run_dir / "graph"
        self.answers = run_dir / "answers"
        self.evaluation = run_dir / "evaluation"
        self.debug = run_dir / "debug"
        self.artifacts = run_dir / "artifacts"
        self.downloads = self.artifacts / "downloads"
        self.extracted = self.artifacts / "extracted"
        self.crawl4ai = self.artifacts / "crawl4ai"

    def ensure(self) -> None:
        for path in (
            self.inputs,
            self.logs,
            self.trajectories,
            self.graph,
            self.answers,
            self.evaluation,
            self.debug,
            self.downloads,
            self.extracted,
            self.crawl4ai,
        ):
            path.mkdir(parents=True, exist_ok=True)

    @property
    def events(self) -> Path:
        return self.logs / "events.jsonl"

    @property
    def config(self) -> Path:
        return self.inputs / "config.json"

    @property
    def question(self) -> Path:
        return self.inputs / "question.json"

    @property
    def benchmark_item(self) -> Path:
        return self.inputs / "benchmark_item.json"

    @property
    def initial_queries(self) -> Path:
        return self.inputs / "initial_queries.json"

    def followups(self, round_id: int) -> Path:
        return self.inputs / f"followups_round_{round_id}.json"

    @property
    def trajectories_jsonl(self) -> Path:
        return self.trajectories / "searcher_trajectories.jsonl"

    @property
    def graph_partials(self) -> Path:
        return self.graph / "partials.jsonl"

    @property
    def graph_compactions(self) -> Path:
        return self.graph / "compactions.jsonl"

    def graph_observed(self, round_id: int) -> Path:
        return self.graph / f"round_{round_id}_observed.json"

    def graph_verified(self, round_id: int) -> Path:
        return self.graph / f"round_{round_id}_verified.json"

    @property
    def graph_final_verified(self) -> Path:
        return self.graph / "final_verified.json"

    @property
    def final_graph(self) -> Path:
        return self.graph / "final_graph.json"

    @property
    def final_answer_json(self) -> Path:
        return self.answers / "final_answer.json"

    @property
    def final_answer_markdown(self) -> Path:
        return self.answers / "final_answer.md"

    @property
    def benchmark_eval(self) -> Path:
        return self.evaluation / "benchmark_eval.json"

    @property
    def artifact_manifest(self) -> Path:
        return self.artifacts / "manifest.jsonl"
