import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import api from '../api/client'
import { buildPlanetObject, planetColor, planetParams } from '../lib/planet'

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
  const navigate = useNavigate()
  const graphRef = useRef(null)
  const containerRef = useRef(null)
  const webglSupported = useMemo(() => detectWebGL(), [])
  const [graphData, setGraphData] = useState(null)
  const [loading, setLoading] = useState(true)
  // If WebGL is unavailable, default to 2D so the user never sees a broken
  // 3D canvas.
  const [mode, setMode] = useState(() => (webglSupported ? '3d' : '2d'))
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
  // larger. react-force-graph mutates nodes/links (replaces string IDs with
  // object refs), so we derive a stable degree count first.
  const enrichedData = useMemo(() => {
    if (!graphData) return null
    const degree = new Map()
    for (const link of graphData.links) {
      degree.set(link.source, (degree.get(link.source) || 0) + 1)
      degree.set(link.target, (degree.get(link.target) || 0) + 1)
    }
    const nodes = graphData.nodes.map((n) => ({
      ...n,
      linkCount: degree.get(n.id) || 0,
    }))
    return { nodes, links: graphData.links.map((l) => ({ ...l })) }
  }, [graphData])

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

  if (loading) return <div className="text-text-secondary">Loading...</div>

  const hasData = graphData && graphData.nodes.length > 0

  return (
    <div className="max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <h1 className="text-2xl font-bold text-text">Knowledge Graph</h1>
        <div className="flex items-center gap-3">
          <div className="text-sm text-text-secondary">
            {graphData?.nodes?.length || 0} pages &middot; {graphData?.links?.length || 0} links
          </div>
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
          <p className="text-lg mb-2">No pages to visualize</p>
          <p className="text-sm">Create pages with [[wikilinks]] to build your knowledge graph</p>
        </div>
      ) : (
        <div className="relative bg-surface rounded-xl shadow-sm border border-border overflow-hidden">
          <div ref={containerRef} className="w-full" style={{ height: 600 }}>
            <Suspense
              fallback={
                <div className="flex items-center justify-center h-full text-text-secondary">
                  Loading graph…
                </div>
              }
            >
              {mode === '3d' && webglSupported ? (
                <ForceGraph3D
                  ref={graphRef}
                  graphData={enrichedData}
                  width={size.width}
                  height={size.height}
                  backgroundColor="rgba(0,0,0,0)"
                  nodeLabel="title"
                  nodeThreeObject={buildPlanetObject}
                  nodeThreeObjectExtend={false}
                  linkColor={() => 'rgba(148, 163, 184, 0.5)'}
                  linkDirectionalArrowLength={3}
                  linkDirectionalArrowRelPos={1}
                  onNodeClick={handleNodeClick}
                  onBackgroundClick={() => setSelectedNode(null)}
                />
              ) : (
                <ForceGraph2D
                  ref={graphRef}
                  graphData={enrichedData}
                  width={size.width}
                  height={size.height}
                  nodeLabel="title"
                  nodeRelSize={4}
                  nodeVal={sizeFor}
                  nodeColor={colorFor}
                  linkColor={() => 'rgba(148, 163, 184, 0.6)'}
                  linkDirectionalArrowLength={4}
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
                Selected page
              </div>
              <div className="font-semibold text-text break-words">{selectedNode.title}</div>
              <div className="text-xs text-text-secondary mt-1">
                {selectedNode.linkCount || 0} connection{selectedNode.linkCount === 1 ? '' : 's'}
              </div>
              <div className="flex gap-2 mt-3">
                <button
                  type="button"
                  onClick={() => navigate(`/page/${selectedNode.slug}`)}
                  className="flex-1 px-3 py-1.5 text-sm bg-primary text-white rounded hover:opacity-90"
                >
                  Go to page
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedNode(null)}
                  className="px-3 py-1.5 text-sm text-text-secondary hover:text-text"
                >
                  Close
                </button>
              </div>
            </div>
          )}

          {!webglSupported && (
            <div className="absolute bottom-3 left-3 text-xs text-text-secondary bg-surface/80 border border-border rounded px-2 py-1">
              WebGL unavailable — showing 2D view
            </div>
          )}
        </div>
      )}
    </div>
  )
}
