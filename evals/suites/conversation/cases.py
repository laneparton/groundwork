from harness.case import EvalCase

CASES = (
    EvalCase(
        id="greeting",
        input="Hi! What can you help me with?",
        expected_output=(
            "A brief greeting explaining that Groundwork can help answer questions "
            "about packages, dependencies, licenses, advisories, and projects using "
            "deps.dev data. No warehouse lookup is needed."
        ),
    ),
)
