/**
 * Mini-renderer Markdown -> HTML securise (escape d'abord).
 * Couvre les elements utilises dans le rapport d'audit IA :
 * titres, listes, gras, italique, code inline, paragraphes, gagnants.
 */

const ESCAPE_MAP: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (ch) => ESCAPE_MAP[ch] ?? ch)
}

function renderInline(line: string): string {
  return escapeHtml(line)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
}

function renderTableCell(cell: string): string {
  return `<td>${renderInline(cell.trim())}</td>`
}

function renderTableRow(row: string): string[] {
  return row
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
}

function renderTable(rows: string[]): string {
  // Supprime la ligne de separation (| --- | --- |).
  const bodyRows = rows.filter((row) => !(/^\s*\|?[\s:|-]*\|?\s*$/.test(row) && row.includes('-')))
  const [headerRow, ...dataRows] = bodyRows
  const parts: string[] = []
  if (headerRow) {
    const headerCells = renderTableRow(headerRow)
      .map((cell) => `<th>${renderInline(cell.trim())}</th>`)
      .join('')
    parts.push(`<thead><tr>${headerCells}</tr></thead>`)
  }
  const tbody = dataRows
    .map((row) => `<tr>${renderTableRow(row).map(renderTableCell).join('')}</tr>`)
    .join('')
  parts.push(`<tbody>${tbody}</tbody>`)
  return `<table>${parts.join('')}</table>`
}

export function renderMarkdown(markdown: string): string {
  const lines = markdown.split(/\r?\n/)
  const html: string[] = []
  let listTag: 'ul' | 'ol' | null = null
  let inCode = false
  let codeBuf: string[] = []
  let tableBuf: string[] = []

  const closeList = () => {
    if (listTag) {
      html.push(`</${listTag}>`)
      listTag = null
    }
  }

  const closeTable = () => {
    if (tableBuf.length > 0) {
      html.push(renderTable(tableBuf))
      tableBuf = []
    }
  }

  for (const raw of lines) {
    const line = raw.trimEnd()

    if (line.startsWith('```')) {
      if (inCode) {
        html.push(`<pre>${escapeHtml(codeBuf.join('\n'))}</pre>`)
        codeBuf = []
        inCode = false
      } else {
        closeList()
        closeTable()
        inCode = true
      }
      continue
    }

    if (inCode) {
      codeBuf.push(line)
      continue
    }

    // Lignes de tableau markdown (| ... | ... |).
    if (/^\s*\|.*\|\s*$/.test(line)) {
      closeList()
      tableBuf.push(line)
      continue
    }
    closeTable()

    const heading = line.match(/^(#{1,6})\s+(.*)$/)
    if (heading) {
      closeList()
      const level = heading[1].length
      html.push(`<h${level}>${renderInline(heading[2])}</h${level}>`)
      continue
    }

    const listMatch = line.match(/^\s*[-*+]\s+(.*)$/)
    if (listMatch) {
      if (listTag !== 'ul') {
        closeList()
        html.push('<ul>')
        listTag = 'ul'
      }
      html.push(`<li>${renderInline(listMatch[1])}</li>`)
      continue
    }

    const ordered = line.match(/^\s*\d+[.)]\s+(.*)$/)
    if (ordered) {
      if (listTag !== 'ol') {
        closeList()
        html.push('<ol>')
        listTag = 'ol'
      }
      html.push(`<li>${renderInline(ordered[1])}</li>`)
      continue
    }

    const quote = line.match(/^>\s?(.*)$/)
    if (quote) {
      closeList()
      html.push(`<blockquote><p>${renderInline(quote[1])}</p></blockquote>`)
      continue
    }

    if (/^\s*(---|\*\*\*|___)\s*$/.test(line)) {
      closeList()
      html.push('<hr>')
      continue
    }

    if (line.trim() === '') {
      closeList()
      continue
    }

    closeList()
    html.push(`<p>${renderInline(line)}</p>`)
  }

  closeList()
  closeTable()
  if (inCode) html.push(`<pre>${escapeHtml(codeBuf.join('\n'))}</pre>`)

  return html.join('\n')
}