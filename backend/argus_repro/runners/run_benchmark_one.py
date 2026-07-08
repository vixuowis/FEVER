from __future__ import annotations

import argparse
import asyncio
import json

from ..evaluation.benchmark_harness import evaluate_item, load_benchmark_item
from ..core.utils import write_json
from .common import build_runner, close_clients


async def amain() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--benchmark",
        required=True,
        choices=["browsecomp", "browsecomp_zh", "sealqa", "xbench_deepsearch_2510", "frontierscience"],
    )
    parser.add_argument("--k", type=int, default=2)
    parser.add_argument("--max-rounds", type=int, default=2)
    parser.add_argument("--item-id", default=None, help="Optional benchmark item id; defaults to the first item.")
    args = parser.parse_args()

    item = load_benchmark_item(args.benchmark, item_id=args.item_id)
    _config, logger, llm, bocha, visit_provider, runner = await build_runner(f"bench_{args.benchmark}")
    try:
        write_json(runner.paths.benchmark_item, item.__dict__)
        result = await runner.run_argus_repro(item.question, k=args.k, max_rounds=args.max_rounds)
        response = result["final_answer"].answer
        eval_result = await evaluate_item(llm, item, response)
        write_json(runner.paths.benchmark_eval, eval_result)
        logger.log("benchmark_eval_finished", benchmark=args.benchmark, score=eval_result["score"])
        print(
            json.dumps(
                {
                    "run_dir": str(runner.run_dir),
                    "benchmark": args.benchmark,
                    "item_id": item.item_id,
                    "answer": response,
                    "score": eval_result["score"],
                    "correct": eval_result["correct"],
                },
                ensure_ascii=False,
            )
        )
    finally:
        await close_clients(llm, bocha, visit_provider)


if __name__ == "__main__":
    asyncio.run(amain())
