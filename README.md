# MyTorbox

A [Stremio](https://www.stremio.com/) addon that turns your [TorBox](https://torbox.app/) library into browsable Movie and Series catalogs, enriched with [TMDB](https://www.themoviedb.org/) posters/metadata and optional [RPDB](https://ratingposterdb.com/) rated posters.

## Features

- **Library catalog** — your TorBox torrents and web downloads, grouped by title/season/episode and matched against TMDB.
- **Poster artwork** — TMDB by default, or swap in [RPDB](https://ratingposterdb.com/) rated posters, or any poster service addressable by IMDb id via a URL pattern like `https://btttr.cc/poster/imdb/poster-default/{imdb_id}.jpg`. RPDB and a custom URL are mutually exclusive; the custom URL wins. Applies to every catalogue, custom streams included.
- **Custom Streams** — add your own IMDb id + direct stream URL; it shows up as a separate "Custom Streams" catalogue in Stremio and self-deletes when its TTL expires. Requires `REDIS_URL`.
- **Configure page** (`/configure`) — enter your keys, validate them live, and generate a personal install link for Stremio or Nuvio.
- **Stats dashboard** (`/stats`) — admin-only view of active users, traffic, cache efficiency and library sizes, computed from the Redis keyspace. Requires `ADMIN_SECRET` and `REDIS_URL`.
- Stateless by design: your API keys are embedded in the install URL itself, not stored server-side (see [Security](#security) below).

## Quick Setup

Don't want to self-host? Use the hosted instance: **[mytorbox.hackerslash.dev/configure](https://mytorbox.hackerslash.dev/configure)** — enter your keys and generate an install link, no setup required.

## Development Setup

```bash
npm install
cp .env.example .env   # fill in the values below
npm run dev            # or: npm start
```

Then open `http://localhost:7000/configure`.

## Environment variables

| Variable           | Required | Description                                                                                                                                                                              |
| ------------------ | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `TORBOX_API_KEY` | no       | Default TorBox key, used when no per-user key is present in the request URL. Handy for local dev/single-user hosting.                                                                    |
| `TMDB_API_KEY`   | no       | Default TMDB key, same idea.                                                                                                                                                             |
| `RPDB_API_KEY`   | no       | Default RatingPosterDB key, same idea.                                                                                                                                                   |
| `POSTER_URL`     | no       | Default custom poster URL pattern containing `{imdb_id}`, e.g. `https://btttr.cc/poster/imdb/poster-default/{imdb_id}.jpg`. Takes precedence over `RPDB_API_KEY`.                         |
| `PORT`           | no       | Port to listen on. Defaults to`7000`.                                                                                                                                                  |
| `BASE_URL`       | no       | Public base URL used to build the manifest's logo URL (e.g.`https://your-domain`). If unset, relative URLs are used.                                                                     |
| `REDIS_URL`      | no       | Redis connection string. Powers the library cache and is**required** for Custom Streams — without it, custom streams silently no-op and the library is cached in-process instead. |
| `ADMIN_SECRET`   | no       | Unlocks`/stats` and `POST /api/cache/clear`. Unset means both are disabled (`503`), not open.                                                                                     |
| `STATS_ENABLED`  | no       | Set to`0` to stop recording usage counters. Defaults to on when `REDIS_URL` is set.                                                                                              |
| `STATS_FLUSH_SECONDS` | no  | How often buffered counters are written to Redis. Defaults to`60`. This interval — not request volume — determines the ongoing Redis command cost.                                |

If none of `TORBOX_API_KEY`/`TMDB_API_KEY` are set, every install must go through `/configure` with its own keys (`behaviorHints.configurationRequired` is set accordingly in the manifest).

## Usage

1. Get a [TorBox API key](https://torbox.app/settings) and a [TMDB API key](https://www.themoviedb.org/settings/api) (optionally a [RPDB key](https://ratingposterdb.com/api-key/) for rated posters).
2. Open `/configure`, enter the keys, and click **Generate Install Link**.
3. Install via the **Install in Stremio** button, or copy the manifest URL into Nuvio (`Settings → Addons → Add Addon`).

## Stats

`/stats` is a self-contained dashboard built entirely from Redis keys — no external analytics. Open it, enter your `ADMIN_SECRET`, and it shows:

- **Users** — daily/7d/30d unique users (HyperLogLog over a SHA-256 of each key triple), new users, and how many libraries are currently cached.
- **Traffic** — requests per day and per hour, broken down by endpoint (manifest/catalog/meta/stream/configure/validate/custom-streams) with average latency and HTTP status mix.
- **Cache efficiency** — library cache hit rate, how often a revalidation skipped a rebuild via change detection, TMDB hit rate, and upstream TorBox/TMDB call volume.
- **Libraries** — total movies/series/episodes/stream links across all users, averages, and the largest libraries.
- **Custom streams**, **rate-limit activity**, and a **Redis keyspace** breakdown with memory usage.

How it works:

- Every counter lives under `st:*` with a ~31-day TTL, so the 30-day window prunes itself — nothing needs a cron job.
- Writes are buffered in-process and flushed as one pipeline on a timer (`STATS_FLUSH_SECONDS`, default 60), so **no request ever waits on Redis for stats** and the command cost is set by the interval rather than by traffic: ~20 commands per flush, ~30k/day, whether you serve a hundred requests or a million. Per-user uniqueness writes are throttled to once per user per 5 minutes. Measured in-process overhead is under 20µs per request.
- The tradeoff: an unclean restart loses up to one flush interval of counters. Lower `STATS_FLUSH_SECONDS` if that matters more than command volume.
- The dashboard payload needs a few `SCAN` passes, so it's cached for 60s (the **Refresh** button forces a recompute).
- Only hashes are stored — no API key, IP address, IMDb id, or filename ever reaches a stats key.

The page itself is gated: `/stats` serves nothing but a token prompt, and every number comes from `GET /api/stats`, which requires the secret (`x-admin-secret` header or `Authorization: Bearer`), compares it in constant time, and is rate limited to 40 requests / 5 min per IP.

## Deploying

Runs as a plain Node server (`npm start` → `index.js`), so it deploys to any container/VM host. Set the environment variables above, and add a Redis instance (e.g. Upstash) if you want Custom Streams and cross-request library caching.

Deployed on [IBM Code Engine](https://www.ibm.com/products/code-engine): every push to `main` triggers a rebuild via the `.github/workflows/deploy-ibm.yml` workflow (buildpacks, no Dockerfile needed).

## Security

The manifest URL encodes your API keys (base64url of a small JSON payload) and is the *only* thing standing between someone and your TorBox library — treat it like a password. The server never persists your keys; Redis caching keys off a SHA-256 hash of them rather than the raw values, so nothing readable comes back out even with direct Redis access. The usage counters behind `/stats` follow the same rule: they store that same hash and aggregate counts, never a credential, IP, or title.
