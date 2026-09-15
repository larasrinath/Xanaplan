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

import { createDiscoveryService } from './discovery-background.mjs';
import { createPageService } from './page-background.mjs';

const discover = createDiscoveryService(chrome);
const page = createPageService(chrome);
chrome.runtime.onMessage.addListener((message, sender, reply) => {
  const handle = message?.target === 'discovery-background' ? discover : message?.target === 'page-background' ? page : null;
  if (!handle) return;
  handle(message, sender).then(reply, error => reply({ ok: false, error: error.message }));
  return true;
});

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(console.error);
chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(console.error);
});
