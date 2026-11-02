from harness.case import EvalCase

CASES = (
    EvalCase(
        id="metadata-without-graph-coverage",
        input=(
            "What are the resolved dependencies of npm React 19.1.0 in this warehouse? "
            "Can you conclude it has none if the dependency query returns no rows?"
        ),
        expected_output=(
            "React 19.1.0 has package metadata but is not in RootVersions: copied React "
            "graphs cover only 19.0.0 and 19.2.0. The empty result is a graph coverage gap, "
            "not evidence that React 19.1.0 has no dependencies. The warehouse cannot "
            "answer its resolved graph from the copied data."
        ),
        expected_tools=("query_sql",),
    ),
)
