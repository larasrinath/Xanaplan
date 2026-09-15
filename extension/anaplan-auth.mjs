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

export function safeSignInUrl(value) {
  try {
    const url = new URL(value);
    if (url.protocol === 'https:' && !url.username && !url.password && (url.hostname === 'anaplan.com' || url.hostname.endsWith('.anaplan.com'))) return url.href;
  } catch {}
  return null;
}

export async function openAnaplanSignIn(value, tabs = globalThis.chrome?.tabs) {
  const url = safeSignInUrl(value);
  if (!url || !tabs?.create) return false;
  try { await tabs.create({ url, active: true }); return true; }
  catch { return false; } // The visible link remains available if Chrome cannot open a tab.
}
