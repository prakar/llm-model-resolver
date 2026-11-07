'use strict';
// Conformance vectors: raw provider list response -> chosen model, under an inline config.
// The same test/vectors.json is meant to be run by ports in other languages (see README,
// "Public JSON for non-Node clients"). If you change selection behaviour on purpose, regenerate
// the expectations and bump the profiles.json schemaVersion if the contract changed.
const test   = require('node:test');
const assert = require('node:assert/strict');
const path   = require('node:path');
const fs     = require('node:fs');

const doc = JSON.parse(fs.readFileSync(path.join(__dirname, 'vectors.json'), 'utf8'));
const RF  = globalThis.fetch;
const INDEX = require.resolve('../index.js');

test.afterEach(() => { globalThis.fetch = RF; delete require.cache[INDEX]; });

for (const c of doc.cases) {
  test('vector: ' + c.name, async () => {
    delete require.cache[INDEX];
    const lib = require('../index.js');
    lib.configure(doc.configs[c.config]);
    const base = doc.endpoints[c.provider];
    globalThis.fetch = async (url) => {
      if (!url.startsWith(base)) throw new Error('unmocked ' + url);
      return { ok: true, json: async () => c.response };
    };
    const r = await lib.inspectModels(c.provider, 'test-key', { forceRefresh: true });
    const ranked = r.candidates.filter(x => x.rank != null).sort((a, b) => a.rank - b.rank).slice(0, c.expect.ranked.length).map(x => x.id);
    assert.deepEqual({ id: r.id, source: r.source, tier: r.tier, orderedBy: r.orderedBy, ranked }, c.expect);
  });
}

test('profiles.json matches the shipped .js profiles and is a valid contract', () => {
  const pj = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'profiles', 'profiles.json'), 'utf8'));
  assert.equal(pj.schemaVersion, 1);
  assert.equal(pj.version, require('../package.json').version);
  assert.ok(['economy', 'flagship'].includes(pj.defaultProfile));
  for (const name of ['economy', 'flagship']) {
    assert.deepEqual(pj.profiles[name], require('../profiles/' + name + '.js'), name + ' differs from ' + name + '.js; run npm run build-profiles');
    for (const p of Object.values(pj.profiles[name].providers)) {
      for (const k of ['include', 'exclude', 'prefer']) if (p[k] != null) new RegExp(p[k], 'i');
    }
  }
});
