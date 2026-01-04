/**
 * Carregador de Tutoriais em Markdown para o Help Viewer
 * Busca arquivos .md em um diretório e prepara para exibição
 */

export async function loadTutorialsFromDirectory(dirPath) {
  try {
    // Enviar requisição IPC para ler diretório
    return new Promise((resolve, reject) => {
      window.ipc?.send('load-tutorials', { dirPath })
      
      window.ipc?.once('load-tutorials-result', (data) => {
        if (data.success) {
          resolve(data.tutorials)
        } else {
          reject(new Error(data.error))
        }
      })
      
      // Timeout de segurança
      setTimeout(() => reject(new Error('Timeout ao carregar tutoriais')), 5000)
    })
  } catch (error) {
    console.error('[Tutorials] Erro ao carregar:', error)
    return []
  }
}

/**
 * Converter Markdown simples para HTML
 * Suporta: títulos, listas, código, negrito, itálico, blocos de referência técnica
 * 
 * Sintaxe de blocos de referência:
 * @ref Nome da Função
 * Descrição da função
 * @return tipo de retorno
 * @example
 * código de exemplo
 * @end
 */
export function markdownToHtml(markdown) {
  if (!markdown) return ''
  
  let html = markdown.trim()
  
  // Processar blocos de referência técnica ANTES de tudo
  const refBlocks = []
  html = html.replace(/@ref\s+([^\n]+)\n([\s\S]*?)@end/g, (match, funcName, content) => {
    const placeholder = `__REF_BLOCK_${refBlocks.length}__`
    
    // Extrair linhas de descrição, retorno e exemplo
    let description = ''
    let returnType = ''
    let example = ''
    let exampleLang = 'c' // Linguagem padrão para SGDK
    
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
        if (currentContent.length > 0) {
          if (currentSection === 'desc') description = currentContent.join('\n').trim()
        }
        currentContent = []
        currentSection = 'example'
      } else if (line.trim()) {
        currentContent.push(line)
      }
    }
    
    // Capturar último conteúdo
    if (currentContent.length > 0) {
      if (currentSection === 'desc') description = currentContent.join('\n').trim()
      if (currentSection === 'example') example = currentContent.join('\n').trim()
    }
    
    // Escapar HTML no exemplo
    const escapedExample = example
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
    
    // Montar bloco HTML
    let refHtml = `<div class="function-docs">
      <hr>
      <h3>Referência Técnica: ${funcName}</h3>
      <p><strong>Descrição:</strong> ${description}</p>`
    
    if (returnType) {
      refHtml += `\n      <p><strong>Retorno:</strong> <code>${returnType}</code></p>`
    }
    
    if (example) {
      // Usar classe hljs para que Highlight.js processe
      refHtml += `\n      <p><strong>Exemplo:</strong></p>
      <pre class="help-code"><code class="language-${exampleLang} hljs">${escapedExample}</code></pre>`
    }
    
    refHtml += `\n    </div>`
    
    refBlocks.push(refHtml)
    return `\n${placeholder}\n`
  })
  
  // Processar blocos de código ANTES de escapar HTML
  const codeBlocks = []
  html = html.replace(/```(\w+)?\n([\s\S]*?)```/g, (match, lang, code) => {
    const language = lang || 'text'
    const cleanCode = code.trim()
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
    const placeholder = `__CODE_BLOCK_${codeBlocks.length}__`
    
    // Gerar ID único para o bloco
    const blockId = `code-block-${Date.now()}-${codeBlocks.length}`
    
    // Montar bloco com botão de copiar
    const codeBlockHtml = `<div class="code-block-wrapper">
      <div class="code-block-header">
        <span class="code-block-lang">${language}</span>
        <button class="code-copy-btn" data-code-id="${blockId}" title="Copiar código">
          <i class="fas fa-copy"></i> Copiar
        </button>
      </div>
      <pre class="code-block language-${language}" id="${blockId}"><code class="language-${language}">${cleanCode}</code></pre>
    </div>`
    
    codeBlocks.push(codeBlockHtml)
    return `\n${placeholder}\n`
  })
  
  // Escapar de HTML para o resto do conteúdo
  html = html.replace(/&/g, '&amp;')
              .replace(/</g, '&lt;')
              .replace(/>/g, '&gt;')
  
  // Título 1
  html = html.replace(/^# (.*?)$/gm, '<h1>$1</h1>')
  
  // Título 2
  html = html.replace(/^## (.*?)$/gm, '<h2>$1</h2>')
  
  // Título 3
  html = html.replace(/^### (.*?)$/gm, '<h3>$1</h3>')
  
  // Negrito
  html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
  
  // Itálico
  html = html.replace(/\*(.*?)\*/g, '<em>$1</em>')
  
  // Código inline (antes de quebras de linha)
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>')
  
  // Imagens (Sintaxe: ![alt](url)) - Deve vir ANTES de links para não conflitar
  html = html.replace(/!\[(.*?)\]\((.*?)\)/g, '<img src="$2" alt="$1" class="markdown-img" />')

  // Links (sem target="_blank" pois será controlado por JS)
  html = html.replace(/\[(.*?)\]\((.*?)\)/g, '<a href="$2">$1</a>')
  
  // Listas não-ordenadas (usar espaços em branco para detectar)
  html = html.replace(/^\s*- (.+)$/gm, '<li>$1</li>')
  html = html.replace(/(<li>.*?<\/li>)/s, (match) => {
    return '<ul>' + match + '</ul>'
  })
  html = html.replace(/<\/li>\n<li>/g, '</li><li>')
  
  // Listas ordenadas
  html = html.replace(/^\s*\d+\.\s+(.+)$/gm, '<li>$1</li>')
  
  // Separar em blocos por linhas vazias
  let blocks = html.split(/\n\n+/)
  blocks = blocks.map(block => {
    // Se já é uma tag especial, não envolver
    if (block.match(/^<(h[1-6]|ul|pre|ol|div|img)/) || block.match(/__CODE_BLOCK_|__REF_BLOCK_/)) {
      return block
    }
    // Se contém apenas tags li, retornar como está
    if (block.match(/^<li>/) && !block.includes('</li>\n<li>')) {
      return block
    }
    // Caso contrário, envolver em <p>
    if (block.trim()) {
      return '<p>' + block.trim() + '</p>'
    }
    return ''
  })
  html = blocks.filter(b => b).join('\n')
  
  // Restaurar blocos de código
  codeBlocks.forEach((block, index) => {
    html = html.replace(`__CODE_BLOCK_${index}__`, block)
  })
  
  // Restaurar blocos de referência
  refBlocks.forEach((block, index) => {
    html = html.replace(`__REF_BLOCK_${index}__`, block)
  })
  
  return html
}

/**
 * Extrair metadados do Markdown (título, descrição, tags)
 * Formato: frontmatter YAML simples no início do arquivo
 */
export function extractMetadata(markdown) {
  const metadata = {
    title: 'Tutorial',
    description: '',
    tags: []
  }
  
  // Procurar por frontmatter
  const frontmatterRegex = /^---\n([\s\S]*?)\n---\n/
  const match = markdown.match(frontmatterRegex)
  
  if (match) {
    const fm = match[1]
    
    // Extrair title
    const titleMatch = fm.match(/title:\s*(.+)/i)
    if (titleMatch) metadata.title = titleMatch[1].trim()
    
    // Extrair description
    const descMatch = fm.match(/description:\s*(.+)/i)
    if (descMatch) metadata.description = descMatch[1].trim()
    
    // Extrair tags
    const tagsMatch = fm.match(/tags:\s*\[(.*?)\]/i)
    if (tagsMatch) {
      metadata.tags = tagsMatch[1]
        .split(',')
        .map(t => t.trim().replace(/["']/g, ''))
        .filter(t => t)
    }
  } else {
    // Tentar extrair título do primeiro H1
    const h1Match = markdown.match(/^# (.+)$/m)
    if (h1Match) metadata.title = h1Match[1].trim()
    
    // Tentar extrair descrição do primeiro parágrafo
    const paraMatch = markdown.match(/^(?!#|-)(.+)$/m)
    if (paraMatch) metadata.description = paraMatch[1].trim().substring(0, 100)
  }
  
  return metadata
}
