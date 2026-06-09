# Seanime Torrentio

A [Seanime](https://seanime.rahim.app) `anime-torrent-provider` extension that finds anime
torrents via [Torrentio](https://torrentio.strem.fun).

## Configuration

The extension has one optional setting: **Torrentio options (advanced)**.

Leave it **empty** and the extension uses sensible anime defaults
(`sort=qualitysize|qualityfilter=cam,scr,unknown`, which sorts by quality and size, and drops
cam/screener/unknown releases). Most users never need to change this.

If you fill it in, your value is used as Torrentio's configuration segment and injected into
every request, e.g.:

```
https://torrentio.strem.fun/<your-options>/stream/series/kitsu:7442:5.json
```

You can use any options from Torrentio's [configure page](https://torrentio.strem.fun/configure),
joined with `|`. Examples:

- `sort=seeders`: prioritise the most-seeded torrents
- `qualityfilter=cam,scr,unknown,480p`: also exclude 480p
- `providers=nyaasi,tokyotosho`: restrict to specific sources
- `limit=5`: cap results per quality tier
- `realdebrid=YOURKEY` (or `alldebrid=`, `premiumize=`, etc.): let Torrentio resolve cached
  streams via your debrid account

**Tip:** the easiest way to build a value is to open the
[configure page](https://torrentio.strem.fun/configure), pick your options, and copy the segment
from the generated install URL, i.e. the part between `torrentio.strem.fun/` and `/manifest.json`.

> A debrid key here is optional. Seanime handles debrid itself, and this extension returns raw
> torrents (info hash + magnet) regardless, so the default works fine without one.
