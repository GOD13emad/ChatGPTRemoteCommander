# R80 ingress clarification — bounded read-only review

Result: an owned public HTTPS MCP domain and an external identity provider are
not prerequisites for the existing private Commander connection or a local
ControlCenter owner login. Real ChatGPT OAuth remains a distinct, unproven
flow whose authorization-server reachability must be established rather than
assumed. No installed transport, setting, account, network, task or job changed.

## Confirmed official transport boundary

Secure MCP Tunnel connects private MCP servers using outbound HTTPS and an
OpenAI-hosted MCP endpoint. The configured local server need not expose a
public listener. OAuth discovery can traverse that path, but the authorization
server is not automatically tunneled. Consequently, successful MCP readiness
alone does not demonstrate that the browser and token-exchange components can
reach an issuer. A private developer plugin and a public directory submission
have different endpoint requirements; a public submission requires public
HTTPS. These statements do not imply that an operator must buy a domain.
[Official Secure MCP Tunnel documentation](https://developers.openai.com/api/docs/guides/secure-mcp-tunnels)

ChatGPT custom MCP setup explicitly offers Connection: Tunnel separately from
a Server URL and then configures authentication. Existing managed-tunnel
metadata, not a guessed public address derived from a loopback port, is the
correct connection authority.
[Official custom MCP setup](https://developers.openai.com/api/docs/guides/custom-mcp-server)

For actual ChatGPT OAuth, resource metadata identifies the selected issuer;
authorization-server metadata supplies authorization/token endpoints, PKCE
and client authentication. Callback issuer identification requires the exact
issuer in both successful and error responses. CIMD supports an OpenAI-managed
client assertion verified with its public JWKS; the application does not need
an OpenAI private key. The exact connection client metadata and redirect URI
must come from that connection's management page.
[Official plugin authentication](https://developers.openai.com/plugins/build/auth)

## Existing Commander source evidence

The inspected installed-source authority is Saeed R75 candidate, commit
51848ade674c7a6e3975fa28f88f882ee53058f0, as recorded by CURRENT.json.
Its README describes account-specific Secure MCP Tunnel profiles and a
loopback MCP server. SETUP.en.md points to Platform tunnel settings and the
private Tunnel / No authentication setup. This is source guidance, not a new
independent readback of the active plugin's present authentication setting.

Installed-source server-v0.3.mjs handles GET /health and POST /mcp; other
paths return404. It does not implement an authorization server or browser
OAuth endpoint at this server boundary. The R78 candidate's OAuth metadata
module explicitly says it installs no listener/route/flow; its HTTPS/443
validation is a source contract for its proposed protected-resource profile,
not evidence of an installed external front door.

COMMANDER_ARCHITECTURE.md defines Control Center as a consumer of the
coordinator API, with identity/security separate from transport. A local
Windows owner enrolment/consent is therefore not equivalent to a ChatGPT
OAuth account link, a bearer-authorized MCP call or authenticated chat identity.

Source tunnel-client-pin.json names0.0.15. Parent supplied current runtime
facts identify0.0.14. These are distinct authorities; this review neither
declares a live upgrade nor runs doctor/refresh/restart to reconcile them.
Likewise the parent's profile loopback target/ready200 and disabled Coucou
bridge are parent-provided sanitized observations, not independently probed
here. Coucou's source contract is unrelated hook-event relay, not ingress.

## Product decision

1. Local ControlCenter owner login / native consent: continue the reviewed
   R80 enrollment and protected selftest without inventing an external IdP,
   paid domain or public-listener dependency. Local acceptance must still
   prove its real OS identity, protected keys, consent and rollback.
2. Existing private managed MCP connection: preserve its current tunnel and
   routing. A missing customer-owned public origin is not itself a defect.
3. ChatGPT OAuth linking: still OPEN. Current native issuer/probe identifiers
   under commander.invalid are test namespaces, not deployed HTTP endpoints.
   No browser/token-server path or cloud-reachable authorization service was
   established by this review. Do not relabel native selftest as ChatGPT OAuth.
4. Public plugin publication: a separate future endpoint/distribution gate,
   not a reason to block the local owner's current product.

## Safe exact discovery surface and smallest next step

No exact external issuer/origin can be recovered from the inspected local
source or the parent's sanitized loopback fields. Do not derive one from
47831,47832, a Tunnel ID, an OpenAI polling host or the placeholder policies.

When the ChatGPT OAuth gate becomes ready, inspect only the existing tunnel
entry at Platform organization tunnel settings and the existing Commander's
ChatGPT plugin management page. Record Connection: Tunnel, the intended
organization/workspace association and public metadata/redirect identifiers;
do not export keys, profile raw values, account data or request logs. The
official settings surface is:
https://platform.openai.com/settings/organization/tunnels

The tunnel's loopback admin /ui is documented as a readiness/tunnel-metadata
surface. Its presence on the actually installed0.0.14 binary remains
unverified here; do not upgrade or open a new listener to obtain it. Even if
available, it cannot prove browser OAuth reachability.

Then draw the actual caller path for discovery, browser authorization and code
exchange. Admit an existing supported transport for each component, retaining
exact issuer/resource/client bindings. If no authorization endpoint is
reachable by the required caller, that specific transport is the blocker.
Creating or exposing a new endpoint would require its own reviewed change;
this report authorizes none. No other apps, credentials or live chats were
contacted during this investigation.

Status: READ_ONLY_ARCHITECTURE_CLARIFIED; local owner domain/IdP dependency
removed as an unsupported assumption; real ChatGPT OAuth ingress UNPROVEN.
