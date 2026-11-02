from harness.case import EvalCase, ExpectedIdentifiers

# Independently verified against the 2026-10-26T21:00:03.696994Z pilot snapshot.
CASES = (
    EvalCase(
        id="express-direct-versus-indirect-dependencies",
        input=(
            "For npm Express 4.18.2, count direct dependencies and indirect-only "
            "dependencies separately, counting each resolved package version once."
        ),
        expected_output=(
            "There are 31 direct resolved dependency versions and 39 indirect-only versions, "
            "70 resolved dependency versions total. There are only 69 distinct dependency "
            "names, so names are not the correct counting unit. Group by dependency System, "
            "Name, and Version and use minimum depth to separate direct from indirect-only."
        ),
        expected_tools=("query_sql",),
        required_facts=("31", "39"),
    ),
    EvalCase(
        id="webpack-vulnerable-indirect-dependencies",
        input=(
            "Which indirect-only dependencies of npm Webpack 5.88.2 have advisories in "
            "this snapshot? Exclude Webpack itself and direct dependencies. Report each "
            "affected resolved package version once with its distinct advisory IDs."
        ),
        expected_output=(
            "No indirect-only resolved dependencies of Webpack 5.88.2 have recorded "
            "advisories in this snapshot. This is an empty join result, not a guarantee "
            "of safety or proof that vulnerabilities do not exist elsewhere."
        ),
        expected_tools=("query_sql",),
    ),
    EvalCase(
        id="express-vulnerable-dependencies",
        input=(
            "For npm Express 4.18.2, which resolved dependencies have recorded advisories? "
            "List each affected package version once, label direct versus indirect-only, "
            "and include its distinct advisory IDs. Exclude Express itself."
        ),
        expected_output=(
            "Six resolved dependency versions have recorded advisories, all direct: "
            "body-parser 1.20.1: GHSA-27r3-jxmh-p828, GHSA-qwcr-r2fm-qrc7, GHSA-v422-hmwv-36x6; "
            "cookie 0.5.0: GHSA-pxg6-pf52-xh8x; "
            "path-to-regexp 0.1.7: GHSA-37ch-88jc-xwx2, GHSA-9wv6-86v2-598j, GHSA-rhx6-c78j-4q9w; "
            "qs 6.11.0: GHSA-4mjr-xmp4-gh2g, GHSA-6rw7-vpxm-498p, GHSA-w7fw-mjwx-w883; "
            "send 0.18.0: GHSA-m6fv-jmcg-4jfg; serve-static 1.15.0: GHSA-cm22-4g7w-348p. "
            "Do not count advisory rows as package versions or duplicate packages across paths."
        ),
        expected_tools=("query_sql",),
        required_facts=(
            "body-parser",
            "1.20.1",
            "cookie",
            "0.5.0",
            "path-to-regexp",
            "0.1.7",
            "qs",
            "6.11.0",
            "send",
            "0.18.0",
            "serve-static",
            "1.15.0",
        ),
        expected_identifiers=ExpectedIdentifiers(
            pattern=r"GHSA-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}",
            values=(
                "GHSA-27r3-jxmh-p828",
                "GHSA-qwcr-r2fm-qrc7",
                "GHSA-v422-hmwv-36x6",
                "GHSA-pxg6-pf52-xh8x",
                "GHSA-37ch-88jc-xwx2",
                "GHSA-9wv6-86v2-598j",
                "GHSA-rhx6-c78j-4q9w",
                "GHSA-4mjr-xmp4-gh2g",
                "GHSA-6rw7-vpxm-498p",
                "GHSA-w7fw-mjwx-w883",
                "GHSA-m6fv-jmcg-4jfg",
                "GHSA-cm22-4g7w-348p",
            ),
        ),
    ),
)
