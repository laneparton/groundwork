import re

from .case import EvalCase


def fact_errors(case: EvalCase, answer: str) -> list[str]:
    errors = [
        f"Missing required fact: {fact}"
        for fact in case.required_facts
        if fact.casefold() not in answer.casefold()
    ]
    if case.expected_identifiers is not None:
        expected = {value.upper() for value in case.expected_identifiers.values}
        actual = {
            match.group().upper()
            for match in re.finditer(case.expected_identifiers.pattern, answer, flags=re.IGNORECASE)
        }
        if actual != expected:
            errors.append(
                f"Identifier mismatch: missing={sorted(expected - actual)}, "
                f"unexpected={sorted(actual - expected)}"
            )
    return errors
