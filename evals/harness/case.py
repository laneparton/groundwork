from dataclasses import dataclass


@dataclass(frozen=True)
class ExpectedIdentifiers:
    pattern: str
    values: tuple[str, ...]


@dataclass(frozen=True)
class EvalCase:
    id: str
    input: str
    expected_output: str
    expected_tools: tuple[str, ...] = ()
    required_facts: tuple[str, ...] = ()
    expected_identifiers: ExpectedIdentifiers | None = None
