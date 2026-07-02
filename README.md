# gsc-cli

Google Search Console from the command line: search analytics, sitemaps, URL inspection.

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
npm install
npm run build
npm link        # makes `gsc` available on your PATH
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
- Filters: `"<dimension> <operator> <expression>"`, repeatable (ANDed). Operators: `contains`, `equals`, `notContains`, `notEquals`, `includingRegex`, `excludingRegex` ([RE2 syntax](https://github.com/google/re2/wiki/Syntax)). Countries are ISO 3166-1 alpha-3 codes (`fra`, `usa`…), devices are `desktop`/`mobile`/`tablet`.
- Dates default to a 28-day window ending 3 days ago (Search Console data is only final after ~3 days); override with `--days`, `--start`/`--end`, or include today's partial data with `--fresh`.
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

### Properties

```sh
gsc sites list
gsc sites add https://new-site.example/
gsc sites remove https://old-site.example/
```

`add`/`remove` and sitemap `submit`/`delete` need full scope — they fail politely if you logged in with `--readonly`.

## Development

```sh
npm test        # unit tests (node:test, runs the TypeScript sources directly)
npm run build   # tsc → dist/
```

No runtime dependencies beyond `commander` and `picocolors`; Google APIs are called directly over REST (`fetch`), including the OAuth PKCE loopback flow and service-account JWT signing.

## License

MIT
