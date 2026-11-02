-- Reference queries for the fixed 2026-10-26T21:00:03.696994Z pilot.
-- Goldens are reviewed outputs of these queries, not model-generated answers.

-- license
SELECT Licenses FROM `ai-test-425016.groundwork_pilot_20261026.PackageVersionsLatest` WHERE System='NPM' AND Name='react' AND Version='19.2.0';

-- version
SELECT Version FROM `ai-test-425016.groundwork_pilot_20261026.PackageVersionsLatest` WHERE System='NPM' AND Name='lodash' AND VersionInfo.IsRelease ORDER BY VersionInfo.Ordinal DESC LIMIT 1;

-- requirements
SELECT Dependencies, PeerDependencies FROM `ai-test-425016.groundwork_pilot_20261026.NPMRequirementsLatest` WHERE Name='react-dom' AND Version='19.2.0';

-- aliases
SELECT a.SourceID,a.Aliases,a.Severity,a.CVSS3Score FROM `ai-test-425016.groundwork_pilot_20261026.PackageVersionsLatest` p CROSS JOIN UNNEST(p.Advisories) ref JOIN `ai-test-425016.groundwork_pilot_20261026.AdvisoriesLatest` a ON ref.Source=a.Source AND ref.SourceID=a.SourceID WHERE p.System='NPM' AND p.Name='lodash' AND p.Version IN ('4.17.19','4.17.20') ORDER BY a.SourceID;

-- express
SELECT COUNTIF(depth=1) AS direct,COUNTIF(depth>1) AS indirect_only FROM (SELECT Dependency.System,Dependency.Name,Dependency.Version,MIN(MinimumDepth) depth FROM `ai-test-425016.groundwork_pilot_20261026.DependenciesLatest` WHERE System='NPM' AND Name='express' AND Version='4.18.2' GROUP BY Dependency.System,Dependency.Name,Dependency.Version);

-- webpack
WITH indirect AS (SELECT Dependency.System AS System,Dependency.Name AS Name,Dependency.Version AS Version FROM `ai-test-425016.groundwork_pilot_20261026.DependenciesLatest` WHERE System='NPM' AND Name='webpack' AND Version='5.88.2' GROUP BY Dependency.System,Dependency.Name,Dependency.Version HAVING MIN(MinimumDepth)>1) SELECT d.System,d.Name,d.Version,ARRAY_AGG(DISTINCT CONCAT(a.Source,':',a.SourceID) ORDER BY CONCAT(a.Source,':',a.SourceID)) AS advisories FROM indirect d JOIN `ai-test-425016.groundwork_pilot_20261026.PackageVersionsLatest` p USING(System,Name,Version) CROSS JOIN UNNEST(p.Advisories) ref JOIN `ai-test-425016.groundwork_pilot_20261026.AdvisoriesLatest` a ON ref.Source=a.Source AND ref.SourceID=a.SourceID GROUP BY d.System,d.Name,d.Version ORDER BY d.Name,d.Version;

-- coverage
SELECT p.Name,p.Version,p.DependenciesProcessed,p.DependencyError,r.Name IS NOT NULL AS GraphCovered FROM `ai-test-425016.groundwork_pilot_20261026.PackageVersionsLatest` p LEFT JOIN `ai-test-425016.groundwork_pilot_20261026.RootVersions` r USING(System,Name,Version) WHERE p.System='NPM' AND p.Name='react' AND p.Version IN ('19.0.0','19.1.0','19.2.0') ORDER BY p.Version;

-- Positive graph/advisory join. Aggregate before counting package versions.
SELECT d.Dependency.Name AS Name, d.Dependency.Version AS Version,
       MIN(d.MinimumDepth) AS minimum_depth,
       ARRAY_AGG(DISTINCT CONCAT(ref.Source, ':', ref.SourceID)
                 ORDER BY CONCAT(ref.Source, ':', ref.SourceID)) AS advisories
FROM `ai-test-425016.groundwork_pilot_20261026.DependenciesLatest` d
JOIN `ai-test-425016.groundwork_pilot_20261026.PackageVersionsLatest` p
  ON p.System=d.Dependency.System AND p.Name=d.Dependency.Name
  AND p.Version=d.Dependency.Version
CROSS JOIN UNNEST(p.Advisories) ref
WHERE d.System='NPM' AND d.Name='express' AND d.Version='4.18.2'
GROUP BY d.Dependency.System, d.Dependency.Name, d.Dependency.Version
ORDER BY Name, Version;
