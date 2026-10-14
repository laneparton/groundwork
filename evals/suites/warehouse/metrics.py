from __future__ import annotations

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from deepeval.metrics import BaseMetric


def metrics(judge_model: str) -> list[BaseMetric]:
    from deepeval.metrics import GEval, ToolCorrectnessMetric
    from deepeval.test_case import SingleTurnParams

    return [
        ToolCorrectnessMetric(threshold=1, should_exact_match=False),
        GEval(
            name="Answer correctness",
            model=judge_model,
            threshold=0.8,
            criteria=(
                "Compare the answer with the expected output. Require the requested package, "
                "version, ecosystem, and factual result to be correct. Do not require identical "
                "wording. Penalize invented data and claims of successful lookup when the tool "
                "output contains only errors. For a missing package, distinguish absence from "
                "this dataset from nonexistence everywhere."
            ),
            evaluation_params=[
                SingleTurnParams.INPUT,
                SingleTurnParams.ACTUAL_OUTPUT,
                SingleTurnParams.EXPECTED_OUTPUT,
                SingleTurnParams.TOOLS_CALLED,
            ],
        ),
    ]
