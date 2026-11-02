// Keep the existing five scoped event suites as a single test invocation.
// This preserves all cases without exceeding Windows cmd.exe qualification limits.
import './mcp-delivery-event-bridge.test.mjs';
import './mcp-events-endpoint.test.mjs';
import './mcp-event-subscriptions.test.mjs';
import './mcp-events-security.test.mjs';
import './work-events-policy.test.mjs';
