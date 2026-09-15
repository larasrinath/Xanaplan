import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { starterQuestions, renderWelcome } from '../extension/welcome.mjs';

const filter = (itemId = '601', label = 'Jan 26') => ({ dimensionId: '501', dimensionName: 'Time', itemId, label, origin: 'page selection' });
const source = (name, moduleId, filters = [filter()]) => ({ id: moduleId, name, moduleIds: [moduleId], filters });
const context = sources => ({ page: { name: 'Coefficient Admin' }, model: { key: 'model' }, sources });

test('starter questions use actual page topics and related cards instead of generic finance prompts', () => {
  const coefficients = context([
    source('CFM010 - Coefficient Type', '101'), source('CFM020 - Default Coefficients Table', '102'),
    source('CFM040 - Custom Coefficients Table', '104'), source('CFM050 - Master Coefficients Table', '105'),
  ]);
  const questions = starterQuestions(coefficients);
  assert.equal(questions.length, 3);
  assert.match(questions[0], /Master Coefficients.*Jan 26/);
  assert.match(questions[1], /Default Coefficients.*Custom Coefficients/);
  assert.match(questions[2], /inputs and rules.*Master Coefficients/);
  assert.doesNotMatch(questions.join(' '), /CFM050|profit|budget|quarter|margin|Table/);
  const stores = starterQuestions(context([source('Existing Stores', '201', [filter('702', 'Canada')])]));
  assert.match(stores[0], /Which records.*Existing Stores.*Canada/);
  assert.doesNotMatch(stores.join(' '), /Coefficients|Jan 26/);
});

test('suggested comparisons preserve independent filters and exclude unknown or technical labels', () => {
  const actual = { dimensionId: '502', dimensionName: 'Versions', itemId: '603', label: 'Actual' };
  const budget = { ...actual, itemId: '604', label: 'Budget' };
  const questions = starterQuestions(context([
    source('Revenue', '101', [filter(), actual]), source('Budget', '101', [filter(), budget]),
  ]));
  assert.match(questions[0], /for Jan 26, Actual/);
  assert.match(questions[1], /compare for Jan 26\?/);
  const incomplete = starterQuestions(context([source('Revenue', '101', [filter('601', 'PRIVATE UNKNOWN'), { ...filter(), issue: 'Unresolved' }, { dimensionId: '20000000012', itemId: '201', label: 'Technical Line Item' }, { dimensionId: '999', itemId: '999', label: '999' }])]));
  assert.doesNotMatch(incomplete.join(' '), /PRIVATE UNKNOWN|Jan 26|Technical Line Item|999/);
  const unrelated = starterQuestions(context([source('Country', '101'), source('Department', '101')]));
  assert.doesNotMatch(unrelated.join(' '), /compare/);
});

test('welcome keeps greetings, clears stale suggestions during loading, and renders labels safely', t => {
  const dom = new JSDOM(readFileSync(new URL('../extension/panel.html', import.meta.url), 'utf8')); t.after(() => dom.window.close());
  const document = dom.window.document, $ = id => document.getElementById(id);
  const state = { context: context([source('<img src=x onerror=alert(1)> Revenue', '101')]), hasApps: true, date: new Date(2026, 8, 14, 9) };
  renderWelcome(document, state);
  assert.equal($('welcome-greeting').textContent, 'Good morning.');
  assert.equal($('starter-questions').children.length, 3); assert.equal($('starter-questions').querySelector('img'), null);
  const button = $('starter-questions').firstElementChild; button.focus();
  renderWelcome(document, state); assert.equal(document.activeElement, button);
  renderWelcome(document, { ...state, busy: true }); assert.equal(button.disabled, true);
  renderWelcome(document, { ...state, loading: true }); assert.equal($('starter-questions').hidden, true); assert.equal($('starter-questions').children.length, 0);
  renderWelcome(document, { ...state, error: 'Unavailable' }); assert.equal($('starter-questions').hidden, true);
  renderWelcome(document, { hasApps: false, date: new Date(2026, 8, 14, 19) });
  assert.equal($('welcome-greeting').textContent, 'Good evening.'); assert.match($('welcome-description').textContent, /Set up an app/);
  assert.deepEqual(starterQuestions(context([{ name: 'Unverified', moduleIds: [] }])), []);
});
