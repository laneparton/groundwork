import pytest

from .cases import CASES, GraphCandidate


@pytest.mark.parametrize("candidate", CASES, ids=lambda case: case.id)
def test_dependency_graph(candidate: GraphCandidate) -> None:
    pytest.skip(candidate.blocked_reason)
