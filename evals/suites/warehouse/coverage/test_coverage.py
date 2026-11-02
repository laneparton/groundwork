from collections.abc import Callable

import pytest

from harness.case import EvalCase

from .cases import CASES


@pytest.mark.parametrize("eval_case", CASES, ids=lambda case: case.id)
def test_coverage(eval_case: EvalCase, evaluate_case: Callable[[EvalCase], None]) -> None:
    evaluate_case(eval_case)
