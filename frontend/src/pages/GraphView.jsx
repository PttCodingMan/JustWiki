import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import api from '../api/client'

export default function GraphView() {
  const navigate = useNavigate()
  const svgRef = useRef(null)
  const [graphData, setGraphData] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api.get('/pages/graph').then((res) => {
      setGraphData(res.data)
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [])

  useEffect(() => {
    if (!graphData || !svgRef.current) return
    const { nodes, links } = graphData
    if (nodes.length === 0) return

    const svg = svgRef.current
    const width = svg.clientWidth || 800
    const height = svg.clientHeight || 600

    // Clear
    svg.innerHTML = ''

    // Create node map
    const nodeMap = new Map(nodes.map((n) => [n.id, { ...n, x: width / 2 + (Math.random() - 0.5) * 200, y: height / 2 + (Math.random() - 0.5) * 200, vx: 0, vy: 0 }]))

    // Resolve links
    const resolvedLinks = links
      .filter((l) => nodeMap.has(l.source) && nodeMap.has(l.target))
      .map((l) => ({ source: nodeMap.get(l.source), target: nodeMap.get(l.target) }))

    const simNodes = [...nodeMap.values()]

    // Simple force simulation
    const ITERATIONS = 300
    for (let iter = 0; iter < ITERATIONS; iter++) {
      const alpha = 1 - iter / ITERATIONS

      // Repulsion between all nodes
      for (let i = 0; i < simNodes.length; i++) {
        for (let j = i + 1; j < simNodes.length; j++) {
          const a = simNodes[i], b = simNodes[j]
          let dx = b.x - a.x, dy = b.y - a.y
          let dist = Math.sqrt(dx * dx + dy * dy) || 1
          const force = (150 * alpha) / dist
          const fx = (dx / dist) * force
          const fy = (dy / dist) * force
          a.x -= fx; a.y -= fy
          b.x += fx; b.y += fy
        }
      }

      // Attraction along links
      for (const link of resolvedLinks) {
        const { source: a, target: b } = link
        let dx = b.x - a.x, dy = b.y - a.y
        let dist = Math.sqrt(dx * dx + dy * dy) || 1
        const force = (dist - 100) * 0.05 * alpha
        const fx = (dx / dist) * force
        const fy = (dy / dist) * force
        a.x += fx; a.y += fy
        b.x -= fx; b.y -= fy
      }

      // Center gravity
      for (const node of simNodes) {
        node.x += (width / 2 - node.x) * 0.01 * alpha
        node.y += (height / 2 - node.y) * 0.01 * alpha
      }
    }

    // Draw SVG
    const ns = 'http://www.w3.org/2000/svg'

    // Defs for arrow markers
    const defs = document.createElementNS(ns, 'defs')
    const marker = document.createElementNS(ns, 'marker')
    marker.setAttribute('id', 'arrowhead')
    marker.setAttribute('viewBox', '0 0 10 10')
    marker.setAttribute('refX', '20')
    marker.setAttribute('refY', '5')
    marker.setAttribute('markerWidth', '6')
    marker.setAttribute('markerHeight', '6')
    marker.setAttribute('orient', 'auto')
    const path = document.createElementNS(ns, 'path')
    path.setAttribute('d', 'M 0 0 L 10 5 L 0 10 Z')
    path.setAttribute('fill', '#94a3b8')
    marker.appendChild(path)
    defs.appendChild(marker)
    svg.appendChild(defs)

    // Links
    for (const link of resolvedLinks) {
      const line = document.createElementNS(ns, 'line')
      line.setAttribute('x1', link.source.x)
      line.setAttribute('y1', link.source.y)
      line.setAttribute('x2', link.target.x)
      line.setAttribute('y2', link.target.y)
      line.setAttribute('stroke', '#cbd5e1')
      line.setAttribute('stroke-width', '1.5')
      line.setAttribute('marker-end', 'url(#arrowhead)')
      svg.appendChild(line)
    }

    // Nodes
    for (const node of simNodes) {
      const g = document.createElementNS(ns, 'g')
      g.style.cursor = 'pointer'
      g.addEventListener('click', () => navigate(`/page/${node.slug}`))

      const circle = document.createElementNS(ns, 'circle')
      circle.setAttribute('cx', node.x)
      circle.setAttribute('cy', node.y)
      circle.setAttribute('r', '8')
      circle.setAttribute('fill', '#3b82f6')
      circle.setAttribute('stroke', '#fff')
      circle.setAttribute('stroke-width', '2')
      g.appendChild(circle)

      const text = document.createElementNS(ns, 'text')
      text.setAttribute('x', node.x)
      text.setAttribute('y', node.y + 22)
      text.setAttribute('text-anchor', 'middle')
      text.setAttribute('font-size', '11')
      text.setAttribute('fill', '#4b5563')
      text.textContent = node.title.length > 20 ? node.title.slice(0, 18) + '…' : node.title
      g.appendChild(text)

      svg.appendChild(g)
    }

    return () => {
      svg.innerHTML = ''
    }
  }, [graphData, navigate])

  if (loading) return <div className="text-text-secondary">Loading...</div>

  return (
    <div className="max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-bold text-text">Knowledge Graph</h1>
        <div className="text-sm text-text-secondary">
          {graphData?.nodes?.length || 0} pages &middot; {graphData?.links?.length || 0} links
        </div>
      </div>
      {!graphData || graphData.nodes.length === 0 ? (
        <div className="text-center py-16 text-text-secondary">
          <p className="text-lg mb-2">No pages to visualize</p>
          <p className="text-sm">Create pages with [[wikilinks]] to build your knowledge graph</p>
        </div>
      ) : (
        <div className="bg-surface rounded-xl shadow-sm border border-border overflow-hidden">
          <svg
            ref={svgRef}
            width="100%"
            height="600"
            className="w-full"
          />
        </div>
      )}
    </div>
  )
}
