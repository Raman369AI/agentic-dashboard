const NS = 'http://www.w3.org/2000/svg'
const tags = new Set('svg g path rect circle ellipse line polyline polygon text tspan title desc defs clipPath mask linearGradient radialGradient stop pattern marker'.split(' '))
const attrs = new Set(('id class version pointer-events display visibility overflow shape-rendering text-rendering x y x1 y1 x2 y2 dx dy width height viewBox preserveAspectRatio d points cx cy r rx ry fx fy fr transform opacity fill fill-opacity fill-rule stroke stroke-width stroke-opacity stroke-linecap stroke-linejoin stroke-miterlimit stroke-dasharray stroke-dashoffset clip-path clip-rule mask font-family font-size font-weight font-style text-anchor dominant-baseline alignment-baseline baseline-shift textLength lengthAdjust letter-spacing word-spacing gradientUnits gradientTransform offset stop-color stop-opacity spreadMethod patternUnits patternContentUnits patternTransform markerWidth markerHeight markerUnits refX refY orient marker-start marker-mid marker-end vector-effect role aria-label aria-roledescription aria-hidden').split(' '))

/** Rebuild a passive SVG from an allowlist, then display only in an image context. */
export function safeSvg(source: unknown): string {
  if (typeof source !== 'string' || new TextEncoder().encode(source).length > 2 * 1024 * 1024) throw new Error('SVG must be a string under 2 MiB.')
  if (/<!DOCTYPE|<!ENTITY|<\?/i.test(source)) throw new Error('SVG declarations and entities are not allowed.')
  const parsed = new DOMParser().parseFromString(source, 'image/svg+xml')
  if (parsed.querySelector('parsererror') || parsed.documentElement.localName !== 'svg' || parsed.documentElement.namespaceURI !== NS) throw new Error('Invalid SVG document; include the SVG namespace.')
  const clean = document.implementation.createDocument(NS, 'svg', null)
  let count = 0
  function copy(node: Element, depth: number): Element {
    if (++count > 10_000 || depth > 40) throw new Error('SVG is too complex.')
    if (node.namespaceURI !== NS || !tags.has(node.localName)) throw new Error('Unsupported SVG element: ' + node.localName)
    const result = clean.createElementNS(NS, node.localName)
    for (const attr of node.attributes) {
      if (attr.name === 'xmlns' && attr.value === NS) continue
      // Vega exports an unused namespace declaration even when it has no links.
      if (attr.name === 'xmlns:xlink' && attr.value === 'http://www.w3.org/1999/xlink') continue
      if (attr.namespaceURI || !attrs.has(attr.name)) throw new Error('Unsupported SVG attribute: ' + attr.name)
      if (/url\s*\(/i.test(attr.value) && !/^url\(#[A-Za-z_][\w:.-]*\)$/.test(attr.value)) throw new Error('SVG may reference only local paint/clip definitions.')
      if (/[\\]|@import|expression\s*\(/i.test(attr.value)) throw new Error('Unsafe SVG attribute value.')
      if (node.localName === 'svg' && ['width', 'height'].includes(attr.name)) {
        const number = Number.parseFloat(attr.value)
        if (!/^(?:\d+(?:\.\d*)?|\.\d+)(?:px|%)?$/.test(attr.value) || !Number.isFinite(number) || number < 0 || number > (attr.value.endsWith('%') ? 100 : 4096)) throw new Error('SVG dimensions must be at most 4096 pixels or 100%.')
      }
      result.setAttribute(attr.name, attr.value)
    }
    for (const child of node.childNodes) {
      if (child.nodeType === Node.ELEMENT_NODE) result.appendChild(copy(child as Element, depth + 1))
      else if (child.nodeType === Node.TEXT_NODE) result.appendChild(clean.createTextNode(child.textContent || ''))
      else if (child.nodeType !== Node.COMMENT_NODE) throw new Error('Unsupported SVG node.')
    }
    return result
  }
  clean.replaceChild(copy(parsed.documentElement, 0), clean.documentElement)
  return new XMLSerializer().serializeToString(clean)
}
