from harness.case import EvalCase

# Verified against NPMRequirementsLatest on 2026-10-14.
CASES = (
    EvalCase(
        id="react-dom-dependencies-versus-peers",
        input=(
            "List React DOM 19.2.0's declared npm runtime dependencies and peer requirements "
            "separately. Include the version ranges. Are these resolved dependency versions?"
        ),
        expected_output=(
            "The runtime dependency is scheduler with requirement ^0.27.0. The peer "
            "requirement is react ^19.2.0. These are declared requirement ranges from "
            "NPMRequirementsLatest, not resolved exact dependency versions. Do not classify "
            "react as the declared runtime dependency or scheduler as a peer."
        ),
        expected_tools=("query_sql",),
        required_facts=("scheduler", "^0.27.0", "react", "^19.2.0"),
    ),
)
