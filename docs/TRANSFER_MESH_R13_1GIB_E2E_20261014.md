# Commander Transfer Mesh R13 — real 1 GiB end-to-end evidence

Date: 2026-10-14 (experiment UTC 2026-10-13 21:33–21:34).
Scope: Emad PC Windows (alias PC) -> Emad Labtop Linux (alias Linux), using live user-scoped Syncthing v2.1.6 transport and existing R06 portable Commander tools. **This was a real 1 GiB cross-machine transfer, not a mock.** Neither stable Core was updated or restarted.

## Exact synthetic test
- Transfer id: `r13-1g-pc-linux-20261014-001`
- Test filename: `ctmesh-r13-1g-pc-linux-20261014-001.bin`
- File size: **1,073,741,824 bytes** (= 1 GiB).
- Content: 128 independently generated 8 MiB blocks of cryptographically random synthetic data; no project/user data.
- Sender source: `%LOCALAPPDATA%\CommanderTransferPilot\local-test\ctmesh-r13-1g-pc-linux-20261014-001.bin`
- Sender job: `%LOCALAPPDATA%\CommanderTransferPilot\jobs\Linux\r13-1g-pc-linux-20261014-001.json`
- Receiver shared pair: `~/.local/share/commander-transfer-pilot/pairs/PC/transfers/r13-1g-pc-linux-20261014-001/`
- Receiver final: `~/.local/share/commander-transfer-pilot/received/ctmesh-r13-1g-pc-linux-20261014-001.bin`
- Expected and verified sender, receiver-shared, and final destination SHA-256:
  `9e529b145842c4a896ef788d5eef59968ffbc500ffaf9cb394fec7fee30539ae`

## Observed receipts (all PASS)
1. Sender generated exactly 1 GiB, recorded SHA-256 and `durable-send.mjs enqueue --peer Linux` yielded `QUEUED`.
2. Sender `job-status` reached `PUBLISHED` with `copiedBytes=1073741824`, `percent=100` and matching SHA-256.
3. Recipient first observed `PENDING` while its synced shared folder had ~544 MiB; later full `payload.bin` 1,073,741,824 bytes and manifest were present.
4. Recipient `transfer.mjs status --peer PC --id ...` returned `RECEIVED_HASH_VERIFIED`, confirming remote payload/manifest identity, size and full hash.
5. Recipient `transfer.mjs receive --peer PC --id ... --dest received` returned `DELIVERED_HASH_VERIFIED` with matching SHA-256.
6. An independent Linux `sha256sum` on final destination matched the source SHA-256. Re-running receive with the same ID and destination was safely blocked with `Destination exists; overwrite forbidden`; post-retry destination SHA-256 and size were unchanged.

## Time readings
- Sender began generating test file at UTC epoch ms 1791927235750.
- Sender started staging at ms 1791927237878.
- Linux verified synced payload and started receive check at ms 1791927289376.
- Linux started local final copy at ms 1791927290568.
- Linux completed local final copy at ms 1791927295785.
- Approximate wall-clock from beginning file generation through complete final delivery: **60.0 s**. From staging start to final-copy completion: **57.9 s**. These combine hashing, staging, Syncthing synchronization, receiver final copy and host clocks; **do not mislabel these as pure network throughput**. Network speed and all destinations are not established by this single sample.

## Safety / retention
- No production dataset read, no stable Core/OS reboot, no firewall/NAT/router change, and no Syncthing service restart.
- Synthetic source, synced pair and final output are **retained** to preserve evidence; do not blindly erase partials, journals, Syncthing entries or unrelated user content. Only scoped, hash-checked test-artifact cleanup is suitable after ownership check.
- Current four live portable durable-send backends are older R06 SHA256 `30e7172cef317ed637103f970e57964247ce88756e9df6363217015f341a2e65`. They can copy this 1 GiB, but do **not** satisfy new Core R11 contractVersion=2. Thus 1 GiB real transport PASS does not imply stable 10 GiB native quota/recovery gate PASS.
- The final receiver-local copy step of `pilot-cli.mjs` still does not automatically resume a leftover partial if interrupted; that gate is OPEN (unverified fix reverted).

## GitHub gates / release
R12 commit `ff80cde168e759b662eef2eaafb7c96a71aec879`: GitHub CI Windows+Ubuntu PASS, Release Sync PASS and Server Canary Windows+Linux PASS. Windows isolated updater NoPromote initial job FAILED: `R157_BAD_RESULT_FAILED`, with nested test qualification `GATE_FAIL test exit=1`. R470 diagnostic artifact showed only `TAP_SUMMARY_EXTRACTED`, 0 parsed failure names and 62,646 stdout bytes (the parser may not support the Unicode Node TAP reporter). A single rerun of failed workflow jobs was requested via GitHub Actions; its outcome requires fresh readback. Do not claim all R12 workflows PASS until verified.
No live four-device native rollout, rollback, reboot recovery or 10 GiB end-to-end test has been conducted.

## Official context
Syncthing's official documentation describes file block transfers and resume behavior; public relay routes can be slower than direct TCP/QUIC:
https://docs.syncthing.net/users/faq.html
https://docs.syncthing.net/users/firewall.html
