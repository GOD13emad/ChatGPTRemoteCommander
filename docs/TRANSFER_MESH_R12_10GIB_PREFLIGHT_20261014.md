# Commander Transfer Mesh R12 — 10 GiB large-file readiness gate

Date: 2026-10-14. Status: development branch only, NOT yet installed in the four stable Core instances.

## Direct answer: can the project move 10 GiB?
Technically **yes after compatible deployment and end-to-end acceptance**. The R11 source supports maximum file size of 16 GiB, queue admission maximum 64 GiB and default three concurrent workers; 10 GiB is within those configured values. Syncthing v2.1.6 can synchronize large files in chunks. However a 10 GiB real end-to-end transfer **has not yet been verified** on the four live nodes; previous larger real canaries and local crash recovery are not evidence of a 10 GiB transfer. Some peer paths use public relays, potentially making transfer slower.

### Current fleet assessment
All four live Syncthing nodes have three connected peers, three private pair folders and their shared/broadcast legacy folder paused. Stable Commander Core is still 0.10.20 on each.
Approximate available disk (Oct 14): Emad PC 341 GB; Emad Labtop Linux 265 GB; Emad Server 380 GB; Server Amirreza 79 GB.
The portable `durable-send.mjs` currently installed on all four hosts has the old R06 SHA256 `30e7172cef317ed637103f970e57964247ce88756e9df6363217015f341a2e65`; it does not advertise the R11 contractVersion=2/admissionQuotas. Thus the native R11 backend *is not ready on live stable installs*. Do not conflate source tests and delivery readiness.

### R12 read-only large-file preflight
`tools/commander-transfer-mesh/large-transfer-preflight.mjs`
- Takes `--root`, `--peer`, `--role send|receive`, `--bytes` and optional quota settings.
- Produces machine-readable checks for source-size limit, existing pending work, available worker slots, disk reserve and exact durable backend capabilities; never writes a job or starts a transfer.
- Uses conservative safety budget: sender **2 x file bytes + outstanding pending reservations + 2 GiB**; receiver **3 x file bytes + outstanding pending reservations + 2 GiB**. These are estimated local staging/receive safety margins, not guaranteed disk use and not a network bandwidth test.
- Requires execution on both ends before initiating a 10 GiB job.
- `safeToAttempt=false` on an R06 portable backend by design, even if size and disk tests all pass. Checks are advisory and inherently non-atomic: a different job may start later.

Examples:

Windows PC -> Linux (source only, no transfer):
```powershell
node tools/commander-transfer-mesh/large-transfer-preflight.mjs --root "$env:LOCALAPPDATA\CommanderTransferPilot" --peer Linux --role send --bytes 10737418240
```
Linux receiving from PC:
```bash
node tools/commander-transfer-mesh/large-transfer-preflight.mjs --root "$HOME/.local/share/commander-transfer-pilot" --peer PC --role receive --bytes 10737418240
```

### Evidence
- Windows **7/7** unit/integration preflight tests PASS.
- Linux **7/7** corresponding tests PASS.
- Read-only preflight PC -> Linux and Linux <- PC both passed disk/size/pending/concurrency checks, but failed the compatible-backend check as expected (old R06). No 10 GiB file was created or copied.
- PC jobs: 7/7 terminal PUBLISHED, 0 locks/partials. Emad Server: 5/5 PUBLISHED, 0 locks/partials. Amirreza Server: 5/5 PUBLISHED, 0 locks/partials. Linux old-queue read-only enumeration was blocked by host safety checks; leave this check open, do not bypass.
- CI workflow now exercises the seven tests on Windows and Ubuntu.

### Remaining release gates
1. Exact R12 GitHub CI and release canary results.
2. Atomic compatible backend+Core rollout beginning on Emad dev host with per-host immutable config/state backup, rollback and verified identities; avoid duplicate parallel installs.
3. Controlled end-to-end **real 10 GiB** pilot with hashes, ETA/throughput measurements, cancellation/restart, no-overwrite and disk checks. No unattended 10 GiB network copy should be started without knowing desired source/destination device and resource impact.
4. Real OS reboot/logon and power outage; safe cleanup/retention; direct-vs-relay optimization using authorized network controls. Authenticity distribution via R11 GitHub Sigstore provenance is NOT Windows Authenticode.

## Interrupted final receive caveat
The existing pilot-cli.mjs receive stage still uses fs.copyFileSync into a deterministic .ctmesh-ID.part. A power loss during final copy can leave that partial; a direct retry rejects the existing .part, and safe inspected cleanup or an approved resumable-receive implementation is required. A source change attempting verified partial resume was reverted after a regression-test write was blocked by host safety controls. Do not claim fully automatic destination resume of an interrupted 10 GiB final copy. Syncthing's network block resumption is separate from this final local file-copy step.
