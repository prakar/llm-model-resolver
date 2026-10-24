# Changelog

## 1.5.2

### Fixed
- **Economy/Gemini price table was behind the listing.** `gemini-3.5-flash` and `3.6`/`3.7`/`3.8-flash` had no price
  and ranked last (correctly, by luck: they cost about 10x `gemini-2.5-flash`). Added prices from two secondary
  sources, not yet checked against Google's page: 3.5 Flash $1.50/$9.00, 3.6 to 3.8 Flash $0.75/$3.75 per million
  tokens. Google's rate for 3.6 to 3.8 is scheduled to double on 2027-01-01, so update them then.
- Economy/Gemini now excludes non-text models (`nano-banana`, `transcribe`, `robotics`, `computer-use`) and
  `*-latest` aliases, whose price can silently change when the alias moves. `gemini-flash-latest` is still the
  fallback. The former `gemini-flash-latest` price entry is removed.
- Eligible models still unpriced (`gemini-3-flash-preview`, the `omni` and `argon` models, at the time of
  writing) are left to the `LLM_RESOLVER_PRICE_INCOMPLETE` warning until someone confirms what they are.

## 1.5.1

### Fixed
- **Economy/Anthropic skipped the newest Haiku.** `claude-haiku-5-5` had no entry in `knownPrices`, and
  unpriced models rank last, so it was never chosen. Added `claude-haiku-5` ($0.10/$0.50 for prompts up to
  100k tokens; from two secondary sources, not yet checked against Anthropic's page). Economy now picks it.
- The `claude-haiku-3` key could never match `claude-3-haiku-20240307`; it is now `claude-3-haiku`.
- `fable` and `mythos` (flagship-tier, unpriced) are excluded from the economy profile for Anthropic.

### Added
- **`LLM_RESOLVER_PRICE_INCOMPLETE` warning** (once per provider per process): under `order: cheapest`,
  names eligible models that have no price and were therefore ranked last.

## 1.5.0

**Behavior change — read this.** The economy profile now prefers **non-reasoning** xAI models, and the
`non-reasoning` exclusion is gone from economy. Before, economy could only choose among reasoning models
and ranked them by input price alone, so on one account it picked `grok-build-0.1` ($1.00/M input, the
cheapest listed), which spent about 10.5k hidden reasoning tokens to return about 1.9k visible ones on a
single extraction call. With the same listing it now picks `grok-4.20-0309-non-reasoning`. To get the old
price-only behaviour pass `{ prefer: null }` to `resolveModel()` or remove `prefer` from the profile.
Flagship is unchanged. Run `node inspect.js xai` to see what you would get.

### Added
- **`prefer`** — a soft ranking rule. Models matching it rank ahead of every other eligible model; each
  group is then ordered by `order`. If nothing matches, it is ignored. Set it per provider in a profile or
  config (`prefer: "non-?reasoning"`), or per call (`resolveModel(p, key, { prefer: /re/ | 'str' | null })`).
  Shown as `preferred` on every candidate in `inspectModels()` and in `PREFERENCE` / `effectiveConfig()`.
- `node inspect.js <provider> --prefer <regex|none>` and a `prefer` line in its output.
- Types: `useProfile`, `AVAILABLE_PROFILES`, `prefer`, `preferred`, and `'cheapest'` in the `order` and
  `orderedBy` types (they were missing).

### Fixed
- **`npm test` did not run `test/readme.test.js`**, so README and type drift went unnoticed. It now runs
  every test file.
- Docs and comments that still said "flagship (default)" (the default has been economy since 1.3.0), the
  wrongly labelled block in `profiles/settings.yml`, the README's timeout defaults (flagship is 10 minutes,
  not 10 seconds), and the missing `no-key`, `/v1/models`, and inspection-result documentation.
- The README guard tests described the pre-1.3 layout and were failing; they now check each profile's own
  rules, fallbacks and timeouts.

## 1.4.1
- Clean test output; the `xl()` test mock includes realistic prices.

## 1.4.0
- **`order: cheapest`** using the live API price (`prompt_text_token_price` for xAI) or the maintained
  `knownPrices` table. The economy profile no longer needs a pin. Candidates carry `priceIn`, `priceOut`,
  `priceSource`, `priceConfidence`, `priceUpdated`.

## 1.3.0
- **Profiles.** `profiles/economy.yml` and `profiles/flagship.yml` ship in the package; the one-line switch
  `flagship_performance` in `profiles/settings.yml` chooses between them (economy is the default).
- `configure()`, `useProfile()`, `effectiveConfig()`, and `pin` support; `LLM_MODEL_RESOLVER_PROFILE`.

## 1.2.0

**Behavior change — read this.** The default is now **newest first**. Before, the resolver took the first
match in the provider's own order, which for xAI and Gemini is not guaranteed to be newest. This can change
which model you get. Pass `{ order: 'provider' }` for the old behavior, and run `node inspect.js <provider>`
to see what a resolution would pick before upgrading.

### Added
- **Recency ordering.** xAI by `created`, Anthropic by `created_at`, Gemini by the generation number in the ID
  (Gemini publishes no release date). Models with no signal sort after models that have one. `resolveModel()`
  now also returns `orderedBy`. Option: `order: 'newest' | 'provider'`.
- **`inspectModels()`** — explains a resolution: every listed model, its recency signal, and its status.
- **Request timeout** (default 10s, `timeoutMs` / `LLM_MODEL_RESOLVER_TIMEOUT_MS`), covering the body as well as
  the headers.
- **Fetch cool-down** (default 60s, `cooldownMs`) so a hung endpoint costs one timeout, not one per call.
- `fetchFreeModels()` / `getNextFreeModel()` accept an options object (`fetchFreeModels(key, true)` still works).
- `DEFAULT_TIMEOUT_MS`, `DEFAULT_COOLDOWN_MS` exports; `inspect.js` for checking against live keys.
- An offline test suite (`npm test`) and a README drift guard.

### Changed
- **xAI** is read from `/v1/language-models` (chat and image-understanding models only), falling back to `/v1/models`.
- **Anthropic** is requested with `limit=1000`; the API returns only 20 models per page otherwise.
- **Exclude rules.** xAI: added `image|imagine|video`. Gemini: added `image|audio`
  (`gemini-3-pro-image-preview` and similar advertise `generateContent` and would otherwise rank as a "pro" text model).
- **Default fallbacks:** `anthropic` → `claude-sonnet-5`, `gemini` → `gemini-flash-latest`
  (was `gemini-2.5-pro`, which is gated to accounts that used it before). `xai` and `openrouter` unchanged.

### Fixed
- OpenRouter: one failed fetch pinned the fallback for the rest of the process, and it was reported as `source: 'live'`.
- A failed refresh threw away a perfectly good cached list instead of continuing to serve it.
- Timeout errors never contain the API key (Gemini carries it in the URL).
- Comments no longer claim the lists are sorted "newest first" (only Anthropic documents that).

## 1.1.0 — changes made after the rename (all included in 1.2.0)
- `markModelBad()` and the in-memory known-bad set: a listed model can still fail the real call.
- Gemini: fixed a `ReferenceError` that made live resolution fall back on every real call.
- xAI: `non-reasoning` variants are skipped so the reasoning variant is preferred.
- Renamed from `failsafe-llm-model-resolver`.

## 1.0.0
- Initial release as `failsafe-llm-model-resolver`.
