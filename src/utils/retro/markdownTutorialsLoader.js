/**
 * Carregador de Tutoriais em Markdown para o Help Viewer
 */

/**
 * Converter Markdown simples para HTML
 * Suporta: títulos, listas, código, negrito, itálico, blocos de referência técnica
 */
export function markdownToHtml(markdown) {
  if (!markdown) return ''

  let html = markdown.trim()

  // Processar blocos de referência técnica ANTES de tudo
  const refBlocks = []
  html = html.replace(/@ref\s+([^\n]+)\n([\s\S]*?)@end/g, (match, funcName, content) => {
    const placeholder = `__REF_BLOCK_${refBlocks.length}__`
    let description = ''
    let returnType = ''
    let example = ''
    const exampleLang = 'c'
    const lines = content.trim().split('\n')
    let currentSection = 'desc'
    let currentContent = []

    for (const line of lines) {
      if (line.startsWith('@return')) {
        if (currentContent.length > 0) {
          if (currentSection === 'desc') description = currentContent.join('\n').trim()
          if (currentSection === 'example') example = currentContent.join('\n').trim()
        }
        currentContent = []
        currentSection = 'return'
        const returnMatch = line.match(/@return\s+(.+)/)
        if (returnMatch) returnType = returnMatch[1].trim()
      } else if (line.startsWith('@example')) {
        if (currentContent.length > 0 && currentSection === 'desc') description = currentContent.join('\n').trim()
        currentContent = []
        currentSection = 'example'
      } else if (line.trim()) {
        currentContent.push(line)
      }
    }
    if (currentContent.length > 0) {
      if (currentSection === 'desc') description = currentContent.join('\n').trim()
      if (currentSection === 'example') example = currentContent.join('\n').trim()
    }

    const escapedExample = example
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')

    let refHtml = `<div class="function-docs"><hr><h3>Referência Técnica: ${funcName}</h3><p><strong>Descrição:</strong> ${description}</p>`
    if (returnType) refHtml += `<p><strong>Retorno:</strong> <code>${returnType}</code></p>`
    if (example) refHtml += `<p><strong>Exemplo:</strong></p><pre class="help-code"><code class="language-${exampleLang}">${escapedExample}</code></pre>`
    refHtml += '</div>'
    refBlocks.push(refHtml)
    return `\n${placeholder}\n`
  })

  // Processar blocos de código
  const codeBlocks = []
  html = html.replace(/```(\w+)?\n([\s\S]*?)```/g, (match, lang, code) => {
    const language = lang || 'text'
    const cleanCode = code.trim()
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
    const blockId = `code-block-${Date.now()}-${codeBlocks.length}`
    const codeBlockHtml = `<div class="code-block-wrapper">
      <div class="code-block-header">
        <span class="code-block-lang">${language}</span>
        <button class="code-copy-btn" data-code-id="${blockId}" title="Copiar código"><span class="icon-copy"></span> Copiar</button>
      </div>
      <pre class="code-block language-${language}" id="${blockId}"><code class="language-${language}">${cleanCode}</code></pre>
    </div>`
    codeBlocks.push(codeBlockHtml)
    return `\n__CODE_BLOCK_${codeBlocks.length - 1}__\n`
  })

  html = html.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  html = html.replace(/^# (.*?)$/gm, '<h1>$1</h1>')
  html = html.replace(/^## (.*?)$/gm, '<h2>$1</h2>')
  html = html.replace(/^### (.*?)$/gm, '<h3>$1</h3>')
  html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
  html = html.replace(/\*(.*?)\*/g, '<em>$1</em>')
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>')
  html = html.replace(/!\[(.*?)\]\((.*?)\)/g, '<img src="$2" alt="$1" class="markdown-img" />')
  html = html.replace(/\[(.*?)\]\((.*?)\)/g, '<a href="$2">$1</a>')
  html = html.replace(/^\s*- (.+)$/gm, '<li>$1</li>')
  html = html.replace(/(<li>.*?<\/li>)/s, (match) => '<ul>' + match + '</ul>')
  html = html.replace(/<\/li>\n<li>/g, '</li><li>')
  html = html.replace(/^\s*\d+\.\s+(.+)$/gm, '<li>$1</li>')

  let blocks = html.split(/\n\n+/)
  blocks = blocks.map((block) => {
    if (block.match(/^<(h[1-6]|ul|pre|ol|div|img)/) || block.match(/__CODE_BLOCK_|__REF_BLOCK_/)) return block
    if (block.match(/^<li>/) && !block.includes('</li>\n<li>')) return block
    return block.trim() ? '<p>' + block.trim() + '</p>' : ''
  })
  html = blocks.filter((b) => b).join('\n')

  codeBlocks.forEach((block, index) => {
    html = html.replace(`__CODE_BLOCK_${index}__`, block)
  })
  refBlocks.forEach((block, index) => {
    html = html.replace(`__REF_BLOCK_${index}__`, block)
  })

  return html
}
