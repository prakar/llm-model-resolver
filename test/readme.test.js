'use strict';
// Keeps README.md honest. The README went stale once already (it described filters the code no
// longer had and missed ones it did); these checks make the next drift fail the build instead.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const os = require('node:os');

const root = path.join(__dirname, '..');
const README = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
const SRC = fs.readFileSync(path.join(root, 'index.js'), 'utf8');
const DTS = fs.readFileSync(path.join(root, 'index.d.ts'), 'utf8');
const m = require('../index.js');

// The bundled profiles are the source of truth for rules, fallbacks and timeouts; the README
// documents them. Read the generated .js form (what the package loads at runtime).
const PROFILES = { economy: require('../profiles/economy.js'), flagship: require('../profiles/flagship.js') };
const section = (title) => {
  const start = README.indexOf('## ' + title);
  assert.ok(start >= 0, 'README section not found: ' + title);
  const next = README.indexOf('\n## ', start + 3);
  return README.slice(start, next < 0 ? undefined : next);
};

test('the README shows each profile\'s include, exclude and prefer rules exactly', () => {
  const docs = { economy: section('Economy profile'), flagship: section('Flagship profile') };
  for (const [name, prof] of Object.entries(PROFILES)) {
    for (const [p, rules] of Object.entries(prof.providers)) {
      for (const field of ['include', 'exclude', 'prefer']) {
        if (!rules[field]) continue;
        assert.ok(docs[name].includes(`${field}:`) && docs[name].includes(`"${rules[field]}"`),
          `${name}/${p}: README does not show ${field} "${rules[field]}"`);
      }
    }
  }
});

test('the economy profile prefers non-reasoning xAI models and does not exclude them', () => {
  const xai = PROFILES.economy.providers.xai;
  assert.equal(xai.prefer, 'non-?reasoning');
  assert.ok(!new RegExp(xai.exclude, 'i').test('grok-4.20-0309-non-reasoning'), 'economy must not exclude non-reasoning');
});

test('the Fallbacks table lists each profile\'s real fallbacks', () => {
  const sec = README.slice(README.indexOf('## Fallbacks'), README.indexOf('## Potential future work'));
  const rows = [...sec.matchAll(/^\| `(xai|anthropic|gemini|openrouter)`\s*\| `([^`]+)`\s*\| `([^`]+)`/gm)];
  assert.equal(rows.length, 4, 'expected one row per provider');
  // Compare to the profiles' own values; openrouter has no profile entry, so use the built-in.
  const builtIn = { openrouter: 'openrouter/free' };
  const clean = { ...process.env };
  for (const k of ['XAI_MODEL_FALLBACK', 'GROK_MODEL_FALLBACK', 'ANTHROPIC_MODEL_FALLBACK', 'GEMINI_MODEL_FALLBACK', 'OPENROUTER_MODEL_FALLBACK', 'OPENROUTER_FREE_FALLBACK', 'LLM_MODEL_RESOLVER_PROFILE']) delete clean[k];
  const out = cp.execFileSync(process.execPath, ['-e', "console.log(JSON.stringify(require('./index.js').DEFAULT_FALLBACKS))"], { cwd: root, env: clean }).toString();
  const active = JSON.parse(out);   // the default profile (settings.yml → economy)
  for (const [, provider, economy, flagship] of rows) {
    const pe = (PROFILES.economy.providers[provider] || {}).fallback || builtIn[provider];
    const pf = (PROFILES.flagship.providers[provider] || {}).fallback || builtIn[provider];
    assert.equal(economy, pe, provider + ' economy');
    assert.equal(flagship, pf, provider + ' flagship');
    assert.equal(active[provider], pe, provider + ' is not what the default profile gives');
  }
});

test('the documented timeout and cool-down defaults are the real ones', () => {
  const clean = { ...process.env }; delete clean.LLM_MODEL_RESOLVER_PROFILE;
  // With no profile loaded the built-in values apply; configure({}) resets to them.
  const b = JSON.parse(cp.execFileSync(process.execPath, ['-e',
    "const m=require('./index.js');m.configure({});console.log(JSON.stringify([m.DEFAULT_TIMEOUT_MS,m.DEFAULT_COOLDOWN_MS]))"], { cwd: root, env: clean }).toString());
  assert.deepEqual(b, [10000, 60000]);
  assert.match(README, /default 10000/);
  assert.match(README, /default 60000/);
  assert.match(README, /\*\*10 seconds\*\*/);
  assert.match(README, /60 seconds/);
  // The profiles' own timeouts, as documented.
  assert.equal(PROFILES.economy.global.timeoutMs, 300000);
  assert.equal(PROFILES.flagship.global.timeoutMs, 600000);
  assert.match(README, /\*\*5 minutes\*\* in economy/);
  assert.match(README, /\*\*10 minutes\*\* in flagship/);
});

test('npm test runs every test file (the README guard used to be skipped)', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const files = fs.readdirSync(__dirname).filter(f => f.endsWith('.test.js'));
  for (const f of files) {
    assert.ok(pkg.scripts.test.includes('test/*.test.js') || pkg.scripts.test.includes(f), 'npm test does not run ' + f);
  }
});

test('every export is documented in the README and declared in the types', () => {
  for (const name of Object.keys(m)) {
    assert.ok(README.includes(name), 'README never mentions ' + name);
    assert.ok(new RegExp('export (function|const) ' + name + '\\b').test(DTS), 'index.d.ts does not declare ' + name);
  }
});

test('every option, reason, status and orderedBy value in the types is in the README', () => {
  for (const opt of ['forceRefresh', 'fallback', 'order', 'timeoutMs', 'cooldownMs']) {
    assert.ok(README.includes(opt + '?'), 'option missing from README API block: ' + opt);
    assert.ok(DTS.includes(opt + '?'), 'option missing from types: ' + opt);
  }
  for (const v of ['no-key', 'fetch-failed', 'cooldown', 'empty-list', 'all-known-bad', 'error',
                   'chosen', 'eligible', 'excluded', 'not-matching', 'known-bad', 'created', 'version', 'provider']) {
    assert.ok(README.includes(v), 'README never mentions the value ' + v);
    assert.ok(DTS.includes(v), 'types never mention the value ' + v);
  }
  for (const k of ['provider', 'id', 'source', 'reason', 'orderedBy', 'tier', 'fallback', 'error', 'candidates', 'created', 'generation', 'status', 'rank']) {
    assert.ok(README.includes(k + ':'), 'inspectModels example is missing the field ' + k);
  }
});

test('the documented endpoints are the ones the code calls', () => {
  for (const url of [
    'https://api.x.ai/v1/language-models', 'https://api.x.ai/v1/models',
    'https://api.anthropic.com/v1/models?limit=1000',
    'https://generativelanguage.googleapis.com/v1beta/models',
    'https://openrouter.ai/api/v1/models',
  ]) {
    assert.ok(README.includes(url), 'README does not mention ' + url);
    assert.ok(SRC.includes(url.replace('?limit=1000', '')), 'code does not call ' + url);
  }
  assert.ok(SRC.includes('limit=1000'), 'the Anthropic limit the README describes is not in the code');
  assert.ok(SRC.includes('pageSize=1000'), 'the Gemini page size the README describes is not in the code');
});

test('every code example parses as JavaScript', () => {
  const blocks = [...README.matchAll(/```js\n([\s\S]*?)```/g)].map(x => x[1]).filter(b => !b.startsWith('xai:'));
  assert.ok(blocks.length >= 6, 'expected several examples, found ' + blocks.length);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'readme-ex-'));
  blocks.forEach((b, i) => {
    const f = path.join(dir, `ex${i}.js`);
    fs.writeFileSync(f, '(async () => {\n' + b + '\n})();\n');
    const r = cp.spawnSync(process.execPath, ['--check', f]);
    assert.equal(r.status, 0, `example ${i + 1} does not parse: ${b.split('\n').find(l => l.trim())}\n${r.stderr}`);
  });
});

test('markdown tables have consistent columns (a bare | inside a cell would split it)', () => {
  const tables = []; let cur = [];
  for (const l of README.split('\n')) { if (l.startsWith('|')) cur.push(l); else if (cur.length) { tables.push(cur); cur = []; } }
  if (cur.length) tables.push(cur);
  assert.ok(tables.length >= 3);
  tables.forEach((tb, i) => {
    const counts = new Set(tb.map(r => (r.match(/(?<!\\)\|/g) || []).length));
    assert.equal(counts.size, 1, `table ${i + 1} has uneven columns: ${[...counts]}`);
  });
});

test('the old package name appears only in the "formerly published as" note', () => {
  const hits = README.split('\n').filter(l => l.includes('failsafe-llm-model-resolver'));
  assert.equal(hits.length, 1, hits.join('\n'));
  assert.match(hits[0], /Formerly published as/);
});

test('the README does not claim things the code no longer does', () => {
  for (const stale of ['does not sort', 'no version sorting', 'No request timeout', 'No version sorting', 'aren\'t filtered by capability']) {
    assert.ok(!README.includes(stale), 'stale claim still in the README: ' + stale);
  }
});

test('package.json license matches the LICENSE file and the README', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  assert.ok(fs.readFileSync(path.join(root, 'LICENSE'), 'utf8').startsWith(pkg.license), 'LICENSE does not start with ' + pkg.license);
  assert.ok(README.trimEnd().endsWith(pkg.license), 'README license line is not ' + pkg.license);
});

test('profiles/*.js are the generated form of profiles/*.yml (skipped when js-yaml is not installed)', (t) => {
  let yaml; try { yaml = require('js-yaml'); } catch (_) { return t.skip('js-yaml not installed'); }
  for (const name of ['economy', 'flagship']) {
    const fromYml = yaml.load(fs.readFileSync(path.join(root, 'profiles', name + '.yml'), 'utf8'));
    assert.deepEqual(require('../profiles/' + name + '.js'), fromYml, name + '.js is stale: run npm run build-profiles');
  }
});
