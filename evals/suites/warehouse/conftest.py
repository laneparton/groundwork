from collections.abc import Callable
from typing import TYPE_CHECKING

import pytest

from harness.case import EvalCase
from harness.settings import Settings

from .metrics import metrics

if TYPE_CHECKING:
    from deepeval.metrics import BaseMetric


@pytest.fixture
def case_metrics(settings: Settings) -> Callable[[EvalCase], list["BaseMetric"]]:
    return lambda _case: metrics(settings.judge_model)
