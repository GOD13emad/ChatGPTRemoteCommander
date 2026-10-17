# Native GUI incident recovery (owner-local)

An uncertain native mouse/keyboard/focus operation can have reached the desktop even when its response was lost. Its per-user `PENDING_NATIVE_EFFECT` record is deliberately persistent: **never blindly retry the action**.

## During an unresolved incident

- `gui_status` reports `GUI_INCIDENT_REVIEW_REQUIRED`, the pending tool and timestamp, and separate `inputAvailable: false` / `readOnlyAvailable` flags.
- An **observe-only** `gui_session_begin`, `gui_screenshot`, `gui_list_windows`, `gui_cursor_position`, lease renewal and lease end remain available when the native backend is healthy.
- Takeover and *every* native input or focus action stay blocked. `GUI_STOP` and ordinary GUI authorization checks still apply. Corrupt incident storage also blocks input.
- Nothing automatically expires or clears the unknown outcome; a Commander restart does not count as review.

## Resolve exactly one incident after owner inspection

On the **affected computer**, under the **same logged-in OS account** as its Commander process, use a real interactive terminal with the compatible installed source:

```sh
node tools/gui-incident-recover.mjs --status
node tools/gui-incident-recover.mjs --review
```

Read the incident's tool and UTC time; inspect the actual desktop without repeating it. Choose one owner-observed disposition:

1. Original action appears applied.
2. Original action appears not applied.
3. Outcome cannot be established; accept it as unknown **and do not replay it**.

Type the exact `REVIEW <incident UUID>` requested by the local terminal. The command refuses piped/noninteractive consent, an incident younger than 60 seconds, stale IDs, corrupt records, symlinks and conflicting archived receipts. No password or typed GUI content is collected. It retains the minimum original incident metadata in a private archive and persists the owner's **claim**, not a cryptographic proof of the native outcome. On verified receipt, the live GUI controller can retire its in-memory uncertainty without automatically repeating any action.

**Do not** manually delete `gui-pending-native-input-v1.json`, force-reset the journal, inject input through another tool, or run this command over an unattended terminal. An uncertain `gui_type_text` may already have submitted text to another application; verify the target before choosing a disposition. If the GUI service is still executing a native request, finish/cancel it via the user's established safe control path before reviewing.

## Scope and release

This workflow is an isolated candidate until validated, reviewed and deployed through the project's existing release process. A local source change does **not** upgrade the connected ChatGPT plugin or its installed runtime. Historical incident records remain untouched until their exact human review; older binaries may still show the obsolete `NATIVE_OUTCOME_UNCERTAIN_RESTART_REQUIRED` wording. Security-sensitive Windows/Linux OS authorization and user desktop control are not bypassed. The CLI itself does not contact external services.
