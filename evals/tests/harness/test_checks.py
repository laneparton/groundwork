from harness.case import EvalCase, ExpectedIdentifiers
from harness.checks import fact_errors


def test_identifier_set_rejects_wrong_ids_even_when_count_matches() -> None:
    case = EvalCase(
        id="identifiers",
        input="Which CVEs?",
        expected_output="Two specified CVEs.",
        expected_identifiers=ExpectedIdentifiers(
            pattern=r"CVE-\d{4}-\d{4,}",
            values=("CVE-2020-28500", "CVE-2021-23337"),
        ),
    )
    failures = fact_errors(case, "CVE-2020-28500 and CVE-2021-99999")
    assert len(failures) == 1
    assert "CVE-2021-23337" in failures[0]
    assert "CVE-2021-99999" in failures[0]
    assert fact_errors(case, "cve-2021-23337 and CVE-2020-28500") == []


def test_required_facts_are_case_insensitive_and_report_missing_values() -> None:
    case = EvalCase(
        id="requirements",
        input="Dependencies?",
        expected_output="scheduler ^0.27.0",
        required_facts=("scheduler", "^0.27.0"),
    )
    assert fact_errors(case, "SCHEDULER ^0.27.0") == []
    assert fact_errors(case, "scheduler 0.27.0") == ["Missing required fact: ^0.27.0"]


def test_verified_facts_metric_reports_a_failing_score() -> None:
    from deepeval.test_case import LLMTestCase

    from harness.metrics import VerifiedFactsMetric

    case = EvalCase(
        id="version",
        input="Highest release?",
        expected_output="4.18.1",
        required_facts=("4.18.1",),
    )
    metric = VerifiedFactsMetric(case)
    assert metric.measure(LLMTestCase(input=case.input, actual_output="4.9.0")) == 0
    assert metric.is_successful() is False
    assert "4.18.1" in metric.reason
