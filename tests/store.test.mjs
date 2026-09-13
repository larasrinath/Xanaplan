import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Store } from '../server/store.mjs';

const model = { workspaceId: 'workspace1', modelId: 'model1', name: 'Synthetic model', workspaceName: 'Synthetic workspace', context: 'Saved context' };
const app = { appId: 'app1', origin: 'https://us1a.app.anaplan.com', tenantId: 'tenant1', tenantName: 'Synthetic tenant', name: 'Synthetic app', context: 'Saved app context', models: [model] };
const operations = {
  'app save': (store, saved) => store.saveApp({ ...saved.app, context: 'Unsaved app context' }),
  'app removal': (store, saved) => store.removeApp(saved.app.key, saved.app.revision),
  'connection save': store => store.saveConnection('unsaved-client'),
  'AI settings save': store => store.saveLlm({ provider: 'openai', model: 'unsaved-model', revision: store.getLlm().revision }),
  'legacy model save': (store, saved) => store.save({ ...saved.model, context: 'Unsaved model context' }),
  'legacy model removal': (store, saved) => store.remove(saved.model.key, saved.model.revision),
};

for (const [name, operation] of Object.entries(operations)) {
  test(`failed ${name} preserves persisted values and permits a retry at the same revision`, t => {
    const directory = mkdtempSync(join(tmpdir(), 'xanaplan-store-'));
    t.after(() => rmSync(directory, { recursive: true, force: true }));
    const store = new Store(directory);
    const saved = { app: store.saveApp(app), model: store.save(model) };
    store.saveConnection('saved-client');
    store.saveLlm({ provider: 'claude', model: 'saved-model', revision: 1 });
    const before = structuredClone(store.data);
    const flush = store.flush;
    store.flush = () => { throw new Error('Synthetic disk failure'); };
    assert.throws(() => operation(store, saved), /Synthetic disk failure/);
    assert.deepEqual(store.data, before);
    assert.deepEqual(new Store(directory).data, before);
    store.flush = flush;
    operation(store, saved);
    assert.notDeepEqual(store.data, before);
    assert.deepEqual(new Store(directory).data, store.data);
  });
}
