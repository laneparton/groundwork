from dataclasses import dataclass


@dataclass(frozen=True)
class GraphCandidate:
    id: str
    input: str
    reference_sql: str
    blocked_reason: str


# No invented goldens: these queries were dry-run, but not executed within the 20 GB cap.
CASES = (
    GraphCandidate(
        id="express-direct-versus-indirect-dependencies",
        input=(
            "For npm Express 4.18.2, count direct dependencies and indirect-only "
            "dependencies separately, counting each resolved package version once."
        ),
        reference_sql="""
            SELECT
              COUNTIF(MinimumDepth = 1) AS direct,
              COUNTIF(MinimumDepth > 1) AS indirect_only
            FROM (
              SELECT Dependency.System, Dependency.Name, Dependency.Version,
                     MIN(MinimumDepth) AS MinimumDepth
              FROM `bigquery-public-data.deps_dev_v1.DependenciesLatest`
              WHERE System = 'NPM' AND Name = 'express' AND Version = '4.18.2'
              GROUP BY Dependency.System, Dependency.Name, Dependency.Version
            )
        """,
        blocked_reason=(
            "Even the simpler dependency-depth query estimated 102 GB. "
            "Needs a bounded snapshot and verified counts."
        ),
    ),
    GraphCandidate(
        id="webpack-vulnerable-indirect-dependencies",
        input=(
            "Which indirect-only dependencies of npm Webpack 5.88.2 have advisories? "
            "Exclude Webpack itself and direct dependencies. Report each affected resolved "
            "package version once with its distinct advisory IDs."
        ),
        reference_sql="""
            WITH indirect AS (
              SELECT Dependency.System AS System, Dependency.Name AS Name,
                     Dependency.Version AS Version
              FROM `bigquery-public-data.deps_dev_v1.DependenciesLatest`
              WHERE System = 'NPM' AND Name = 'webpack' AND Version = '5.88.2'
              GROUP BY Dependency.System, Dependency.Name, Dependency.Version
              HAVING MIN(MinimumDepth) > 1
            )
            SELECT d.System, d.Name, d.Version,
                   ARRAY_AGG(DISTINCT CONCAT(a.Source, ':', a.SourceID)
                             ORDER BY CONCAT(a.Source, ':', a.SourceID)) AS advisories
            FROM indirect AS d
            JOIN `bigquery-public-data.deps_dev_v1.PackageVersionsLatest` AS p
              USING (System, Name, Version)
            CROSS JOIN UNNEST(p.Advisories) AS ref
            JOIN `bigquery-public-data.deps_dev_v1.AdvisoriesLatest` AS a
              ON ref.Source = a.Source AND ref.SourceID = a.SourceID
            GROUP BY d.System, d.Name, d.Version
            ORDER BY d.System, d.Name, d.Version
        """,
        blocked_reason=(
            "Dependency discovery estimated up to 185 GB before this full join. "
            "Needs a bounded snapshot and verified affected package versions."
        ),
    ),
)
