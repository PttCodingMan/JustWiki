import * as THREE from 'three'

// String → 32-bit seed. FNV-1a-ish; just needs to be deterministic and
// well-distributed enough for hue/feature variation. Don't use for security.
function hashString(str) {
  let h = 2166136261
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

// Indicators per node that drive the look:
//   - title hash   → base hue (stable colour per page)
//   - slug hash    → accent hue + rotation direction/speed
//   - linkCount    → size, ring presence, rim intensity
//   - title.length → noise frequency (longer titles = busier surface)
export function planetParams(node) {
  const titleSeed = hashString(node.title || node.slug || String(node.id))
  const slugSeed = hashString(node.slug || String(node.id))
  const links = node.linkCount || 0
  const titleLen = (node.title || '').length
  const spinSign = slugSeed % 2 === 0 ? 1 : -1
  return {
    titleSeed,
    slugSeed,
    hue: (titleSeed % 360) / 360,
    accentHue: ((titleSeed * 7 + 120) % 360) / 360,
    rimHue: ((titleSeed * 13 + 200) % 360) / 360,
    hasRing: links >= 3,
    ringBands: 1 + (links >= 5 ? 1 : 0),
    ringTiltRad: ((slugSeed % 360) * Math.PI) / 180,
    // Noise freq scales with title length. Clamped so extreme titles still read.
    noiseFreq: 1.1 + Math.min(2.2, titleLen * 0.08),
    spinRate: spinSign * (0.05 + ((slugSeed % 100) / 100) * 0.2),
    radius: 1 + Math.sqrt(links) * 0.4,
    rimStrength: 0.35 + Math.min(0.5, links * 0.08),
  }
}

// CSS hue → hex for the 2D renderer (keeps 2D/3D visually consistent).
export function planetColor(node) {
  const { hue } = planetParams(node)
  return `hsl(${Math.round(hue * 360)}, 65%, 55%)`
}

// Ashima 3D simplex noise (Ian McEwan / Ashima Arts, MIT). Returns snoise(v)
// in [-1, 1]. Used on object-space position so continents "stick" to the
// sphere regardless of world placement.
const SIMPLEX_GLSL = /* glsl */ `
vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 permute(vec4 x) { return mod289(((x * 34.0) + 1.0) * x); }
vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }

float snoise(vec3 v) {
  const vec2 C = vec2(1.0/6.0, 1.0/3.0);
  const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
  vec3 i  = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);
  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);
  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + C.yyy;
  vec3 x3 = x0 - D.yyy;
  i = mod289(i);
  vec4 p = permute(permute(permute(
              i.z + vec4(0.0, i1.z, i2.z, 1.0))
            + i.y + vec4(0.0, i1.y, i2.y, 1.0))
            + i.x + vec4(0.0, i1.x, i2.x, 1.0));
  float n_ = 0.142857142857;
  vec3 ns = n_ * D.wyz - D.xzx;
  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_);
  vec4 x = x_ * ns.x + ns.yyyy;
  vec4 y = y_ * ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);
  vec4 b0 = vec4(x.xy, y.xy);
  vec4 b1 = vec4(x.zw, y.zw);
  vec4 s0 = floor(b0) * 2.0 + 1.0;
  vec4 s1 = floor(b1) * 2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));
  vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;
  vec3 p0 = vec3(a0.xy, h.x);
  vec3 p1 = vec3(a0.zw, h.y);
  vec3 p2 = vec3(a1.xy, h.z);
  vec3 p3 = vec3(a1.zw, h.w);
  vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2,p2), dot(p3,p3)));
  p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
  vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
  m = m * m;
  return 42.0 * dot(m*m, vec4(dot(p0,x0), dot(p1,x1), dot(p2,x2), dot(p3,x3)));
}
`

const VERTEX_SHADER = /* glsl */ `
varying vec3 vObjPos;
varying vec3 vNormal;
varying vec3 vViewDir;
void main() {
  vObjPos = position;
  vNormal = normalize(normalMatrix * normal);
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vViewDir = normalize(-mv.xyz);
  gl_Position = projectionMatrix * mv;
}
`

const FRAGMENT_SHADER = /* glsl */ `
${SIMPLEX_GLSL}
uniform float uTime;
uniform float uFreq;
uniform float uRimStrength;
uniform vec3 uColorDeep;
uniform vec3 uColorShallow;
uniform vec3 uColorLand;
uniform vec3 uRimColor;
varying vec3 vObjPos;
varying vec3 vNormal;
varying vec3 vViewDir;

// 5-octave fBm for natural-looking terrain. 5 is the knee — more octaves
// eat perf without visibly improving the look at this geometry size.
float fbm(vec3 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 5; i++) {
    v += a * snoise(p);
    p *= 2.02;
    a *= 0.5;
  }
  return v;
}

void main() {
  // Normalise to the unit sphere so uFreq controls the visual scale
  // independent of the mesh radius.
  vec3 unit = normalize(vObjPos);
  // Spin the sample point around Y so the surface animates without
  // rotating the sphere itself (cheaper than touching transforms).
  float c = cos(uTime);
  float s = sin(uTime);
  vec3 p = vec3(c * unit.x + s * unit.z, unit.y, -s * unit.x + c * unit.z);

  float land = fbm(p * uFreq);
  float detail = fbm(p * uFreq * 2.4 + 11.3) * 0.5;
  float h = land + detail * 0.3;

  // Three-stop gradient: deep → shallow → land, like a simplified biome map.
  vec3 col;
  if (h < -0.05) {
    col = mix(uColorDeep, uColorShallow, smoothstep(-0.4, -0.05, h));
  } else {
    col = mix(uColorShallow, uColorLand, smoothstep(-0.05, 0.35, h));
  }

  // Cheap directional key light so there's a visible terminator.
  vec3 lightDir = normalize(vec3(0.4, 0.7, 0.6));
  float diff = max(dot(normalize(vNormal), lightDir), 0.0);
  col *= 0.35 + 0.75 * diff;

  // Fresnel rim — makes the planet read as atmospheric.
  float rim = pow(1.0 - max(dot(normalize(vNormal), normalize(vViewDir)), 0.0), 2.5);
  col += uRimColor * rim * uRimStrength;

  gl_FragColor = vec4(col, 1.0);
}
`

function hslToColor(h, s, l) {
  const c = new THREE.Color()
  c.setHSL(h, s, l)
  return c
}

const STAR_FRAGMENT = /* glsl */ `
${SIMPLEX_GLSL}
uniform float uTime;
uniform vec3 uCore;
uniform vec3 uFlare;
varying vec3 vObjPos;
varying vec3 vNormal;
varying vec3 vViewDir;

void main() {
  vec3 unit = normalize(vObjPos);
  // Rolling plasma surface: two noise samples at different scales/speeds.
  float n1 = snoise(unit * 2.5 + vec3(uTime * 0.6));
  float n2 = snoise(unit * 5.0 - vec3(uTime * 0.9));
  float heat = 0.5 + 0.5 * (n1 * 0.6 + n2 * 0.4);
  vec3 col = mix(uCore, uFlare, smoothstep(0.3, 0.95, heat));
  // Strong fresnel halo so bloom can latch onto the rim.
  float rim = pow(1.0 - max(dot(normalize(vNormal), normalize(vViewDir)), 0.0), 2.0);
  col += uFlare * rim * 1.4;
  gl_FragColor = vec4(col, 1.0);
}
`

// A glowing star — used for pages that have children. Bright, emissive-feeling
// material that interacts well with UnrealBloomPass. No light/shading: stars
// emit, they don't receive.
export function buildStarObject(node) {
  const params = planetParams(node)
  const group = new THREE.Group()
  // Stars read bigger than planets so they anchor the system visually.
  const baseR = 5.5 * params.radius

  const geometry = new THREE.SphereGeometry(baseR, 48, 32)
  // Star colour: warm yellow-orange biased by the page's hue, so it still
  // varies per page but reads as a star, not a random planet.
  const coreHue = (params.hue * 0.2 + 0.08) % 1.0
  const flareHue = (coreHue + 0.04) % 1.0
  const material = new THREE.ShaderMaterial({
    vertexShader: VERTEX_SHADER,
    fragmentShader: STAR_FRAGMENT,
    uniforms: {
      uTime: { value: 0 },
      uCore: { value: hslToColor(coreHue, 0.85, 0.7) },
      uFlare: { value: hslToColor(flareHue, 1.0, 0.85) },
    },
  })
  const sphere = new THREE.Mesh(geometry, material)
  sphere.onBeforeRender = () => {
    material.uniforms.uTime.value = performance.now() * 0.001
  }
  group.add(sphere)

  // Soft corona — additive sprite-like shell that fakes glow even without bloom,
  // and gives bloom something extra to latch onto when it's enabled.
  const coronaGeom = new THREE.SphereGeometry(baseR * 1.6, 32, 24)
  const coronaMat = new THREE.MeshBasicMaterial({
    color: hslToColor(flareHue, 1.0, 0.7),
    transparent: true,
    opacity: 0.18,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  })
  group.add(new THREE.Mesh(coronaGeom, coronaMat))

  return group
}

// Build a procedural planet mesh. Each node gets its own ShaderMaterial
// instance (uniforms differ) but three.js dedups the program compile
// because the shader source is identical across all planets.
export function buildPlanetObject(node) {
  const params = planetParams(node)
  const group = new THREE.Group()
  const baseR = 4 * params.radius

  const geometry = new THREE.SphereGeometry(baseR, 48, 32)
  const material = new THREE.ShaderMaterial({
    vertexShader: VERTEX_SHADER,
    fragmentShader: FRAGMENT_SHADER,
    uniforms: {
      uTime: { value: 0 },
      uFreq: { value: params.noiseFreq },
      uRimStrength: { value: params.rimStrength },
      uColorDeep: { value: hslToColor(params.hue, 0.55, 0.18) },
      uColorShallow: { value: hslToColor(params.hue, 0.6, 0.42) },
      uColorLand: { value: hslToColor(params.accentHue, 0.5, 0.58) },
      uRimColor: { value: hslToColor(params.rimHue, 0.7, 0.65) },
    },
  })

  const sphere = new THREE.Mesh(geometry, material)
  // Drive animated uTime per-planet from the renderer's own loop.
  // Three.js calls onBeforeRender for every mesh on every frame, so we get
  // an animation clock "for free" without installing our own RAF loop.
  const spin = params.spinRate
  sphere.onBeforeRender = () => {
    material.uniforms.uTime.value = performance.now() * 0.001 * spin
  }
  group.add(sphere)

  if (params.hasRing) {
    const inner = baseR * 1.4
    const outer = baseR * (1.9 + 0.2 * params.ringBands)
    const ringGeom = new THREE.RingGeometry(inner, outer, 64)
    const ringMat = new THREE.MeshBasicMaterial({
      color: hslToColor(params.accentHue, 0.6, 0.7),
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.45,
    })
    const ring = new THREE.Mesh(ringGeom, ringMat)
    ring.rotation.x = Math.PI / 2 + params.ringTiltRad * 0.3
    ring.rotation.y = params.ringTiltRad * 0.2
    group.add(ring)
  }

  return group
}
