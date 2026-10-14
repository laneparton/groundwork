from __future__ import annotations

from collections.abc import Callable
from typing import TYPE_CHECKING

import pytest

from harness.case import EvalCase
from harness.settings import Settings

if TYPE_CHECKING:
    from deepeval.metrics import BaseMetric


@pytest.fixture
def case_metrics(settings: Settings) -> Callable[[EvalCase], list[BaseMetric]]:
    from deepeval.metrics import GEval, ToolCorrectnessMetric
    from deepeval.test_case import SingleTurnParams

    def make_metrics(_case: EvalCase) -> list[BaseMetric]:
        return [
            ToolCorrectnessMetric(threshold=1, should_exact_match=False),
            GEval(
                name="Conversation correctness",
                model=settings.judge_model,
                threshold=0.8,
                criteria=(
                    "Give a relevant, brief response consistent with the expected output, "
                    "without inventing warehouse facts or claiming a lookup occurred."
                ),
                evaluation_params=[
                    SingleTurnParams.INPUT,
                    SingleTurnParams.ACTUAL_OUTPUT,
                    SingleTurnParams.EXPECTED_OUTPUT,
                ],
            ),
        ]

    return make_metrics
