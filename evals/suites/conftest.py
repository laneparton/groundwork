from __future__ import annotations

import json
from collections.abc import Callable, Iterator
from dataclasses import asdict
from datetime import UTC, datetime
from pathlib import Path
from typing import TYPE_CHECKING

import pytest

from harness.case import EvalCase
from harness.checks import fact_errors
from harness.client import AgentClient, AgentRunError
from harness.settings import EVAL_DIR, Settings

if TYPE_CHECKING:
    from deepeval.metrics import BaseMetric


@pytest.fixture(scope="session")
def settings() -> Settings:
    return Settings.from_env()


@pytest.fixture(scope="session")
def agent(settings: Settings) -> Iterator[AgentClient]:
    with AgentClient(settings) as client:
        yield client


@pytest.fixture(scope="session")
def report_dir() -> Path:
    timestamp = datetime.now(UTC).strftime("%Y%m%dT%H%M%S%fZ")
    directory = EVAL_DIR / "reports" / timestamp
    directory.mkdir(parents=True)
    return directory


@pytest.fixture
def evaluate_case(
    agent: AgentClient,
    report_dir: Path,
    case_metrics: Callable[[EvalCase], list[BaseMetric]],
    request: pytest.FixtureRequest,
) -> Callable[[EvalCase], None]:
    from deepeval import assert_test
    from deepeval.test_case import LLMTestCase, ToolCall

    from harness.metrics import VerifiedFactsMetric

    def check(case: EvalCase) -> None:
        try:
            result = agent.ask(case.input)
        except AgentRunError as error:
            trace = {**asdict(case), **asdict(error.result), "error": str(error)}
            (report_dir / f"{case.id}.json").write_text(json.dumps(trace, indent=2) + "\n")
            raise
        failures = fact_errors(case, result.text)
        trace = {
            "suite": str(request.node.path.relative_to(EVAL_DIR / "suites")),
            **asdict(case),
            **asdict(result),
            "fact_errors": failures,
        }
        (report_dir / f"{case.id}.json").write_text(json.dumps(trace, indent=2) + "\n")
        test_case = LLMTestCase(
            name=case.id,
            input=case.input,
            actual_output=result.text,
            expected_output=case.expected_output,
            tools_called=[
                ToolCall(
                    name=call["name"],
                    input_parameters=call["input"],
                    output=call["output"],
                )
                for call in result.tools
            ],
            expected_tools=[ToolCall(name=name) for name in case.expected_tools],
        )
        configured_metrics = case_metrics(case)
        if case.required_facts or case.expected_identifiers is not None:
            configured_metrics.append(VerifiedFactsMetric(case))
        assert_test(test_case, configured_metrics)

    return check
