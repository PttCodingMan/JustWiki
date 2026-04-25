import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import api from '../api/client'
import { buildPlanetObject, buildStarObject, planetColor, planetParams } from '../lib/planet'
import { buildStarfield, disposeStarfield, makeBloomPass } from '../lib/galaxy'

const ForceGraph3D = lazy(() => import('react-force-graph-3d'))
const ForceGraph2D = lazy(() => import('react-force-graph-2d'))

// WebGL feature-detect. Some older browsers / low-end mobile devices have no
// WebGL context; in that case we force 2D mode regardless of user toggle.
function detectWebGL() {
  try {
    const canvas = document.createElement('canvas')
    return !!(canvas.getContext('webgl') || canvas.getContext('experimental-webgl'))
  } catch {
    return false
  }
}

export default function GraphView() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const graphRef = useRef(null)
  const containerRef = useRef(null)
  const webglSupported = useMemo(() => detectWebGL(), [])
  const [graphData, setGraphData] = useState(null)
  const [loading, setLoading] = useState(true)
  // If WebGL is unavailable, default to 2D so the user never sees a broken
  // 3D canvas.
  const [mode, setMode] = useState(() => (webglSupported ? '3d' : '2d'))
  // Galaxy mode: starfield + bloom + dark scene. Only meaningful in 3D and
  // when WebGL is available, so we gate it behind both.
  const [galaxy, setGalaxy] = useState(true)
  const [selectedNode, setSelectedNode] = useState(null)
  const [size, setSize] = useState({ width: 800, height: 600 })

  useEffect(() => {
    api
      .get('/pages/graph')
      .then((res) => {
        setGraphData(res.data)
        setLoading(false)
      })
      .catch(() => setLoading(false))
  }, [])

  // Track container size so the canvas fills available width.
  useEffect(() => {
    if (!containerRef.current) return
    const el = containerRef.current
    const update = () => {
      setSize({ width: el.clientWidth, height: 600 })
    }
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [graphData])

  // Bump 3D zoom sensitivity. TrackballControls ships with zoomSpeed=1.2
  // which feels sluggish on typical trackpads. The graph ref is populated
  // after the Suspense-lazy component mounts, so retry briefly until the
  // controls handle is available.
  useEffect(() => {
    if (mode !== '3d' || !graphData) return
    let cancelled = false
    const apply = () => {
      if (cancelled) return
      const g = graphRef.current
      if (g && typeof g.controls === 'function') {
        const c = g.controls()
        if (c) {
          c.zoomSpeed = 4
          return
        }
      }
      setTimeout(apply, 50)
    }
    apply()
    return () => {
      cancelled = true
    }
  }, [mode, graphData])

  // Pre-compute link counts so nodes with more connections can be rendered
  // larger. react-force-graph mutates the arrays we hand it — replacing
  // link.source/target string IDs with node object refs and decorating nodes
  // with simulation state (x/y/z, vx/vy/vz, __threeObj …). If we let those
  // mutations leak into the next renderer (e.g. on 2D ↔ 3D swap), it crashes.
  // So we rebuild a fresh, *clean* copy whenever mode changes, and explicitly
  // un-mutate any link refs the previous renderer left behind.
  const enrichedData = useMemo(() => {
    if (!graphData) return null
    const linkSourceId = (l) => (typeof l.source === 'object' && l.source ? l.source.id : l.source)
    const linkTargetId = (l) => (typeof l.target === 'object' && l.target ? l.target.id : l.target)
    const degree = new Map()
    const childCount = new Map()
    for (const link of graphData.links) {
      const s = linkSourceId(link)
      const t = linkTargetId(link)
      degree.set(s, (degree.get(s) || 0) + 1)
      degree.set(t, (degree.get(t) || 0) + 1)
      if (link.type === 'hierarchy') {
        childCount.set(s, (childCount.get(s) || 0) + 1)
      }
    }
    const nodes = graphData.nodes.map((n) => ({
      id: n.id,
      slug: n.slug,
      title: n.title,
      parent_id: n.parent_id,
      is_star: n.is_star,
      linkCount: degree.get(n.id) || 0,
      isStar: Boolean(n.is_star) || (childCount.get(n.id) || 0) > 0,
    }))
    const links = graphData.links.map((l) => ({
      source: linkSourceId(l),
      target: linkTargetId(l),
      type: l.type,
    }))
    return { nodes, links }
    // `mode` is a real dep here even though it isn't read: switching renderers
    // requires fresh, un-mutated data (see comment above).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graphData, mode])

  // Spread the simulation out: default d3-force settings cluster nodes tight
  // enough that the star/planet meshes overlap their neighbours. We push
  // repulsion up and link distance out so each "system" has breathing room.
  useEffect(() => {
    if (!graphData) return
    let cancelled = false
    const apply = () => {
      if (cancelled) return
      const g = graphRef.current
      if (!g || typeof g.d3Force !== 'function') {
        setTimeout(apply, 50)
        return
      }
      const charge = g.d3Force('charge')
      if (charge && charge.strength) charge.strength(-260)
      const link = g.d3Force('link')
      if (link && link.distance) {
        // Hierarchy edges shorter so children visibly orbit their star;
        // wikilinks longer so unrelated systems drift apart.
        link.distance((l) => (l.type === 'hierarchy' ? 70 : 160))
      }
      if (typeof g.d3ReheatSimulation === 'function') g.d3ReheatSimulation()
    }
    apply()
    return () => {
      cancelled = true
    }
  }, [graphData, mode])

  // Galaxy mode: install starfield + bloom on the active 3D scene/composer.
  // We hook in via the ref instead of replacing ForceGraph3D's renderer so we
  // don't fight the library's own RAF loop.
  useEffect(() => {
    if (mode !== '3d' || !graphData || !galaxy) return
    let cancelled = false
    let starfield = null
    let bloomPass = null
    let composer = null
    let scene = null

    const apply = () => {
      if (cancelled) return
      const g = graphRef.current
      if (!g || typeof g.scene !== 'function' || typeof g.postProcessingComposer !== 'function') {
        setTimeout(apply, 50)
        return
      }
      scene = g.scene()
      composer = g.postProcessingComposer()
      if (!scene || !composer) {
        setTimeout(apply, 50)
        return
      }
      starfield = buildStarfield()
      scene.add(starfield)
      bloomPass = makeBloomPass(size.width, size.height)
      composer.addPass(bloomPass)
    }
    apply()

    return () => {
      cancelled = true
      // Best-effort teardown: by the time this runs, the WebGL context may
      // already be gone (ForceGraph3D unmounted on mode swap). Swallow any
      // errors so a teardown blip doesn't leave us stuck on a blank canvas.
      try {
        if (starfield && scene) scene.remove(starfield)
        disposeStarfield(starfield)
      } catch { /* ignore */ }
      try {
        if (bloomPass && composer) {
          const idx = composer.passes.indexOf(bloomPass)
          if (idx >= 0) composer.passes.splice(idx, 1)
          bloomPass.dispose?.()
        }
      } catch { /* ignore */ }
    }
    // size intentionally omitted — bloom pass auto-resizes via composer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, graphData, galaxy])

  const handleNodeClick = (node) => {
    setSelectedNode(node)
    const g = graphRef.current
    if (!g) return
    if (mode === '3d') {
      // Move the camera to a point offset along the vector from origin to
      // node, so we end up looking at the node from a sensible distance
      // instead of clipping through it.
      const distance = 80
      const dist = Math.hypot(node.x || 1, node.y || 1, node.z || 1) || 1
      const ratio = 1 + distance / dist
      g.cameraPosition(
        { x: (node.x || 0) * ratio, y: (node.y || 0) * ratio, z: (node.z || 0) * ratio },
        node,
        1000,
      )
    } else {
      g.centerAt(node.x, node.y, 1000)
      g.zoom(4, 1000)
    }
  }

  const colorFor = (node) => planetColor(node)
  const sizeFor = (node) => 1 + planetParams(node).radius * 2
  const buildNodeObject = (node) =>
    node.isStar ? buildStarObject(node) : buildPlanetObject(node)
  const linkColorFor = (link) =>
    link.type === 'hierarchy' ? 'rgba(255, 196, 120, 0.7)' : 'rgba(140, 200, 255, 0.45)'
  const linkWidthFor = (link) => (link.type === 'hierarchy' ? 1.2 : 0.4)

  if (loading) return <div className="text-text-secondary">{t('common.loading')}</div>

  const hasData = graphData && graphData.nodes.length > 0

  return (
    <div className="max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <h1 className="text-2xl font-bold text-text">{t('graph.title')}</h1>
        <div className="flex items-center gap-3">
          <div className="text-sm text-text-secondary">
            {t('graph.stats', { pages: graphData?.nodes?.length || 0, links: graphData?.links?.length || 0 })}
          </div>
          {hasData && webglSupported && mode === '3d' && (
            <button
              type="button"
              onClick={() => setGalaxy((v) => !v)}
              className={`px-3 py-1 text-sm rounded-md border border-border ${galaxy ? 'bg-primary text-white' : 'bg-surface text-text-secondary hover:bg-surface-hover'}`}
              title={t('graph.galaxyHint', { defaultValue: 'Toggle galaxy mode' })}
            >
              {t('graph.galaxy', { defaultValue: 'Galaxy' })}
            </button>
          )}
          {hasData && webglSupported && (
            <div className="inline-flex rounded-md border border-border overflow-hidden text-sm">
              <button
                type="button"
                onClick={() => setMode('2d')}
                className={`px-3 py-1 ${mode === '2d' ? 'bg-primary text-white' : 'bg-surface text-text-secondary hover:bg-surface-hover'}`}
              >
                2D
              </button>
              <button
                type="button"
                onClick={() => setMode('3d')}
                className={`px-3 py-1 ${mode === '3d' ? 'bg-primary text-white' : 'bg-surface text-text-secondary hover:bg-surface-hover'}`}
              >
                3D
              </button>
            </div>
          )}
        </div>
      </div>

      {!hasData ? (
        <div className="text-center py-16 text-text-secondary">
          <p className="text-lg mb-2">{t('graph.emptyTitle')}</p>
          <p className="text-sm">{t('graph.emptyHint')}</p>
        </div>
      ) : (
        <div className="relative bg-surface rounded-xl shadow-sm border border-border overflow-hidden">
          <div ref={containerRef} className="w-full" style={{ height: 600 }}>
            <Suspense
              fallback={
                <div className="flex items-center justify-center h-full text-text-secondary">
                  {t('common.loadingGraph')}
                </div>
              }
            >
              {mode === '3d' && webglSupported ? (
                <ForceGraph3D
                  key="fg-3d"
                  ref={graphRef}
                  graphData={enrichedData}
                  width={size.width}
                  height={size.height}
                  backgroundColor={galaxy ? '#04060d' : 'rgba(0,0,0,0)'}
                  nodeLabel="title"
                  nodeThreeObject={buildNodeObject}
                  nodeThreeObjectExtend={false}
                  linkColor={linkColorFor}
                  linkWidth={linkWidthFor}
                  linkOpacity={0.6}
                  linkDirectionalArrowLength={(l) => (l.type === 'hierarchy' ? 0 : 3)}
                  linkDirectionalArrowRelPos={1}
                  onNodeClick={handleNodeClick}
                  onBackgroundClick={() => setSelectedNode(null)}
                />
              ) : (
                <ForceGraph2D
                  key="fg-2d"
                  ref={graphRef}
                  graphData={enrichedData}
                  width={size.width}
                  height={size.height}
                  nodeLabel="title"
                  nodeRelSize={4}
                  nodeVal={sizeFor}
                  nodeColor={colorFor}
                  linkColor={linkColorFor}
                  linkWidth={linkWidthFor}
                  linkDirectionalArrowLength={(l) => (l.type === 'hierarchy' ? 0 : 4)}
                  linkDirectionalArrowRelPos={1}
                  onNodeClick={handleNodeClick}
                  onBackgroundClick={() => setSelectedNode(null)}
                />
              )}
            </Suspense>
          </div>

          {selectedNode && (
            <div className="absolute top-4 right-4 w-64 bg-surface border border-border rounded-lg shadow-lg p-4">
              <div className="text-xs uppercase tracking-wide text-text-secondary mb-1">
                {t('graph.selectedLabel')}
              </div>
              <div className="font-semibold text-text break-words">{selectedNode.title}</div>
              <div className="text-xs text-text-secondary mt-1">
                {t('graph.connections', { count: selectedNode.linkCount || 0 })}
              </div>
              <div className="flex gap-2 mt-3">
                <button
                  type="button"
                  onClick={() => navigate(`/page/${selectedNode.slug}`)}
                  className="flex-1 px-3 py-1.5 text-sm bg-primary text-white rounded hover:opacity-90"
                >
                  {t('graph.goToPage')}
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedNode(null)}
                  className="px-3 py-1.5 text-sm text-text-secondary hover:text-text"
                >
                  {t('graph.close')}
                </button>
              </div>
            </div>
          )}

          {!webglSupported && (
            <div className="absolute bottom-3 left-3 text-xs text-text-secondary bg-surface/80 border border-border rounded px-2 py-1">
              {t('graph.webglUnavailable')}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
