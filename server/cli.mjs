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

import { spawn } from 'node:child_process';
import { AppError } from './validation.mjs';

export function runCli(command, args, { cwd, label, input = '', signal, timeout = 120000, onLine } = {}) {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) return reject(new AppError('Question cancelled.', 499));
      const child = spawn(command, args, { cwd, env: { ...process.env }, stdio: ['pipe', 'pipe', 'pipe'] });
      child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
      let stdout = '', stderr = '', pendingLine = '', settled = false;
      const finish = (error, result) => {
        if (settled) return;
        settled = true; clearTimeout(timer); signal?.removeEventListener('abort', abort);
        error ? reject(error) : resolve(result);
      };
      const stop = () => { child.kill('SIGTERM'); const hard = setTimeout(() => child.kill('SIGKILL'), 2000); hard.unref(); };
      const abort = () => { stop(); finish(new AppError('Question cancelled.', 499)); };
      const timer = setTimeout(() => { stop(); finish(new AppError(`${label} took too long to respond. Try a narrower question.`, 504)); }, timeout);
      signal?.addEventListener('abort', abort, { once: true });
      child.stdout.on('data', data => {
        stdout += data;
        if (onLine && !settled) {
          pendingLine += data;
          const lines = pendingLine.split('\n'); pendingLine = lines.pop();
          for (const line of lines) {
            try { onLine(line); } catch (error) { stop(); finish(error); break; }
          }
        }
        if (stdout.length > 2000000) { stop(); finish(new AppError(`${label} response exceeded the local size limit.`, 502)); }
      });
      child.stderr.on('data', data => { if (stderr.length < 8000) stderr += data; });
      child.stdin.on('error', () => {});
      child.on('error', () => finish(new AppError(`${label} could not start. Check its installation in Admin.`, 503)));
      child.on('close', code => finish(null, { stdout, stderr, code }));
      child.stdin.end(input);
    });
  }
