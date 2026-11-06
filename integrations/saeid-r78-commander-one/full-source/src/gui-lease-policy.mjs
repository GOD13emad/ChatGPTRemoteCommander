// Shared V1 physical-desktop lease policy: same on Windows, Linux and GUI servers.
// Telemetry can veto takeover, but idle/silence never creates an owner grant.
import { guiError } from './gui-contract.mjs';
export const GUI_PHYSICAL_IDLE_THRESHOLD_MS = 60_000;
export const GUI_TAKEOVER_MAX_SECONDS = 120;
export const GUI_MANAGER_NOTICE_OPEN_MS = 60_000; // One-minute reject window before autoapproval.
export const GUI_MANAGER_NO_RESPONSE_MS = 60_000; // One minute after the native notice.

// Pure decision logic for a native UI notifier; it does not display or
// self-approve an OS consent dialog. Silence cannot override active input.
export function managerNoticeDecision({ openedAtMs, nowMs, rejected = false,
  standingOwnerGrant = false, nativeStatus = {} } = {}) {
  if (!Number.isSafeInteger(openedAtMs) || !Number.isSafeInteger(nowMs) || nowMs < openedAtMs) {
    return { state: 'invalid-window', mayTakeControl: false, canWorkInBackground: true };
  }
  const elapsedMs = nowMs - openedAtMs;
  const noticeOpen = elapsedMs < GUI_MANAGER_NOTICE_OPEN_MS;
  if (rejected) return { state: 'declined', mayTakeControl: false,
    noticeOpen, canWorkInBackground: true };
  if (!standingOwnerGrant) return { state: 'owner-grant-required', mayTakeControl: false,
    noticeOpen, canWorkInBackground: true, autoApproved: false };
  const noRejectionApproved = elapsedMs >= GUI_MANAGER_NO_RESPONSE_MS;
  if (!noticeOpen && !noRejectionApproved) return { state: 'notice-expired', mayTakeControl: false,
    noticeOpen: false, canWorkInBackground: true, autoApproved: false };
  const activity = sessionActivity(nativeStatus);
  const idleApproved = activity === 'idle-observed';
  // Either trigger approves under the owner's standing grant. Once approved,
  // the controller may exclude physical input for the bounded lease.
  const autoApproved = idleApproved || noRejectionApproved;
  return { state: autoApproved ? 'owner-authorized-auto' :
      activity === 'recent-input' ? 'manager-active' : 'activity-unknown',
    // Once either predicate fires, the physical-input lock is acquired.
    mayTakeControl: autoApproved, lockPhysicalInput: autoApproved,
    autoApproved, noticeOpen, canWorkInBackground: true,
    noRejectionApproved, idleApproved, activity };
}


export function sessionActivity(status) {
  const ms = status?.idleMs;
  if (!Number.isSafeInteger(ms) || ms < 0) return 'unknown';
  return ms < GUI_PHYSICAL_IDLE_THRESHOLD_MS ? 'recent-input' : 'idle-observed';
}

export function prepareGuiLease(input, nativeStatus, { standingOwnerGrant = false } = {}) {
  if (nativeStatus?.managerRejected === true) throw guiError('GUI_MANAGER_DECLINED');
  const activity = sessionActivity(nativeStatus);
  const automaticTakeover = input.mode === undefined &&
    standingOwnerGrant === true &&
    (activity === 'idle-observed' || activity === 'recent-input');
  const mode = input.mode ?? (automaticTakeover ? 'takeover' : 'observe');
  if (mode !== 'takeover') return {
    mode: 'observe', durationSeconds: input.ttlSeconds ?? 60,
    authorization: 'observe-only', activity
  };
  if (!automaticTakeover &&
      (typeof input.explicitUserAuthorization !== 'string' ||
       input.explicitUserAuthorization.trim().length < 8)) {
    throw guiError('GUI_EXPLICIT_TAKEOVER_AUTHORIZATION_REQUIRED');
  }
  // A standing owner grant permits an explicit native 60-second notice
  // when the manager is active; silence after that notice is the second
  // independent automatic-approval predicate. Unknown activity still fails closed.
  const hasCurrentOwnerApproval = typeof input.explicitUserAuthorization === 'string' &&
    input.explicitUserAuthorization.trim().length >= 8;
  if (!automaticTakeover && !hasCurrentOwnerApproval)
    throw guiError(activity === 'unknown' ? 'GUI_MANAGER_ACTIVITY_UNKNOWN' : 'GUI_EXPLICIT_TAKEOVER_AUTHORIZATION_REQUIRED');
  const durationSeconds = input.estimatedTaskSeconds === undefined
    ? (input.ttlSeconds ?? 60)
    : Math.min(GUI_TAKEOVER_MAX_SECONDS, input.estimatedTaskSeconds * 2);
  return { mode: 'takeover', durationSeconds,
    authorization: automaticTakeover ? (activity === 'idle-observed'
      ? 'owner-persisted-idle' : 'owner-persisted-notice') : 'per-call',
    activity, noticeRequired: activity !== 'idle-observed' };
}
