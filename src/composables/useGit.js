/**
 * Estado e operações Git
 */
import { ref, computed } from 'vue'

export function useGit(workspacePath, openFile, refreshTree, lastError) {
  const isGitRepo = ref(false)
  const gitStatus = ref([])
  const gitBranch = ref('')
  const gitCommitMessage = ref('')
  const isLoadingGit = ref(false)
  const gitBranches = ref([])
  const showBranchDialog = ref(false)
  const newBranchName = ref('')
  const showBranchesPanel = ref(false)
  const gitCommits = ref([])
  const showCommitsPanel = ref(false)
  const isLoadingCommits = ref(false)
  const showDiffModal = ref(false)
  const diffContent = ref('')
  const diffFilePath = ref('')
  const diffStaged = ref(false)

  const parsedDiff = computed(() => {
    if (!diffContent.value) return []
    const lines = diffContent.value.split('\n')
    return lines.map((line) => {
      let type = 'normal'
      if (line.startsWith('+++') || line.startsWith('---')) type = 'header'
      else if (line.startsWith('@@')) type = 'hunk'
      else if (line.startsWith('+')) type = 'add'
      else if (line.startsWith('-')) type = 'delete'
      else if (line.startsWith('diff --git')) type = 'file'
      return { text: line, type }
    })
  })

  const stagedFiles = computed(() => gitStatus.value.filter(f => f.staged))
  const unstagedFiles = computed(() => gitStatus.value.filter(f => f.unstaged && !f.staged))

  async function loadGitStatus() {
    if (!workspacePath.value) return
    isLoadingGit.value = true
    try {
      isGitRepo.value = await window.retroStudio.git.isRepository()
      if (isGitRepo.value) {
        const [status, branch] = await Promise.all([
          window.retroStudio.git.status(),
          window.retroStudio.git.currentBranch()
        ])
        gitStatus.value = status
        gitBranch.value = branch
      }
    } catch (e) {
      console.error('Failed to load git status', e)
    } finally {
      isLoadingGit.value = false
    }
  }

  async function gitStageFile(filePath) {
    try {
      await window.retroStudio.git.stage(filePath)
      await loadGitStatus()
    } catch (e) {
      console.error('Failed to stage file', e)
      lastError.value = e.message
    }
  }

  async function gitUnstageFile(filePath) {
    try {
      await window.retroStudio.git.unstage(filePath)
      await loadGitStatus()
    } catch (e) {
      console.error('Failed to unstage file', e)
      lastError.value = e.message
    }
  }

  async function gitDiscardFile(filePath) {
    if (!confirm(`Discard changes in ${filePath}?`)) return
    try {
      await window.retroStudio.git.discard(filePath)
      await loadGitStatus()
      await refreshTree()
    } catch (e) {
      console.error('Failed to discard file', e)
      lastError.value = e.message
    }
  }

  async function gitCommit() {
    if (!gitCommitMessage.value.trim()) {
      window.retroStudioToast?.warning('Por favor, insira uma mensagem de commit')
      return
    }
    try {
      await window.retroStudio.git.commit(gitCommitMessage.value)
      gitCommitMessage.value = ''
      await loadGitStatus()
      window.retroStudioToast?.success('Commit realizado com sucesso!')
    } catch (e) {
      console.error('Failed to commit', e)
      if (e.message.includes('não está configurado') || e.message.includes('user.name') || e.message.includes('user.email')) {
        const userName = prompt('Configure o Git:\n\nDigite seu nome:')
        if (!userName) return
        const userEmail = prompt('Digite seu email:')
        if (!userEmail) return
        try {
          await window.retroStudio.git.config('user.name', userName)
          await window.retroStudio.git.config('user.email', userEmail)
          await window.retroStudio.git.commit(gitCommitMessage.value)
          gitCommitMessage.value = ''
          await loadGitStatus()
          window.retroStudioToast?.success('Git configurado e commit realizado!', { duration: 4000 })
        } catch (configError) {
          console.error('Failed to configure git', configError)
          lastError.value = configError.message
          window.retroStudioToast?.error('Erro ao configurar Git', { description: configError.message })
        }
      } else {
        lastError.value = e.message
        window.retroStudioToast?.error('Erro ao fazer commit', { description: e.message })
      }
    }
  }

  async function gitInitRepo() {
    try {
      await window.retroStudio.git.init()
      await loadGitStatus()
    } catch (e) {
      console.error('Failed to init git', e)
      lastError.value = e.message
    }
  }

  async function gitPull() {
    isLoadingGit.value = true
    try {
      const result = await window.retroStudio.git.pull()
      await loadGitStatus()
      window.retroStudioToast?.success('Pull realizado com sucesso!', { description: result.message, duration: 4000 })
    } catch (e) {
      console.error('Failed to pull', e)
      lastError.value = e.message
      window.retroStudioToast?.error('Erro ao fazer pull', { description: e.message })
    } finally {
      isLoadingGit.value = false
    }
  }

  async function gitPush() {
    isLoadingGit.value = true
    try {
      const result = await window.retroStudio.git.push()
      await loadGitStatus()
      window.retroStudioToast?.success('Push realizado com sucesso!', { description: result.message, duration: 4000 })
    } catch (e) {
      console.error('Failed to push', e)
      lastError.value = e.message
      window.retroStudioToast?.error('Erro ao fazer push', { description: e.message })
    } finally {
      isLoadingGit.value = false
    }
  }

  async function loadGitBranches() {
    try {
      const branches = await window.retroStudio.git.branches()
      gitBranches.value = branches
    } catch (e) {
      console.error('Failed to load branches', e)
      lastError.value = e.message
    }
  }

  async function gitCheckout(branchName) {
    if (!confirm(`Trocar para a branch "${branchName}"?`)) return
    isLoadingGit.value = true
    try {
      await window.retroStudio.git.checkout(branchName)
      await Promise.all([loadGitStatus(), loadGitBranches()])
      await refreshTree()
      window.retroStudioToast?.success(`Branch trocada para "${branchName}"`)
    } catch (e) {
      console.error('Failed to checkout branch', e)
      lastError.value = e.message
      window.retroStudioToast?.error('Erro ao trocar de branch', { description: e.message })
    } finally {
      isLoadingGit.value = false
    }
  }

  async function gitCreateBranch() {
    const name = newBranchName.value.trim()
    if (!name) {
      window.retroStudioToast?.warning('Por favor, insira um nome para a branch')
      return
    }
    isLoadingGit.value = true
    try {
      await window.retroStudio.git.createBranch(name)
      await Promise.all([loadGitStatus(), loadGitBranches()])
      newBranchName.value = ''
      showBranchDialog.value = false
      window.retroStudioToast?.success(`Branch "${name}" criada com sucesso!`)
    } catch (e) {
      console.error('Failed to create branch', e)
      lastError.value = e.message
      window.retroStudioToast?.error('Erro ao criar branch', { description: e.message })
    } finally {
      isLoadingGit.value = false
    }
  }

  async function gitDeleteBranch(branchName) {
    if (!confirm(`Deletar a branch "${branchName}"?\n\nATENÇÃO: Esta ação não pode ser desfeita!`)) return
    isLoadingGit.value = true
    try {
      await window.retroStudio.git.deleteBranch(branchName)
      await Promise.all([loadGitStatus(), loadGitBranches()])
      window.retroStudioToast?.success(`Branch "${branchName}" deletada com sucesso!`)
    } catch (e) {
      console.error('Failed to delete branch', e)
      lastError.value = e.message
      window.retroStudioToast?.error('Erro ao deletar branch', { description: e.message })
    } finally {
      isLoadingGit.value = false
    }
  }

  async function loadGitCommits(reset = false) {
    if (reset) gitCommits.value = []
    isLoadingCommits.value = true
    try {
      const skip = reset ? 0 : gitCommits.value.length
      const commits = await window.retroStudio.git.log({ limit: 20, skip })
      gitCommits.value = reset ? commits : [...gitCommits.value, ...commits]
    } catch (e) {
      console.error('Failed to load commits', e)
      lastError.value = e.message
    } finally {
      isLoadingCommits.value = false
    }
  }

  async function showFileDiff(filePath, staged = false) {
    try {
      const diff = await window.retroStudio.git.diff(filePath, staged)
      if (!diff) {
        window.retroStudioToast?.info('Sem mudanças para exibir')
        return
      }
      diffFilePath.value = filePath
      diffStaged.value = staged
      diffContent.value = diff
      showDiffModal.value = true
    } catch (e) {
      console.error('Failed to get diff', e)
      lastError.value = e.message
      window.retroStudioToast?.error('Erro ao carregar diff', { description: e.message })
    }
  }

  function closeDiffModal() {
    showDiffModal.value = false
    diffContent.value = ''
    diffFilePath.value = ''
    diffStaged.value = false
  }

  function formatCommitDate(dateStr) {
    const date = new Date(dateStr)
    const now = new Date()
    const diffMs = now - date
    const diffMins = Math.floor(diffMs / 60000)
    const diffHours = Math.floor(diffMs / 3600000)
    const diffDays = Math.floor(diffMs / 86400000)
    if (diffMins < 1) return 'just now'
    if (diffMins < 60) return `${diffMins}m ago`
    if (diffHours < 24) return `${diffHours}h ago`
    if (diffDays < 7) return `${diffDays}d ago`
    return date.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' })
  }

  function getGitStatusIcon(status) {
    switch (status) {
      case 'modified': return 'M'
      case 'added': return 'A'
      case 'deleted': return 'D'
      case 'renamed': return 'R'
      case 'untracked': return 'U'
      case 'conflict': return 'C'
      default: return '?'
    }
  }

  return {
    isGitRepo,
    gitStatus,
    gitBranch,
    gitCommitMessage,
    isLoadingGit,
    gitBranches,
    showBranchDialog,
    newBranchName,
    showBranchesPanel,
    gitCommits,
    showCommitsPanel,
    isLoadingCommits,
    showDiffModal,
    diffContent,
    diffFilePath,
    diffStaged,
    parsedDiff,
    stagedFiles,
    unstagedFiles,
    loadGitStatus,
    gitStageFile,
    gitUnstageFile,
    gitDiscardFile,
    gitCommit,
    gitInitRepo,
    gitPull,
    gitPush,
    loadGitBranches,
    gitCheckout,
    gitCreateBranch,
    gitDeleteBranch,
    loadGitCommits,
    showFileDiff,
    closeDiffModal,
    formatCommitDate,
    getGitStatusIcon,
    toggleBranchesPanel: () => {
      showBranchesPanel.value = !showBranchesPanel.value
      if (showBranchesPanel.value && gitBranches.value.length === 0) loadGitBranches()
    },
    openBranchDialog: () => {
      newBranchName.value = ''
      showBranchDialog.value = true
    },
    closeBranchDialog: () => {
      showBranchDialog.value = false
      newBranchName.value = ''
    },
    toggleCommitsPanel: () => {
      showCommitsPanel.value = !showCommitsPanel.value
      if (showCommitsPanel.value && gitCommits.value.length === 0) loadGitCommits(true)
    }
  }
}
