/// <reference path="./core.d.ts" />
/// <reference path="./anime-torrent-provider.d.ts" />

const TORRENTIO_BASE = "https://torrentio.strem.fun"
const DEFAULT_CONFIG = "sort=qualitysize|qualityfilter=cam,scr,unknown"
const ARM_API = "https://arm.haglund.dev/api/v2/ids"
const YUNA_API = "https://relations.yuna.moe/api/ids"

interface TorrentioStream {
    name: string
    title: string
    infoHash: string
    fileIdx?: number
    behaviorHints?: { bingeGroup?: string; filename?: string }
    sources?: string[]
}

interface ResolvedIds {
    kitsuId?: number
    imdbId?: string
    malId?: number
}

function parseSizeToBytes(text: string): number {
    const m = text.match(/([\d.]+)\s*(B|KB|MB|GB|TB)/i)
    if (!m) return 0
    const value = parseFloat(m[1])
    const unit = m[2].toUpperCase()
    const mult: { [u: string]: number } = {
        B: 1, KB: 1024, MB: 1048576, GB: 1073741824, TB: 1099511627776,
    }
    return Math.round(value * (mult[unit] || 1))
}

function parseStreamMeta(title: string): { seeders: number; sizeBytes: number; source: string } {
    const seedM = title.match(/👤\s*(\d+)/)
    const sizeM = title.match(/💾\s*([\d.]+\s*(?:B|KB|MB|GB|TB))/i)
    const srcM = title.match(/⚙️\s*([^\n]+)/)
    return {
        seeders: seedM ? parseInt(seedM[1], 10) : 0,
        sizeBytes: sizeM ? parseSizeToBytes(sizeM[1]) : 0,
        source: srcM ? srcM[1].trim() : "",
    }
}

function buildMagnet(infoHash: string, displayName: string, sources: string[]): string {
    let magnet = "magnet:?xt=urn:btih:" + infoHash
    if (displayName) magnet += "&dn=" + encodeURIComponent(displayName)
    const list = sources || []
    for (let i = 0; i < list.length; i++) {
        const s = list[i]
        if (s.indexOf("tracker:") === 0) {
            magnet += "&tr=" + encodeURIComponent(s.slice("tracker:".length))
        }
    }
    return magnet
}

function detectBatch(name: string): boolean {
    const n = name.toLowerCase()
    if (/\b(batch|complete|collection)\b/.test(n)) return true
    if (/s\d{1,2}\s*[-~]\s*s\d{1,2}/i.test(name)) return true
    if (/\b\d{1,3}\s*[-~]\s*\d{1,3}\b/.test(name)) return true
    return false
}

function parseResolution(name: string): string {
    const m = name.match(/(2160p|1080p|720p|480p|360p|4k)/i)
    return m ? m[1].toLowerCase() : ""
}

function resolutionMatches(resolution: string, wanted: string): boolean {
    if (!wanted) return true
    const w = wanted.toLowerCase().replace("p", "")
    const r = resolution.toLowerCase().replace("4k", "2160")
    return r.indexOf(w) !== -1
}

function firstLine(s: string): string {
    return (s || "").split("\n")[0].trim()
}

function dedupeByHash(list: AnimeTorrent[]): AnimeTorrent[] {
    const seen: { [k: string]: boolean } = {}
    const out: AnimeTorrent[] = []
    for (let i = 0; i < list.length; i++) {
        const t = list[i]
        const key = (t.infoHash || t.magnetLink || t.name).toLowerCase()
        if (seen[key]) continue
        seen[key] = true
        out.push(t)
    }
    return out
}

class Provider {
    private cache: { [anilistId: number]: ResolvedIds } = {}

    getSettings(): AnimeProviderSettings {
        return {
            type: "special",
            canSmartSearch: true,
            smartSearchFilters: ["batch", "episodeNumber", "resolution"],
            supportsAdult: false,
        }
    }

    private streamToTorrent(s: TorrentioStream, confirmed: boolean): AnimeTorrent {
        const name = firstLine(s.title) || (s.behaviorHints && s.behaviorHints.filename) || s.name || "Unknown"
        const meta = parseStreamMeta(s.title || "")
        const resolution = parseResolution(s.name || name)
        return {
            name: name,
            date: "",
            size: meta.sizeBytes,
            formattedSize: "",
            seeders: meta.seeders,
            leechers: 0,
            downloadCount: 0,
            link: TORRENTIO_BASE + "/#" + s.infoHash,
            downloadUrl: "",
            magnetLink: buildMagnet(s.infoHash, name, s.sources || []),
            infoHash: s.infoHash,
            resolution: resolution,
            isBatch: detectBatch(name),
            episodeNumber: -1,
            releaseGroup: "",
            isBestRelease: false,
            confirmed: confirmed,
        }
    }

    private async resolveIds(media: Media): Promise<ResolvedIds> {
        if (this.cache[media.id]) return this.cache[media.id]
        let resolved: ResolvedIds = {}

        try {
            const res = await fetch(ARM_API + "?source=anilist&id=" + media.id, { timeout: 15 })
            if (res.ok) {
                const d = res.json<any>()
                if (d) {
                    resolved = {
                        kitsuId: d.kitsu || undefined,
                        imdbId: d.imdb || undefined,
                        malId: d.myanimelist || undefined,
                    }
                }
            }
        } catch (e) {
            console.error("Torrentio: ARM lookup failed: " + (e as Error).message)
        }

        if (!resolved.kitsuId) {
            try {
                const res = await fetch(YUNA_API + "?source=anilist&id=" + media.id, { timeout: 15 })
                if (res.ok) {
                    const d = res.json<any>()
                    if (d && d.kitsu) resolved.kitsuId = d.kitsu
                }
            } catch (e) {
                console.error("Torrentio: yuna lookup failed: " + (e as Error).message)
            }
        }

        if (resolved.kitsuId || resolved.imdbId) {
            this.cache[media.id] = resolved
        }
        return resolved
    }

    private getConfigSegment(): string {
        const user = ($getUserPreference("torrentioConfig") || "").trim()
        const seg = user || DEFAULT_CONFIG
        return seg.replace(/\|/g, "%7C")
    }

    private base(): string {
        const cfg = this.getConfigSegment()
        return cfg ? TORRENTIO_BASE + "/" + cfg : TORRENTIO_BASE
    }

    private seriesUrl(kitsuId: number, ep: number): string {
        return this.base() + "/stream/series/kitsu:" + kitsuId + ":" + ep + ".json"
    }

    private movieUrl(kitsuId: number): string {
        return this.base() + "/stream/movie/kitsu:" + kitsuId + ".json"
    }

    private imdbSeriesUrl(imdb: string, season: number, ep: number): string {
        return this.base() + "/stream/series/" + imdb + ":" + season + ":" + ep + ".json"
    }

    private imdbMovieUrl(imdb: string): string {
        return this.base() + "/stream/movie/" + imdb + ".json"
    }

    private async fetchStreams(url: string): Promise<TorrentioStream[]> {
        console.log("Torrentio: fetching " + url)
        const res = await fetch(url, { timeout: 30 })
        if (!res.ok) return []
        const data = res.json<{ streams?: TorrentioStream[] }>()
        return (data && data.streams) ? data.streams : []
    }

    private isMovieOrSingle(media: Media): boolean {
        return media.format === "MOVIE" || media.episodeCount === 1
    }

    async search(opts: AnimeSearchOptions): Promise<AnimeTorrent[]> {
        try {
            const media = opts.media
            const ids = await this.resolveIds(media)
            const movieOrSingle = this.isMovieOrSingle(media)

            let streams: TorrentioStream[] = []
            if (ids.kitsuId) {
                streams = movieOrSingle
                    ? await this.fetchStreams(this.movieUrl(ids.kitsuId))
                    : await this.fetchStreams(this.seriesUrl(ids.kitsuId, 1))
            } else if (ids.imdbId) {
                streams = movieOrSingle
                    ? await this.fetchStreams(this.imdbMovieUrl(ids.imdbId))
                    : await this.fetchStreams(this.imdbSeriesUrl(ids.imdbId, 1, 1))
            } else {
                return []
            }

            return dedupeByHash(streams.map(s => this.streamToTorrent(s, !!ids.kitsuId)))
        } catch (e) {
            console.error("Torrentio: search error: " + (e as Error).message)
            return []
        }
    }

    async smartSearch(opts: AnimeSmartSearchOptions): Promise<AnimeTorrent[]> {
        try {
            const media = opts.media
            const ids = await this.resolveIds(media)
            const movieOrSingle = this.isMovieOrSingle(media)
            const ep = opts.episodeNumber > 0 ? opts.episodeNumber : 1

            let streams: TorrentioStream[] = []
            if (ids.kitsuId) {
                streams = movieOrSingle
                    ? await this.fetchStreams(this.movieUrl(ids.kitsuId))
                    : await this.fetchStreams(this.seriesUrl(ids.kitsuId, ep))
            } else if (ids.imdbId) {
                streams = movieOrSingle
                    ? await this.fetchStreams(this.imdbMovieUrl(ids.imdbId))
                    : await this.fetchStreams(this.imdbSeriesUrl(ids.imdbId, 1, ep))
            } else {
                return []
            }

            let torrents = streams.map(s => this.streamToTorrent(s, !!ids.kitsuId))

            if (!movieOrSingle) {
                torrents = opts.batch
                    ? torrents.filter(t => t.isBatch)
                    : torrents.filter(t => !t.isBatch)
            }

            if (opts.resolution) {
                torrents = torrents.filter(t => resolutionMatches(t.resolution || "", opts.resolution))
            }

            return dedupeByHash(torrents)
        } catch (e) {
            console.error("Torrentio: smartSearch error: " + (e as Error).message)
            return []
        }
    }

    async getLatest(): Promise<AnimeTorrent[]> {
        return []
    }

    async getTorrentInfoHash(torrent: AnimeTorrent): Promise<string> {
        return torrent.infoHash || ""
    }

    async getTorrentMagnetLink(torrent: AnimeTorrent): Promise<string> {
        return torrent.magnetLink || ""
    }
}
