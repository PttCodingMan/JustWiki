import * as THREE from 'three'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'
import { planetParams } from './planet'

// Distant starfield rendered as a single THREE.Points cloud. One draw call,
// no per-frame work; we place it in the scene once and let it sit far enough
// out that the force-graph nodes never collide with it.
export function buildStarfield({ count = 4000, radius = 4500 } = {}) {
  const positions = new Float32Array(count * 3)
  const colors = new Float32Array(count * 3)
  for (let i = 0; i < count; i++) {
    // Uniform sample on a sphere, then push out to a thick shell so the
    // background reads as a dome instead of a flat plane.
    const u = Math.random()
    const v = Math.random()
    const theta = 2 * Math.PI * u
    const phi = Math.acos(2 * v - 1)
    const r = radius * (0.7 + Math.random() * 0.3)
    positions[i * 3 + 0] = r * Math.sin(phi) * Math.cos(theta)
    positions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta)
    positions[i * 3 + 2] = r * Math.cos(phi)
    // Most stars near-white, a few tinted blue/orange — much more believable
    // than uniform white.
    const tint = Math.random()
    if (tint < 0.1) {
      colors[i * 3 + 0] = 1.0
      colors[i * 3 + 1] = 0.75
      colors[i * 3 + 2] = 0.55
    } else if (tint < 0.2) {
      colors[i * 3 + 0] = 0.7
      colors[i * 3 + 1] = 0.85
      colors[i * 3 + 2] = 1.0
    } else {
      const b = 0.85 + Math.random() * 0.15
      colors[i * 3 + 0] = b
      colors[i * 3 + 1] = b
      colors[i * 3 + 2] = b
    }
  }
  const geom = new THREE.BufferGeometry()
  geom.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geom.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  const mat = new THREE.PointsMaterial({
    size: 2.2,
    sizeAttenuation: true,
    vertexColors: true,
    transparent: true,
    opacity: 0.9,
    depthWrite: false,
  })
  const points = new THREE.Points(geom, mat)
  // Don't let frustum culling drop the field when the camera moves; this
  // shell is large enough that we always want it drawn.
  points.frustumCulled = false
  return points
}

export function disposeStarfield(points) {
  if (!points) return
  if (points.geometry) points.geometry.dispose()
  if (points.material) points.material.dispose()
}

export function makeBloomPass(width, height) {
  // strength, radius, threshold. Threshold > 0 keeps planet surfaces from
  // bleeding; only stars / glowing edges bloom.
  return new UnrealBloomPass(new THREE.Vector2(width, height), 1.1, 0.6, 0.55)
}

// ---------------------------------------------------------------------------
// 2D galaxy renderer
//
// Mirrors the look of the 3D scene (deep-space background, distant starfield,
// glowing stars, planets with rim/atmosphere) using only Canvas 2D so it works
// without WebGL. Drawn through react-force-graph-2d's nodeCanvasObject /
// linkCanvasObject / onRenderFramePre hooks; all coordinates are world-space
// (the library applies the pan/zoom transform before invoking us).
// ---------------------------------------------------------------------------

function mulberry32(seed) {
  let s = seed >>> 0
  return () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// Generate a deterministic starfield + a few nebula clouds. Computed once and
// reused across frames so the field doesn't twinkle on every redraw.
export function createSpace2D({
  count = 700,
  spread = 7000,
  seed = 0xc0ffee,
  nebulaCount = 4,
} = {}) {
  const rng = mulberry32(seed)
  const stars = []
  for (let i = 0; i < count; i++) {
    const x = (rng() - 0.5) * 2 * spread
    const y = (rng() - 0.5) * 2 * spread
    const sizeRoll = rng()
    // Most stars are sub-pixel specks; a few are noticeably larger so the
    // field has visual hierarchy.
    const size = sizeRoll < 0.85 ? 0.7 : sizeRoll < 0.97 ? 1.3 : 2.0
    const tint = rng()
    let rgb
    if (tint < 0.1) rgb = '255, 200, 150'
    else if (tint < 0.2) rgb = '180, 215, 255'
    else rgb = '230, 235, 245'
    const alpha = 0.45 + rng() * 0.5
    stars.push({ x, y, size, color: `rgba(${rgb}, ${alpha.toFixed(2)})` })
  }
  // Soft nebula clouds — large, low-opacity radial gradients in muted hues.
  // They give the empty space a sense of depth without competing with nodes.
  const nebulaPalette = [
    'rgba(80, 60, 160, ',   // violet
    'rgba(40, 90, 160, ',   // deep blue
    'rgba(160, 60, 130, ',  // magenta
    'rgba(40, 120, 130, ',  // teal
  ]
  const nebulas = []
  for (let i = 0; i < nebulaCount; i++) {
    const x = (rng() - 0.5) * 1.4 * spread
    const y = (rng() - 0.5) * 1.4 * spread
    const r = spread * (0.18 + rng() * 0.18)
    const color = nebulaPalette[i % nebulaPalette.length]
    const peak = 0.18 + rng() * 0.12
    nebulas.push({ x, y, r, color, peak })
  }
  return { stars, nebulas }
}

export function drawSpace2D(ctx, space, globalScale) {
  // Nebulas first (behind stars), in additive mode so overlaps brighten
  // instead of muddy.
  ctx.save()
  ctx.globalCompositeOperation = 'lighter'
  for (const n of space.nebulas) {
    const grad = ctx.createRadialGradient(n.x, n.y, 0, n.x, n.y, n.r)
    grad.addColorStop(0, `${n.color}${n.peak.toFixed(3)})`)
    grad.addColorStop(0.6, `${n.color}${(n.peak * 0.3).toFixed(3)})`)
    grad.addColorStop(1, `${n.color}0)`)
    ctx.fillStyle = grad
    ctx.beginPath()
    ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.restore()

  // Stars are sized in screen pixels — divide by globalScale so they stay
  // crisp at any zoom (otherwise they balloon when zooming in).
  const inv = 1 / Math.max(0.0001, globalScale)
  for (const s of space.stars) {
    ctx.fillStyle = s.color
    ctx.beginPath()
    ctx.arc(s.x, s.y, s.size * inv, 0, Math.PI * 2)
    ctx.fill()
  }
}

function hsla(h, s, l, a) {
  return `hsla(${(h * 360) | 0}, ${(s * 100) | 0}%, ${(l * 100) | 0}%, ${a})`
}

// Per-node radius used for both rendering and pointer-area painting so the
// hit area matches what the user sees.
export function nodeDrawRadius(node) {
  const p = planetParams(node)
  return node.isStar ? 5 + p.radius * 5 : 4 + p.radius * 4
}

function drawPlanet2D(ctx, node, globalScale, isSelected) {
  const p = planetParams(node)
  const x = node.x
  const y = node.y
  const r = 4 + p.radius * 4
  const inv = 1 / Math.max(0.0001, globalScale)

  // Ring (drawn behind the body so the planet occludes the front arc).
  if (p.hasRing) {
    ctx.save()
    ctx.translate(x, y)
    ctx.rotate(p.ringTiltRad)
    ctx.scale(1, 0.32)
    ctx.lineWidth = Math.max(0.6, r * 0.18)
    ctx.strokeStyle = hsla(p.accentHue, 0.6, 0.7, 0.55)
    ctx.beginPath()
    ctx.arc(0, 0, r * 1.7, 0, Math.PI * 2)
    ctx.stroke()
    if (p.ringBands > 1) {
      ctx.strokeStyle = hsla(p.accentHue, 0.6, 0.7, 0.3)
      ctx.beginPath()
      ctx.arc(0, 0, r * 2.0, 0, Math.PI * 2)
      ctx.stroke()
    }
    ctx.restore()
  }

  // Atmospheric halo — additive radial gradient, gives planets the same
  // soft-glow feel as the bloomed 3D version.
  ctx.save()
  ctx.globalCompositeOperation = 'lighter'
  const haloR = r * 2.2
  const halo = ctx.createRadialGradient(x, y, r * 0.4, x, y, haloR)
  halo.addColorStop(0, hsla(p.rimHue, 0.8, 0.65, 0.32 * p.rimStrength + 0.12))
  halo.addColorStop(1, hsla(p.rimHue, 0.8, 0.65, 0))
  ctx.fillStyle = halo
  ctx.beginPath()
  ctx.arc(x, y, haloR, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()

  // Body — radial gradient offset toward upper-left to fake a key light,
  // matching the directional light in the 3D shader.
  const body = ctx.createRadialGradient(
    x - r * 0.4, y - r * 0.4, r * 0.1,
    x, y, r,
  )
  body.addColorStop(0, hsla(p.accentHue, 0.55, 0.7, 1))
  body.addColorStop(0.55, hsla(p.hue, 0.6, 0.45, 1))
  body.addColorStop(1, hsla(p.hue, 0.7, 0.18, 1))
  ctx.fillStyle = body
  ctx.beginPath()
  ctx.arc(x, y, r, 0, Math.PI * 2)
  ctx.fill()

  if (isSelected) {
    ctx.strokeStyle = 'rgba(255,255,255,0.9)'
    ctx.lineWidth = 1.5 * inv
    ctx.beginPath()
    ctx.arc(x, y, r + 3 * inv, 0, Math.PI * 2)
    ctx.stroke()
  }
}

function drawStar2D(ctx, node, globalScale, isSelected) {
  const p = planetParams(node)
  const x = node.x
  const y = node.y
  const r = 5 + p.radius * 5
  const inv = 1 / Math.max(0.0001, globalScale)

  // Match 3D star palette: warm yellow biased by page hue.
  const coreHue = (p.hue * 0.2 + 0.08) % 1
  const flareHue = (coreHue + 0.04) % 1

  ctx.save()
  ctx.globalCompositeOperation = 'lighter'

  // Outer corona — wide, soft, fades to transparent.
  const coronaR = r * 4
  const corona = ctx.createRadialGradient(x, y, r * 0.5, x, y, coronaR)
  corona.addColorStop(0, hsla(flareHue, 1, 0.7, 0.5))
  corona.addColorStop(0.4, hsla(flareHue, 1, 0.6, 0.16))
  corona.addColorStop(1, hsla(flareHue, 1, 0.6, 0))
  ctx.fillStyle = corona
  ctx.beginPath()
  ctx.arc(x, y, coronaR, 0, Math.PI * 2)
  ctx.fill()

  // Diffraction spikes — two perpendicular bars, faked with thin gradients.
  // These read as "this is a star", much like JWST images.
  const spikeLen = r * 5
  for (let k = 0; k < 2; k++) {
    const spike = ctx.createLinearGradient(
      x - (k === 0 ? spikeLen : 0),
      y - (k === 1 ? spikeLen : 0),
      x + (k === 0 ? spikeLen : 0),
      y + (k === 1 ? spikeLen : 0),
    )
    spike.addColorStop(0, hsla(flareHue, 1, 0.7, 0))
    spike.addColorStop(0.5, hsla(flareHue, 1, 0.85, 0.55))
    spike.addColorStop(1, hsla(flareHue, 1, 0.7, 0))
    ctx.fillStyle = spike
    if (k === 0) ctx.fillRect(x - spikeLen, y - 0.4 * inv, spikeLen * 2, 0.8 * inv)
    else ctx.fillRect(x - 0.4 * inv, y - spikeLen, 0.8 * inv, spikeLen * 2)
  }

  // Hot core — the visible "disc" of the star.
  const core = ctx.createRadialGradient(x, y, 0, x, y, r)
  core.addColorStop(0, 'hsla(60, 100%, 96%, 1)')
  core.addColorStop(0.5, hsla(coreHue, 1, 0.78, 1))
  core.addColorStop(1, hsla(flareHue, 1, 0.55, 1))
  ctx.fillStyle = core
  ctx.beginPath()
  ctx.arc(x, y, r, 0, Math.PI * 2)
  ctx.fill()

  ctx.restore()

  if (isSelected) {
    ctx.strokeStyle = 'rgba(255,255,255,0.9)'
    ctx.lineWidth = 1.5 * inv
    ctx.beginPath()
    ctx.arc(x, y, r + 4 * inv, 0, Math.PI * 2)
    ctx.stroke()
  }
}

export function drawNode2D(node, ctx, globalScale, isSelected) {
  if (node.x == null || node.y == null) return
  if (node.isStar) drawStar2D(ctx, node, globalScale, isSelected)
  else drawPlanet2D(ctx, node, globalScale, isSelected)
}

// 'before' hook — drops a soft additive halo behind each link so wikilinks
// shimmer like glowing threads. The library still draws its own crisp line +
// arrow on top, so legibility is preserved.
export function drawLinkGlow2D(link, ctx, globalScale) {
  const a = link.source
  const b = link.target
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return
  if (a.x == null || b.x == null) return
  const inv = 1 / Math.max(0.0001, globalScale)
  const isHierarchy = link.type === 'hierarchy'
  const haloColor = isHierarchy
    ? 'rgba(255, 196, 120, 0.18)'
    : 'rgba(140, 200, 255, 0.14)'
  const haloW = isHierarchy ? 4 : 2.5
  ctx.save()
  ctx.globalCompositeOperation = 'lighter'
  ctx.strokeStyle = haloColor
  ctx.lineCap = 'round'
  ctx.lineWidth = haloW * inv
  ctx.beginPath()
  ctx.moveTo(a.x, a.y)
  ctx.lineTo(b.x, b.y)
  ctx.stroke()
  ctx.restore()
}

// Pointer-area paint — must produce a filled solid-color shape matching the
// visible node footprint, so click hit detection lines up with what the user
// sees rather than the default circle from nodeRelSize/nodeVal.
export function paintNodePointer2D(node, color, ctx) {
  if (node.x == null || node.y == null) return
  const r = nodeDrawRadius(node)
  ctx.fillStyle = color
  ctx.beginPath()
  ctx.arc(node.x, node.y, r, 0, Math.PI * 2)
  ctx.fill()
}
