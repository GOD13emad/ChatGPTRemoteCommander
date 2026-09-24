# Headless Chess Stress Benchmark — 2026-09-21

> Historical snapshot. Product comparisons, measurements and roadmap statements apply to the recorded date/version. See [current project state](PROJECT_CONTROL_STATE.md) and [v0.8.35](RELEASE_0.8.35.md) for present release scope.

## Objective
Exercise Remote Commander under a repeated think/tool/respond loop without touching the user's foreground desktop. This is a latency/reliability stress test, not a scientific benchmark of model chess strength or a cross-product superiority test.

## Engine authority
- Engine: Stockfish 19, official Windows x86-64 universal release.
- Source: https://stockfishchess.org/download/
- Download asset: https://github.com/official-stockfish/Stockfish/releases/latest/download/stockfish-windows-x86-64-universal.zip
- ZIP SHA-256: `3C8BF1F9EA66A09350A40DF4F632288285AC206D99F33AB5842C408FC30B48A7`
- Executable SHA-256: `45BC8E4969147DB9C2EB533810637994619BFF0EACC81CCFD9854394901BCBD0`
- Local benchmark root: `%LOCALAPPDATA%\ChatGPTRemoteCommander\benchmarks\stockfish19-20260921` (external/local evidence; not release content).

## Host
- Device: Windows test host
- CPU: Intel Core i9-13900KF, 32 logical processors
- Engine configuration: 32 threads, 2048 MiB hash, Skill Level 20/default maximum
- GUI usage: none. Stockfish ran headlessly through a persistent PowerShell terminal; no screenshot, mouse, keyboard, scroll, focus, or browser interaction was used.

## Measured engine throughput
A corrected UCI harness waited for `uciok`, `readyok`, and `bestmove`. A 1000 ms start-position search returned:
- elapsed: 1004 ms
- depth: 24
- nodes: 17,935,535
- NPS: 17,899,735
- best move: d2d4

The first naive pipeline attempt is excluded because it queued `quit` immediately and returned a depth-1/nodes-0 result; root cause was harness sequencing, not engine performance.

## Bounded game stress run
Remote Commander kept one Stockfish process alive and sent each Black move request at `go movetime 500`. White moves were selected by the assistant; Stockfish was not used to select White moves. Engine observed throughput across sampled moves was approximately 16–24 million NPS.

Moves:
```text
1. e4 e5
2. Nf3 Nc6
3. Bb5 Nf6
4. O-O Nxe4
5. d4 Nd6
6. Bxc6 dxc6
7. dxe5 Nf5
8. Qxd8+ Kxd8
9. Nc3 Bd7
10. h3 h6
11. b3 Kc8
12. Bb2 a5
13. Rad1 a4
14. g4 Ne7
15. Rd3 Nd5
16. Nxd5 cxd5
17. Rxd5 Be6
18. Rd3 c5
19. Nd2 axb3
20. axb3 h5
```

At the bounded stop after 20...h5, Stockfish's final search reported `score cp -4` from the Black-to-move search immediately before the move, effectively an equal position at this precision. The run therefore demonstrates no quick collapse against maximum-skill Stockfish, but it is **not a win** and is not evidence that the assistant is stronger than Stockfish.

## Result
- Headless/no-desktop-interference requirement: PASS.
- Repeated terminal/tool round-trip: PASS.
- Persistent-engine path: PASS.
- 500 ms engine response target: PASS in observed calls.
- Assistant win versus Stockfish 19: NOT ACHIEVED in the bounded run.
- Product/model superiority conclusion: UNPROVEN; requires a predefined multi-task benchmark against comparable agents under matched hardware, model, permissions, and time budgets.
