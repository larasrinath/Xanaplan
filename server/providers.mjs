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

import { PROVIDERS, validateLlmChoice } from './llm-settings.mjs';

export class ProviderManager {
  constructor({ store, claude, openai }) { this.store = store; this.providers = { claude, openai }; }
  async status() {
    const llm = this.store.getLlm();
    const results = await Promise.all(Object.entries(this.providers).map(async ([id, provider]) => [id, await provider.status()]));
    const connections = Object.fromEntries(results);
    return { llm, connections, provider: { ...connections[llm.provider], id: llm.provider, label: PROVIDERS[llm.provider], model: llm.model } };
  }
  select(input) {
    if (['provider', 'llmModel', 'llmProvider'].some(key => Object.hasOwn(input, key))) throw new AppError('The AI provider and model are managed in Admin.', 403);
    const settings = this.store.getLlm();
    if (input.llmRevision !== settings.revision) throw new AppError('AI settings changed. Refresh the connection before asking again.', 409);
    const implementation = this.providers[settings.provider];
    const check = () => {
      if (this.store.getLlm().revision !== settings.revision) throw new AppError('AI settings changed during this question. Refresh and ask again.', 409);
    };
    return {
      settings, check,
      decide: async (payload, signal) => { check(); const result = await implementation.decide(payload, signal, { model: settings.model }); check(); return result; },
    };
  }
  async test(input, signal) {
    const settings = validateLlmChoice(input);
    const result = await this.providers[settings.provider].decide({
      model: { name: 'Connection test', context: 'Synthetic connection check. No Anaplan information is included.' },
      question: 'Return a final answer saying Connection ready. Do not request data or tools.',
      history: [], tools: [], evidence: [], readsRemaining: 0,
    }, signal, { model: settings.model });
    if (result.kind !== 'answer') throw new AppError('The provider did not complete the connection check. Check the selected model.', 502);
    return { success: true, provider: settings.provider, model: settings.model, message: `${PROVIDERS[settings.provider]} connection verified.`, testedAt: new Date().toISOString() };
  }
}
