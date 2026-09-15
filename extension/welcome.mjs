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

const clean = value => typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim() : '';
const readable = value => value && !/^\d{10,}$|^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i.test(value);
const nameOf = value => {
  const name = clean(value).replace(/^(?:[a-z]{2,8}\d{2,5}|\d{3,6})\s*[-–—:]\s*/i, '').replace(/\s+(?:table|grid)$/i, '');
  return readable(name) && !/^(?:card|chart|grid|table|untitled|view|module)(?:\s+\d+)?$/i.test(name) && name.length <= 140 ? name : '';
};
const metric = /\b(?:coefficients?|rates?|discounts?|prices?|margins?|costs?|revenue|sales|profits?|volumes?|units|amounts?|budgets?|forecasts?|spend|inventory|headcount)\b/i;
const settings = /\b(?:properties|settings|configuration|types?|assumptions|parameters)\b/i;
const records = /\b(?:stores|customers|products|employees|accounts|orders|suppliers|locations)\b/i;
const quote = name => `“${name}”`;

function selectedItems(source) {
  const dimensions = new Map();
  for (const filter of source.filters || []) {
    if (!dimensions.has(filter.dimensionId)) dimensions.set(filter.dimensionId, []);
    dimensions.get(filter.dimensionId).push(filter);
  }
  return [...dimensions.values()].filter(items => items.length === 1).map(items => items[0]).filter(filter => {
    const label = clean(filter.label);
    return filter.itemId && !filter.issue && filter.dimensionId !== '20000000012' && !/^line\s*items$/i.test(filter.dimensionName || '') && readable(label) && label !== filter.itemId && label.length <= 70;
  });
}

// Only name filters shared by every card targeted by this question. Other
// current selections remain enforced by the page ticket when the user sends it.
function scopeFor(cards) {
  const first = selectedItems(cards[0].source);
  const shared = first.filter(filter => cards.every(card => selectedItems(card.source).some(item => item.dimensionId === filter.dimensionId && item.itemId === filter.itemId)));
  const labels = [...new Set(shared.map(filter => clean(filter.label)))].slice(0, 2);
  return labels.length ? ` for ${labels.join(', ')}` : '';
}

function relatedPair(cards) {
  const tokens = name => new Set(name.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(word => word.length > 2 && !['table', 'grid', 'data', 'default', 'custom', 'actual', 'budget', 'forecast', 'plan', 'master', 'the', 'and'].includes(word)));
  let best;
  for (let i = 0; i < cards.length; i++) for (let j = i + 1; j < cards.length; j++) {
    const left = cards[i], right = cards[j], shared = [...tokens(left.name)].filter(word => tokens(right.name).has(word)).length;
    const sameModule = left.source.moduleIds.some(id => right.source.moduleIds.includes(id));
    if (!shared && !(sameModule && metric.test(left.name) && metric.test(right.name))) continue;
    const names = `${left.name} ${right.name}`;
    const comparison = /\bdefault\b/i.test(names) && /\bcustom\b/i.test(names) || /\bactual\b/i.test(names) && /\b(?:budget|plan|forecast)\b/i.test(names);
    const score = shared * 2 + Number(sameModule) + (comparison ? 4 : 0);
    if (!best || score > best.score) best = { cards: [left, right], score };
  }
  return best?.cards;
}

export function starterQuestions(context) {
  if (!context?.page || !context.model?.key) return [];
  const names = new Set(), cards = [];
  for (const source of context.sources || []) {
    if (!source.moduleIds?.length) continue;
    const name = nameOf(source.name) || nameOf(source.moduleName);
    if (!name || names.has(name.toLowerCase())) continue;
    names.add(name.toLowerCase()); cards.push({ name, source });
  }
  if (!cards.length) return [];
  cards.sort((a, b) => Number(/\b(?:master|summary|overview|total|results)\b/i.test(b.name)) - Number(/\b(?:master|summary|overview|total|results)\b/i.test(a.name)));
  const primary = cards[0], scope = scopeFor([primary]), label = quote(primary.name);
  const questions = [settings.test(primary.name) ? `What settings are defined in ${label}${scope}?`
    : metric.test(primary.name) ? `What are the values in ${label}${scope}?`
    : records.test(primary.name) ? `Which records are included in ${label}${scope}?`
    : `Summarize ${label}${scope}.`];
  const pair = relatedPair(cards);
  if (pair) questions.push(`How do ${quote(pair[0].name)} and ${quote(pair[1].name)} compare${scopeFor(pair)}?`);
  questions.push(`What inputs and rules determine ${label}${scope}?`);
  if (questions.length < 3 && cards[1]) questions.push(`Explain ${quote(cards[1].name)}${scopeFor([cards[1]])}.`);
  if (questions.length < 3) questions.push(`Where does the data in ${label} come from?`);
  return questions.slice(0, 3);
}

export function renderWelcome(document, { context, loading = false, error = '', hasApps, busy = false, date = new Date() }) {
  const $ = id => document.getElementById(id), hour = date.getHours();
  $('welcome-greeting').textContent = hour < 12 ? 'Good morning.' : hour < 18 ? 'Good afternoon.' : 'Good evening.';
  const questions = loading || error ? [] : starterQuestions(context);
  $('welcome-description').textContent = !hasApps ? 'Welcome to Xanaplan. Set up an app to get started.'
    : loading ? 'I’m getting this page ready. You can start typing your question.'
    : !context || error ? 'Choose a page above, and I’ll suggest questions for it.'
    : questions.length ? 'A few starting points for this page. Pick one or ask your own question.'
    : 'What would you like to explore on this page?';
  const container = $('starter-questions'), key = JSON.stringify(questions);
  // Preserve keyboard focus during unrelated status updates.
  if (container.dataset.questions !== key) {
    container.dataset.questions = key; container.replaceChildren();
    for (const question of questions) {
      const button = document.createElement('button'); button.type = 'button'; button.dataset.question = question;
      button.append(document.createTextNode(question));
      const arrow = document.createElement('span'); arrow.textContent = '↗'; arrow.setAttribute('aria-hidden', 'true');
      button.append(arrow); container.append(button);
    }
  }
  for (const button of container.children) button.disabled = busy;
  container.hidden = !questions.length;
}
