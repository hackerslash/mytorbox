# MyTorbox

A [Stremio](https://www.stremio.com/) addon that turns your [TorBox](https://torbox.app/) library into browsable Movie and Series catalogs, enriched with [TMDB](https://www.themoviedb.org/) posters/metadata and optional [RPDB](https://ratingposterdb.com/) rated posters.

## Features

- **Library catalog** — your TorBox torrents and web downloads, grouped by title/season/episode and matched against TMDB.
- **Custom Streams** — add your own IMDb id + direct stream URL; it shows up as a separate "Custom Streams" catalogue in Stremio and self-deletes when its TTL expires. Requires `REDIS_URL`.
- **Configure page** (`/configure`) — enter your keys, validate them live, and generate a personal install link for Stremio or Nuvio.
- Stateless by design: your API keys are embedded in the install URL itself, not stored server-side (see [Security](#security) below).

## Quick Setup

Don't want to self-host? Use the hosted instance: **[mytorbox.vercel.app/configure](https://mytorbox.vercel.app/configure)** — enter your keys and generate an install link, no setup required.

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
| `PORT`           | no       | Port to listen on. Defaults to`7000`.                                                                                                                                                  |
| `BASE_URL`       | no       | Public base URL used to build the manifest's logo URL. Falls back to Vercel's own URL when deployed there.                                                                               |
| `REDIS_URL`      | no       | Redis connection string. Powers the library cache and is**required** for Custom Streams — without it, custom streams silently no-op and the library is cached in-process instead. |

If none of `TORBOX_API_KEY`/`TMDB_API_KEY` are set, every install must go through `/configure` with its own keys (`behaviorHints.configurationRequired` is set accordingly in the manifest).

## Usage

1. Get a [TorBox API key](https://torbox.app/settings) and a [TMDB API key](https://www.themoviedb.org/settings/api) (optionally a [RPDB key](https://ratingposterdb.com/api-key/) for rated posters).
2. Open `/configure`, enter the keys, and click **Generate Install Link**.
3. Install via the **Install in Stremio** button, or copy the manifest URL into Nuvio (`Settings → Addons → Add Addon`).

## Deploying

Configured for [Vercel](https://vercel.com) out of the box (`vercel.json` rewrites everything to `api/index.js`). Set the environment variables above in the Vercel project settings, and add a Redis instance (e.g. Upstash) if you want Custom Streams and cross-request library caching.

## Security

The manifest URL encodes your API keys (base64url of a small JSON payload) and is the *only* thing standing between someone and your TorBox library — treat it like a password. The server never persists your keys; Redis caching keys off a SHA-256 hash of them rather than the raw values, so nothing readable comes back out even with direct Redis access.
