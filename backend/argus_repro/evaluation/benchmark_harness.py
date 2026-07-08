from __future__ import annotations

import json
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from .benchmarks import EXPORT_ROOT
from ..providers.llm_client import LLMClient


@dataclass
class BenchmarkItem:
    benchmark: str
    item_id: str
    question: str
    answer: str
    metadata: dict[str, Any]


def _required_export(*parts: str) -> Path:
    path = EXPORT_ROOT.joinpath(*parts)
    if not path.exists():
        raise FileNotFoundError(f"Required benchmark export is missing: {path}")
    return path


def _read_first_jsonl(path: Path) -> dict[str, Any]:
    for line in path.read_text(encoding="utf-8").splitlines():
        if line.strip():
            return json.loads(line)
    raise RuntimeError(f"No rows in {path}")


def _read_jsonl_by_id(path: Path, item_id: str | None, *id_fields: str) -> dict[str, Any]:
    first: dict[str, Any] | None = None
    for idx, line in enumerate(path.read_text(encoding="utf-8").splitlines()):
        if not line.strip():
            continue
        row = json.loads(line)
        if first is None:
            first = row
        if item_id is None:
            return row
        candidates = {str(row.get(field)) for field in id_fields if row.get(field) is not None}
        candidates.add(str(idx))
        if str(item_id) in candidates:
            return row
    if item_id is not None:
        raise KeyError(f"No item_id={item_id!r} in {path}")
    if first is not None:
        return first
    raise RuntimeError(f"No rows in {path}")


def load_benchmark_item(name: str, item_id: str | None = None) -> BenchmarkItem:
    if name == "browsecomp":
        row = _read_jsonl_by_id(_required_export("browsecomp", "test_decrypted.jsonl"), item_id, "id")
        return BenchmarkItem(name, row["id"], row["question"], row["answer"], row)
    if name == "browsecomp_zh":
        row = _read_jsonl_by_id(_required_export("browsecomp_zh", "test_decrypted.jsonl"), item_id, "id")
        return BenchmarkItem(name, row["id"], row["question"], row["answer"], row)
    if name == "sealqa":
        row = _read_jsonl_by_id(EXPORT_ROOT / "vtllms__sealqa" / "seal_0" / "test.jsonl", item_id, "id", "qid", "uid")
        return BenchmarkItem(name, str(item_id or "0"), row["question"], row["answer"], row)
    if name == "xbench_deepsearch_2510":
        row = _read_jsonl_by_id(_required_export("xbench_deepsearch_2510", "test_decrypted.jsonl"), item_id, "id")
        return BenchmarkItem(name, row["id"], row["question"], row["answer"], row)
    if name == "frontierscience":
        row = _read_jsonl_by_id(EXPORT_ROOT / "openai__frontierscience" / "test.jsonl", item_id, "task_group_id", "id")
        return BenchmarkItem(name, row.get("task_group_id", "0"), row["problem"], row["answer"], row)
    raise ValueError(f"Unsupported benchmark {name}")


def browsecomp_judge_prompt(question: str, correct_answer: str, response: str) -> list[dict[str, str]]:
    return [
        {
            "role": "user",
            "content": f"""Judge whether the following [response] to [question] is correct or not based on the precise and unambiguous [correct_answer] below.

[question]: {question}

[response]: {response}

Your judgement must be in the format and criteria specified below:

extracted_final_answer: The final exact answer extracted from the [response]. Put the extracted answer as 'None' if there is no exact, final answer to extract from the response.

[correct_answer]: {correct_answer}

reasoning: Explain why the extracted_final_answer is correct or incorrect based on [correct_answer], focusing only on whether the answers match.

correct: Answer 'yes' if extracted_final_answer matches [correct_answer], or is within a small margin of error for numerical problems. Answer 'no' otherwise.

confidence: The extracted confidence score between 0% and 100% from [response]. Put 100 if there is no confidence score available.""",
        }
    ]


def chinese_judge_prompt(question: str, correct_answer: str, response: str) -> list[dict[str, str]]:
    return [
        {
            "role": "user",
            "content": f"""Judge whether the following [response] is correct based only on the precise [correct_answer].

[question]: {question}
[correct_answer]: {correct_answer}
[response]: {response}

Use this exact format:
final_answer: The exact final answer extracted from [response], or 'None' if no final answer is stated.
explanation: Explain whether final_answer matches [correct_answer]. Do not solve the problem again.
verdict: correct if final_answer matches [correct_answer], or if a numerical answer is within an acceptable small tolerance; otherwise incorrect.""",
        }
    ]


async def evaluate_item(llm: LLMClient, item: BenchmarkItem, response: str) -> dict[str, Any]:
    if item.benchmark in {"browsecomp", "sealqa"}:
        data = await llm.generate(
            browsecomp_judge_prompt(item.question, item.answer, response),
            model=llm.config.judge_model,
            temperature=0.0,
            max_tokens=1024,
            json_mode=False,
            label=f"{item.benchmark}_judge",
        )
        correct = bool(re.search(r"correct:\s*yes", data, flags=re.I))
        return {"judge_response": data, "score": 1.0 if correct else 0.0, "correct": correct}
    if item.benchmark in {"browsecomp_zh", "xbench_deepsearch_2510", "frontierscience"}:
        data = await llm.generate(
            chinese_judge_prompt(item.question, item.answer, response),
            model=llm.config.judge_model,
            temperature=0.0,
            max_tokens=1024,
            json_mode=False,
            label=f"{item.benchmark}_judge",
        )
        correct = bool(re.search(r"verdict:\s*correct", data, flags=re.I))
        return {"judge_response": data, "score": 1.0 if correct else 0.0, "correct": correct}
    raise ValueError(item.benchmark)
