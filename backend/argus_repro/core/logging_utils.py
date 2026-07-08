from __future__ import annotations

from pathlib import Path
from typing import Any

from .run_paths import RunPaths
from .utils import append_jsonl, utc_now_iso


class RunLogger:
    def __init__(self, run_dir: Path):
        self.run_dir = run_dir
        self.path = RunPaths(run_dir).events
        self.run_dir.mkdir(parents=True, exist_ok=True)
        self.path.parent.mkdir(parents=True, exist_ok=True)

    def log(self, event: str, **payload: Any) -> None:
        append_jsonl(
            self.path,
            {
                "ts": utc_now_iso(),
                "event": event,
                **payload,
            },
        )
