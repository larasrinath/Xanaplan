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

const duration = ms => {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, '0')}s`;
};

export function createQuestionProgress(document, { now = Date.now, tickMs = 1000 } = {}) {
  const $ = id => document.getElementById(id);
  let started = null, lastUpdate = 0, lastStep = 0, timer, message = '', stage = '', count = 0;
  let hasData = false;
  const seen = new Set();
  const titles = { understand: 'Understanding the ask', find: 'Finding the data', work: 'Working through it', wrap: 'Wrapping up' };
  function phaseFor(event) {
    if (event.stage === 'read-complete' || event.readCount > 0) hasData = true;
    const phase = ['answer', 'saving'].includes(event.stage) ? 'wrap'
      : event.stage === 'read' ? 'find'
      : event.stage === 'read-complete' || (event.stage === 'ai' && hasData) ? 'work' : 'understand';
    seen.add(phase);
    $('question-activity').dataset.phase = phase;
    $('activity-title').textContent = titles[phase];
    for (const item of $('activity-phases').children) {
      const active = item.dataset.phase === phase;
      item.dataset.state = active ? 'active' : seen.has(item.dataset.phase) ? 'visited' : 'pending';
      if (active) item.setAttribute('aria-current', 'step'); else item.removeAttribute('aria-current');
    }
  }
  function tick() {
    if (started === null) return;
    const time = now();
    $('activity-elapsed').textContent = duration(time - started);
    $('activity-connection').textContent = stage === 'context' ? 'Checking the page and its selections.'
      : time - lastUpdate >= 25000 ? `No helper update for ${duration(time - lastUpdate)}. You can stop and retry.`
      : stage === 'ai' && time - lastStep >= 20000 ? 'The helper is connected; the AI provider has not returned this step yet.'
      : stage === 'read' && time - lastStep >= 20000 ? 'The helper is connected; this Anaplan read is still pending.'
      : 'Activity updates appear as each step starts and finishes.';
  }
  function update(event) {
    if (started === null) return;
    lastUpdate = now();
    if (event.type === 'heartbeat') { tick(); return; }
    if (typeof event.message !== 'string') return;
    stage = event.stage; message = event.message; lastStep = now();
    phaseFor(event);
    $('activity-status').textContent = message;
    const item = document.createElement('li');
    const time = document.createElement('span'); time.className = 'activity-time'; time.textContent = duration(lastStep - started);
    const label = document.createElement('span'); label.textContent = message;
    item.append(time, label); $('activity-log').append(item);
    if ($('activity-log').children.length > 60) $('activity-log').firstElementChild.remove();
    $('activity-summary').textContent = `Activity · ${++count} updates`;
    tick();
  }
  function stop() {
    clearInterval(timer); started = null; message = ''; $('question-activity').hidden = true;
  }
  return {
    start() {
      stop(); started = now(); lastUpdate = started; count = 0; hasData = false; seen.clear();
      $('activity-log').replaceChildren(); $('activity-details').open = false;
      $('question-activity').hidden = false;
      update({ stage: 'context', message: 'Checking page context and selections' });
      timer = setInterval(tick, tickMs); timer.unref?.();
    },
    update, stop,
    get message() { return message; },
  };
}
