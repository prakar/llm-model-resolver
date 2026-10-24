# llm-model-resolver

**Resolve the current model ID for an LLM provider at runtime, instead of hard-coding it.**

```js
const { resolveModel } = require('llm-model-resolver');
// The active profile (economy by default, set in profiles/settings.yml) decides which model.
const { id, source, orderedBy } = await resolveModel('xai', process.env.XAI_API_KEY);
// → { id: 'grok-4.20-0309-non-reasoning', source: 'live', orderedBy: 'cheapest' }
// (an example: the answer depends on what your account lists. Run `node inspect.js xai`.)
```

> Formerly published as `failsafe-llm-model-resolver`.

---

## Profiles — the only thing you need to change

All preferences live in YAML files inside this package under `profiles/`. Edit them in
the GitHub repo — they ship with the package so everyone who clones it can change them
directly without touching application code.

Two profiles ship in the box:

| Profile | What it picks | Good for |
|---------|---------------|----------|
| `economy`  | Cheapest eligible model (the default); xAI prefers non-reasoning variants | Batch work, classification, tagging, extraction |
| `flagship` | Newest, most capable model | Complex reasoning, quality-critical work |

**One field in `profiles/settings.yml` switches between them:**

```yaml
# profiles/settings.yml — edit this in GitHub to change the active profile
flagship_performance: no    # yes = flagship (newest/best), no = economy (cheapest)
```

The package reads `settings.yml` automatically at startup. No env vars, no code changes.
It ships with `no`, so **economy is the default**.

`LLM_MODEL_RESOLVER_PROFILE=flagship` (env var) and `useProfile('flagship')` (code) work as
per-process overrides, for example for one script or for CI:

```js
const { useProfile, resolveModel } = require('llm-model-resolver');
useProfile('flagship');   // this process only; settings.yml is untouched
const { id } = await resolveModel('anthropic', process.env.ANTHROPIC_API_KEY);
```

---

## How a model is chosen

For one provider, the resolver lists the models the account can see, then:

1. keeps those that match `include` and do not match `exclude` (if that leaves nothing, it
   keeps everything that matches `include`: rule tier 2; if that is empty too, the provider's
   list order is used: tier 3);
2. moves models that match `prefer` to the front (a soft rule: if nothing matches, it is ignored);
3. orders each group by the profile's `order` (`cheapest`, `newest`, `oldest` or `provider`);
4. takes the first one, or your fallback if the list could not be fetched.

### Reasoning models and `prefer`

Economy ranks by **input-token price only**. That is blind to reasoning models, which bill
their hidden "thinking" tokens as output. A model can have the lowest input price and still
cost many times more per request: one extraction call on `grok-build-0.1` ($1.00/M input,
the cheapest model its account listed) produced 1.9k visible output tokens and 10.5k
reasoning tokens in 47 seconds.

So the economy profile sets `prefer: "non-?reasoning"` for xAI. A model that is explicitly
non-reasoning ranks ahead of every other model, whatever their price; the cheapest of those
is chosen. If xAI lists no such model, the preference is ignored and the cheapest model wins.
The check is by name: a reasoning model whose name does not say so cannot be recognised, and
simply isn't preferred.

To change this, per call or in a config:

```js
const { resolveModel } = require('llm-model-resolver');
// Price only, no preference:
await resolveModel('xai', key, { prefer: null });
// Prefer reasoning variants instead (name-based):
await resolveModel('xai', key, { prefer: /(?<!non-)reasoning/i });
```

```yaml
# in a profile or a config file
providers:
  xai:
    prefer: "non-?reasoning"   # or omit the line, or set it to null, for no preference
```

---

## How pricing works

Model selection in the economy profile is based on actual input-token price, not on name
heuristics. This matters: a new expensive model whose name doesn't say "reasoning" still
ranks below a cheaper one automatically.

Prices come from two sources with different confidence levels:

| Provider | Price source | Confidence | Notes |
|----------|-------------|------------|-------|
| xAI | `prompt_text_token_price` field in `/v1/language-models` response | `live` | Automatic, no maintenance needed |
| Anthropic | `knownPrices` table in `economy.yml` | `maintained` | Anthropic's `/v1/models` returns no pricing |
| Gemini | `knownPrices` table in `economy.yml` | `maintained` | Gemini's API returns no pricing |

This provenance is exposed on every candidate in `inspectModels()`:

```js
const ev = await inspectModels('xai', key);
// ev.candidates[0]:
// { id: 'grok-4-fast', priceIn: 0.20, priceOut: 0.50,
//   priceSource: 'provider-api', priceConfidence: 'live', priceUpdated: null, ... }

// vs. Anthropic:
// { id: 'claude-haiku-4-5', priceIn: 1.00, priceOut: 5.00,
//   priceSource: 'maintained', priceConfidence: 'maintained', priceUpdated: '2026-09-29', ... }
```

`priceIn` and `priceOut` are **effective base rates** in USD per million tokens — uncached
input, standard output. This is a deliberate simplification appropriate for model
*selection*. It ignores volume tiers, caching discounts, batch pricing, and reasoning token
surcharges (see "Reasoning models and `prefer`" above for how economy compensates for the
last one). Cost *accounting* (what you were actually billed) is a separate concern that
belongs in your application, not here. When you account for xAI calls, count the reasoning
tokens (`completion_tokens_details.reasoning_tokens`), which are reported separately from
the visible output.

If `cheapest` is requested but no price data exists for a provider (neither from the API
nor from `knownPrices`), a `LLM_RESOLVER_PRICE_UNAVAILABLE` warning is emitted and the
provider's own list order is used instead of silently returning the wrong model.

---

## Updating the price table

When Anthropic or Gemini changes their pricing, edit `profiles/economy.yml`:

```yaml
anthropic:
  knownPrices:
    source:  maintained
    updated: "2026-10-01"       # ← bump this date when you update prices
    models:
      claude-haiku-4:  { input: 1.00, output: 5.00 }
      claude-sonnet-5: { input: 3.00, output: 15.00 }
      claude-opus-5:   { input: 15.00, output: 75.00 }
```

Key matching uses longest prefix: `claude-haiku-4` matches `claude-haiku-4-5-20251001`
and any future haiku-4 variant, so you don't need to update the table for every minor
model release. After editing the YAML, run `npm run build-profiles` to regenerate the
`.js` counterpart.

Verify current rates at:
- Anthropic: https://www.anthropic.com/pricing
- Gemini: https://ai.google.dev/gemini-api/docs/pricing

---

## Economy profile (`profiles/economy.yml`)

```yaml
global:
  order: cheapest   # sort eligible models by input-token price, cheapest first

providers:
  xai:
    include: "^grok-"
    exclude: "image|imagine|video|code-fast"
    prefer:  "non-?reasoning"   # non-reasoning variants first; see "Reasoning models and prefer"
    fallback: "grok-4.3"
    # No knownPrices — xAI returns live pricing in its /v1/language-models response

  anthropic:
    include: "^claude-"
    exclude: "instant|mini"
    fallback: "claude-haiku-4-5"
    knownPrices:
      source: maintained
      updated: "2026-09-29"
      models:
        claude-haiku-3:  { input: 0.25,  output: 1.25  }
        claude-haiku-4:  { input: 1.00,  output: 5.00  }
        claude-sonnet-5: { input: 3.00,  output: 15.00 }
        claude-opus-5:   { input: 15.00, output: 75.00 }

  gemini:
    include: "gemini-"
    exclude: "lite|embedding|aqa|imagen|veo|tts|live|image|audio"
    fallback: "gemini-flash-latest"
    knownPrices:
      source: maintained
      updated: "2026-09-29"
      models:
        gemini-2.5-flash:    { input: 0.075, output: 0.30 }
        gemini-flash-latest: { input: 0.075, output: 0.30 }
        gemini-2.5-pro:      { input: 1.25,  output: 5.00 }
```

Fast/cheap models as listed in September 2026. **Availability varies by account**: one
account's xAI listing in October 2026 contained none of the `fast` models, so run
`node inspect.js <provider>` to see what you actually get.

| Provider | Model | Input $/M | Output $/M |
|----------|-------|-----------|------------|
| xAI | `grok-4-fast` | $0.20 | $0.50 |
| xAI | `grok-4.1-fast` | $0.20 | $0.50 |
| xAI | `grok-4.3` | $1.25 | $2.50 |
| Anthropic | `claude-3-haiku-20240307` | $0.25 | $1.25 |
| Anthropic | `claude-haiku-4-5` | $1.00 | $5.00 |
| Gemini | `gemini-2.5-flash` | $0.075 | $0.30 |

---

## Flagship profile (`profiles/flagship.yml`)

Picks the newest, most capable model. No price ordering — uses `order: newest`. It skips
`non-reasoning` xAI variants on purpose, so the newest *reasoning* model wins.

```yaml
global:
  order: newest

providers:
  xai:       { include: "^grok-",   exclude: "non-?reasoning|fast|mini|lite|code-fast|image|imagine|video" }
  anthropic: { include: "^claude-", exclude: "haiku|instant|mini" }
  gemini:    { include: "gemini-",  exclude: "flash|lite|embedding|aqa|imagen|veo|tts|live|image|audio" }
```

---

## Install

```bash
npm install llm-model-resolver
# To load custom YAML files with loadConfig() (bundled profiles need no extra dep):
npm install js-yaml
```

Custom rules without editing the package:

```js
const { configure, resolveModel } = require('llm-model-resolver');
configure({
  global: { order: 'cheapest' },
  providers: { gemini: { include: 'gemini-', exclude: 'lite|image|audio', fallback: 'gemini-flash-latest' } },
});
const { id } = await resolveModel('gemini', process.env.GEMINI_API_KEY);
```

---

## Supported providers

| Provider | Name | Endpoint | Selection |
|----------|------|----------|-----------|
| xAI | `xai` | `GET https://api.x.ai/v1/language-models` (fallback: `GET https://api.x.ai/v1/models`) | by `order` within include/exclude/prefer rules |
| Anthropic | `anthropic` | `GET https://api.anthropic.com/v1/models?limit=1000` | by `order` within include/exclude/prefer rules |
| Gemini | `gemini` | `GET https://generativelanguage.googleapis.com/v1beta/models?key=…` | by `order`; only `generateContent` models |
| OpenRouter | `openrouter` | `GET https://openrouter.ai/api/v1/models` | free models only, round-robin |

No SDKs. Native `fetch` only (Node ≥ 18).

**Ordering signals by provider:**

| Provider | `order: newest/oldest` | `order: cheapest` |
|----------|------------------------|-------------------|
| xAI | `created` (Unix timestamp from API) | `prompt_text_token_price` from API |
| Anthropic | `created_at` (RFC 3339 from API) | `knownPrices` table in YAML |
| Gemini | generation number parsed from ID (`2.5` < `3` < `3.1`) | `knownPrices` table in YAML |

---

## API

```ts
// Profile selection
function useProfile(name: 'flagship' | 'economy'): object
const AVAILABLE_PROFILES: string[]
// env: LLM_MODEL_RESOLVER_PROFILE=flagship  (read at require time)

// Custom config
function configure(cfg: object): void
function loadConfig(filePath: string): object   // .json (zero dep) or .yml (needs js-yaml)
function effectiveConfig(provider: string): ProviderConfig   // pin, include, exclude, prefer, fallback, knownPrices

// Resolution
function resolveModel(provider, apiKey, options?): Promise<ResolveResult>
// ResolveResult: { id, source: 'live'|'pinned'|'fallback', orderedBy }

function inspectModels(provider, apiKey, options?): Promise<Inspection>
// Inspection: { id, source, orderedBy, tier, reason, fallback, error,
//               candidates: [{ id, priceIn, priceOut, priceSource, priceConfidence,
//                              priceUpdated, preferred, created, generation, status, rank }] }

// options: { forceRefresh?, fallback?, order?, prefer?, timeoutMs?, cooldownMs? }
//   order?   'newest' | 'oldest' | 'cheapest' | 'provider'
//   prefer?  RegExp | string | null   overrides the profile's prefer rule for this call

// OpenRouter
function fetchFreeModels(apiKey, opts?): Promise<Set<string>>
function getNextFreeModel(apiKey, opts?): Promise<string>
function resetFreeModelIndex(): void

// Known-bad model tracking
function markModelBad(provider: 'xai'|'anthropic'|'gemini', modelId: string): void

// Cache / state
function clearCache(): void
const DEFAULT_FALLBACKS:  Record<string, string>   // live view of active config
const DEFAULT_TIMEOUT_MS:  number
const DEFAULT_COOLDOWN_MS: number
const PREFERENCE: Record<string, { include: RegExp, exclude: RegExp, prefer: RegExp | null }>
```

---

## Reading an inspection

`inspectModels()` (and `node inspect.js <provider>`) explains a decision. Every listed model
appears once, with a `status`, and the result says how the list was ordered:

```js
const ev = await inspectModels('xai', key);
// {
//   provider: 'xai',
//   id: 'grok-4.20-0309-non-reasoning',
//   source: 'live',                 // 'live' | 'pinned' | 'fallback'
//   reason: null,                   // why we fell back; see below
//   orderedBy: 'cheapest',          // 'cheapest' | 'created' | 'version' | 'provider'
//   tier: 1,                        // 1 = include/exclude matched, 2 = exclude dropped, 3 = list order
//   fallback: 'grok-4.3',
//   error: null,
//   candidates: [
//     { id: 'grok-4.20-0309-non-reasoning', created: '2026-03-09T…', generation: null,
//       status: 'chosen', rank: 1, preferred: true, priceIn: 1.25, … },
//   ],
// }
```

| `status` | Meaning |
|----------|---------|
| `chosen` | The model that was picked |
| `eligible` | Matches the rules, ranked behind the chosen one (see `rank`) |
| `excluded` | Matches `include` but also `exclude` |
| `not-matching` | Does not match `include` |
| `known-bad` | Skipped because `markModelBad()` was called for it |

| `reason` (when `source` is `fallback`) | Meaning |
|----------------------------------------|---------|
| `no-key` | No API key was passed |
| `fetch-failed` | The listing request failed or timed out |
| `cooldown` | A recent fetch failed; the provider is skipped until the cool-down ends |
| `empty-list` | The provider listed no models |
| `all-known-bad` | Every listed model was marked bad |
| `error` | Something unexpected threw (see `error`) |

`orderedBy` is `cheapest` (price), `created` (release timestamp), `version` (generation
number parsed from the ID, Gemini) or `provider` (the provider's own order, used when no
signal exists).

---

## Timeouts and the fetch cool-down

Every `/models` request has a timeout and a cool-down:

- `timeoutMs?` — default 10000 ms (**10 seconds**) with no profile loaded. The bundled
  profiles set their own: **5 minutes** in economy, **10 minutes** in flagship. Set
  `LLM_MODEL_RESOLVER_TIMEOUT_MS` or pass `timeoutMs` per call to override either.
- `cooldownMs?` — default 60000 ms. After a failed fetch the provider is skipped for
  60 seconds rather than retried on every call.

---

## Known-bad model tracking

A model can be listed in a provider's `/models` response and still fail the actual API
call. Gemini has returned 404 for models its own listing still showed (account-tier
gating). Mark it bad on 404 or 403 — not on 429 or 5xx — and every subsequent
`resolveModel()` skips it:

```js
const { resolveModel, markModelBad } = require('llm-model-resolver');

let r = await resolveModel('gemini', key, { fallback: 'gemini-flash-latest' });
try {
  return await callGemini(r.id, prompt);
} catch (e) {
  if (e.status !== 404 && e.status !== 403) throw e;
  markModelBad('gemini', r.id);
  r = await resolveModel('gemini', key, { fallback: 'gemini-flash-latest' });
  return await callGemini(r.id, prompt);   // second failure throws
}
```

The known-bad set is in-memory only (process lifetime). See the design note in `index.js`
before adding persistence or a TTL — it is intentional.

---

## Fallbacks

The fallback is what you get when the live list cannot be used. Each profile sets its own:

| Provider | Economy (default) | Flagship |
|----------|-------------------|----------|
| `xai` | `grok-4.3` | `grok-4` |
| `anthropic` | `claude-haiku-4-5` | `claude-sonnet-5` |
| `gemini` | `gemini-flash-latest` | `gemini-flash-latest` |
| `openrouter` | `openrouter/free` | `openrouter/free` |

Order of precedence: `options.fallback` on a call, then the active profile or config file,
then these environment variables:

```bash
XAI_MODEL_FALLBACK=…          # or GROK_MODEL_FALLBACK
ANTHROPIC_MODEL_FALLBACK=…
GEMINI_MODEL_FALLBACK=…
OPENROUTER_MODEL_FALLBACK=…   # or OPENROUTER_FREE_FALLBACK
LLM_MODEL_RESOLVER_TIMEOUT_MS=…
```

Because both bundled profiles set a fallback for `xai`, `anthropic` and `gemini`, the
`*_MODEL_FALLBACK` variables for those three have no effect while a bundled profile is
active; they apply to `openrouter`, and to any provider whose profile or config sets no
fallback.

---

## Potential future work

Deliberately not built; listed here so the tradeoffs are visible to anyone extending
the package.

**Cost-aware ranking.** `prefer` handles the reasoning-model case by name. A more general
fix would rank on expected cost per request: input price plus output price (xAI returns
`completion_text_token_price` already), with a caller-supplied weight for reasoning tokens.
It was not built because the shape of "expected" depends on the caller's workload.

**Per-provider pricing files.** The suggestion was to split `knownPrices` into separate
`pricing/anthropic.yml`, `pricing/gemini.yml` files rather than keeping them inline in
`economy.yml`. The current inline approach is sufficient for a small table you update
quarterly; a separate file structure would make sense if pricing data grew large enough
to warrant it or if multiple profiles needed to share the same price data.

**External pricing catalogue as a source.** OpenRouter's `/api/v1/models` returns
`pricing.prompt` and `pricing.completion` for models from Anthropic, Google and others.
This could serve as a price-discovery mechanism for providers whose own APIs return no
pricing. It was intentionally not implemented: OpenRouter's prices are what you pay to
route *through* OpenRouter (including their margin), not what a direct Anthropic or
Gemini API call costs. Using it to compare against a direct xAI call would be comparing
apples to oranges. The `maintained` table is the correct level of trust for now; an
external catalogue could be added as a *validation* mechanism (flag when OpenRouter's
price deviates significantly from the table) rather than as the source of truth.

**Multi-dimensional pricing.** Providers charge differently for cached vs. uncached
input, long-context tiers, batch requests, and reasoning tokens. The current `priceIn`
is the base uncached input rate — a deliberate simplification for model *selection*,
explicitly documented as such. A more complete pricing model belongs in the application
doing cost accounting (Quarry's `MODEL_PRICES` table in `tagger.js`), not here.

**Version sorting for xAI.** The resolver sorts xAI models by the `created` timestamp
from the API rather than by parsing version numbers from the ID. This is correct because
xAI IDs like `grok-4.20-0309` and `grok-4.3` are not monotonic version numbers, so
timestamp is the only reliable ordering signal. If xAI ever stabilises a version-number
scheme, a version-aware sort could replace the timestamp sort for `order: newest`.

**Inference-time capability filtering.** The Anthropic and xAI model lists are filtered
by name patterns only; Gemini's list is additionally filtered by `supportedGenerationMethods`.
A future version could use an inference-time capability check (probe a model with a
minimal prompt before accepting it) to catch models that are listed but not callable for
this account. This was not built because it adds latency and a billed API call to every
cold startup.

---

## Design notes

- **In-memory cache** — one `/models` fetch per provider per process.
- **Pin skips the network** — use it when cost predictability matters more than "latest".
- **Cheapest never silently means newest** — if no price data exists, a warning is emitted.
- **Cheapest is not the same as cheap to run** — price ranks input tokens only; `prefer`
  keeps economy off models that bill a lot of hidden reasoning output.
- **Fails toward a known model** — network error, timeout, empty list → your fallback.
- **Zero core dependencies** — only what Node 18+ provides. `js-yaml` is optional and only
  needed for loading custom YAML files with `loadConfig()`; bundled profiles use `.js`.

---

## License

MIT
