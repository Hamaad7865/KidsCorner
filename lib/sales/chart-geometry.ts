/**
 * The maths behind the dashboard's sales curve.
 *
 * Kept out of the component and free of React so it can be tested directly:
 * the no-overshoot guarantee below is a property of the curve, not of any
 * rendering, and it is the whole reason for choosing this interpolation.
 */

export type ChartPoint = { x: number; y: number }

/**
 * Round a peak up to a clean axis top — 5,300 becomes 6,000, 940 becomes
 * 1,000 — so the four gridlines land on figures a person would write down.
 *
 * Never returns zero. Every plotted value is divided by this, and a shop that
 * has sold nothing yet today still has to get a chart rather than a panel of
 * NaN.
 */
export function niceCeiling(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 1
  const magnitude = 10 ** Math.floor(Math.log10(value))
  return Math.ceil(value / magnitude) * magnitude
}

/**
 * A smooth cubic through every point, using Fritsch–Carlson tangents.
 *
 * The obvious choice is a Catmull-Rom spline, and it is wrong here. In SVG y
 * grows downward, so the axis floor is the LARGEST y — and Catmull-Rom
 * overshoots around a sharp change. On the day a shop has taken nothing yet,
 * the curve would swing below the floor and draw negative sales.
 *
 * Fritsch–Carlson cannot do that: it flattens the tangent to zero wherever
 * the slope changes sign, so the curve is bounded by the points it joins.
 * A run of equal values stays perfectly flat rather than rippling.
 */
export function monotonePath(points: ChartPoint[]): string {
  const n = points.length
  if (n < 2) return ""

  // Secant slope of each segment.
  const dx: number[] = []
  const slope: number[] = []
  for (let i = 0; i < n - 1; i++) {
    dx[i] = points[i + 1].x - points[i].x
    slope[i] = (points[i + 1].y - points[i].y) / dx[i]
  }

  // Tangent at each point: the weighted harmonic mean of the slopes either
  // side, forced to zero at any turning point — that zero is what stops the
  // overshoot.
  const tangent: number[] = [slope[0]]
  for (let i = 1; i < n - 1; i++) {
    if (slope[i - 1] * slope[i] <= 0) {
      tangent[i] = 0
    } else {
      const w1 = 2 * dx[i] + dx[i - 1]
      const w2 = dx[i] + 2 * dx[i - 1]
      tangent[i] = (w1 + w2) / (w1 / slope[i - 1] + w2 / slope[i])
    }
  }
  tangent[n - 1] = slope[n - 2]

  let d = `M ${points[0].x} ${points[0].y}`
  for (let i = 0; i < n - 1; i++) {
    const third = dx[i] / 3
    d +=
      ` C ${points[i].x + third} ${points[i].y + tangent[i] * third},` +
      ` ${points[i + 1].x - third} ${points[i + 1].y - tangent[i + 1] * third},` +
      ` ${points[i + 1].x} ${points[i + 1].y}`
  }
  return d
}
