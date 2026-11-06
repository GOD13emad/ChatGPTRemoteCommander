import assert from 'node:assert/strict';import{readFileSync}from'node:fs';import{createHash}from'node:crypto';import{pathToFileURL}from'node:url';
const verifier=process.argv[3];assert.equal(createHash('sha256').update(readFileSync(verifier)).digest('hex'),'69fca49dc6cfd0e885d57aec2bd8c414961c99768c73f6f29196d40344e7adec');
const{createLocalResourceGrantVerifier}=await import(pathToFileURL(verifier));const f=JSON.parse(readFileSync(process.argv[2],'utf8'));assert.equal(f.realOwnerEnrollment,false);
const v=createLocalResourceGrantVerifier({issuer:'https://issuer.invalid/',resource:'https://resource.invalid/mcp',ownerId:'fixture-owner',enrollmentEpoch:'epoch:fixture',keyId:'issuer:fixture',publicKeyPem:f.publicKeyPem});
const expected={clientId:f.clientId,profileId:'fixture',rootPolicyId:'fixture-root',action:'read_text',requiredScopes:['commander:read']};
const result=v.verify({accessToken:f.accessToken,stateEnvelope:f.activeState,expected});assert.equal(result.nativeActionAuthorized,false);assert.equal(result.conversationIdentityAuthenticated,false);
assert.throws(()=>v.verify({accessToken:f.accessToken,stateEnvelope:f.revokedState,expected}),e=>e.code==='LOCAL_AUTH_GRANT_REVOKED');
assert.throws(()=>v.verify({accessToken:f.accessToken,stateEnvelope:f.activeState,expected}),e=>['LOCAL_AUTH_STATE_ROLLBACK_OR_EQUIVOCATION','LOCAL_AUTH_GRANT_REVOKED'].includes(e.code));
console.log(JSON.stringify({schema:'r78-protected-oauth-parent-resource-interop-v1',status:'PASS_FIXED_NATIVE_ISSUANCE_PARENT_RESOURCE_VERIFIER',uniqueCases:1,activeAccepted:true,revokedRejected:true,olderActiveRejected:true,ownerEnrollment:false,fixtureTokensOnly:true,nativeActionAuthorized:false}));
