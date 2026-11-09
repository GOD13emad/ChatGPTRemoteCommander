/**
 * Apply current-profile owner authorization and explicit capability opt-outs
 * to the runtime's user-token capabilities. Neither this module nor profile
 * configuration proves ChatGPT caller identity, OS elevation, or J01 consent.
 */
export function hasAuthorizedFullPower(config) {
  const profile = config?.capabilityProfile;
  return config?.powerMode?.enabled === true
    && (profile?.tier === 'FULL_POWER' || profile?.tier === 'FULL_ACCESS')
    && profile.explicitlyAuthorized === true;
}

function capabilityGranted(config, name) {
  return hasAuthorizedFullPower(config)
    && !(config?.capabilityProfile?.disabledCapabilities ?? []).includes(name);
}

export function hasEffectiveFullFilesystem(config) {
  return config?.powerMode?.fullFilesystem === true
    && capabilityGranted(config, 'filesystem.full');
}

export function effectivePowerMode(config) {
  const raw = config?.powerMode ?? {};
  const gui = raw.guiControl ?? {};
  const browser = raw.browserControl ?? {};
  const mouse = gui.allowMouse === true && capabilityGranted(config, 'gui.mouse');
  const keyboard = gui.allowKeyboard === true && capabilityGranted(config, 'gui.keyboard');
  const screenshot = gui.allowScreenshot === true && capabilityGranted(config, 'gui.screenshot');
  const focus = gui.allowWindowFocus === true && capabilityGranted(config, 'gui.window_focus');
  const browserBackground = browser.enabled === true && capabilityGranted(config, 'browser.background');
  const processControl = raw.allowProcessControl === true && capabilityGranted(config, 'process.control');
  const shellExecution = raw.allowShell === true && capabilityGranted(config, 'shell.execute');

  return {
    ...raw,
    fullFilesystem: hasEffectiveFullFilesystem(config),
    allowShell: shellExecution,
    allowProcessControl: processControl,
    allowProcessTerminate: processControl && capabilityGranted(config, 'process.terminate'),
    allowPersistentTerminal: processControl && shellExecution && capabilityGranted(config, 'terminal.persistent'),
    allowPermanentDelete: raw.allowPermanentDelete === true && capabilityGranted(config, 'filesystem.permanent_delete'),
    blockedShellPatterns: capabilityGranted(config, 'shell.unrestricted')
      ? raw.blockedShellPatterns : ['.*'],
    guiControl: {
      ...gui,
      enabled: gui.enabled === true && (mouse || keyboard || screenshot || focus),
      allowMouse: mouse, allowKeyboard: keyboard,
      allowWindowFocus: focus, allowScreenshot: screenshot,
      ownerAuthorizedTakeover: gui.ownerAuthorizedTakeover === true && mouse && keyboard
    },
    browserControl: {
      ...browser,
      enabled: browserBackground,
      allowInput: browser.allowInput === true && capabilityGranted(config, 'browser.input'),
      allowNavigate: browser.allowNavigate === true && capabilityGranted(config, 'browser.navigate'),
      allowScreenshot: browser.allowScreenshot === true && capabilityGranted(config, 'browser.screenshot'),
      userBrowserProfileReuse: false
    }
  };
}
