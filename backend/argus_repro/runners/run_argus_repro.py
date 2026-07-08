from __future__ import annotations

import argparse
import asyncio
import json

from .common import build_runner, close_clients


async def amain() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--question", required=True)
    parser.add_argument("--k", type=int, default=None)
    parser.add_argument("--max-rounds", type=int, default=None)
    args = parser.parse_args()

    _config, logger, llm, bocha, visit_provider, runner = await build_runner("argus_repro")
    try:
        result = await runner.run_argus_repro(args.question, k=args.k, max_rounds=args.max_rounds)
        logger.log("run_finished", final_answer=result["final_answer"].answer)
        print(json.dumps({"run_dir": str(runner.run_dir), "answer": result["final_answer"].answer}, ensure_ascii=False))
    finally:
        await close_clients(llm, bocha, visit_provider)


if __name__ == "__main__":
    asyncio.run(amain())
