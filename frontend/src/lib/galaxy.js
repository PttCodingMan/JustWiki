import * as THREE from 'three'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'

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
