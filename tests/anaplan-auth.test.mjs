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

import test from 'node:test';
import assert from 'node:assert/strict';
import { safeSignInUrl, openAnaplanSignIn } from '../extension/anaplan-auth.mjs';

test('sign-in permits Anaplan IAM and rejects unsafe or credential-bearing links', () => {
  assert.equal(safeSignInUrl('https://iam.anaplan.com/activate?user_code=TEST'), 'https://iam.anaplan.com/activate?user_code=TEST');
  for (const url of [null, '', 'https://anaplan.com.evil.test', 'http://iam.anaplan.com', 'javascript:alert(1)', 'https://evil.test', 'https://user:password@iam.anaplan.com/']) assert.equal(safeSignInUrl(url), null);
});

test('Connect opens the validated sign-in URL in an active Chrome tab', async () => {
  const calls = [], tabs = { create: async input => { calls.push(input); } };
  assert.equal(await openAnaplanSignIn('https://iam.anaplan.com/activate?user_code=TEST', tabs), true);
  assert.deepEqual(calls, [{ url: 'https://iam.anaplan.com/activate?user_code=TEST', active: true }]);
  assert.equal(await openAnaplanSignIn('https://evil.test', tabs), false);
  assert.equal(calls.length, 1);
});

test('missing browser APIs and tab creation failures retain the manual sign-in fallback', async () => {
  const url = 'https://iam.anaplan.com/activate';
  assert.equal(await openAnaplanSignIn(url, {}), false);
  assert.equal(await openAnaplanSignIn(url, { create: async () => { throw new Error('Unavailable'); } }), false);
});
