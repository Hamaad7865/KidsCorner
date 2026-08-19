/**
 * The latest published Android till release, for the bootstrap payload.
 *
 * The till has no business talking to GitHub itself — the same principle as
 * Supabase and every other upstream this server fronts (see sale-core's own
 * note on why the till never reaches a backend directly). This is the one
 * place that asks GitHub, so the client's only trusted origin stays the till
 * API it already authenticates against. Once GitHub answers with an asset
 * URL, the till fetches those bytes itself — the repo is public, so no token
 * needs to reach a device that could be lost or rooted.
 *
 * A release counts only if its tag is `till-v<versionCode>`; anything else in
 * the repo's release history (a future web release, a draft, a typo) is
 * ignored rather than accidentally offered to a tablet. The highest matching
 * versionCode wins, not "whichever GitHub calls latest" — a release created
 * for an unrelated reason must never leapfrog the till's own version history.
 */

const REPO = "Hamaad7865/KidsCorner"
const TAG_PATTERN = /^till-v(\d+)$/

export type LatestRelease = {
  versionCode: number
  versionName: string
  apkUrl: string
}

type GithubAsset = {
  name: string
  browser_download_url: string
}

type GithubRelease = {
  tag_name: string
  name: string | null
  draft: boolean
  prerelease: boolean
  assets: GithubAsset[]
}

/**
 * Fetches the release list once and picks the newest matching one.
 *
 * Cached at Cloudflare's edge for ten minutes (`cf.cacheTtl`) rather than
 * fetched on every heartbeat — a shop's tills call bootstrap every two
 * minutes each, and GitHub's unauthenticated API is rate-limited per
 * source IP, which on Workers is shared with unrelated traffic. A stale
 * answer for up to ten minutes costs nothing; a shop is not waiting on this.
 *
 * Never throws. A malformed response, a rate limit, GitHub being down — all
 * of it comes back as null, and bootstrap simply omits the update fields
 * that round, exactly like any other optional field failing gracefully.
 */
export async function getLatestAndroidRelease(): Promise<LatestRelease | null> {
  try {
    const response = await fetch(`https://api.github.com/repos/${REPO}/releases?per_page=30`, {
      headers: {
        Accept: "application/vnd.github+json",
        // GitHub's REST API refuses requests with no User-Agent.
        "User-Agent": "kidscorner-till-update-check",
      },
      // Cloudflare-specific fetch option; ignored (harmlessly) outside Workers.
      cf: { cacheTtl: 600, cacheEverything: true },
    } as RequestInit)

    if (!response.ok) return null

    const releases = (await response.json()) as GithubRelease[]
    if (!Array.isArray(releases)) return null

    let best: LatestRelease | null = null

    for (const release of releases) {
      if (release.draft || release.prerelease) continue

      const match = TAG_PATTERN.exec(release.tag_name)
      if (!match) continue

      const versionCode = Number(match[1])
      if (!Number.isInteger(versionCode)) continue
      if (best && versionCode <= best.versionCode) continue

      const apk = release.assets.find((a) => a.name.toLowerCase().endsWith(".apk"))
      if (!apk) continue

      best = {
        versionCode,
        versionName: release.name?.trim() || release.tag_name,
        apkUrl: apk.browser_download_url,
      }
    }

    return best
  } catch {
    return null
  }
}
