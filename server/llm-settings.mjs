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

import { AppError } from './validation.mjs';

export const PROVIDERS = Object.freeze({ claude: 'Claude', openai: 'OpenAI' });
export function validateLlmChoice(input) {
  if (!input || !Object.hasOwn(PROVIDERS, input.provider)) throw new AppError('Choose OpenAI or Claude.');
  if (typeof input.model !== 'string' || input.model.length > 120 || (input.model.trim() && !/^[a-zA-Z0-9][a-zA-Z0-9._:/-]*$/.test(input.model.trim()))) throw new AppError('Enter a valid model name or leave it blank for the provider default.');
  return { provider: input.provider, model: input.model.trim() };
}
