/*
 * Copyright 2026 Lara Srinath
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { runCli } from './cli.mjs';
import { DECISION_SCHEMA, SYSTEM_PROMPT, validateDecision } from './llm-contract.mjs';
import { AppError } from './validation.mjs';

export class ClaudeProvider {
  constructor({ command = process.env.XANAPLAN_CLAUDE_COMMAND || 'claude', cwd }) { this.command = command; this.cwd = cwd; }
  run(args, input = '', signal, timeout = 120000) { return runCli(this.command, args, { cwd: this.cwd, label: 'Claude Code', input, signal, timeout }); }
  async status() {
    try {
      const result = await this.run(['auth', 'status', '--json'], '', undefined, 12000);
      const status = JSON.parse(result.stdout);
      return { installed: true, loggedIn: status.loggedIn === true, method: status.authMethod ?? 'unknown' };
    } catch { return { installed: false, loggedIn: false, method: 'unavailable' }; }
  }
  async decide(payload, signal, { model = '' } = {}) {
    const result = await this.run([
      ...(model ? ['--model', model] : []),
      '-p', '--output-format', 'json', '--json-schema', JSON.stringify(DECISION_SCHEMA),
      '--tools', '', '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}',
      '--safe-mode', '--setting-sources', '', '--disable-slash-commands', '--no-chrome',
      '--no-session-persistence', '--permission-prompts', 'none', '--system-prompt', SYSTEM_PROMPT,
    ], JSON.stringify(payload), signal);
    let output;
    try { output = JSON.parse(result.stdout); } catch {}
    if (result.code !== 0 || output?.is_error) {
      // Never forward raw CLI output: it can contain local paths, auth details or diagnostics unrelated to this model.
      if (/login|log in|sign in|authentication|not logged/i.test(result.stdout)) throw new AppError('Sign in to Claude Code with claude auth login, then check the connection.', 401, { code: 'CLAUDE_LOGIN' });
      if (/usage|limit|credit|quota/i.test(result.stdout)) throw new AppError('Claude reports a usage or credit limit. Check your Claude plan before trying again.', 429);
      throw new AppError('Claude could not answer. Check Claude Code in Terminal and retry.', 502);
    }
    return validateDecision(output?.structured_output, 'Claude');
  }
}
