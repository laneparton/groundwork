# Vendored anti-slop

Source: https://github.com/dmmulroy/anti-slop
Revision: 13909c9e07590f5a85d93c62712259fe14a883f7
Copied from: skills/install-anti-slop/assets/anti-slop
Installed at: tools/oxlint/anti-slop
Installed: 2026-10-14

No changes to upstream rule implementations. The upstream MIT license and the nested eslint-stylistic license and provenance are preserved.

Generic rules are enabled for both applications. The Effect rule group is enabled only for apps/server, which directly depends on Effect. The service-constructor rule currently covers relative project imports, not package aliases.

Oxlint and @oxlint/plugins are pinned to 1.86.0, matching the installed Oxlint version. Keep those versions synchronized when upgrading.
