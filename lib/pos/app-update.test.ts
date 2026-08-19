import { afterEach, describe, expect, it, vi } from "vitest"

import { getLatestAndroidRelease } from "./app-update"

function githubResponse(releases: unknown[], ok = true) {
  return {
    ok,
    json: async () => releases,
  } as Response
}

function release(overrides: Record<string, unknown> = {}) {
  return {
    tag_name: "till-v2",
    name: "Till v0.2.0",
    draft: false,
    prerelease: false,
    assets: [{ name: "kidscorner-till-v2.apk", browser_download_url: "https://example.test/v2.apk" }],
    ...overrides,
  }
}

describe("getLatestAndroidRelease", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("picks the highest versionCode among several till releases", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        githubResponse([
          release({ tag_name: "till-v3", name: "Till v0.3.0", assets: [{ name: "v3.apk", browser_download_url: "https://example.test/v3.apk" }] }),
          release({ tag_name: "till-v1", name: "Till v0.1.0", assets: [{ name: "v1.apk", browser_download_url: "https://example.test/v1.apk" }] }),
          release(),
        ]),
      ),
    )

    const latest = await getLatestAndroidRelease()
    expect(latest).toEqual({
      versionCode: 3,
      versionName: "Till v0.3.0",
      apkUrl: "https://example.test/v3.apk",
    })
  })

  it("ignores releases whose tag is not till-v<number>", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        githubResponse([
          release({ tag_name: "web-2026-08-19", name: "Web deploy" }),
          release({ tag_name: "v2-beta" }),
        ]),
      ),
    )

    expect(await getLatestAndroidRelease()).toBeNull()
  })

  it("ignores draft and prerelease releases even when tagged correctly", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        githubResponse([
          release({ tag_name: "till-v5", draft: true }),
          release({ tag_name: "till-v4", prerelease: true }),
        ]),
      ),
    )

    expect(await getLatestAndroidRelease()).toBeNull()
  })

  it("falls back to the tag when the release has no name", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(githubResponse([release({ name: null })])))

    const latest = await getLatestAndroidRelease()
    expect(latest?.versionName).toBe("till-v2")
  })

  it("skips a matching release that carries no APK asset", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(githubResponse([release({ assets: [{ name: "changelog.txt", browser_download_url: "https://example.test/x" }] })])),
    )

    expect(await getLatestAndroidRelease()).toBeNull()
  })

  it("returns null when GitHub answers with a non-OK status", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(githubResponse([], false)))

    expect(await getLatestAndroidRelease()).toBeNull()
  })

  it("returns null rather than throwing when the network call fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")))

    expect(await getLatestAndroidRelease()).toBeNull()
  })

  it("returns null when the response body is not an array", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ message: "nope" }) } as Response))

    expect(await getLatestAndroidRelease()).toBeNull()
  })
})
