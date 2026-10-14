from harness.case import EvalCase

CASES = (
    EvalCase(
        id="react-license",
        input="What licenses does React 19.2.0 declare on npm? Check deps.dev.",
        expected_output="The npm package react, version 19.2.0, declares the MIT license.",
        expected_tools=("query_sql",),
    ),
    EvalCase(
        id="missing-package",
        input=(
            "Look up the npm package groundwork-eval-nonexistent-package-8d20f74f, "
            "version 0.0.0, in deps.dev. What license does it declare?"
        ),
        expected_output=(
            "No matching package version was found in deps.dev. Its license cannot "
            "be determined from this dataset; do not invent a license or assert "
            "that the package cannot exist elsewhere."
        ),
        expected_tools=("query_sql",),
    ),
)
