#!/usr/bin/env node
// Run from the owner-local MMZ system, no modifications/no authentication.
import os from 'node:os';
import path from 'node:path';
import {inspectV2OAuthProvider} from '../src/v2-oauth-provider-readiness.mjs';
try{
 const status=await inspectV2OAuthProvider({
  file:path.join(os.homedir(),'.config','CommanderV2','oauth-provider.json')
 });
 process.stdout.write(JSON.stringify(status)+'\n');
 if(status.status!=='PUBLIC_PROVIDER_DISCOVERY_PASS_OWNER_LOGIN_PENDING')
  process.exitCode=2;
}catch(e){
 const error=e?.code?.startsWith('V2_')?e.code:'V2_OAUTH_PREFLIGHT_FAILED';
 process.stdout.write(JSON.stringify({
  status:error,oauthLoginVerified:false,ownerSessionVerified:false,
  privateToolsActivated:false
 })+'\n');
 process.exitCode=2;
}
