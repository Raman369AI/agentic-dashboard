import { describe, expect, it } from 'vitest'
import { safeSvg } from './svg'

const svg = (content: string) => '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100">' + content + '</svg>'
describe('passive custom SVG', () => {
  it('preserves geometry, text, gradients and local definitions', () => {
    const result = safeSvg(svg('<defs><linearGradient id="paint"><stop offset="0" stop-color="red"/><stop offset="1" stop-color="blue"/></linearGradient></defs><rect width="100" height="50" fill="url(#paint)"/><text x="5" y="20">Custom &amp; safe</text>'))
    expect(result).toContain('url(#paint)')
    expect(result).toContain('Custom &amp; safe')
  })
  it.each([
    '<script>alert(1)</script>',
    '<foreignObject><div>HTML</div></foreignObject>',
    '<rect onclick="alert(1)" />',
    '<image href="https://example.com/tracker" />',
    '<use href="#recursive" />',
    '<style>@import "https://example.com/track"</style>',
    '<rect fill="url(https://example.com/track)" />',
    '<rect style="fill:red"/>',
    '<animate attributeName="x"/>',
    '<a href="javascript:alert(1)"><text>Bad</text></a>',
  ])('rejects active or unsupported SVG content: %s', (content) => {
    expect(() => safeSvg(svg(content))).toThrow()
  })
  it('rejects unbounded SVG image dimensions', () => {
    expect(() => safeSvg('<svg xmlns="http://www.w3.org/2000/svg" width="999999"/>')).toThrow('dimensions')
    expect(() => safeSvg('<svg xmlns="http://www.w3.org/2000/svg" width="100%"/>')).not.toThrow()
  })
  it('rejects malformed XML, entities and missing namespaces', () => {
    expect(() => safeSvg('<svg/>')).toThrow('namespace')
    expect(() => safeSvg('<!DOCTYPE svg><svg/>')).toThrow('declarations')
    expect(() => safeSvg(svg('<broken>'))).toThrow('Invalid')
  })
})
