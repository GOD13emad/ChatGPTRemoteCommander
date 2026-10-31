// Workspace routing: choose the least-interfering lawful control surface first.
// A failed/uncertain target MUST NOT disable other windows or the physical desktop.
const OPTIONS=new Set(['existing-browser','new-browser','existing-app','new-app']);
const DESKTOPS=new Set(['windows','x11','wayland','headless']);
const no=(code,detail)=>({code,detail});
export function chooseWorkspaceRoute(input){
  if(!input||!OPTIONS.has(input.target))throw Error('WORKSPACE_TARGET_INVALID');
  const desktop=input.desktop??'headless';
  if(!DESKTOPS.has(desktop))throw Error('WORKSPACE_DESKTOP_INVALID');
  const owner=input.sameUserSession===true;
  const isolated=input.target.startsWith('new-');
  // Existing authentication is the default; a new isolated login must be
  // explicitly requested, never inferred from "open the app/browser".
  const reuseAuthentication=input.requireExistingAuthentication!==false;
  const result={schema:1,target:input.target,desktop,physicalMouse:'UNCHANGED',
    physicalKeyboard:'UNCHANGED',foreground:'PRESERVE',globalInputLock:false,
    independentTargetsRemainUsable:true,viewer:'READ_ONLY_NONINTERACTIVE',
    credentials:'NEVER_EXPORT_OR_CLONE',attemptedInput:false,
    reuseAuthenticationByDefault:reuseAuthentication,
    credentialFallbackOrder:['EXISTING_OWNER_SESSION','NORMAL_OWNER_APP_PROFILE',
      'BROWSER_NATIVE_CONSENTED_ATTACH','NATIVE_ACCESSIBILITY',
      'BROWSER_MANAGED_AUTOFILL','OS_NATIVE_CREDENTIAL_UI','USER_SIGN_IN_LAST_RESORT'],
    passwordPromptPolicy:'ONLY_AFTER_SAVED_LOGIN_AND_CREDENTIAL_OPTIONS_VERIFIED_ABSENT',
    credentialStoreProbe:'NO_SECRET_READS',nativeConsent:'PRESERVE'};
  if(input.target==='existing-browser'){
    if(!owner)return {...result,route:'OWNER_SESSION_BRIDGE_REQUIRED',
      next:'Connect authorized same-user desktop agent, not SYSTEM/Session 0'};
    // CUA native CDP attachment is not release-accepted for Brave/Firefox.
    // An exact owner AX window may be usable without copying the login profile;
    // neither inspection nor a plan grants permission for background input.
    if(['brave','firefox'].includes(input.browserEngine))
      return {...result,route:'OWNER_BROWSER_ACCESSIBILITY_CANDIDATE',
        authenticationPolicy:'REUSE_OWNER_EXISTING_SESSION_ONLY',
        inspectionStatus:'NOT_EXECUTED',inputStatus:'NATIVE_APPROVAL_REQUIRED',
        backgroundControl:'CAPABILITY_UNVERIFIED',
        next:'Observe exact owner window via native AX; use targeted background semantic actions only if driver permits and explicitly authorized; never clone profile or force debugging'};
    if(input.existingProfileGrant!==true)return {...result,route:'PROFILE_ATTACH_AUTHORIZATION_REQUIRED',
      next:'Use browser-native consent and driver existing-profile grant; no cookie/profile copy'};
    return {...result,route:'CUA_EXISTING_BROWSER_CDP',inputMode:'BACKGROUND_TARGETED',
      note:'Browser must support the requested profile attachment; browser_prepare may refuse'};
  }
  // The owner may request opening an application WITHOUT signing into an
  // unrelated automation profile. This is a plan, not an authorization to start
  // a process or a claim that the existing site's login has been verified.
  if(reuseAuthentication&&isolated){
    if(!owner)return {...result,route:'OWNER_SESSION_BRIDGE_REQUIRED',
      authenticationPolicy:'SAME_OWNER_SESSION_REQUIRED',
      next:'Connect authorized original-user session; do not use another account or copied credentials'};
    return {...result,route:input.target==='new-browser'?
        'OWNER_NATIVE_BROWSER_LAUNCH_REQUIRED':'OWNER_NATIVE_APP_LAUNCH_REQUIRED',
      authenticationPolicy:'REUSE_OWNER_EXISTING_SESSION_ONLY',
      launchStatus:'NOT_EXECUTED',foreground:'UNVERIFIED_UNTIL_LAUNCH',
      inputMode:'NATIVE_SAME_USER_LAUNCH_THEN_TARGET_VERIFICATION',
      backgroundControl:'REQUIRES_EXACT_WINDOW_AND_NATIVE_CONSENT',
      profilePolicy:'NO_PROFILE_COPY_NO_DEBUG_FLAGS_NO_PASSWORD_EXPORT',
      next:'Request a supported owner-session launcher, open the normally installed app under the same user, verify exact window and authentication; never start a fresh automation profile'};
  }
  if(input.target==='new-browser')
    return {...result,route:'COMMANDER_OWNED_PERSISTENT_PROFILE',inputMode:'BACKGROUND_CDP',
      note:'Login once in this distinct owner profile if needed; reuse only that profile'};
  if(input.target==='existing-app'){
    if(!owner)return {...result,route:'OWNER_SESSION_BRIDGE_REQUIRED',
      next:'Run the GUI driver under the owning user; do not open global input ACL'};
    if(input.backgroundCapability===false)
      return {...result,route:'BACKGROUND_UNAVAILABLE_TARGET_ONLY',fallback:'PRIVATE_APP_INSTANCE_OR_EXPLICIT_FOREGROUND',
        note:'Do not transfer a running app to another desktop or block other targets'};
    return {...result,route:'CUA_BACKGROUND_WINDOW',inputMode:'AX_FIRST_THEN_BACKGROUND_PIXEL',
      note:desktop==='wayland'?'AT-SPI only where addressable; no raw background seat injection':'Never move physical cursor or steal focus'};
  }
  return {...result,route:desktop==='windows'?'OWNER_ACCOUNT_SECONDARY_DESKTOP_OR_APP_INSTANCE':desktop==='headless'?'HEADLESS_APP_OR_BROWSER':'PRIVATE_X11_DISPLAY',
    inputMode:'ISOLATED_AGENT_CURSOR',
    note:'A separate instance may require app-supported session login; cannot assume reuse of another app login'};
}
export function classifyWorkspaceOutcome({effect,refusedCode,hasFreshObservation}={}){
  if(refusedCode==='background_unavailable'||refusedCode==='browser_input_trust_unavailable')
    return {status:'ROUTE_ALTERNATIVE_REQUIRED',scope:'TARGET_ONLY',retry:'DO_NOT_ESCALATE_TO_FOREGROUND_AUTOMATICALLY'};
  if(effect==='confirmed'&&hasFreshObservation===true)
    return {status:'CONFIRMED',scope:'TARGET_ONLY',retry:'NOT_NEEDED'};
  return {status:'RECONCILE_TARGET',scope:'TARGET_ONLY',retry:'OBSERVE_AND_DECIDE_NO_BLIND_REPLAY'};
}
