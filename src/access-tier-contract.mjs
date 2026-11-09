/**
 * V102: the only active human- and machine-readable access tier vocabulary.
 * This is normative product policy, NOT an authorization grant. Runtime
 * identity, owner-scoped grants, OS token, broker and session checks remain
 * independent and must never be bypassed by a tier name.
 *
 * Historical R4 definitions remain in Git for provenance, but are superseded.
 */
export const ACCESS_TIER_CONTRACT_ID = 'V102-OWNER-ACCESS-TIER-SEMANTICS-20261109';
export const ACCESS_TIER_CONTRACT_URL =
  'https://app.notion.com/p/410d5b4a86f6813c88dcd3e68ed10833';

const deepFreeze = value => {
  for (const child of Object.values(value)) {
    if (child !== null && typeof child === 'object') deepFreeze(child);
  }
  return Object.freeze(value);
};

export const ACCESS_TIER_DEFINITIONS = deepFreeze({
  STANDARD: {
    name: 'STANDARD',
    descriptionFa: 'دقیقاً یک پروفایل مرورگر اختصاصی و پایدار؛ دسترسی به سایر فایل‌ها، برنامه‌ها و منابع با مجوز یک‌باره یا دائمیِ محدود و قابل‌لغو.',
    descriptionEn: 'Exactly one persistent dedicated browser profile; access to other files, applications and computer resources requires a one-time or durable, precisely scoped, revocable owner grant.',
    browserProfiles: 'one-persistent-dedicated',
    ownerGui: 'requires-scope-specific-owner-grant',
    filesystemAndApplications: 'scope-specific-owner-grant',
    nativeOsPrivilege: 'not-persistently-elevated',
    privilegedActions: 'native-approval-if-required'
  },
  FULL_POWER: {
    name: 'FULL_POWER',
    descriptionFa: 'تمام برنامه‌ها، فایل‌ها، کنترل GUI و پروفایل‌های مرورگرِ همان مالک در سطح کاربر؛ فقط عملیات نیازمند Administrator/Root تأیید بومی موردی می‌خواهند.',
    descriptionEn: 'All same-owner user-level files, applications, GUI actions and existing browser profiles; native Administrator/Root approval is required only for genuinely elevated OS actions.',
    browserProfiles: 'all-existing-same-owner',
    ownerGui: 'same-owner-session',
    filesystemAndApplications: 'same-owner-user-token',
    nativeOsPrivilege: 'ordinary-owner-token',
    privilegedActions: 'native-approval-per-elevated-operation'
  },
  FULL_ACCESS: {
    name: 'FULL_ACCESS',
    descriptionFa: 'تأیید بومی اولیه و نصب Broker ممتاز پایدار Administrator/SYSTEM یا Root همراه با Worker نشست همان مالک؛ عملیات محلیِ تحت پوشش و GUI/مرورگر مالک بدون تأیید تکراری.',
    descriptionEn: 'One-time native owner enrollment of a persistent Administrator/SYSTEM or Root privileged broker paired with the same-owner interactive session worker; covered local actions, GUI and owner browser profiles do not require repeated approvals.',
    browserProfiles: 'all-existing-same-owner',
    ownerGui: 'same-owner-interactive-worker',
    filesystemAndApplications: 'same-owner-plus-authorized-privileged-broker',
    nativeOsPrivilege: 'persistent-native-admin-or-root-broker',
    privilegedActions: 'one-time-native-enrollment-for-covered-actions'
  }
});

export function accessTierContractSnapshot() {
  return {
    id: ACCESS_TIER_CONTRACT_ID,
    authority: ACCESS_TIER_CONTRACT_URL,
    policyOnly: true,
    configuredTierIsNotEffectiveTier: true,
    effectiveOsPrivilegeIsIndependent: true,
    ownerAccountBoundaryEnforced: true,
    noRawPasswordOrCookieExtraction: true,
    noExternalSideEffectGrantImplied: true,
    definitions: ACCESS_TIER_DEFINITIONS
  };
}
