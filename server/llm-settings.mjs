import { AppError } from './validation.mjs';

export const PROVIDERS = Object.freeze({ claude: 'Claude', openai: 'OpenAI' });
export function validateLlmChoice(input) {
  if (!input || !Object.hasOwn(PROVIDERS, input.provider)) throw new AppError('Choose OpenAI or Claude.');
  if (typeof input.model !== 'string' || input.model.length > 120 || (input.model.trim() && !/^[a-zA-Z0-9][a-zA-Z0-9._:/-]*$/.test(input.model.trim()))) throw new AppError('Enter a valid model name or leave it blank for the provider default.');
  return { provider: input.provider, model: input.model.trim() };
}
