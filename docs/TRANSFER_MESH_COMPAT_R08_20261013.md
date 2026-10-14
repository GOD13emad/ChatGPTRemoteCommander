# Commander Transfer Mesh R08 — Cross-Version Fail-Closed Gate
Date: 2026-10-13
State: SOURCE CANDIDATE — NOT DEPLOYED. Draft PR #202.

## Critical real-world finding
Two isolated native Core 0.10.21 Windows Server canaries were started from exact R07 commit 1f2eb4c9fc313942f6e840bca01f578a93159d9a with transferMesh.maxSourceBytes=1024, maxPendingBytes=8192 and maxActiveJobs=1. Each had eight native MCP transfer tools. However the native adapter targeted a pre-existing R06 portable durable-send.mjs in the user pilot root. That R06 script did not understand the R07 quota flags, so an existing synthetic 16 MiB file was inadvertently admitted and published on each server. No user project data was involved and no receiver delivery was requested. Jobs retained:
- EmadServer -> PC: r07-canary-deny-emadserver-001; sha256 BF7AE0C9ECCAAF8B82026EABA7F63310215CD3CAFC36280AFB4D22B5A8CC8C5E.
- Amirreza -> PC: r07-canary-deny-amirreza-001; sha256 B7144CB6DE3067ED6178E956CF8BC306DA0CC0DD04B1028A739DA9C9B56447C5.
Both native canary terminals were stopped. Four stable Commander Core installations remain v0.10.20. Syncthing pilot was not restarted.

## Root cause
R07 native adapter trusted a valid path to durable-send.mjs as proof that the backend understood quota CLI contract. R06 silently ignored unknown arguments. Unit and HTTP tests had copied matching R07 Core and CLI; mixed-version installs were not covered.

## R08 prevention
- R08 portable durable-send.mjs supports a capabilities subcommand and returns schema ctmesh-durable-v1, contractVersion=2, admissionQuotas=true and supported operations.
- createTransferMeshTools uses execFileSync with bounded 3.5-second timeout and max 8KiB output to check capability BEFORE advertising the durable native tools.
- Unsupported and old backends fail startup explicitly with TRANSFER_DURABLE_BACKEND_INCOMPATIBLE. No durable job queued. R05 four native tools remain possible if durableEnabled=false.
- Unit and integration tests prove rejection of older backend and explicit capability acceptance of new CLI.
- R07 cancel/publication fix is still a source-only uncommitted change and has two manual regression tests Windows and Linux PASS; never delete already published user content.

## Evidence and remaining gates
R07 on commit 1f2eb4c9fc313942f6e840bca01f578a93159d9a: CI Windows, CI Ubuntu, Release Sync, Server Install Canary and Windows isolated updater NoPromote all PASS.
R08 full Windows npm run check PASS exit 0 and npm test PASS exit 0. Focused updated Windows native, durable and cancellation suite 12/12 PASS; matching Linux suite 12/12 PASS. Mixed-version older backend rejected by capability check and synchronous send quota regression passed. R08 commit and fresh GitHub CI pending.
Before stable FINAL: atomic compatible upgrade and verified rollback, Windows/Linux signed artifacts, complete R08 CI, four live native tools/list after canary rollout, OS reboot/logon evidence, quota/retention and cleanup, relay privacy approval. Never apply native R08 Core over older R06 portable CLI in production. No stable Core updated.

## Official references
https://docs.syncthing.net/users/firewall.html
https://tasks.extensions.modelcontextprotocol.io/specification/draft/tasks

## Source-only test integration note
The two publication/cancellation race tests in tools/commander-transfer-mesh/durable-cancel.test.mjs were run directly on Windows and Linux; package.json does not yet include that file in the default npm test script because an attempted change was blocked by host safety checks. Reviewers should run this test directly until it is included through an approved CI change. Do not describe these two tests as automatically exercised in npm test.
