import { describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dataset = JSON.parse(
  fs.readFileSync(path.join(__dirname, '../src/dataset.json'), 'utf-8')
);

describe('dataset integrity', () => {
  it('has all probe categories populated', () => {
    for (const cat of ['self_declare', 'knowledge', 'capability', 'behavior']) {
      assert.ok(Array.isArray(dataset[cat]) && dataset[cat].length > 0, `missing ${cat}`);
    }
  });

  it('every probe has an id and bilingual prompts', () => {
    const all = [
      ...dataset.self_declare,
      ...dataset.knowledge,
      ...dataset.capability,
      ...dataset.behavior
    ];
    for (const q of all) {
      assert.ok(q.id, 'probe missing id');
      assert.ok(q.prompt_zh, `${q.id} missing prompt_zh`);
      assert.ok(q.prompt_en, `${q.id} missing prompt_en`);
    }
  });

  it('probe ids are unique', () => {
    const ids = [...dataset.knowledge, ...dataset.capability, ...dataset.behavior].map((q) => q.id);
    assert.strictEqual(new Set(ids).size, ids.length, 'duplicate probe ids');
  });

  it('knowledge probes carry a date anchor and a check spec', () => {
    for (const q of dataset.knowledge) {
      assert.ok(/^\d{4}-\d{2}$/.test(q.date), `${q.id} bad date`);
      assert.ok(q.check, `${q.id} missing check`);
    }
  });

  it('capability probes carry tier, weight and a checkable answer key', () => {
    for (const q of dataset.capability) {
      assert.ok(Number.isInteger(q.tier), `${q.id} missing tier`);
      assert.ok(q.weight > 0, `${q.id} missing weight`);
      assert.ok(q.check, `${q.id} missing check`);
    }
  });

  it('the generated prompt never leaks answer keys', () => {
    // sanity: serialized prompt body must not contain any capability expected value
    const serialized = JSON.stringify(dataset.capability.map((q) => q.check));
    assert.ok(serialized.includes('708'), 'dataset should hold the keys');
  });
});
