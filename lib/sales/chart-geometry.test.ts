import { describe, expect, it } from "vitest"

import { monotonePath, niceCeiling, type ChartPoint } from "@/lib/sales/chart-geometry"

/**
 * Pull the cubic segments back out of a path string so the curve can be
 * sampled. The no-overshoot guarantee is a claim about the space *between*
 * the points, and reading the control points is the only way to check it.
 */
function segments(d: string) {
  const start = d.match(/^M ([\d.-]+) ([\d.-]+)/)
  if (!start) return []
  let from: ChartPoint = { x: Number(start[1]), y: Number(start[2]) }
  const out: { p0: ChartPoint; c1: ChartPoint; c2: ChartPoint; p1: ChartPoint }[] = []
  const curve = /C ([\d.-]+) ([\d.-]+), ([\d.-]+) ([\d.-]+), ([\d.-]+) ([\d.-]+)/g
  for (const m of d.matchAll(curve)) {
    const p1 = { x: Number(m[5]), y: Number(m[6]) }
    out.push({
      p0: from,
      c1: { x: Number(m[1]), y: Number(m[2]) },
      c2: { x: Number(m[3]), y: Number(m[4]) },
      p1,
    })
    from = p1
  }
  return out
}

function sampleY(seg: ReturnType<typeof segments>[number], t: number): number {
  const u = 1 - t
  return (
    u * u * u * seg.p0.y +
    3 * u * u * t * seg.c1.y +
    3 * u * t * t * seg.c2.y +
    t * t * t * seg.p1.y
  )
}

describe("niceCeiling", () => {
  it("rounds a peak up to a clean axis top", () => {
    expect(niceCeiling(5300)).toBe(6000)
    expect(niceCeiling(940)).toBe(1000)
    expect(niceCeiling(22150)).toBe(30000)
  })

  it("leaves an already-round peak alone", () => {
    expect(niceCeiling(6000)).toBe(6000)
    expect(niceCeiling(1000)).toBe(1000)
  })

  // A shop that has sold nothing today still has to get a chart, and every
  // value is divided by this — zero here would paint NaN across the panel.
  it("never returns zero", () => {
    expect(niceCeiling(0)).toBe(1)
    expect(niceCeiling(-5)).toBe(1)
    expect(niceCeiling(Number.NaN)).toBe(1)
  })
})

describe("monotonePath", () => {
  it("says nothing about fewer than two points", () => {
    expect(monotonePath([])).toBe("")
    expect(monotonePath([{ x: 0, y: 10 }])).toBe("")
  })

  it("starts at the first point and ends at the last", () => {
    const pts = [
      { x: 0, y: 100 },
      { x: 50, y: 20 },
      { x: 100, y: 60 },
    ]
    const d = monotonePath(pts)
    expect(d.startsWith("M 0 100")).toBe(true)
    expect(d.trimEnd().endsWith("100 60")).toBe(true)
  })

  it("passes exactly through every point", () => {
    const pts = [
      { x: 0, y: 80 },
      { x: 25, y: 30 },
      { x: 50, y: 95 },
      { x: 75, y: 10 },
    ]
    const segs = segments(monotonePath(pts))
    expect(segs).toHaveLength(3)
    segs.forEach((seg, i) => {
      expect(seg.p0.y).toBeCloseTo(pts[i].y, 6)
      expect(seg.p1.y).toBeCloseTo(pts[i + 1].y, 6)
    })
  })

  /**
   * The reason this is Fritsch–Carlson and not Catmull-Rom. In SVG, y grows
   * downward, so the axis floor is the LARGEST y. A day with no takings sits
   * on the floor, and a spline that overshoots there draws the curve below
   * the axis — negative sales, painted.
   */
  it("never overshoots past the points it joins", () => {
    const floor = 200
    const pts = [
      { x: 0, y: 60 },
      { x: 100, y: 20 },
      { x: 200, y: floor }, // today: nothing sold yet
    ]
    for (const seg of segments(monotonePath(pts))) {
      const lo = Math.min(seg.p0.y, seg.p1.y)
      const hi = Math.max(seg.p0.y, seg.p1.y)
      for (let t = 0; t <= 1; t += 0.02) {
        const y = sampleY(seg, t)
        expect(y).toBeGreaterThanOrEqual(lo - 1e-9)
        expect(y).toBeLessThanOrEqual(hi + 1e-9)
      }
    }
  })

  it("stays flat across equal values instead of rippling", () => {
    const pts = [
      { x: 0, y: 50 },
      { x: 50, y: 50 },
      { x: 100, y: 50 },
    ]
    for (const seg of segments(monotonePath(pts))) {
      for (let t = 0; t <= 1; t += 0.1) {
        expect(sampleY(seg, t)).toBeCloseTo(50, 9)
      }
    }
  })
})
