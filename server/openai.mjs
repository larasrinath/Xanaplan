import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runCli } from './cli.mjs';
import { DECISION_SCHEMA, SYSTEM_PROMPT, validateDecision } from './llm-contract.mjs';
import { AppError } from './store.mjs';

// Verified against Codex CLI 0.154.0. Ignore personal configuration while preserving official CLI auth.
// Tools which can read local/private context, contact other services, or execute actions are disabled.
export const CODEX_DISABLED_FEATURES = [
  'shell_tool', 'unified_exec', 'view_image', 'apps', 'plugins', 'hooks', 'memories',
  'browser_use', 'browser_use_external', 'in_app_browser', 'computer_use', 'image_generation',
  'multi_agent', 'multi_agent_v2', 'workspace_dependencies', 'code_mode', 'code_mode_host',
  'shell_snapshot', 'skill_search', 'skill_mcp_dependency_install', 'goals', 'sleep_tool',
];
export function codexArguments(schemaPath, model = '') {
  return [
    'exec', '--ignore-user-config', '--ephemeral', '--skip-git-repo-check', '--sandbox', 'read-only',
    '--color', 'never', '--json', '--output-schema', schemaPath,
    '-c', 'approval_policy="never"', '-c', 'model_provider="openai"', '-c', 'web_search="disabled"',
    '-c', 'project_doc_max_bytes=0', '-c', 'mcp_servers={}',
    '-c', 'features.skip_host_skill_discovery=true',
    ...CODEX_DISABLED_FEATURES.flatMap(feature => ['--disable', feature]),
    ...(model ? ['--model', model] : []), '-',
  ];
}
export class OpenAIProvider {
  constructor({ command = process.env.XANAPLAN_CODEX_COMMAND || 'codex' } = {}) { this.command = command; }
  async status() {
    try {
      const result = await runCli(this.command, ['login', 'status'], { cwd: tmpdir(), label: 'Codex', timeout: 12000 });
      const output = result.stdout + result.stderr;
      return { installed: true, loggedIn: result.code === 0 && /logged in/i.test(output), method: /using ChatGPT/i.test(output) ? 'ChatGPT subscription' : /API key/i.test(output) ? 'API key' : 'not signed in' };
    } catch { return { installed: false, loggedIn: false, method: 'unavailable' }; }
  }
  async decide(payload, signal, { model = '' } = {}) {
    const directory = mkdtempSync(join(tmpdir(), 'xanaplan-inference-'));
    const schemaPath = join(directory, 'decision-schema.json');
    writeFileSync(schemaPath, JSON.stringify(DECISION_SCHEMA), { mode: 0o600 });
    let answer;
    try {
      const result = await runCli(this.command, codexArguments(schemaPath, model), {
        cwd: directory, label: 'OpenAI through Codex', signal,
        input: `${SYSTEM_PROMPT}\n\nBusiness request and supplied evidence (JSON):\n${JSON.stringify(payload)}`,
        onLine(line) {
          let event; try { event = JSON.parse(line); } catch { return; }
          if (event.type === 'item.started' || event.type === 'item.completed') {
            const type = event.item?.type;
            if (type && !['agent_message', 'reasoning', 'error'].includes(type)) throw new AppError('Codex attempted an unexpected tool action. The answer was stopped; check the local CLI version.', 502);
            if (type === 'agent_message' && event.type === 'item.completed') answer = event.item.text;
          }
        },
      });
      if (result.code !== 0) {
        const diagnostic = result.stdout + result.stderr;
        if (/not logged|login|log in|authentication|unauthorized/i.test(diagnostic)) throw new AppError('Sign in to OpenAI using codex login, then test the connection in Admin.', 401, { code: 'OPENAI_LOGIN' });
        if (/usage limit|credit|quota|rate.limit/i.test(diagnostic)) throw new AppError('OpenAI reports a usage or credit limit. Check your account and retry.', 429);
        if (/model.*(?:not found|not supported|does not exist|unavailable)|unknown model/i.test(diagnostic)) throw new AppError('The selected OpenAI model is unavailable for this connection. Check the model in Admin.', 422);
        throw new AppError('OpenAI could not answer through Codex. Check the selected model and CLI connection in Admin.', 502);
      }
      let decision; try { decision = JSON.parse(answer); } catch {}
      return validateDecision(decision, 'OpenAI');
    } finally { rmSync(directory, { recursive: true, force: true }); }
  }
}
