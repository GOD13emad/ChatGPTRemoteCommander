# Competitive Audit — 2026-09-21

## Scope
Evidence-first comparison of ChatGPT Remote Commander v0.8.12 candidate with adjacent agent/execution products. The products are not identical: Remote Commander is primarily an MCP execution/control layer for a real machine, while Work, Codex, Claude Code, Cursor, GitHub Copilot agents and Open Interpreter include their own agent/model/harness surfaces.

## Current external evidence
- ChatGPT Work: longer research/analysis/deliverable tasks, connected apps/files, scheduled tasks, and a separate cloud browser/computer that can continue after the user's local device is closed. Sources: https://help.openai.com/en/articles/20001275/ and https://help.openai.com/en/articles/20001280-using-cloud-browser-in-chatgpt
- Codex: end-to-end coding agent, built-in worktrees/cloud environments, parallel multi-agent workflows and scheduled/background engineering. Source: https://openai.com/codex/
- Claude Code: terminal coding agent with MCP support and permission controls; documentation describes explicit permissions/allowed tools and resumable CLI sessions. Sources: https://docs.anthropic.com/en/docs/claude-code/getting-started and https://docs.anthropic.com/en/docs/claude-code/cli-usage
- Cursor Cloud Agents: dedicated isolated VMs, parallel agents, proof artifacts and background execution. Sources: https://cursor.com/docs/cloud-agent and https://prod.cursor.com/docs/cloud-agent/security
- GitHub coding agents: PR-oriented cloud agents; GitHub documents CodeQL, secret scanning and dependency/advisory validation for agent-generated code. Source: https://docs.github.com/en/copilot/concepts/agents/about-third-party-coding-agents
- Open Interpreter: local desktop/file/browser automation with workspace boundaries and approval policies; supports Windows/macOS/Linux desktop use. Sources: https://www.openinterpreter.com/docs/desktop, /desktop/workspaces and /desktop/approvals
- Remote Desktop Commander: hosted remote MCP relay for filesystem/terminal/process access, multiple machines and multiple AI clients; currently documented as beta. Source: https://github.com/desktop-commander/remote-desktop-commander

## Evidence-backed Remote Commander strengths
- Real target-machine MCP access from ChatGPT with local loopback server and Secure MCP Tunnel path.
- Explicit Standard vs Full Power authority, per-capability persistence across updates and per-profile local isolation.
- Candidate-first automatic update with staged gates, stable routing, rollback/maintenance state and source-hash activation checks.
- Durable workflow journal with revision preconditions, evidence hashes, no blind replay after uncertain effects, one-writer-per-root and Project Brain projection.
- Windows GUI control with exclusive lease, fresh single-use frame, uncertain-outcome latch, emergency stop, and in v0.8.10 an observe-only default plus direct-session-only interactive takeover.
- Multiple account/profile and multiple-device workflows documented and locally exercised in prior releases.
- Source/security/recovery regression suites and release asset SHA-256 verification.

## Gaps / non-comparable strengths of others
- Remote Commander does not itself supply a frontier reasoning model or a cloud-agent fleet. Model reasoning and true background agent execution are host responsibilities.
- `runnerConfigured=false` is an intentional boundary: the local scheduler can recover/reconcile/queue, but cannot invent an LLM host runner. Flipping it would be a false capability claim.
- Cursor/Codex provide first-class isolated cloud worktrees/VMs and parallel agent orchestration; Remote Commander instead targets the user's real machine and one-writer safety.
- ChatGPT Work has its own cloud browser and finished-artifact stack; Remote Commander can expose local execution to Work but is not a replacement for Work's cloud computer.
- GitHub documents platform-native CodeQL/advisory/secret validation for coding agents. Remote Commander has its own secret/source audits but does not claim CodeQL-equivalent static analysis.
- Open Interpreter documents cross-platform desktop driving. Remote Commander's native GUI backend is Windows-only; Windows Secure Desktop/UAC, lock screen, protected input and real-time gameplay remain intentional boundaries.
- No reproducible, matched cross-product benchmark exists that proves Remote Commander is categorically faster, safer or better at every task.

## Decision
Do not optimize for an unsupported "best at everything" claim. Optimize for the distinct role: a high-authority, evidence-backed, non-intrusive execution substrate that makes capable host agents more effective on a real trusted machine.

v0.8.10 closes the most relevant competitive/safety gap found in this audit: foreground desktop control cannot be taken merely because Full Power is enabled or because a durable workflow resumes. Observe-only is the default; takeover requires an explicit current-user basis and cannot be dispatched through durable workflows.

## Future benchmark needed for superiority claims
A defensible comparison must pin: same model (where possible), same task corpus, same repository/data snapshot, same hardware/time/token budget, same network permissions, same confirmation policy, and identical acceptance tests. Report task success, wall-clock time, intervention count, reruns, safety violations, context-loss failures and evidence completeness. Until such a benchmark is executed, global superiority remains UNPROVEN.
