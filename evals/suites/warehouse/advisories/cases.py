from harness.case import EvalCase, ExpectedIdentifiers

# Package/advisory joins verified against the latest snapshot on 2026-10-26.
CASES = (
    EvalCase(
        id="lodash-distinct-cve-aliases",
        input=(
            "Across npm lodash 4.17.19 and 4.17.20, list every distinct CVE identifier "
            "in the aliases of "
            "its advisories. How many CVE mentions are there before deduplication, and how "
            "many distinct CVEs afterward? Count CVE identifiers, not advisory records "
            "or GHSA aliases."
        ),
        expected_output=(
            "There are 10 CVE mentions before deduplication and 5 distinct CVEs: "
            "CVE-2020-28500, CVE-2021-23337, CVE-2025-13465, CVE-2026-2950, "
            "and CVE-2026-4800. Join PackageVersionsLatest.Advisories to AdvisoriesLatest "
            "using both Source and SourceID. Repeated CVE aliases across the two "
            "package versions must not be "
            "counted twice, and GHSA identifiers are not CVEs."
        ),
        expected_tools=("query_sql",),
        expected_identifiers=ExpectedIdentifiers(
            pattern=r"CVE-\d{4}-\d{4,}",
            values=(
                "CVE-2020-28500",
                "CVE-2021-23337",
                "CVE-2025-13465",
                "CVE-2026-2950",
                "CVE-2026-4800",
            ),
        ),
    ),
    EvalCase(
        id="advisory-severity-and-identity-evidence",
        input=(
            "Compare the deps.dev severity fields and CVSS scores for OSV advisories "
            "GHSA-35jh-r3h4-6jhm and GHSA-r5fr-rjxr-66jc. Do their aliases overlap? "
            "Explain what the data supports without inventing a single authoritative severity."
        ),
        expected_output=(
            "Both records have Severity UNKNOWN. GHSA-35jh-r3h4-6jhm has CVSS3Score 7.2; "
            "GHSA-r5fr-rjxr-66jc has CVSS3Score 8.1. The first aliases CVE-2021-23337; "
            "the second aliases CVE-2026-4800. Their aliases do not overlap in this "
            "snapshot. Report the differing scores "
            "without inventing an explanation or selecting one as authoritative. UNKNOWN "
            "does not mean zero severity or no vulnerability."
        ),
        expected_tools=("query_sql",),
        required_facts=("UNKNOWN", "7.2", "8.1"),
    ),
)
