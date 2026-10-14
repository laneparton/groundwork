from typing import ClassVar

from deepeval.metrics import BaseMetric
from deepeval.test_case import LLMTestCase, SingleTurnParams

from .case import EvalCase
from .checks import fact_errors


class VerifiedFactsMetric(BaseMetric):
    _required_params: ClassVar[list[SingleTurnParams]] = [SingleTurnParams.ACTUAL_OUTPUT]

    def __init__(self, case: EvalCase) -> None:
        self.case = case
        self.threshold = 1
        self.verbose_mode = False

    def measure(
        self,
        test_case: LLMTestCase,
        _show_indicator: bool = True,
        _in_component: bool = False,
    ) -> float:
        failures = fact_errors(self.case, test_case.actual_output)
        self.score = 0.0 if failures else 1.0
        self.reason = "; ".join(failures) if failures else "All verified facts matched."
        self.success = not failures
        return self.score

    async def a_measure(
        self,
        test_case: LLMTestCase,
        _show_indicator: bool = True,
        _in_component: bool = False,
    ) -> float:
        return self.measure(test_case, _show_indicator, _in_component)

    @property
    def __name__(self) -> str:
        return "Verified facts"
