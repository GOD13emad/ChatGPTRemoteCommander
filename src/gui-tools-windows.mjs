import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const guiScript = path.resolve(here, '..', 'tools', 'gui-control.ps1');

function guiConfig(ctx) {
  if (process.platform !== 'win32') throw new Error('GUI Control is currently supported on Windows only');
  if (ctx.config.powerMode?.enabled !== true) throw new Error('Power Mode is disabled');
  const cfg = ctx.config.powerMode?.guiControl;
  if (cfg?.enabled !== true) throw new Error('GUI Control is disabled; re-run installer with -PowerMode -GuiControl');
  return cfg;
}

async function invokeGui(ctx, request, timeoutMs = 20000) {
  guiConfig(ctx);
  const child = spawn('pwsh.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-File', guiScript], {
    windowsHide: true,
    stdio: ['pipe', 'pipe', 'pipe']
  });

  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => { stdout += chunk.toString('utf8'); });
  child.stderr.on('data', (chunk) => { stderr += chunk.toString('utf8'); });
  child.stdin.end(JSON.stringify(request));

  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; child.kill(); }, timeoutMs);
  const code = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', resolve);
  });
  clearTimeout(timer);

  if (timedOut) throw new Error('GUI helper timed out');
  if (code !== 0) throw new Error(stderr.trim() || stdout.trim() || ('GUI helper exited ' + code));
  const line = stdout.trim().split(/\r?\n/).filter(Boolean).at(-1);
  if (!line) throw new Error('GUI helper returned no JSON');
  return JSON.parse(line);
}

function cap(cfg, key) {
  if (cfg[key] !== true) throw new Error('GUI capability disabled by policy: ' + key);
}

const ro = { readOnlyHint: true, destructiveHint: false, openWorldHint: false };
const act = { readOnlyHint: false, destructiveHint: false, openWorldHint: true };

export const guiToolDefinitions = [
  {
    name: 'gui_status',
    description: 'Report Windows interactive desktop and monitor geometry for GUI Control.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: ro
  },
  {
    name: 'gui_screenshot',
    description: 'Capture the live Windows desktop or one monitor and return an MCP image plus coordinate metadata.',
    inputSchema: {
      type: 'object',
      properties: {
        screenIndex: { type: 'integer', minimum: -1, maximum: 32 },
        format: { type: 'string', enum: ['jpeg', 'png'] },
        quality: { type: 'integer', minimum: 25, maximum: 95 }
      },
      additionalProperties: false
    },
    annotations: ro
  },
  {
    name: 'gui_cursor_position',
    description: 'Return the current Windows mouse cursor position.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: ro
  },
  {
    name: 'gui_mouse_move',
    description: 'Move the mouse using absolute desktop coordinates or normalized relative coordinates.',
    inputSchema: {
      type: 'object',
      properties: {
        x: { type: 'number' },
        y: { type: 'number' },
        coordinateMode: { type: 'string', enum: ['absolute', 'relative'] },
        screenIndex: { type: 'integer', minimum: -1, maximum: 32 }
      },
      required: ['x', 'y'],
      additionalProperties: false
    },
    annotations: act
  },
  {
    name: 'gui_mouse_delta',
    description: 'Move the mouse by a relative dx/dy delta, useful for pointer-look style interactions.',
    inputSchema: {
      type: 'object',
      properties: {
        dx: { type: 'integer', minimum: -10000, maximum: 10000 },
        dy: { type: 'integer', minimum: -10000, maximum: 10000 }
      },
      required: ['dx', 'dy'],
      additionalProperties: false
    },
    annotations: act
  },
  {
    name: 'gui_mouse_scroll',
    description: 'Send vertical or horizontal mouse-wheel input.',
    inputSchema: {
      type: 'object',
      properties: {
        delta: { type: 'integer', minimum: -12000, maximum: 12000 },
        horizontal: { type: 'boolean' }
      },
      required: ['delta'],
      additionalProperties: false
    },
    annotations: act
  },
  {
    name: 'gui_mouse_click',
    description: 'Move to a desktop or normalized relative coordinate and click a mouse button.',
    inputSchema: {
      type: 'object',
      properties: {
        x: { type: 'number' },
        y: { type: 'number' },
        coordinateMode: { type: 'string', enum: ['absolute', 'relative'] },
        screenIndex: { type: 'integer', minimum: -1, maximum: 32 },
        button: { type: 'string', enum: ['left', 'right', 'middle'] },
        clicks: { type: 'integer', minimum: 1, maximum: 10 },
        intervalMs: { type: 'integer', minimum: 20, maximum: 2000 }
      },
      required: ['x', 'y'],
      additionalProperties: false
    },
    annotations: act
  },
  {
    name: 'gui_mouse_drag',
    description: 'Drag the mouse between two absolute or relative positions.',
    inputSchema: {
      type: 'object',
      properties: {
        from: { type: 'object' },
        to: { type: 'object' },
        button: { type: 'string', enum: ['left', 'right', 'middle'] },
        durationMs: { type: 'integer', minimum: 50, maximum: 10000 },
        steps: { type: 'integer', minimum: 2, maximum: 120 }
      },
      required: ['from', 'to'],
      additionalProperties: false
    },
    annotations: act
  },
  {
    name: 'gui_type_text',
    description: 'Type Unicode text into the currently focused Windows application.',
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string', maxLength: 4096 },
        intervalMs: { type: 'integer', minimum: 0, maximum: 1000 }
      },
      required: ['text'],
      additionalProperties: false
    },
    annotations: act
  },
  {
    name: 'gui_key_press',
    description: 'Press a key or key combination such as CTRL+L, ALT+TAB, ENTER, arrows, WASD, or function keys; holdMs supports sustained input.',
    inputSchema: {
      type: 'object',
      properties: {
        keys: { type: 'array', minItems: 1, maxItems: 8, items: { type: 'string' } },
        holdMs: { type: 'integer', minimum: 0, maximum: 5000 }
      },
      required: ['keys'],
      additionalProperties: false
    },
    annotations: act
  },
  {
    name: 'gui_list_windows',
    description: 'List visible top-level Windows desktop windows with title, handle, and PID.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: ro
  },
  {
    name: 'gui_focus_window',
    description: 'Restore and focus a visible Windows window by handle or title substring.',
    inputSchema: {
      type: 'object',
      properties: {
        handle: { type: 'integer' },
        titleContains: { type: 'string' }
      },
      additionalProperties: false
    },
    annotations: act
  }
];

export async function executeGuiTool(ctx, name, input) {
  const cfg = guiConfig(ctx);
  switch (name) {
    case 'gui_status':
      return { ...(await invokeGui(ctx, { action: 'status' })), policy: cfg };
    case 'gui_screenshot': {
      cap(cfg, 'allowScreenshot');
      const result = await invokeGui(ctx, { action: 'screenshot', ...input }, 30000);
      const { data, mimeType, ...meta } = result;
      return {
        __mcpContent: [
          { type: 'image', data, mimeType },
          { type: 'text', text: JSON.stringify(meta) }
        ],
        __structuredContent: meta
      };
    }
    case 'gui_cursor_position':
      return invokeGui(ctx, { action: 'cursor' });
    case 'gui_mouse_move':
      cap(cfg, 'allowMouse');
      return invokeGui(ctx, { action: 'move', ...input });
    case 'gui_mouse_delta':
      cap(cfg, 'allowMouse');
      return invokeGui(ctx, { action: 'moveRelative', ...input });
    case 'gui_mouse_scroll':
      cap(cfg, 'allowMouse');
      return invokeGui(ctx, { action: 'scroll', ...input });
    case 'gui_mouse_click':
      cap(cfg, 'allowMouse');
      return invokeGui(ctx, { action: 'click', ...input });
    case 'gui_mouse_drag':
      cap(cfg, 'allowMouse');
      return invokeGui(ctx, { action: 'drag', ...input });
    case 'gui_type_text':
      cap(cfg, 'allowKeyboard');
      return invokeGui(ctx, { action: 'typeText', ...input });
    case 'gui_key_press':
      cap(cfg, 'allowKeyboard');
      return invokeGui(ctx, { action: 'keyPress', ...input });
    case 'gui_list_windows':
      cap(cfg, 'allowWindowFocus');
      return invokeGui(ctx, { action: 'listWindows' });
    case 'gui_focus_window':
      cap(cfg, 'allowWindowFocus');
      return invokeGui(ctx, { action: 'focusWindow', ...input });
    default:
      throw Object.assign(new Error('Unknown GUI tool: ' + name), { rpcCode: -32602 });
  }
}
