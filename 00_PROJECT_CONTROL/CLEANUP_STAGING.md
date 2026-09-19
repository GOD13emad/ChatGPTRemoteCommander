# Cleanup and Staging Rules

- Preserve source, baseline, current config, workflow stores, credentials, profile YAML, handoffs, evidence, manifests, and unrelated/personal files.
- Candidate staging and release retirement are registry/manifest first. Recursive deletion is allowed only for an exact direct child with parent/name checks, no reparse/link ambiguity, exact ownership, and a verified manifest.
- Unknown listeners/processes are never killed. An owned process requires matching runtime marker, PID, port, profile, project directory, release commit, and slot.
- Legacy tracked source is archived; untracked/ignored bytes are copied and rehashed; Git refs are bundled and verified before the old application tree can be removed.
- An old release is removed only when no pointer, process, tunnel, supervisor, registry, or autostart entry references it.
- Cleanup failure after successful cutover is `SERVICE_ACTIVE_CLEANUP_INCOMPLETE`: service stays active, legacy evidence stays present, and the next run performs cleanup recovery before another promotion.
