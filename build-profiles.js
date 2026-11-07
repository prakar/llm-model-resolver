#!/usr/bin/env node
// build-profiles.js  —  run after editing profiles/*.yml
// Requires js-yaml: npm install --save-dev js-yaml
// Converts each .yml file to a corresponding .js module that the resolver loads
// at runtime without needing js-yaml as a runtime dependency.
'use strict';
const fs     = require('fs');
const path   = require('path');
const jsyaml = require('js-yaml');

const dir     = path.join(__dirname, 'profiles');
const banner  = '// Generated from {name}.yml — do not edit directly.\n// Edit {name}.yml then run: node build-profiles.js\n';

let built = 0;
for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.yml'))) {
  const name = f.replace('.yml','');
  const raw  = jsyaml.load(fs.readFileSync(path.join(dir, f), 'utf8'));
  const code = banner.replace(/{name}/g, name) +
    "'use strict';\nmodule.exports = " + JSON.stringify(raw, null, 2) + ';\n';
  fs.writeFileSync(path.join(dir, name + '.js'), code);
  console.log('  wrote profiles/' + name + '.js');
  built++;
}

// ---------------------------------------------------------------------------
// profiles/profiles.json — one public, language-neutral file for clients that cannot
// require() this package (Android, iOS, Python...). Served by jsDelivr from the npm package:
//   https://cdn.jsdelivr.net/npm/llm-model-resolver@1/profiles/profiles.json
// The contract is described in README, "Public JSON for non-Node clients". Deterministic on
// purpose (no timestamp), so rebuilding without edits produces no diff.
// ---------------------------------------------------------------------------
const PROVIDERS = ['xai', 'anthropic', 'gemini', 'openrouter'];
const ORDERS    = ['newest', 'oldest', 'cheapest', 'provider'];
const profiles  = {};
for (const name of ['economy', 'flagship']) {
  const raw = jsyaml.load(fs.readFileSync(path.join(dir, name + '.yml'), 'utf8'));
  if (!ORDERS.includes(raw.global && raw.global.order)) throw new Error(name + ': global.order must be one of ' + ORDERS.join('|'));
  for (const [p, rules] of Object.entries(raw.providers || {})) {
    if (!PROVIDERS.includes(p)) throw new Error(name + ': unknown provider ' + p);
    for (const k of ['include', 'exclude', 'prefer']) if (rules[k] != null) new RegExp(String(rules[k]), 'i');   // fail early on a bad pattern
  }
  profiles[name] = raw;
}
// Same rule as index.js: js-yaml 4 reads yes/no as strings, so match the text, not the parsed value.
const m        = /^\s*flagship_performance\s*:\s*(yes|no|true|false)/mi.exec(fs.readFileSync(path.join(dir, 'settings.yml'), 'utf8'));
const flagship = m ? (m[1] === 'yes' || m[1] === 'true') : false;
const pkg      = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8'));
const contract = {
  schemaVersion: 1,
  package:       pkg.name,
  version:       pkg.version,
  defaultProfile: flagship ? 'flagship' : 'economy',
  regexFlags:    'i',
  providers:     PROVIDERS,
  profiles,
};
fs.writeFileSync(path.join(dir, 'profiles.json'), JSON.stringify(contract, null, 2) + '\n');
console.log('  wrote profiles/profiles.json (schemaVersion ' + contract.schemaVersion + ', default ' + contract.defaultProfile + ')');
console.log('Done —', built, 'profiles rebuilt.');
