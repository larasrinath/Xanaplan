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

// These labels describe actual operations. Never forward provider reasoning,
// prompts, raw tool arguments, or data through the progress channel.
const reads = {
  show_modules: 'Locating the data', show_moduledetails: 'Checking how the figures are organized',
  show_lineitems: 'Identifying relevant figures and formulas', show_savedviews: 'Locating saved figures', show_allviews: 'Locating the data',
  show_viewdetails: 'Checking view dimensions', show_lists: 'Finding model lists',
  get_list_items: 'Reading list members', show_dimensionitems: 'Reading dimension members',
  show_viewdimensionitems: 'Checking members in the selected view',
  show_lineitem_dimensions: 'Checking line-item dimensions',
  show_lineitem_dimensions_items: 'Checking line-item members',
  lookup_dimensionitems: 'Looking up matching dimension members',
  show_currentperiod: 'Checking the current period', show_modelcalendar: 'Checking the model calendar',
  show_versions: 'Checking available forecasts and plans', read_cells: 'Pulling the latest numbers from Anaplan',
  read_module_cells: 'Gathering the underlying figures', follow_formula: 'Checking how the figures are calculated',
};
export function readProgress(tool, readCount) {
  return { stage: 'read', message: reads[tool] || 'Reading Anaplan data', readCount };
}

export function createChatStream(res, { heartbeatMs = 10000 } = {}) {
  const started = Date.now();
  res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
  res.writeHead(200);
  res.flushHeaders?.();
  const emit = event => {
    if (!res.destroyed && !res.writableEnded) res.write(JSON.stringify({ ...event, elapsedMs: Date.now() - started }) + '\n');
  };
  const timer = setInterval(() => emit({ type: 'heartbeat' }), heartbeatMs);
  timer.unref?.();
  const cleanup = () => clearInterval(timer);
  res.once('close', cleanup);
  return {
    progress: event => emit({ ...event, type: 'progress' }),
    finish(type, data) { cleanup(); emit({ type, ...data }); if (!res.destroyed) res.end(); },
  };
}
