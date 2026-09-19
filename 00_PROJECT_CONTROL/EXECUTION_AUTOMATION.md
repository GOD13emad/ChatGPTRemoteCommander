# Execution Automation

Authoritative runner: `RUN_BLUEGREEN.ps1`.

Operator form from an exact candidate Git root:

```powershell
.\RUN_BLUEGREEN.ps1 -CandidateRoot (Get-Location).Path -ExpectedCommit (git rev-parse HEAD) -LegacyRoot "$env:LOCALAPPDATA\ChatGPTRemoteCommander\app"
```

The runner owns preflight, exact archive validation, candidate start, regression gates, policy/identity checks, drain, CAS cutover, rollback, old in-flight wait, ownership-only stop, retirement evidence, cleanup, and final status. For a Remote Commander self-upgrade, launch it as a detached, hash-pinned process and independently inspect the durable log and target state; a synchronous in-band call is expected to block its own drain gate.

Blind rerun is forbidden after an uncertain external effect. First inspect managed state, pointer generation, runtime markers, process/listener ownership, workflow checkpoint, and the previous runner log.
