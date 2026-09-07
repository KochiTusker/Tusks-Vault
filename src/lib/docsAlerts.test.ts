import { describe, it, expect } from 'vitest'
import { renderDocsAlerts } from './docsAlerts'

const KINDS = ['note', 'tip', 'important', 'warning', 'caution'] as const

describe('renderDocsAlerts', () => {
  it('rewrites each alert kind into a matching callout div', () => {
    for (const kind of KINDS) {
      const out = renderDocsAlerts(`> [!${kind.toUpperCase()}]\n> Body text.`)
      expect(out).toContain(`<div class="docs-alert docs-alert-${kind}">`)
      expect(out).toContain('Body text.')
      expect(out).not.toContain(`[!${kind.toUpperCase()}]`)
    }
  })

  it('keeps markdown inside the callout intact for the renderer', () => {
    const out = renderDocsAlerts(
      '> [!TIP]\n> Run `npm run dev` and see [the docs](docs/README.md).',
    )
    // Blank lines around the body are what let the markdown parser treat the
    // contents as markdown rather than as literal text inside an HTML block.
    expect(out).toMatch(/docs-alert-label">Streamlined<\/div>\n\n/)
    expect(out).toContain('`npm run dev`')
    expect(out).toContain('[the docs](docs/README.md)')
  })

  it('leaves alert syntax inside fenced code blocks alone', () => {
    const src = ['```md', '> [!CAUTION]', '> Example.', '```'].join('\n')
    expect(renderDocsAlerts(src)).toBe(src)
  })

  it('ends the callout at the first non-blockquote line', () => {
    const out = renderDocsAlerts('> [!WARNING]\n> Inside.\n\nOutside.')
    // lastIndexOf, not indexOf: the first </div> closes the label, not the
    // callout.
    const closing = out.lastIndexOf('</div>')
    expect(out.indexOf('Inside.')).toBeLessThan(closing)
    expect(out.indexOf('Outside.')).toBeGreaterThan(closing)
  })

  // Regression: git's autocrlf leaves CRLF in a Windows working tree. `.` in
  // a JS regex does not match \r, so the body pattern silently failed and the
  // quote markers rendered as literal text inside the callout. Every fixture
  // above uses \n, which is exactly why the original suite missed it.
  it('strips quote markers from a CRLF document', () => {
    const out = renderDocsAlerts('> [!CAUTION]\r\n> First line.\r\n> Second line.\r\n')
    expect(out).toContain('docs-alert-caution')
    expect(out).toContain('First line.')
    expect(out).not.toContain('>First line.')
    expect(out).not.toContain('> First line.')
    expect(out).not.toContain('\r')
  })

  it('produces the same callout for CRLF and LF input', () => {
    const lf = '# Doc\n\n> [!TIP]\n> Body **bold** here.\n\nAfter.'
    const crlf = lf.replace(/\n/g, '\r\n')
    expect(renderDocsAlerts(crlf)).toBe(renderDocsAlerts(lf))
  })

  it('passes ordinary blockquotes through untouched', () => {
    const src = '> Just a quotation.\n> Second line.'
    expect(renderDocsAlerts(src)).toBe(src)
  })

  it('handles several alerts in one document', () => {
    const out = renderDocsAlerts(
      '> [!CAUTION]\n> One.\n\ntext\n\n> [!TIP]\n> Two.',
    )
    expect(out).toContain('docs-alert-caution')
    expect(out).toContain('docs-alert-tip')
  })
})
