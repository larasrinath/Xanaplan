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

export function appOrigin(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || !/^[a-z0-9-]+\.app\.anaplan\.com$/i.test(url.hostname) || url.port || url.username || url.password) throw new Error('Use an HTTPS Anaplan app address.');
  return url.origin;
}

export function discoveryInput({ origin, tenantId = '', appId = '' }) {
  origin = appOrigin(origin);
  if (typeof tenantId !== 'string' || (tenantId && !/^[a-zA-Z0-9_-]{1,80}$/.test(tenantId))) throw new Error('Select a tenant from the list.');
  if (typeof appId !== 'string' || (appId && !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(appId))) throw new Error('Select an app from the list.');
  if (appId && !tenantId) throw new Error('Select a tenant before choosing an app.');
  return { origin, tenantId, appId };
}
