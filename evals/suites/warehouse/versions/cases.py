from harness.case import EvalCase

# Verified against deps.dev on 2026-10-14. Review this golden when new releases arrive.
CASES = (
    EvalCase(
        id="lodash-semantic-version-order",
        input=(
            "What is lodash's highest stable npm release in the latest deps.dev snapshot? "
            "Explain how you determine version order rather than sorting version strings."
        ),
        expected_output=(
            "The highest stable release is 4.18.1. Use VersionInfo.IsRelease and "
            "VersionInfo.Ordinal from PackageVersionsLatest, not lexical version ordering. "
            "Lexical descending order would incorrectly select 4.9.0. Latest refers to "
            "the latest snapshot, not one latest version per package."
        ),
        expected_tools=("query_sql",),
        required_facts=("4.18.1",),
    ),
)
