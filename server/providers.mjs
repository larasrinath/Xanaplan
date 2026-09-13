import { AppError } from './store.mjs';

export const PROVIDERS = Object.freeze({ claude: 'Claude', openai: 'OpenAI' });
export function validateLlmChoice(input) {
  if (!input || !Object.hasOwn(PROVIDERS, input.provider)) throw new AppError('Choose OpenAI or Claude.');
  if (typeof input.model !== 'string' || input.model.length > 120 || (input.model.trim() && !/^[a-zA-Z0-9][a-zA-Z0-9._:/-]*$/.test(input.model.trim()))) throw new AppError('Enter a valid model name or leave it blank for the provider default.');
  return { provider: input.provider, model: input.model.trim() };
}
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
