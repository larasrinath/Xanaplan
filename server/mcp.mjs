import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { AppError } from './validation.mjs';

// Deliberate allowlist, reviewed against the sibling project's handlers. New MCP tools are denied by default.
export const READ_TOOLS = new Set([
  'show_modules', 'show_moduledetails', 'show_lineitems', 'show_savedviews',
  'show_viewdetails', 'show_lists', 'get_list_items', 'show_dimensionitems',
  'show_viewdimensionitems', 'show_lineitem_dimensions', 'show_lineitem_dimensions_items',
  'lookup_dimensionitems', 'show_currentperiod', 'show_modelcalendar', 'show_versions', 'read_cells',
]);
const DISCOVERY_TOOLS = new Set(['show_workspaces', 'show_models']);
export function resultText(result) {
  return (result.content ?? []).filter(item => item.type === 'text').map(item => item.text).join('\n');
}
export function authorizationError(message) {
  if (!/Anaplan (?:OAuth re)?authorization required/i.test(message)) return null;
  const candidate = message.match(/(?:Click to authorize:|Go to:)\s*(https:\/\/\S+)/)?.[1];
  let url;
  try {
    const parsed = new URL(candidate);
    if (parsed.protocol === 'https:' && (parsed.hostname === 'anaplan.com' || parsed.hostname.endsWith('.anaplan.com'))) url = parsed.href;
  } catch {}
  return new AppError('Sign in to Anaplan, then select “Check sign-in” to continue.', 401, {
    code: 'ANAPLAN_LOGIN', ...(url ? { url } : {}), userCode: message.match(/Enter code:\s*(\S+)/)?.[1] ?? '',
  });
}
// The MCP's exploration tools return markdown tables, including a vertical layout for a single record.
export function parseChoices(text) {
  const lines = text.split('\n').filter(line => line.startsWith('|'));
  const cells = line => line.slice(1, -1).split('|').map(value => value.trim());
  if (!lines.length) return [];
  const header = cells(lines[0]);
  if (header[0] !== '#') {
    const fields = Object.fromEntries(lines.map(cells));
    if (!fields.ID || !fields.Name) throw new AppError('The MCP returned an unrecognized model list.', 502);
    return [{ id: fields.ID, name: fields.Name }];
  }
  return lines.slice(2).map(line => {
    const row = cells(line);
    if (row.length !== header.length) throw new AppError('A model or workspace name contains an unsupported table delimiter.', 502);
    const fields = Object.fromEntries(header.map((name, index) => [name, row[index]]));
    if (!fields.ID || !fields.Name) throw new AppError('The MCP returned an incomplete model list.', 502);
    return { id: fields.ID, name: fields.Name };
  });
}
export function scopeArguments(name, args, model, schema) {
  if (!READ_TOOLS.has(name)) throw new AppError('This action is unavailable in the read-only assistant.', 403);
  if (!args || typeof args !== 'object' || Array.isArray(args)) throw new AppError('Tool arguments must be an object.');
  const props = schema?.properties ?? {};
  if (!props.modelId) throw new AppError('This tool cannot be safely scoped to the selected model.', 403);
  const scoped = { ...args };
  for (const field of ['modelId', 'workspaceId']) {
    if (field in args && args[field] !== model[field]) throw new AppError('A question can only access its selected model.', 403);
    if (field in props) scoped[field] = model[field];
  }
  for (const key of Object.keys(scoped)) {
    if (!(key in props)) throw new AppError(`Unexpected argument: ${key}`);
  }
  if ('limit' in props) scoped.limit = Math.min(1000, Math.max(1, Number(scoped.limit) || 100));
  if (name === 'read_cells') scoped.maxRows = Math.min(1000, Math.max(1, Number(scoped.maxRows) || 500));
  return scoped;
}
export class McpBridge {
  constructor({ directory, clientId }) { this.directory = directory; this.clientId = clientId; this.connection = null; }
  available() { return existsSync(join(this.directory, 'dist/index.js')) && existsSync(join(this.directory, 'node_modules/@modelcontextprotocol/sdk')); }
  async connect() {
    if (!this.clientId()) throw new AppError('Add the Anaplan OAuth client ID in Connection settings.', 503);
    if (!this.available()) throw new AppError('Build the anaplan-mcp checkout first: npm install && npm run build.', 503);
    if (!this.connection) this.connection = this.open().catch(error => { this.connection = null; throw error; });
    return this.connection;
  }
  async open() {
    const require = createRequire(join(this.directory, 'package.json'));
    const [{ Client }, { StdioClientTransport }] = await Promise.all([
      import(pathToFileURL(require.resolve('@modelcontextprotocol/sdk/client/index.js'))),
      import(pathToFileURL(require.resolve('@modelcontextprotocol/sdk/client/stdio.js'))),
    ]);
    const transport = new StdioClientTransport({
      command: process.execPath, args: [join(this.directory, 'dist/index.js')], cwd: this.directory,
      env: { PATH: process.env.PATH ?? '', ANAPLAN_CLIENT_ID: this.clientId() }, stderr: 'pipe',
    });
    transport.stderr?.resume();
    const client = new Client({ name: 'xanaplan-local', version: '0.3.0' });
    await client.connect(transport);
    client.onclose = () => { this.connection = null; };
    const { tools } = await client.listTools();
    return { client, tools };
  }
  async reset() {
    const pending = this.connection;
    this.connection = null;
    if (pending) await pending.then(({ client }) => client.close()).catch(() => {});
  }
  async tools() {
    return (await this.connect()).tools.filter(tool => READ_TOOLS.has(tool.name) && tool.inputSchema.properties?.modelId);
  }
  async execute(name, args, signal) {
    const { client } = await this.connect();
    if (signal?.aborted) throw new AppError('Question cancelled.', 499);
    let result;
    try { result = await client.callTool({ name, arguments: args }, undefined, { timeout: 60000, signal }); }
    catch (error) { throw authorizationError(error.message) ?? new AppError('Anaplan could not complete this read. Check your connection and access.', 502); }
    const text = resultText(result);
    const auth = authorizationError(text);
    if (auth) throw auth;
    if (result.isError) throw new AppError(text.slice(0, 1500) || 'Anaplan read failed.', 502);
    return text;
  }
  async discover(name, args = {}) {
    if (!DISCOVERY_TOOLS.has(name)) throw new AppError('Discovery action unavailable.', 403);
    const text = await this.execute(name, { ...args, limit: 1000 });
    return { items: parseChoices(text), incomplete: /more not shown/.test(text) };
  }
  async read(name, args, model, signal) {
    const tool = (await this.tools()).find(tool => tool.name === name);
    if (!tool) throw new AppError('This tool is not available in the read-only assistant.', 403);
    const scoped = scopeArguments(name, args, model, tool.inputSchema);
    const text = await this.execute(name, scoped, signal);
    return { text, arguments: scoped };
  }
}
