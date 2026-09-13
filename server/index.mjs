import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { Store } from './store.mjs';
import { McpBridge } from './mcp.mjs';
import { ClaudeProvider } from './claude.mjs';
import { OpenAIProvider } from './openai.mjs';
import { ProviderManager } from './providers.mjs';
import { createApp } from './app.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export function findClientId() {
  if (process.env.ANAPLAN_CLIENT_ID) return process.env.ANAPLAN_CLIENT_ID;
  // Reuse only the existing public Anaplan OAuth client ID, never credentials or unrelated MCP configuration.
  try {
    const config = readFileSync(join(homedir(), '.codex/config.toml'), 'utf8');
    const section = config.match(/\[mcp_servers\.anaplan\.env\]([^]*?)(?=\n\[|$)/)?.[1];
    return section?.match(/^ANAPLAN_CLIENT_ID\s*=\s*"([^"\n]+)"/m)?.[1] ?? '';
  } catch { return ''; }
}
export async function start() {
  const directory = join(root, '.local');
  const store = new Store(directory);
  const mcp = new McpBridge({ directory: resolve(process.env.XANAPLAN_MCP_DIR || join(root, '../anaplan-mcp')), clientId: () => store.data.anaplanClientId || findClientId() });
  const runnerDirectory = join(directory, 'runner');
  mkdirSync(runnerDirectory, { recursive: true, mode: 0o700 });
  const defaultClaude = join(homedir(), '.local/bin/claude');
  const defaultCodex = ['/opt/homebrew/bin/codex', '/usr/local/bin/codex'].find(existsSync) ?? 'codex';
  const providers = new ProviderManager({
    store,
    claude: new ClaudeProvider({ command: process.env.XANAPLAN_CLAUDE_COMMAND || (existsSync(defaultClaude) ? defaultClaude : 'claude'), cwd: runnerDirectory }),
    openai: new OpenAIProvider({ command: process.env.XANAPLAN_CODEX_COMMAND || defaultCodex }),
  });
  const port = 8766;
  const server = createApp({ store, mcp, providers, port });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  writeFileSync(join(root, 'extension/local-config.js'), `// Generated locally by npm start. Do not share or commit.\nexport const connection = ${JSON.stringify({ baseUrl: `http://127.0.0.1:${port}`, token: store.data.token })};\n`, { mode: 0o600 });
  console.log('Xanaplan local helper is running.\nLoad the extension folder in Chrome, then click Xanaplan beside your Anaplan tab.\nPress Ctrl+C to stop.');
  const stop = () => { server.closeAllConnections(); server.close(); mcp.reset().finally(() => process.exit(0)); };
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
  return server;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) start().catch(error => {
  console.error(error.code === 'EADDRINUSE' ? 'Xanaplan is already running on port 8766.' : 'Could not start Xanaplan: ' + error.message);
  process.exitCode = 1;
});
