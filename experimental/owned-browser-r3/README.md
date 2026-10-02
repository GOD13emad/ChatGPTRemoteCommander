# Owned Browser R3 — versioned component snapshot

Status: ACCEPTED_COMPONENT / NOT PRODUCTION-WIRED.

This directory preserves the Saeid Windows browser R3 source that passed the bounded owned-fixture qualification on 2026-10-02.

Evidence-backed scope:
- graceful-close regression: 10/10 PASS;
- Windows module URL regression: 1/1 PASS;
- real isolated headless Chrome fixture: 7 snapshots across 60 seconds;
- helper exit code 0;
- no forced termination;
- post-run scoped browser-process count 0;
- no real ChatGPT chats read, no credentials/profile reuse, no foreground input.

Important boundary: `tools/browser-control.mjs` in this snapshot is intentionally fixture-only and must not replace the production browser-control tool. It requires isolated/headless fixture inputs and a pinned local fixture URL. It is preserved here for future integration work after durable monitor privacy and long-run gates.

Production baseline remains the normal v0.10.6 browser implementation unless a later independently qualified revision explicitly promotes this component.
