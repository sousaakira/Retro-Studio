/**
 * AI Tools - Ferramentas que a IA pode usar para interagir com o código
 * 
 * Cada tool tem:
 * - name: Nome único da tool
 * - description: Descrição para a IA entender quando usar
 * - parameters: Schema JSON dos parâmetros
 * - execute: Função que executa a tool
 */

import fs from 'node:fs/promises'
import path from 'node:path'
import { exec, spawn } from 'node:child_process'
import { promisify } from 'node:util'
import { findSymbolsInCContent, getSymbolsFromCFile } from './ast/cParser.js'
import { runBuildAsync, runEmulatorAsync } from '../retro/buildForTools.js'
import { createProjectFromTemplate, TEMPLATE_DIRECTORIES } from '../retro/projectUtils.js'

const execAsync = promisify(exec)

// Configurações de terminal
const MAX_TERMINAL_OUTPUT = 50000 // Limite de caracteres no output
const TERMINAL_TIMEOUT = 30000 // 30 segundos de timeout
const PERSISTENT_TERMINAL_TIMEOUT = 5000 // 5 segundos para comandos persistentes

// Armazena terminais persistentes
const persistentTerminals = new Map()

/**
 * Definição das tools no formato OpenAI Function Calling
 */
export const toolDefinitions = [
  {
    type: 'function',
    function: {
      name: 'read_file',
      description: 'Lê o conteúdo de um arquivo. Use para ver o código fonte de um arquivo específico.',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'Caminho do arquivo relativo ao workspace (ex: src/App.vue)'
          },
          start_line: {
            type: 'number',
            description: 'Linha inicial (opcional, começa em 1)'
          },
          end_line: {
            type: 'number',
            description: 'Linha final (opcional)'
          }
        },
        required: ['path']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'list_directory',
      description: 'Lista arquivos e pastas de um diretório. Use para explorar a estrutura do projeto.',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'Caminho do diretório relativo ao workspace (ex: src/components). Use "." para raiz.'
          },
          recursive: {
            type: 'boolean',
            description: 'Se true, lista recursivamente. Default: false'
          }
        },
        required: ['path']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'search_files',
      description: 'Busca arquivos por nome ou padrão glob. Use para encontrar arquivos específicos.',
      parameters: {
        type: 'object',
        properties: {
          pattern: {
            type: 'string',
            description: 'Padrão de busca (ex: "*.vue", "App*", "test")'
          },
          path: {
            type: 'string',
            description: 'Diretório para buscar (opcional, default: raiz do workspace)'
          }
        },
        required: ['pattern']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'grep_code',
      description: 'Busca texto ou regex no código. Use para encontrar onde algo é usado ou definido.',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Texto ou regex para buscar'
          },
          path: {
            type: 'string',
            description: 'Diretório para buscar (opcional, default: raiz)'
          },
          include: {
            type: 'string',
            description: 'Padrão de arquivos para incluir (ex: "*.ts", "*.vue")'
          },
          case_sensitive: {
            type: 'boolean',
            description: 'Se a busca é case-sensitive. Default: false'
          }
        },
        required: ['query']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_project_structure',
      description: 'Retorna a estrutura completa do projeto em formato de árvore. Use para ter uma visão geral.',
      parameters: {
        type: 'object',
        properties: {
          max_depth: {
            type: 'number',
            description: 'Profundidade máxima da árvore. Default: 3'
          },
          include_hidden: {
            type: 'boolean',
            description: 'Incluir arquivos/pastas ocultos. Default: false'
          }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_file_info',
      description: 'Retorna informações sobre um arquivo (tamanho, tipo, linhas, etc).',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'Caminho do arquivo'
          }
        },
        required: ['path']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'write_file',
      description: 'Cria um novo arquivo ou sobrescreve um arquivo existente com conteúdo fornecido.',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'Caminho do arquivo relativo ao workspace'
          },
          content: {
            type: 'string',
            description: 'Conteúdo completo a ser escrito no arquivo'
          }
        },
        required: ['path', 'content']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'patch_file',
      description: 'Aplica modificações em um arquivo existente usando busca e substituição. Use para editar partes específicas de um arquivo.',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'Caminho do arquivo relativo ao workspace'
          },
          search: {
            type: 'string',
            description: 'Texto exato a ser encontrado (deve ser único no arquivo)'
          },
          replace: {
            type: 'string',
            description: 'Texto que substituirá o texto encontrado'
          }
        },
        required: ['path', 'search', 'replace']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'insert_at_line',
      description: 'Insere conteúdo em uma linha específica do arquivo. Use para adicionar código em posições precisas.',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'Caminho do arquivo relativo ao workspace'
          },
          line: {
            type: 'number',
            description: 'Número da linha onde inserir (1-based)'
          },
          content: {
            type: 'string',
            description: 'Conteúdo a ser inserido'
          },
          mode: {
            type: 'string',
            enum: ['before', 'after', 'replace'],
            description: 'Modo de inserção: before (antes da linha), after (depois), replace (substitui a linha). Default: before'
          }
        },
        required: ['path', 'line', 'content']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'search_codebase',
      description: 'Busca inteligente no código combinando múltiplas estratégias. Use para encontrar funções, classes, variáveis, ou qualquer código relacionado a um conceito.',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Termo de busca (ex: "autenticação", "getUserData", "class User")'
          },
          type: {
            type: 'string',
            enum: ['all', 'function', 'class', 'variable', 'import', 'component'],
            description: 'Tipo de código a buscar. Default: all'
          },
          file_pattern: {
            type: 'string',
            description: 'Padrão de arquivos para filtrar (ex: "*.vue", "*.js")'
          },
          max_results: {
            type: 'number',
            description: 'Número máximo de resultados. Default: 20'
          }
        },
        required: ['query']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'get_file_symbols',
      description: 'Lista funções, macros e includes de um arquivo C (.c ou .h). Use para saber o que existe no arquivo sem ler o código inteiro.',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'Caminho do arquivo relativo ao workspace (ex: src/main.c)'
          }
        },
        required: ['path']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'build_rom',
      description: 'Compila o projeto SGDK/Mega Drive. Use para gerar a ROM. Retorna stderr em caso de erro para análise.',
      parameters: {
        type: 'object',
        properties: {
          clean: {
            type: 'boolean',
            description: 'Se true, faz clean antes do build. Default: false'
          }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'create_project',
      description: 'Cria novo projeto a partir de template. Use quando o usuário pedir "crie um platformer", "novo projeto", etc.',
      parameters: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description: 'Nome do projeto (ex: meu-jogo)'
          },
          path: {
            type: 'string',
            description: 'Diretório onde criar (relativo ao workspace ou "." para raiz do workspace)'
          },
          template: {
            type: 'string',
            description: `Template: ${Object.keys(TEMPLATE_DIRECTORIES).join(', ')}. hello-world-sgdk é o mais simples.`
          }
        },
        required: ['name']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'list_assets',
      description: 'Lista sprites, tiles, paletas, mapas e sons definidos nos arquivos .res do projeto. Use para saber quais recursos existem.',
      parameters: {
        type: 'object',
        properties: {}
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'run_emulator',
      description: 'Executa o emulador com a ROM do último build. Use após build_rom para testar o jogo.',
      parameters: {
        type: 'object',
        properties: {
          rom_path: {
            type: 'string',
            description: 'Caminho da ROM (opcional, usa out/rom.bin do projeto se omitido)'
          }
        }
      }
    }
  },
  // ===== Terminal Tools =====
  {
    type: 'function',
    function: {
      name: 'run_command',
      description: 'Executa um comando no terminal e aguarda o resultado. Use para npm, git, build, testes, etc. NÃO use para editar arquivos - use edit_file ao invés.',
      parameters: {
        type: 'object',
        properties: {
          command: {
            type: 'string',
            description: 'O comando a ser executado'
          },
          cwd: {
            type: 'string',
            description: 'Diretório onde executar (opcional, default: raiz do workspace)'
          },
          timeout: {
            type: 'number',
            description: 'Timeout em segundos (opcional, default: 30)'
          }
        },
        required: ['command']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'open_persistent_terminal',
      description: 'Abre um terminal persistente para comandos de longa duração como dev servers (npm run dev). Retorna um ID para usar com run_persistent_command.',
      parameters: {
        type: 'object',
        properties: {
          cwd: {
            type: 'string',
            description: 'Diretório onde abrir o terminal (opcional)'
          },
          name: {
            type: 'string',
            description: 'Nome identificador do terminal (opcional)'
          }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'run_persistent_command',
      description: 'Executa comando em um terminal persistente criado com open_persistent_terminal. Retorna output após 5 segundos (comando continua rodando em background).',
      parameters: {
        type: 'object',
        properties: {
          terminal_id: {
            type: 'string',
            description: 'ID do terminal persistente'
          },
          command: {
            type: 'string',
            description: 'Comando a executar'
          }
        },
        required: ['terminal_id', 'command']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'kill_persistent_terminal',
      description: 'Encerra um terminal persistente.',
      parameters: {
        type: 'object',
        properties: {
          terminal_id: {
            type: 'string',
            description: 'ID do terminal a encerrar'
          }
        },
        required: ['terminal_id']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'list_terminals',
      description: 'Lista todos os terminais persistentes ativos.',
      parameters: {
        type: 'object',
        properties: {}
      }
    }
  },
  // ===== File Management Tools =====
  {
    type: 'function',
    function: {
      name: 'create_file_or_folder',
      description: 'Cria um arquivo ou pasta. Para criar pasta, o caminho DEVE terminar com /.',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'Caminho do arquivo ou pasta (terminar com / para pasta)'
          },
          content: {
            type: 'string',
            description: 'Conteúdo inicial do arquivo (opcional, apenas para arquivos)'
          }
        },
        required: ['path']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'delete_file_or_folder',
      description: 'Deleta um arquivo ou pasta.',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'Caminho do arquivo ou pasta a deletar'
          },
          recursive: {
            type: 'boolean',
            description: 'Se true, deleta pasta recursivamente. Default: false'
          }
        },
        required: ['path']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'rename_file',
      description: 'Renomeia ou move um arquivo/pasta.',
      parameters: {
        type: 'object',
        properties: {
          old_path: {
            type: 'string',
            description: 'Caminho atual do arquivo/pasta'
          },
          new_path: {
            type: 'string',
            description: 'Novo caminho do arquivo/pasta'
          }
        },
        required: ['old_path', 'new_path']
      }
    }
  },
  // ===== Fast Apply Tool =====
  {
    type: 'function',
    function: {
      name: 'edit_file',
      description: 'Edita um arquivo usando blocos SEARCH/REPLACE. Mais preciso que patch_file para edições complexas.',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'Caminho do arquivo a editar'
          },
          search_replace_blocks: {
            type: 'string',
            description: `Blocos no formato: <<<<<<< ORIGINAL\\ncódigo original\\n=======\\ncódigo novo\\n>>>>>>> UPDATED`
          },
          search: { type: 'string', description: 'Alternativa: texto a buscar' },
          replace: { type: 'string', description: 'Alternativa: texto de substituição' }
        },
        required: ['path']
      }
    }
  },
  // ===== Git Tools =====
  {
    type: 'function',
    function: {
      name: 'git_status',
      description: 'Obtém o status Git do repositório (arquivos modificados, staged, branch atual, etc).',
      parameters: {
        type: 'object',
        properties: {}
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'git_diff',
      description: 'Mostra as mudanças de um arquivo específico no Git.',
      parameters: {
        type: 'object',
        properties: {
          file_path: {
            type: 'string',
            description: 'Caminho do arquivo para ver o diff'
          },
          staged: {
            type: 'boolean',
            description: 'Se true, mostra diff do staged. Default: false (unstaged)'
          }
        },
        required: ['file_path']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'git_commit',
      description: 'Cria um commit com os arquivos no stage.',
      parameters: {
        type: 'object',
        properties: {
          message: {
            type: 'string',
            description: 'Mensagem do commit'
          }
        },
        required: ['message']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'git_stage',
      description: 'Adiciona arquivo(s) ao stage para commit.',
      parameters: {
        type: 'object',
        properties: {
          file_path: {
            type: 'string',
            description: 'Caminho do arquivo ou "." para todos'
          }
        },
        required: ['file_path']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'git_log',
      description: 'Mostra o histórico de commits.',
      parameters: {
        type: 'object',
        properties: {
          limit: {
            type: 'number',
            description: 'Número máximo de commits. Default: 10'
          }
        }
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'git_branch',
      description: 'Gerencia branches Git (listar, criar, trocar).',
      parameters: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: ['list', 'create', 'checkout'],
            description: 'Ação: list (listar), create (criar nova), checkout (trocar)'
          },
          branch_name: {
            type: 'string',
            description: 'Nome da branch (obrigatório para create e checkout)'
          }
        },
        required: ['action']
      }
    }
  }
]

/**
 * Implementação das tools
 */
class ToolExecutor {
  constructor(workspacePath) {
    this.workspacePath = workspacePath
  }

  setWorkspace(workspacePath) {
    this.workspacePath = workspacePath
  }

  resolvePath(relativePath) {
    if (!this.workspacePath) {
      throw new Error('Workspace não selecionado')
    }
    const resolved = path.resolve(this.workspacePath, relativePath)
    // Segurança: garantir que está dentro do workspace
    if (!resolved.startsWith(this.workspacePath)) {
      throw new Error('Caminho fora do workspace')
    }
    return resolved
  }

  async execute(toolName, params) {
    const method = this[toolName]
    if (!method) {
      throw new Error(`Tool desconhecida: ${toolName}`)
    }
    const TOOL_TIMEOUT_MS = 90000
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`Tool ${toolName} excedeu timeout de ${TOOL_TIMEOUT_MS / 1000}s`)), TOOL_TIMEOUT_MS)
    )
    return await Promise.race([method.call(this, params), timeoutPromise])
  }

  /**
   * Lê conteúdo de um arquivo
   */
  async read_file({ path: filePath, start_line, end_line }) {
    let resolved
    
    try {
      resolved = this.resolvePath(filePath)
      await fs.access(resolved)
    } catch {
      // Arquivo não encontrado, tenta buscar pelo nome
      const fileName = path.basename(filePath)
      const searchResult = await this.search_files({ pattern: fileName })
      
      if (searchResult.matches && searchResult.matches.length > 0) {
        // Usa o primeiro resultado encontrado
        const foundPath = searchResult.matches[0].path
        resolved = this.resolvePath(foundPath)
        filePath = foundPath // Atualiza o caminho para exibição
      } else {
        throw new Error(`Arquivo não encontrado: ${filePath}`)
      }
    }
    
    const content = await fs.readFile(resolved, 'utf8')
    
    if (start_line || end_line) {
      const lines = content.split('\n')
      const start = (start_line || 1) - 1
      const end = end_line || lines.length
      const sliced = lines.slice(start, end)
      
      return {
        path: filePath,
        content: sliced.join('\n'),
        start_line: start + 1,
        end_line: Math.min(end, lines.length),
        total_lines: lines.length,
        lines: sliced.length
      }
    }
    
    return {
      path: filePath,
      content,
      total_lines: content.split('\n').length,
      lines: content.split('\n').length
    }
  }

  /**
   * Lista conteúdo de um diretório
   */
  async list_directory({ path: dirPath, recursive = false }) {
    const resolved = this.resolvePath(dirPath || '.')
    
    const listDir = async (dir, depth = 0) => {
      const entries = await fs.readdir(dir, { withFileTypes: true })
      const result = []
      
      for (const entry of entries) {
        if (entry.name.startsWith('.')) continue // Ignora ocultos
        
        const fullPath = path.join(dir, entry.name)
        const relativePath = path.relative(this.workspacePath, fullPath)
        
        if (entry.isDirectory()) {
          const item = { name: entry.name, path: relativePath, type: 'directory' }
          if (recursive && depth < 5) {
            item.children = await listDir(fullPath, depth + 1)
          }
          result.push(item)
        } else {
          result.push({ name: entry.name, path: relativePath, type: 'file' })
        }
      }
      
      // Ordena: pastas primeiro, depois arquivos, ambos alfabeticamente
      return result.sort((a, b) => {
        if (a.type !== b.type) return a.type === 'directory' ? -1 : 1
        return a.name.localeCompare(b.name)
      })
    }
    
    const entries = await listDir(resolved)
    return { path: dirPath || '.', entries }
  }

  /**
   * Busca arquivos por padrão
   */
  async search_files({ pattern, path: searchPath }) {
    const startDir = this.resolvePath(searchPath || '.')
    const results = []
    const patternLower = pattern.toLowerCase()
    const isGlob = pattern.includes('*')
    
    const search = async (dir) => {
      const entries = await fs.readdir(dir, { withFileTypes: true })
      
      for (const entry of entries) {
        if (entry.name.startsWith('.')) continue
        
        const fullPath = path.join(dir, entry.name)
        const relativePath = path.relative(this.workspacePath, fullPath)
        
        if (entry.isDirectory()) {
          await search(fullPath)
        } else {
          let matches = false
          if (isGlob) {
            // Simples glob matching
            const regex = new RegExp('^' + pattern.replace(/\*/g, '.*').replace(/\?/g, '.') + '$', 'i')
            matches = regex.test(entry.name)
          } else {
            matches = entry.name.toLowerCase().includes(patternLower)
          }
          
          if (matches) {
            results.push({ name: entry.name, path: relativePath })
          }
        }
        
        if (results.length >= 50) return // Limite de resultados
      }
    }
    
    await search(startDir)
    return { pattern, matches: results, count: results.length }
  }

  /**
   * Busca texto no código (grep)
   */
  async grep_code({ query, path: searchPath, include, case_sensitive = false }) {
    const startDir = this.resolvePath(searchPath || '.')
    const results = []
    const flags = case_sensitive ? 'g' : 'gi'
    const regex = new RegExp(query, flags)
    
    const searchFile = async (filePath) => {
      try {
        const content = await fs.readFile(filePath, 'utf8')
        const lines = content.split('\n')
        const matches = []
        
        lines.forEach((line, index) => {
          if (regex.test(line)) {
            matches.push({
              line: index + 1,
              content: line.trim().substring(0, 200) // Limita tamanho
            })
          }
          regex.lastIndex = 0 // Reset regex state
        })
        
        if (matches.length > 0) {
          const relativePath = path.relative(this.workspacePath, filePath)
          results.push({ path: relativePath, matches })
        }
      } catch {
        // Ignora arquivos que não podem ser lidos
      }
    }
    
    const search = async (dir) => {
      const entries = await fs.readdir(dir, { withFileTypes: true })
      
      for (const entry of entries) {
        if (entry.name.startsWith('.') || entry.name === 'node_modules') continue
        
        const fullPath = path.join(dir, entry.name)
        
        if (entry.isDirectory()) {
          await search(fullPath)
        } else {
          // Verifica extensão se include foi especificado
          if (include) {
            const ext = path.extname(entry.name)
            const includeExts = include.replace(/\*/g, '').split(',').map(e => e.trim())
            if (!includeExts.some(ie => ext === ie || entry.name.endsWith(ie))) {
              continue
            }
          }
          
          // Só busca em arquivos de texto comuns
          const textExts = ['.js', '.ts', '.vue', '.jsx', '.tsx', '.json', '.md', '.css', '.scss', '.html', '.xml', '.yaml', '.yml', '.txt', '.py', '.go', '.rs', '.java', '.c', '.cpp', '.h']
          if (textExts.includes(path.extname(entry.name).toLowerCase())) {
            await searchFile(fullPath)
          }
        }
        
        if (results.length >= 30) return // Limite de arquivos com matches
      }
    }
    
    await search(startDir)
    return { query, results, total_files: results.length }
  }

  /**
   * Retorna estrutura do projeto
   */
  async get_project_structure({ max_depth = 3, include_hidden = false }) {
    const buildTree = async (dir, depth = 0, prefix = '') => {
      if (depth > max_depth) return ''
      
      let output = ''
      const entries = await fs.readdir(dir, { withFileTypes: true })
      
      const filtered = entries.filter(e => {
        if (!include_hidden && e.name.startsWith('.')) return false
        if (e.name === 'node_modules') return false
        return true
      }).sort((a, b) => {
        if (a.isDirectory() !== b.isDirectory()) {
          return a.isDirectory() ? -1 : 1
        }
        return a.name.localeCompare(b.name)
      })
      
      for (let i = 0; i < filtered.length; i++) {
        const entry = filtered[i]
        const isLast = i === filtered.length - 1
        const connector = isLast ? '└── ' : '├── '
        const childPrefix = prefix + (isLast ? '    ' : '│   ')
        
        if (entry.isDirectory()) {
          output += prefix + connector + entry.name + '/\n'
          output += await buildTree(path.join(dir, entry.name), depth + 1, childPrefix)
        } else {
          output += prefix + connector + entry.name + '\n'
        }
      }
      
      return output
    }
    
    const rootName = path.basename(this.workspacePath)
    let tree = rootName + '/\n'
    tree += await buildTree(this.workspacePath)
    
    return { structure: tree }
  }

  /**
   * Informações sobre um arquivo
   */
  async get_file_info({ path: filePath }) {
    const resolved = this.resolvePath(filePath)
    const stat = await fs.stat(resolved)
    const content = await fs.readFile(resolved, 'utf8')
    const lines = content.split('\n')
    const ext = path.extname(filePath)
    
    // Detecta linguagem
    const langMap = {
      '.js': 'JavaScript',
      '.ts': 'TypeScript',
      '.vue': 'Vue',
      '.jsx': 'React JSX',
      '.tsx': 'React TSX',
      '.css': 'CSS',
      '.scss': 'SCSS',
      '.json': 'JSON',
      '.md': 'Markdown',
      '.html': 'HTML',
      '.py': 'Python',
      '.go': 'Go',
      '.rs': 'Rust'
    }
    
    return {
      path: filePath,
      name: path.basename(filePath),
      extension: ext,
      language: langMap[ext] || 'Unknown',
      size_bytes: stat.size,
      size_readable: formatBytes(stat.size),
      lines: lines.length,
      modified: stat.mtime.toISOString()
    }
  }

  /**
   * Escreve conteúdo em um arquivo (criar ou sobrescrever)
   */
  async write_file({ path: filePath, content }) {
    const resolved = this.resolvePath(filePath)
    
    // Cria diretório se não existir
    const dir = path.dirname(resolved)
    await fs.mkdir(dir, { recursive: true })
    
    // Escreve o arquivo
    await fs.writeFile(resolved, content, 'utf8')
    
    const lines = content.split('\n').length
    return {
      path: filePath,
      action: 'written',
      lines: lines,
      bytes: content.length
    }
  }

  /**
   * Aplica patch em arquivo (busca e substituição)
   */
  async patch_file({ path: filePath, search, replace }) {
    const resolved = this.resolvePath(filePath)
    const content = await fs.readFile(resolved, 'utf8')
    
    // Tenta encontrar o texto exato primeiro
    let foundText = search
    let occurrences = content.split(search).length - 1
    
    // Se não encontrou exato, tenta case-insensitive
    if (occurrences === 0) {
      const searchLower = search.toLowerCase()
      const lines = content.split('\n')
      
      for (const line of lines) {
        if (line.toLowerCase().includes(searchLower)) {
          // Encontra a substring que match
          const idx = line.toLowerCase().indexOf(searchLower)
          foundText = line.substring(idx, idx + search.length)
          occurrences = 1
          break
        }
      }
    }
    
    // Verifica se o texto de busca existe
    if (occurrences === 0) {
      throw new Error(`Texto não encontrado no arquivo. Buscando por: "${search}"`)
    }
    
    // Verifica se é único (apenas para matches exatos)
    if (occurrences > 1 && foundText === search) {
      throw new Error(`Texto encontrado ${occurrences} vezes. Deve ser único para segurança. Use um texto mais específico.`)
    }
    
    // Aplica substituição
    const newContent = content.replace(foundText, replace)
    await fs.writeFile(resolved, newContent, 'utf8')
    
    return {
      path: filePath,
      action: 'patched',
      old_lines: content.split('\n').length,
      new_lines: newContent.split('\n').length,
      matched: foundText
    }
  }

  /**
   * Insere conteúdo em linha específica
   */
  async insert_at_line({ path: filePath, line, content, mode = 'before' }) {
    const resolved = this.resolvePath(filePath)
    const fileContent = await fs.readFile(resolved, 'utf8')
    const lines = fileContent.split('\n')
    
    // Valida linha
    if (line < 1 || line > lines.length + 1) {
      throw new Error(`Linha ${line} inválida. O arquivo tem ${lines.length} linhas.`)
    }
    
    const lineIndex = line - 1
    
    // Aplica a inserção baseado no modo
    switch (mode) {
      case 'before':
        lines.splice(lineIndex, 0, content)
        break
      case 'after':
        lines.splice(lineIndex + 1, 0, content)
        break
      case 'replace':
        lines[lineIndex] = content
        break
      default:
        throw new Error(`Modo inválido: ${mode}. Use 'before', 'after' ou 'replace'.`)
    }
    
    const newContent = lines.join('\n')
    await fs.writeFile(resolved, newContent, 'utf8')
    
    return {
      path: filePath,
      action: `inserted_${mode}`,
      line: line,
      new_total_lines: lines.length
    }
  }

  /**
   * Busca inteligente no codebase
   */
  async search_codebase({ query, type = 'all', file_pattern, max_results = 20 }) {
    const results = []
    const queryLower = query.toLowerCase()
    
    // Padrões de busca por tipo
    const patterns = {
      function: [
        /(?:function|async function)\s+(\w+)\s*\(/g,
        /(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s*)?\([^)]*\)\s*=>/g,
        /(\w+)\s*:\s*(?:async\s*)?function/g,
        /(\w+)\s*\([^)]*\)\s*\{/g // Métodos
      ],
      class: [
        /class\s+(\w+)/g,
        /interface\s+(\w+)/g,
        /type\s+(\w+)\s*=/g
      ],
      variable: [
        /(?:const|let|var)\s+(\w+)\s*=/g,
        /export\s+(?:const|let|var)\s+(\w+)/g
      ],
      import: [
        /import\s+.*?from\s+['"]([^'"]+)['"]/g,
        /import\s+['"]([^'"]+)['"]/g,
        /require\s*\(['"]([^'"]+)['"]\)/g
      ],
      component: [
        /<([A-Z]\w+)/g, // Vue/React components
        /export\s+default\s+\{/g
      ]
    }
    
    // Determina quais padrões usar
    const searchPatterns = type === 'all' 
      ? Object.values(patterns).flat()
      : patterns[type] || []
    
    // Função para buscar em um arquivo
    const searchInFile = async (filePath) => {
      try {
        const content = await fs.readFile(filePath, 'utf8')
        const lines = content.split('\n')
        const fileResults = []
        const ext = path.extname(filePath).toLowerCase()

        // Para .c/.h: usa parser de símbolos C (funções, macros) além dos padrões
        if ((ext === '.c' || ext === '.h') && queryLower) {
          const symbolMatches = findSymbolsInCContent(content, filePath, query)
          const relPath = path.relative(this.workspacePath, filePath)
          for (const s of symbolMatches) {
            const startLine = Math.max(0, s.line - 2)
            const endLine = Math.min(lines.length, s.line + 2)
            const contextLines = lines.slice(startLine, endLine)
            fileResults.push({
              file: relPath,
              line: s.line,
              match: `${s.type}: ${s.name}`,
              context: contextLines.join('\n'),
              type: s.type
            })
          }
        }

        // Busca por padrões específicos
        if (searchPatterns.length > 0) {
          for (const pattern of searchPatterns) {
            let match
            const regex = new RegExp(pattern.source, pattern.flags)
            
            while ((match = regex.exec(content)) !== null) {
              const matchedText = match[1] || match[0]
              
              // Verifica se match contém a query
              if (matchedText.toLowerCase().includes(queryLower) || 
                  content.substring(Math.max(0, match.index - 50), match.index + 100)
                    .toLowerCase().includes(queryLower)) {
                
                // Encontra o número da linha
                const beforeMatch = content.substring(0, match.index)
                const lineNum = beforeMatch.split('\n').length
                
                // Pega contexto (2 linhas antes e depois)
                const startLine = Math.max(0, lineNum - 2)
                const endLine = Math.min(lines.length, lineNum + 2)
                const contextLines = lines.slice(startLine, endLine)
                
                fileResults.push({
                  file: path.relative(this.workspacePath, filePath),
                  line: lineNum,
                  match: matchedText,
                  context: contextLines.join('\n'),
                  type: type === 'all' ? this.detectType(match[0]) : type
                })
              }
            }
          }
        }
        
        // Busca textual simples
        lines.forEach((line, idx) => {
          if (line.toLowerCase().includes(queryLower)) {
            // Evita duplicatas
            const alreadyFound = fileResults.some(r => r.line === idx + 1)
            if (!alreadyFound) {
              const startLine = Math.max(0, idx - 1)
              const endLine = Math.min(lines.length, idx + 3)
              const contextLines = lines.slice(startLine, endLine)
              
              fileResults.push({
                file: path.relative(this.workspacePath, filePath),
                line: idx + 1,
                match: line.trim(),
                context: contextLines.join('\n'),
                type: 'text'
              })
            }
          }
        })
        
        return fileResults
      } catch (e) {
        return []
      }
    }
    
    // Busca recursiva em diretórios
    const searchDir = async (dir) => {
      if (results.length >= max_results) return
      
      const entries = await fs.readdir(dir, { withFileTypes: true })
      
      for (const entry of entries) {
        if (results.length >= max_results) break
        
        // Ignora node_modules e pastas ocultas
        if (entry.name.startsWith('.') || entry.name === 'node_modules') continue
        
        const fullPath = path.join(dir, entry.name)
        
        if (entry.isDirectory()) {
          await searchDir(fullPath)
        } else if (entry.isFile()) {
          // Filtra por padrão se especificado (simples glob)
          if (file_pattern) {
            const pattern = file_pattern.replace(/\*/g, '.*').replace(/\?/g, '.')
            const regex = new RegExp(`^${pattern}$`, 'i')
            if (!regex.test(entry.name)) continue
          }
          
          // Apenas arquivos de código
          const codeExts = ['.js', '.ts', '.vue', '.jsx', '.tsx', '.py', '.go', '.rs', '.java', '.c', '.cpp', '.h', '.css', '.scss', '.html']
          const ext = path.extname(entry.name).toLowerCase()
          
          if (codeExts.includes(ext)) {
            const fileResults = await searchInFile(fullPath)
            results.push(...fileResults.slice(0, max_results - results.length))
          }
        }
      }
    }
    
    await searchDir(this.workspacePath)
    
    // Ordena por relevância (matches exatos primeiro)
    results.sort((a, b) => {
      const aExact = a.match.toLowerCase() === queryLower
      const bExact = b.match.toLowerCase() === queryLower
      if (aExact && !bExact) return -1
      if (!aExact && bExact) return 1
      return 0
    })
    
    return {
      query,
      total: results.length,
      results: results.slice(0, max_results)
    }
  }

  /**
   * Lista símbolos (funções, macros, includes) de arquivo C (.c / .h)
   */
  async get_file_symbols({ path: filePath }) {
    const resolved = this.resolvePath(filePath)
    const ext = path.extname(resolved).toLowerCase()
    if (ext !== '.c' && ext !== '.h') {
      return { path: filePath, error: 'Apenas arquivos .c ou .h são suportados', symbols: null }
    }
    const content = await fs.readFile(resolved, 'utf8')
    const symbols = getSymbolsFromCFile(content, filePath)
    return {
      path: path.relative(this.workspacePath, resolved),
      functions: symbols.functions,
      macros: symbols.macros,
      includes: symbols.includes
    }
  }

  /**
   * Cria projeto a partir de template
   */
  async create_project({ name, path: basePathRel, template = 'hello-world-sgdk' } = {}) {
    if (!this.workspacePath) throw new Error('Workspace não selecionado')
    const basePath = basePathRel ? this.resolvePath(basePathRel) : this.workspacePath
    return createProjectFromTemplate(name, basePath, template)
  }

  /**
   * Lista assets (sprites, tiles, paletas, mapas, sons) dos arquivos .res
   */
  async list_assets() {
    if (!this.workspacePath) throw new Error('Workspace não selecionado')
    const resDir = path.join(this.workspacePath, 'res')
    const sprites = []
    const tilesets = []
    const palettes = []
    const maps = []
    const sounds = []
    const images = []

    const parseResFile = async (filePath) => {
      const content = await fs.readFile(filePath, 'utf8').catch(() => '')
      const lines = content.split('\n')
      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed || trimmed.startsWith('#')) continue
        const parts = trimmed.split(/\s+/)
        if (parts.length < 2) continue
        const type = parts[0].toUpperCase()
        const name = parts[1]
        if (type === 'SPRITE') sprites.push(name)
        else if (type === 'TILESET' || type === 'TS') tilesets.push(name)
        else if (type === 'PALETTE' || type === 'PAL') palettes.push(name)
        else if (type === 'MAP' || type === 'TILEMAP' || type === 'BIN') maps.push(name)
        else if (['XGM', 'VGM', 'WAV', 'SGDK'].includes(type)) sounds.push(name)
        else if (type === 'IMAGE' || type === 'IMG') images.push(name)
      }
    }

    try {
      const entries = await fs.readdir(resDir, { withFileTypes: true })
      for (const e of entries) {
        if (e.isFile() && e.name.endsWith('.res')) {
          await parseResFile(path.join(resDir, e.name))
        } else if (e.isDirectory()) {
          const sub = await fs.readdir(path.join(resDir, e.name), { withFileTypes: true })
          for (const s of sub) {
            if (s.isFile() && s.name.endsWith('.res')) {
              await parseResFile(path.join(resDir, e.name, s.name))
            }
          }
        }
      }
    } catch (e) {
      if (e.code !== 'ENOENT') throw e
      return { sprites: [], tilesets: [], palettes: [], maps: [], sounds: [], images: [], error: 'Pasta res/ não encontrada' }
    }

    return { sprites, tilesets, palettes, maps, sounds, images }
  }

  /**
   * Compila o projeto SGDK/Mega Drive
   */
  async build_rom({ clean = false } = {}) {
    if (!this.workspacePath) throw new Error('Workspace não selecionado')
    const result = await runBuildAsync(this.workspacePath, null, { clean })
    if (result.error) return { success: false, error: result.error }
    if (!result.success) {
      const errLines = result.errors?.length ? result.errors.map(e => `${e.file}:${e.line}: ${e.message}`).join('\n') : result.stderr
      return {
        success: false,
        exitCode: result.exitCode,
        stderr: errLines || result.stderr,
        errors: result.errors
      }
    }
    return {
      success: true,
      romPath: result.romPath,
      message: `Build concluído: ${path.basename(result.romPath || '')}`
    }
  }

  /**
   * Executa emulador com a ROM
   */
  async run_emulator({ rom_path: romPath } = {}) {
    if (!this.workspacePath) throw new Error('Workspace não selecionado')
    return await runEmulatorAsync(romPath, this.workspacePath)
  }
  
  /**
   * Detecta o tipo de código baseado no match
   */
  detectType(match) {
    if (/^(function|async function)/.test(match)) return 'function'
    if (/^class/.test(match)) return 'class'
    if (/^(const|let|var)/.test(match)) return 'variable'
    if (/^import/.test(match)) return 'import'
    if (/^<[A-Z]/.test(match)) return 'component'
    return 'code'
  }
  
  // ===== Git Tools =====
  
  /**
   * Obtém status Git do repositório
   */
  async git_status() {
    try {
      const { stdout: branch } = await execAsync('git rev-parse --abbrev-ref HEAD', { cwd: this.workspacePath })
      const { stdout: status } = await execAsync('git status --porcelain', { cwd: this.workspacePath })
      
      const files = status.trim().split('\n').filter(Boolean).map(line => {
        const status = line.substring(0, 2)
        const path = line.substring(3).trim()
        return { status, path }
      })
      
      return {
        branch: branch.trim(),
        files,
        staged: files.filter(f => f.status[0] !== ' ' && f.status[0] !== '?').length,
        unstaged: files.filter(f => f.status[1] !== ' ').length,
        untracked: files.filter(f => f.status === '??').length
      }
    } catch (e) {
      throw new Error('Não é um repositório Git')
    }
  }
  
  /**
   * Mostra diff de um arquivo
   */
  async git_diff({ file_path, staged = false }) {
    try {
      const flag = staged ? '--cached' : ''
      const { stdout } = await execAsync(`git diff ${flag} -- "${file_path}"`, { cwd: this.workspacePath })
      
      if (!stdout.trim()) {
        return { file_path, message: 'Sem mudanças', diff: '' }
      }
      
      return { file_path, diff: stdout }
    } catch (e) {
      throw new Error(`Erro ao obter diff: ${e.message}`)
    }
  }
  
  /**
   * Cria um commit
   */
  async git_commit({ message }) {
    try {
      const { stdout } = await execAsync(`git commit -m "${message.replace(/"/g, '\\"')}"`, { cwd: this.workspacePath })
      return { success: true, message: stdout.trim() }
    } catch (e) {
      throw new Error(`Erro ao commitar: ${e.message}`)
    }
  }
  
  /**
   * Adiciona arquivo(s) ao stage
   */
  async git_stage({ file_path }) {
    try {
      await execAsync(`git add "${file_path}"`, { cwd: this.workspacePath })
      return { success: true, message: `${file_path} adicionado ao stage` }
    } catch (e) {
      throw new Error(`Erro ao fazer stage: ${e.message}`)
    }
  }
  
  /**
   * Mostra histórico de commits
   */
  async git_log({ limit = 10 }) {
    try {
      const format = '%H|%an|%ae|%ai|%s'
      const { stdout } = await execAsync(`git log --format="${format}" --max-count=${limit}`, { cwd: this.workspacePath })
      
      if (!stdout.trim()) {
        return { commits: [] }
      }
      
      const commits = stdout.trim().split('\n').map(line => {
        const [hash, author, email, date, subject] = line.split('|')
        return {
          hash: hash.trim(),
          shortHash: hash.trim().substring(0, 7),
          author: author.trim(),
          email: email.trim(),
          date: date.trim(),
          subject: subject.trim()
        }
      })
      
      return { commits, count: commits.length }
    } catch (e) {
      throw new Error(`Erro ao obter log: ${e.message}`)
    }
  }
  
  /**
   * Gerencia branches
   */
  async git_branch({ action, branch_name }) {
    try {
      if (action === 'list') {
        const { stdout } = await execAsync('git branch -a', { cwd: this.workspacePath })
        const branches = stdout.trim().split('\n').map(line => {
          const isCurrent = line.startsWith('*')
          const name = line.replace(/^\*?\s+/, '').trim()
          return { name, current: isCurrent }
        })
        return { branches }
      }
      
      if (action === 'create') {
        if (!branch_name) throw new Error('Nome da branch é obrigatório')
        await execAsync(`git branch "${branch_name}"`, { cwd: this.workspacePath })
        return { success: true, message: `Branch "${branch_name}" criada` }
      }
      
      if (action === 'checkout') {
        if (!branch_name) throw new Error('Nome da branch é obrigatório')
        await execAsync(`git checkout "${branch_name}"`, { cwd: this.workspacePath })
        return { success: true, message: `Trocado para branch "${branch_name}"` }
      }
      
      throw new Error(`Ação desconhecida: ${action}`)
    } catch (e) {
      throw new Error(`Erro em git_branch: ${e.message}`)
    }
  }
  
  // ===== Terminal Tools =====
  
  /**
   * Executa um comando no terminal e aguarda resultado
   */
  async run_command({ command, cwd, timeout = 30 }) {
    const workDir = cwd ? this.resolvePath(cwd) : this.workspacePath
    const timeoutMs = timeout * 1000
    
    try {
      const { stdout, stderr } = await execAsync(command, {
        cwd: workDir,
        timeout: timeoutMs,
        maxBuffer: 10 * 1024 * 1024, // 10MB buffer
        shell: true
      })
      
      let result = ''
      if (stdout) result += stdout
      if (stderr) result += (result ? '\n' : '') + stderr
      
      // Trunca se muito grande
      if (result.length > MAX_TERMINAL_OUTPUT) {
        result = result.substring(0, MAX_TERMINAL_OUTPUT) + '\n... [output truncado]'
      }
      
      return {
        success: true,
        command,
        output: result || '(comando executado sem output)',
        exit_code: 0
      }
    } catch (error) {
      // Captura output mesmo em erro
      let output = ''
      if (error.stdout) output += error.stdout
      if (error.stderr) output += (output ? '\n' : '') + error.stderr
      if (!output) output = error.message
      
      return {
        success: false,
        command,
        output: output.substring(0, MAX_TERMINAL_OUTPUT),
        exit_code: error.code || 1,
        error: error.killed ? 'Timeout atingido' : 'Comando falhou'
      }
    }
  }
  
  /**
   * Abre um terminal persistente
   */
  async open_persistent_terminal({ cwd, name }) {
    const workDir = cwd ? this.resolvePath(cwd) : this.workspacePath
    const terminalId = `term_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`
    
    const terminal = {
      id: terminalId,
      name: name || `Terminal ${persistentTerminals.size + 1}`,
      cwd: workDir,
      process: null,
      output: [],
      createdAt: new Date().toISOString()
    }
    
    persistentTerminals.set(terminalId, terminal)
    
    return {
      terminal_id: terminalId,
      name: terminal.name,
      cwd: workDir,
      message: 'Terminal persistente criado. Use run_persistent_command para executar comandos.'
    }
  }
  
  /**
   * Executa comando em terminal persistente
   */
  async run_persistent_command({ terminal_id, command }) {
    const terminal = persistentTerminals.get(terminal_id)
    if (!terminal) {
      throw new Error(`Terminal não encontrado: ${terminal_id}`)
    }
    
    return new Promise((resolve, reject) => {
      const output = []
      let timeoutId
      
      // Spawn do processo
      const proc = spawn(command, [], {
        cwd: terminal.cwd,
        shell: true,
        stdio: ['pipe', 'pipe', 'pipe']
      })
      
      terminal.process = proc
      
      proc.stdout.on('data', (data) => {
        output.push(data.toString())
        terminal.output.push(data.toString())
      })
      
      proc.stderr.on('data', (data) => {
        output.push(data.toString())
        terminal.output.push(data.toString())
      })
      
      proc.on('error', (err) => {
        clearTimeout(timeoutId)
        reject(new Error(`Erro ao executar: ${err.message}`))
      })
      
      proc.on('close', (code) => {
        clearTimeout(timeoutId)
        resolve({
          terminal_id,
          command,
          output: output.join('').substring(0, MAX_TERMINAL_OUTPUT),
          exit_code: code,
          completed: true
        })
      })
      
      // Timeout - retorna output parcial após 5 segundos
      timeoutId = setTimeout(() => {
        resolve({
          terminal_id,
          command,
          output: output.join('').substring(0, MAX_TERMINAL_OUTPUT) || '(aguardando output...)',
          completed: false,
          message: 'Comando ainda rodando em background'
        })
      }, PERSISTENT_TERMINAL_TIMEOUT)
    })
  }
  
  /**
   * Encerra um terminal persistente
   */
  async kill_persistent_terminal({ terminal_id }) {
    const terminal = persistentTerminals.get(terminal_id)
    if (!terminal) {
      throw new Error(`Terminal não encontrado: ${terminal_id}`)
    }
    
    if (terminal.process) {
      terminal.process.kill('SIGTERM')
      // Força kill após 2 segundos
      setTimeout(() => {
        if (terminal.process && !terminal.process.killed) {
          terminal.process.kill('SIGKILL')
        }
      }, 2000)
    }
    
    persistentTerminals.delete(terminal_id)
    
    return {
      success: true,
      terminal_id,
      message: `Terminal ${terminal.name} encerrado`
    }
  }
  
  /**
   * Lista terminais persistentes
   */
  async list_terminals() {
    const terminals = []
    for (const [id, terminal] of persistentTerminals) {
      terminals.push({
        id,
        name: terminal.name,
        cwd: terminal.cwd,
        running: terminal.process && !terminal.process.killed,
        createdAt: terminal.createdAt
      })
    }
    return { terminals, count: terminals.length }
  }
  
  // ===== File Management Tools =====
  
  /**
   * Cria arquivo ou pasta
   */
  async create_file_or_folder({ path: filePath, content = '' }) {
    const resolved = this.resolvePath(filePath)
    const isFolder = filePath.endsWith('/')
    
    if (isFolder) {
      await fs.mkdir(resolved, { recursive: true })
      return {
        path: filePath,
        type: 'folder',
        action: 'created'
      }
    } else {
      // Cria diretório pai se não existir
      const dir = path.dirname(resolved)
      await fs.mkdir(dir, { recursive: true })
      
      // Cria arquivo
      await fs.writeFile(resolved, content, 'utf8')
      return {
        path: filePath,
        type: 'file',
        action: 'created',
        bytes: content.length
      }
    }
  }
  
  /**
   * Deleta arquivo ou pasta
   */
  async delete_file_or_folder({ path: filePath, recursive = false }) {
    const resolved = this.resolvePath(filePath)
    
    const stat = await fs.stat(resolved)
    const isFolder = stat.isDirectory()
    
    if (isFolder) {
      if (recursive) {
        await fs.rm(resolved, { recursive: true, force: true })
      } else {
        await fs.rmdir(resolved)
      }
    } else {
      await fs.unlink(resolved)
    }
    
    return {
      path: filePath,
      type: isFolder ? 'folder' : 'file',
      action: 'deleted'
    }
  }
  
  /**
   * Renomeia ou move arquivo/pasta
   */
  async rename_file({ old_path, new_path }) {
    const oldResolved = this.resolvePath(old_path)
    const newResolved = this.resolvePath(new_path)
    
    // Cria diretório pai se não existir
    const dir = path.dirname(newResolved)
    await fs.mkdir(dir, { recursive: true })
    
    await fs.rename(oldResolved, newResolved)
    
    return {
      old_path,
      new_path,
      action: 'renamed'
    }
  }
  
  // ===== Fast Apply Tool =====
  
  /**
   * Edita arquivo usando blocos SEARCH/REPLACE (Fast Apply)
   */
  async edit_file({ path: filePath, search_replace_blocks, search, replace }) {
    const resolved = this.resolvePath(filePath)
    let content = await fs.readFile(resolved, 'utf8')
    const originalContent = content

    // Aceita search/replace direto (alternativa ao conflito)
    if ((!search_replace_blocks || (Array.isArray(search_replace_blocks) && search_replace_blocks.length === 0)) && search != null && replace != null) {
      search_replace_blocks = `<<<<<<< ORIGINAL\n${String(search)}\n=======\n${String(replace)}\n>>>>>>> UPDATED`
    }
    if (!search_replace_blocks) {
      throw new Error('Forneça search_replace_blocks ou search e replace')
    }
    if (Array.isArray(search_replace_blocks)) {
      search_replace_blocks = search_replace_blocks.join('\n\n')
    }
    if (typeof search_replace_blocks !== 'string') {
      throw new Error('search_replace_blocks deve ser string ou array de strings')
    }
    search_replace_blocks = search_replace_blocks.replace(/\r\n/g, '\n').trim()

    // Parse dos blocos SEARCH/REPLACE (aceita variações do LLM)
    const fixEscapedQuotes = (s) => (typeof s === 'string' ? s.replace(/\\"/g, '"') : s)

    const blocks = []
    const patterns = [
      // Formato completo: <<<<<<< ORIGINAL ... ======= ... >>>>>>> UPDATED
      /<<<<<<<\s*ORIGINAL\s*\n([\s\S]*?)\n=======\s*\n([\s\S]*?)\n>>>>>>>\s*UPDATED/g,
      // Variação: >>>>>>> UPDATED ou só UPDATED em linha separada no final
      /<<<<<<<\s*ORIGINAL\s*\n([\s\S]*?)\n=======\s*\n([\s\S]*?)\n(?:>>>>>>>\s*)?UPDATED\s*$/gm
    ]

    for (const regex of patterns) {
      let match
      regex.lastIndex = 0
      while ((match = regex.exec(search_replace_blocks)) !== null) {
        const search = fixEscapedQuotes(match[1].trim())
        const replace = fixEscapedQuotes(match[2].trim())
        if (search && replace) {
          blocks.push({ search, replace })
        }
      }
      if (blocks.length > 0) break
    }

    // Fallback: formato {"search":"...","replace":"..."}
    if (blocks.length === 0) {
      try {
        const parsed = JSON.parse(search_replace_blocks)
        if (parsed?.search != null && parsed?.replace != null) {
          blocks.push({
            search: fixEscapedQuotes(String(parsed.search).trim()),
            replace: fixEscapedQuotes(String(parsed.replace).trim())
          })
        }
      } catch (_) {}
    }

    if (blocks.length === 0) {
      throw new Error('Nenhum bloco SEARCH/REPLACE válido encontrado. Use o formato:\n<<<<<<< ORIGINAL\ncódigo original\n=======\ncódigo novo\n>>>>>>> UPDATED')
    }
    
    // Aplica cada bloco
    const applied = []
    const errors = []
    
    const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

    for (const block of blocks) {
      // 1. Match exato
      if (content.includes(block.search)) {
        content = content.replace(block.search, block.replace)
        applied.push({ search: block.search.substring(0, 50) + '...' })
        continue
      }

      // 2. Match com \s+ (whitespace flexível)
      const normalizedSearch = escapeRegex(block.search).replace(/\s+/g, '\\s+')
      try {
        const normalizedRegex = new RegExp(normalizedSearch)
        if (normalizedRegex.test(content)) {
          content = content.replace(normalizedRegex, block.replace)
          applied.push({ search: block.search.substring(0, 50) + '... (whitespace)' })
          continue
        }
      } catch (_) { /* regex inválido */ }

      // 3. Match linha a linha (permite indent diferente)
      const lines = block.search.split('\n').filter(l => l.trim().length > 0)
      if (lines.length >= 1) {
        const firstLine = lines[0].trim()
        const firstLineEscaped = escapeRegex(firstLine).replace(/\s+/g, '\\s+')
        const firstMatch = content.match(new RegExp(firstLineEscaped))
        if (firstMatch) {
          const startIdx = content.indexOf(firstMatch[0])
          const afterStart = content.slice(startIdx)
          let endIdx = startIdx
          let braceCount = 0
          let inBlock = false
          for (let i = 0; i < afterStart.length; i++) {
            const c = afterStart[i]
            if (c === '{') { braceCount++; inBlock = true }
            else if (c === '}') { braceCount--; if (inBlock && braceCount === 0) { endIdx = startIdx + i + 1; break } }
          }
          if (endIdx > startIdx) {
            content = content.slice(0, startIdx) + block.replace + content.slice(endIdx)
            applied.push({ search: block.search.substring(0, 50) + '... (por assinatura)' })
            continue
          }
        }
      }

      errors.push({ search: block.search.substring(0, 80), error: 'Texto não encontrado no arquivo' })
    }
    
    if (applied.length === 0) {
      throw new Error(`Nenhum bloco aplicado. Erros: ${JSON.stringify(errors)}`)
    }
    
    // Salva o arquivo modificado
    await fs.writeFile(resolved, content, 'utf8')
    
    return {
      path: filePath,
      action: 'edited',
      blocks_applied: applied.length,
      blocks_failed: errors.length,
      old_lines: originalContent.split('\n').length,
      new_lines: content.split('\n').length,
      applied,
      errors: errors.length > 0 ? errors : undefined
    }
  }
}

function formatBytes(bytes) {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i]
}

// Instância singleton
export const toolExecutor = new ToolExecutor(null)

export default { toolDefinitions, toolExecutor }
