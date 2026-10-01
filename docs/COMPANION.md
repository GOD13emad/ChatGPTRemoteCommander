# Read-only native companion candidate

This is a source candidate built on Commander v0.10.4, not an installed upgrade
or a new release. The matching native panel is proposed in
`Usefull-Skills/chatgpt-cef-linux`. Existing workflows remain the durable memory
store; the companion does not duplicate that database or resume work on its own.

## What is implemented

- `workflow_companion_snapshot({id})` is an additive, read-only MCP operation.
  It exposes a bounded, redacted observation of one operator-bound workflow.
- Backend identity and its tool catalog are distinct from tools, plugins and
  skills actually exposed to a particular chat. In the shipped server adapter,
  current-chat exposure is **UNKNOWN**. A server tool list is not proof of chat
  access. Friendly device/plugin names are not stable machine identity.
- Explicit App/account/profile/workflow/root/chat binding is checked. Conflicts,
  expired host observations and uncertain operation receipts cannot authorize a
  replay, a root switch or automatic rebinding. `actionAllowed` is always false.
- A local exporter uses only literal loopback MCP, bounded modern requests and
  before/after identity checks. It never opens the target project or controls
  the Windows desktop.
- Published snapshots are append-only, no-clobber artifacts. Exporters acquire
  an empty exclusive lock once; a pre-existing lock stops the operation. No
  stale-lock takeover or automatic retry is provided. At most 32 snapshots are
  admitted; reaching the cap stops export, not deletes older evidence.

## Operator configuration and observation

This candidate does **not** discover accounts, cookies, app IDs or chat access.
The operator supplies authoritative values, or uses `null` for unknown fields.
In the isolated candidate configuration, under `durableWorkflows`, add:

```json
{
  "companion": {
    "binding": {
      "appId": null,
      "accountId": null,
      "profileId": "example-profile",
      "workflowId": "example-project",
      "projectRoot": "C:\\Projects\\example",
      "chatUrl": null
    }
  }
}
```

The native profile also needs a private `commander-binding.json` containing
exactly the six keys inside `binding`. The exporter checks it independently;
the snapshot cannot self-certify its intended recipient. Do not commit this
file, real snapshots or local configuration to a public repository.

Use a dedicated, already-created private directory, owned by the current user.
On Windows, both directory and individual files must allow only the owner,
SYSTEM and Administrators. The verifier reads ACLs without changing them,
opening a window or requesting elevation. On Linux, final directory/files are
same-user private; symlinks, hardlinks and unsafe writable ancestors are rejected.
No ACL setup or runtime installation is performed automatically.

One explicit observation, against an already-running isolated candidate:

```text
node tools/companion-export.mjs --endpoint http://127.0.0.1:49001/mcp --profile-directory C:\PrivateCompanion --workflow-id example-project
```

The output is `commander-companion-<16-digit observation time>-<UUID>.json`.
The matching Linux native reader selects the newest admitted name, checks that
its timestamp matches its content, and never falls back to older evidence if
that newest observation is invalid or expired. Legacy `commander-companion.json`
is read only when no immutable snapshot exists; the exporter never overwrites it.
Unknown files and existing snapshots are never cleaned up automatically.

The exported file is private local data, not an authenticated cross-machine
transport. A Windows path is not a Linux profile path; copying it through an
unverified shared directory does not establish a secure connection.

## Offline project adviser contract

`src/local-project-advisor.mjs` is a pure policy/adapter contract, not a bundled
LLM or a working model installer. It evaluates fresh resource headroom and a
host-pinned model/license/hash proposal. Exact owner approval, project and
hardware scope, expiry, single-use durable CAS and installed-artifact receipts
are required before an injected host transport may be used.

There is no default model, installer, network client or Codex dependency. Model
output is untrusted advice, never command, promotion or acceptance authority.
No model was downloaded or executed by this candidate's qualification tests.
Actual offline inference, model quality and hardware performance remain separate
acceptance gates.

## Verification and remaining gates

Run `npm test` and `npm run audit` in an isolated source checkout. New tests
include Windows private-file proofs and an actual isolated loopback MCP server;
unit proofs/mocks are not a live-chat or installed-runtime acceptance receipt.
The existing audit checks tracked source/history; publication must additionally
scan every new file before adding it to the remote tree.

Native compilation, sanitizer/file-guard tests, X11 overlay/lifecycle and binary
hashes belong to the matching CEF GitHub CI. Authenticated chat exposure, Emad
runtime, cross-machine transport, long-duration background decisions, controlled
retention, actual model installation and production rollout remain UNPROVEN
until separate target evidence exists. This panel cannot bypass ChatGPT limits,
guarantee background answer streaming, or enlarge a model's context window.

فارسی: این نسخه یک پنل مشاهدهٔ امن و حافظهٔ پروژهٔ قابل‌ردیابی اضافه می‌کند؛
هنوز به معنی نصب روی سیستم شما، دسترسی قطعی به عماد یا رفع تضمینی توقف چت نیست.
موارد ناشناخته واضح نمایش داده می‌شوند و از اجرای کار روی پروژهٔ اشتباه جلوگیری
می‌شود؛ تصمیم و اجرای مستقل نیازمند پذیرش مرحلهٔ بعد است.
