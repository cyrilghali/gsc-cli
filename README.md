# gsc-cli

[![CI](https://github.com/cyrilghali/gsc-cli/actions/workflows/ci.yml/badge.svg)](https://github.com/cyrilghali/gsc-cli/actions/workflows/ci.yml)

Google Search Console from the command line: search analytics, sitemaps, URL inspection.

Ships three binaries: **`gsc`** (Search Console, needs your Google credentials), **`gtrends`** (Google Trends, no auth — see [below](#gtrends-google-trends)), and **`gpain`** (community pain-signal mining, no auth — see [below](#gpain-pain-signal-mining)).

```
$ gsc query sc-domain:example.com --days 28
QUERY                CLICKS  IMPRESSIONS    CTR  POSITION
-------------------  ------  -----------  -----  --------
best running shoes      412       10,022  4.11%       6.2
trail shoes women       188        4,510  4.17%       8.9
…
```

## Install

```sh
git clone https://github.com/cyrilghali/gsc-cli.git
cd gsc-cli
npm install     # also compiles (runs prepare → npm run build)
npm link        # puts both `gsc` and `gtrends` on your PATH
```

Requires Node ≥ 20 (≥ 23.6 to run the tests, which execute TypeScript directly).

## Setup (one-time)

The Search Console API requires your own Google Cloud credentials — there is no shared API key.

1. Create (or pick) a project on [Google Cloud Console](https://console.cloud.google.com/) and enable the **Google Search Console API** (APIs & Services → Library).
2. Choose an auth method:

**Option A — OAuth (your own Google account)**

1. APIs & Services → Credentials → Create credentials → **OAuth client ID** → type **Desktop app**.
2. Download the client JSON, then:

```sh
gsc auth login --credentials ~/Downloads/client_secret_xxx.json
```

A browser window opens; sign in with the Google account that has access to your Search Console properties. Tokens are stored in `~/.config/gsc-cli/` (mode 600) and refresh automatically. Add `--readonly` if you only need to read data.

**Option B — service account (headless, CI)**

1. IAM & Admin → Service Accounts → create one → Keys → add a **JSON** key.
2. In [Search Console](https://search.google.com/search-console) → Settings → Users and permissions, add the service account email as a user of each property.
3. Then either:

```sh
gsc auth login --service-account ~/keys/gsc-sa.json
# or, without storing anything:
export GOOGLE_APPLICATION_CREDENTIALS=~/keys/gsc-sa.json
```

## Usage

Property URLs are either URL-prefix (`https://example.com/`) or domain (`sc-domain:example.com`) — use exactly what `gsc sites list` shows. Set a default once to stop repeating it:

```sh
gsc sites list
gsc sites use sc-domain:example.com
```

### Search analytics

```sh
gsc query                                        # top queries, last 28 final days
gsc query --dimensions page --sort impressions   # top pages
gsc query --dimensions query,page --limit 5000 --output csv > top.csv
gsc query --dimensions date --days 90 --output json | jq '.[].clicks'
gsc query --filter "query contains chaussures" --filter "country equals fra"
gsc query --dimensions page --filter "page includingRegex ^https://example.com/blog/"
gsc query --type discover --days 7 --fresh       # fresh (non-final) Discover data
```

- Dimensions: `query`, `page`, `country`, `device`, `date`, `searchAppearance`.
- Filters: `"<dimension> <operator> <expression>"`, repeatable (ANDed). Filterable dimensions: `query`, `page`, `country`, `device`, `searchAppearance` — `date` is not filterable, bound the period with `--start`/`--end` instead. Operators: `contains`, `equals`, `notContains`, `notEquals`, `includingRegex`, `excludingRegex` ([RE2 syntax](https://github.com/google/re2/wiki/Syntax)). Countries are ISO 3166-1 alpha-3 codes (`fra`, `usa`…), devices are `desktop`/`mobile`/`tablet`.
- Dates default to a 28-day window ending 3 days ago (Search Console data is only final after ~3 days); override with `--days`, `--start`/`--end`, or include today's partial data with `--fresh`.
- The API only orders by clicks. `--sort` therefore fetches the whole dataset (up to 100 000 rows) before keeping the top `--limit` rows, so the ranking is global. `--asc` alone means `--sort clicks --asc`.
- `--limit` above 25 000 paginates automatically. `table` output is for humans (formatted numbers, summary on stderr); `csv`/`json` emit raw values for machines.

### Sitemaps

```sh
gsc sitemaps                                      # list (default subcommand)
gsc sitemaps submit https://example.com/sitemap.xml
gsc sitemaps submit sitemap.xml                   # relative path, URL-prefix properties only
gsc sitemaps delete https://example.com/old-sitemap.xml
```

### URL inspection

```sh
gsc inspect https://example.com/some-page
gsc inspect https://example.com/some-page --output json
```

Shows the index verdict, coverage state, canonicals, last crawl time, referring URLs and rich results, plus a deep link to the full report in Search Console.

### Indexing

Request that Google crawls (or removes) a URL via the [Indexing API](https://developers.google.com/search/apis/indexing-api/v3/quickstart):

```sh
gsc index request https://example.com/new-page
gsc index request https://example.com/a https://example.com/b https://example.com/c
gsc index request https://example.com/gone --deleted    # signal URL_DELETED
gsc index request https://example.com/page --output json

gsc index status https://example.com/page               # last notification metadata
gsc index status https://example.com/page --output json
```

**Re-auth required** — `gsc index` uses Google's Indexing API which requires an additional OAuth scope. If you have existing tokens, run `gsc auth login` again (without `--readonly`) to add the indexing scope.

**Caveat** — Google officially limits the Indexing API to pages with `JobPosting` or `BroadcastEvent` structured data. In practice it reliably triggers a crawl for most URLs, but indexing is never guaranteed. Default quota: 200 URLs/day per Google Cloud project.

`--deleted` emits a `URL_DELETED` notification (use for pages you have removed). The default notification type is `URL_UPDATED`. A 404 from `gsc index status` means the URL was never submitted via the Indexing API — it is not an error.

### Properties

```sh
gsc sites list
gsc sites add https://new-site.example/
gsc sites remove https://old-site.example/
```

`add`/`remove` and sitemap `submit`/`delete` need full scope — they fail politely if you logged in with `--readonly`.

## `gtrends` (Google Trends)

A second binary for Google Trends. It needs **no auth and no setup** — it talks to Trends' undocumented internal endpoints (the same ones the website calls), so it can hit rate limits (HTTP 429); it retries with backoff and tells you to wait if it gives up.

```
$ gtrends interest chatgpt claude --geo US
SERIES   TREND (53 pts)                                    MIN  AVG  MAX  NOW
-------  ------------------------------------------------  ---  ---  ---  ---
chatgpt  ▃▄▅▆▆▅▅▆▆▇█▇▇▇▇█▇█▆▄▆▆▄▁▂▄▅▄▅▃▄▅▅▆▄▆▅▄▅▄▄▅▄▄▄▅▃▃   54   80  100   65
claude   ▁▁▁▁▁▁▁▁▁▁▁▁▂▁▁▁▁▁▂▁▂▁▁▁▁▂▂▃▃▄▄▅█▇▆▇█▇▇▆▆▆▆█▇█▆▅    4   14   33   23
```

```sh
gtrends interest "bitcoin"                       # interest over time as a sparkline (0–100)
gtrends interest pizza sushi tacos --geo US       # compare up to 5 terms
gtrends interest "climatiseur mobile" --geo FR,BE,CH,LU   # one term across geos, cross-comparable
gtrends interest chatgpt --time "today 5-y" --output csv > interest.csv
gtrends related "electric car" --geo US           # top (established) + rising (breakout) queries
gtrends trending --geo FR                          # today's trending searches
gtrends suggest "crm" -n 5                         # commercial-intent keyword expansion via Autocomplete
gtrends shocks --geo FR --seeds "climatiseur"      # demand shocks: trending + breakouts probed for purchase intent
```

- Values are Google's own 0–100 scale, relative to each series' own peak (100). `--geo` takes a two-letter country (`trending` defaults to US; `interest` and `related` default to worldwide); `interest` also accepts a comma-separated list (`--geo FR,BE,CH,LU`) to compare one keyword across countries on a single shared scale — keywords × geos must stay ≤ 5. `--time` (`now 1-H`, `now 4-H`, `now 1-d`, `now 7-d`, `today 1-m`, `today 3-m`, `today 12-m`, `today 5-y`, `all`) and `--category` apply to both `interest` and `related`.
- Because every series is normalized to its own peak, a term with almost no volume still shows `100`. `interest` flags such series in the table: `⚠noise` (negligible or just emerging) or `~seasonal` (dormant between recurring peaks), so a normalized `100` isn't misread as real popularity.
- `table` output draws sparklines for humans; `csv`/`json` emit the full timeline / ranked lists for machines.
- `shocks` detects demand spikes younger than the market's reaction time — the regime where high volume and zero competitors coexist for a few weeks. It reads today's trending searches (plus rising breakouts ≥1000% for `--seeds` categories) and probes each candidate with Autocomplete for purchase-intent completions ("en stock", "where to buy", retailer names, "dupe"); long breakout queries are also probed on their 2-token product core. A news topic scores near 0 whatever its traffic; a product people are hunting scores near 1. Snapshot the JSON daily and diff — a shock is only actionable while it is new.
- No credentials are stored — nothing to log in to, nothing under `~/.config`.

## `gpain` (pain-signal mining)

A third binary for mining community pain signals — the raw material of micro-SaaS opportunity scanning. No auth: it queries the [HN Algolia API](https://hn.algolia.com/api) (comments) and the [dev.to Forem API](https://developers.forem.com/api/v1) (articles), scores each hit against a table of pain-phrase patterns ("would happily pay", "frustrating", "spreadsheet", …) anchored near your search term, and ranks the results.

```sh
gpain mine "invoicing" "crm" --days 90 -o json     # pain signals per term, weighted and deduped
gpain mine "zapier alternative" -o json | gpain score /dev/stdin
gpain saturate "crm" "crm for dentists" -o json    # market-saturation proxies per term
gpain enrich "crm for dentists" -o table           # volume/CPC/difficulty via DataForSEO (paid)
gpain score signals.json \
  --keywords-file suggest.json \                    # gtrends suggest -o json (commercial-intent weight)
  --trend-file related.json \                       # gtrends related -o json (trend velocity weight)
  --saturation-file saturation.json                 # gpain saturate -o json (re-ranks by opportunity)
```

- `mine` emits one record per matching comment/article: `term`, `source`, `weight`, `matched_phrase`, `url`, plus `multi_url_pain_match` when a term matched ≥3 distinct URLs.
- `saturate` estimates how crowded the market behind a term is, from free proxies: Google Autocomplete density on `{term} vs` / `{term} alternatives` (comparison queries only exist around established incumbents) and Show HN launch count over `--days` (default 730). Every completion and title is filtered through anchored root matching before counting, so typo-tolerant matches ("mental" for "dental") and off-topic drift don't inflate the score. `presence` counts completions for the term itself — a niche with presence 0 has no search demand, low saturation alone is not a green light. Measured gradient: crm 1.00, invoicing 0.79, screenshot api 0.40, crm for dentists 0.00.
- `score` combines keyword-pattern weight (0.35), trend velocity (0.25), and pain depth (0.40, with a 1.2× bonus when a workaround phrase like "manually" or "spreadsheet" was detected) into a demand score ∈ [0,1], and always writes a snapshot (`--out`, default under `~/.claude/saas-suite/snapshots/`) so successive scans can be diffed. With `--saturation-file`, each matched term also gets `accessibility = 1 − saturation` and `opportunity = score × accessibility`, and the ranking switches to opportunity — high demand in a saturated market is not an opportunity. Unmatched terms carry `null` (unevaluated ≠ open).
- `enrich` is the only paid stage: it batches terms (≤1000) through DataForSEO's Google Ads search-volume and Labs keyword-difficulty live endpoints and prints the actual billed cost on stderr (~$0.05–0.10 per batch). Credentials come from `DATAFORSEO_LOGIN`/`DATAFORSEO_PASSWORD` or `~/.config/gsc-cli/dataforseo.json` (store them with `gpain enrich --save-auth 'login:password'`). Feeding the output to `score --enrichment-file` attaches per-term metrics plus a `sweet_spot` verdict — micro volume (50–2000/mo), monetizable (CPC ≥ $2), low difficulty (KD < 30) — which gates the P1 label without changing the opportunity ranking.
- Sources fail independently: if one API is down its failure is reported on stderr and the others still contribute; the command errors only when every source failed.

## Development

```sh
npm test        # unit tests (node:test, runs the TypeScript sources directly)
npm run build   # tsc → dist/
```

No runtime dependencies beyond `commander` and `picocolors`; Google APIs are called directly over REST (`fetch`), including the OAuth PKCE loopback flow and service-account JWT signing.

## License

MIT
