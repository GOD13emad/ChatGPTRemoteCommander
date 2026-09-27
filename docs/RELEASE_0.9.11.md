# ChatGPT Remote Commander v0.9.11

Date: 2026-09-27

## Purpose

v0.9.11 restores the product's intended reasoning boundary:

**Remote Commander is the execution/control layer for the current ChatGPT conversation. It must not silently consume Codex or convert Commander project work into a Codex/Work agent run.**

The default path is always:

`current ChatGPT chat -> Remote Commander -> local tools/apps/files`

If the assistant believes Work or Codex would materially help, it must stop before handoff and ask the user to choose explicitly:

1. **Continue in this chat with Remote Commander** — default.
2. **Move to Work/Codex** — only after explicit current-chat user approval; the handoff occurs outside Commander.

Commander itself never launches Codex, even after a historical approval. A later Work/Codex choice is a separate execution path, not a Commander sub-process.

## Root cause

v0.9.0-v0.9.10 Full Power installation/update logic could bootstrap a private Codex CLI 0.156.1 and auto-configure Project Engine with `provider.kind=codex`, `runner.enabled=true`, and `autoTick=true`. Separately, general Commander command/shell execution could run a project script that itself spawned Codex. R28 demonstrated this second path: a background Python executor launched Codex CLI while the user expected ChatGPT+Commander usage.

This was an architecture-policy mismatch, not merely one project bug.

## Changes

- Removed automatic Codex provider provisioning from Windows/Linux installers and auto-updaters.
- Candidate configuration migrates inherited Codex Project Engine runners fail-closed to disabled.
- Project Engine rejects Codex as a planner provider; explicit non-Codex command providers remain opt-in only.
- `run_project_command` rejects direct Codex executables, package-manager Codex invocation, and interpreter scripts that are detectably Codex launchers.
- `run_shell`, one-shot terminals, and terminal input reject direct/package-manager/script-mediated Codex delegation.
- Commander child processes receive a model-credential-scrubbed environment and isolated `CODEX_HOME`.
- Added `delegation_requirement` and `delegation_status` so the chat can expose the required two-way choice without launching Codex.
- Plugin skill now explicitly requires ChatGPT-first reasoning and current-chat approval before any external Work/Codex handoff.
- Existing explicit Work/Codex plugin-install tooling remains available only for users who deliberately enter that separate setup path; it is not used by normal Commander runtime execution.

## Compatibility

- Durable workflow recovery, filesystem/shell/GUI/browser execution, async operations, delivery, routing, multi-profile isolation, and boot recovery remain available.
- The `workflow.project_engine` capability may still exist as an authority surface for explicitly configured non-Codex command providers; no model provider is auto-created.
- Existing private Codex CLI files may remain on disk as historical inert artifacts until ordinary release cleanup removes them. Their mere presence does not grant launch authority.

## Acceptance

Release acceptance requires:

- no automatic model provider after config migration;
- old Codex runner config migrates to disabled;
- direct Codex command blocked;
- package-manager Codex blocked;
- Python/script-mediated Codex launch blocked;
- shell/terminal mediated launch blocked;
- child model credentials scrubbed;
- handoff gate offers exactly continue-chat or external Work/Codex;
- full repository check/test/audit and GUI contract pass;
- Windows and Linux candidate-first deployment shows no automatic Codex runner/provider.
