import { ref, computed, provide, watch, onMounted, onBeforeUnmount } from 'vue'

export function useGit(workspacePath, openFile, refreshTree, lastError) {
  const isGitRepo = ref(false), gitStatus = ref([]), gitBranch = ref('')
  const gitCommitMessage = ref(''), isLoadingGit = ref(false), gitBranches = ref([])
  const showBranchDialog = ref(false), newBranchName = ref(''), showBranchesPanel = ref(false)
  const gitCommits = ref([]), showCommitsPanel = ref(false), isLoadingCommits = ref(false)
  const showDiffModal = ref(false), diffContent = ref(''), diffFilePath = ref(''), diffStaged = ref(false)
  const error = ref(''), notice = ref(''), busy = ref(false), panelActive = ref(false)
  const identityOpen = ref(false), userName = ref(''), userEmail = ref(''), confirmation = ref(null)
  const needsRestart = ref(false)
  const filter = ref(''), remoteOpen = ref(false), remoteUrl = ref('')
  const stagedFiles = computed(() => gitStatus.value.filter(file => file.staged))
  const unstagedFiles = computed(() => gitStatus.value.filter(file => file.unstaged))
  const conflicts = computed(() => gitStatus.value.filter(file => file.conflict))
  const parsedDiff = computed(() => diffContent.value.split('\n').map(text => ({
    text, type: text.startsWith('+++') || text.startsWith('---') ? 'header' :
      text.startsWith('@@') ? 'hunk' : text.startsWith('+') ? 'add' :
      text.startsWith('-') ? 'delete' : text.startsWith('diff --git') ? 'file' : 'normal'
  })))
  const api = () => window.retroStudio.git
  const drafts = new Map()
  let sequence = 0, timer
  const report = failure => {
    error.value = String(failure?.message || failure).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
    lastError.value = error.value
  }
  function closeDiffModal() {
    showDiffModal.value = false; diffContent.value = ''; diffFilePath.value = ''; diffStaged.value = false
  }
  watch(workspacePath, (next, previous) => {
    drafts.set(previous, gitCommitMessage.value)
    gitCommitMessage.value = drafts.get(next) || ''
    sequence++
    isGitRepo.value = false; gitStatus.value = []; gitBranch.value = ''
    gitBranches.value = []; gitCommits.value = []; error.value = ''; notice.value = ''
    identityOpen.value = false; userName.value = ''; userEmail.value = ''
    confirmation.value = null; filter.value = ''; remoteOpen.value = false; remoteUrl.value = ''; closeDiffModal()
  }, { flush: 'sync' })
  async function checkService() {
    let version = 0
    try { version = await api().serviceVersion?.() || 0 } catch { /* old Electron main/preload */ }
    needsRestart.value = version !== 2
    if (needsRestart.value) {
      gitStatus.value = []
      isGitRepo.value = false
      error.value = 'O painel Git foi atualizado, mas o processo principal ainda usa a versão antiga. Salve os arquivos, feche todas as janelas do Retro Studio e abra a IDE novamente.'
      return false
    }
    return true
  }
  async function loadGitStatus() {
    const workspace = workspacePath.value, request = ++sequence
    if (!workspace) { isGitRepo.value = false; gitStatus.value = []; isLoadingGit.value = false; return }
    isLoadingGit.value = true
    try {
      if (!await checkService()) return
      if (request !== sequence || workspace !== workspacePath.value) return
      const repository = await api().isRepository()
      if (request !== sequence || workspace !== workspacePath.value) return
      isGitRepo.value = repository
      if (!repository) { gitStatus.value = []; gitBranch.value = ''; return }
      const [files, branch] = await Promise.all([api().status(), api().currentBranch()])
      if (request !== sequence || workspace !== workspacePath.value) return
      gitStatus.value = files; gitBranch.value = branch
    } catch (failure) { if (request === sequence && workspace === workspacePath.value) report(failure) }
    finally { if (request === sequence) isLoadingGit.value = false }
  }
  async function perform(operation, successMessage = '', refresh = true) {
    if (busy.value || !workspacePath.value) return false
    const workspace = workspacePath.value
    busy.value = true; error.value = ''; notice.value = ''
    try {
      if (!await checkService() || workspace !== workspacePath.value) return false
      const result = await operation()
      if (workspace !== workspacePath.value) return false
      if (result === false) return false
      notice.value = successMessage
      if (refresh) await loadGitStatus()
      return true
    } catch (failure) { if (workspace === workspacePath.value) report(failure); return false }
    finally { busy.value = false }
  }
  const gitStageFile = file => perform(() => api().stage(file))
  const gitUnstageFile = file => perform(() => api().unstage(file))
  const gitStageAll = () => perform(() => api().stage('.'))
  const gitUnstageAll = () => perform(() => api().unstage('.'))
  async function gitDiscardFile(file) {
    if (await perform(() => api().discard(file))) await refreshTree()
  }
  async function openIdentity() {
    identityOpen.value = true
    const workspace = workspacePath.value
    try {
      const values = await Promise.all([api().getConfig('user.name'), api().getConfig('user.email')])
      if (workspace === workspacePath.value) [userName.value, userEmail.value] = values
    } catch (failure) { if (workspace === workspacePath.value) report(failure) }
  }
  async function openRemote() {
    const workspace = workspacePath.value
    remoteOpen.value = true
    try { const url = await api().getRemote(); if (workspace === workspacePath.value) remoteUrl.value = url }
    catch (failure) { if (workspace === workspacePath.value) report(failure) }
  }
  async function saveRemote() {
    if (await perform(() => api().setRemote(remoteUrl.value), '', false)) remoteOpen.value = false
  }
  async function saveIdentity() {
    const name = userName.value.trim(), email = userEmail.value.trim()
    if (!name || !email) return
    const workspace = workspacePath.value
    const saved = await perform(async () => {
      await api().config('user.name', name)
      if (workspace !== workspacePath.value) throw new Error('O projeto mudou. Confira a identidade do repositório.')
      await api().config('user.email', email)
    }, '', false)
    if (saved) identityOpen.value = false
  }
  async function gitCommit() {
    if (!gitCommitMessage.value.trim() || !stagedFiles.value.length || conflicts.value.length) return
    const message = gitCommitMessage.value
    if (await perform(() => api().commit(message), 'Commit realizado.')) {
      if (gitCommitMessage.value === message) gitCommitMessage.value = ''
      if (showCommitsPanel.value) await loadGitCommits(true)
    } else if (/user\.name|user\.email/.test(error.value)) await openIdentity()
  }
  const gitInitRepo = () => perform(() => api().init())
  async function gitPull() { if (await perform(() => api().pull(), 'Pull concluído.')) await refreshTree() }
  const gitPush = () => perform(() => api().push(), 'Push concluído.')
  const gitFetch = () => perform(() => api().fetch(), 'Fetch concluído.')
  async function loadGitBranches() {
    const workspace = workspacePath.value
    try { const result = await api().branches(); if (workspace === workspacePath.value) gitBranches.value = result }
    catch (failure) { if (workspace === workspacePath.value) report(failure) }
  }
  function ask(message, action) {
    const workspace = workspacePath.value
    confirmation.value = { message, action: async () => {
      confirmation.value = null
      if (workspace === workspacePath.value) await action()
    } }
  }
  function gitCheckout(name) {
    ask('Trocar para a branch "' + name + '"?', async () => {
      if (await perform(() => api().checkout(name))) { await loadGitBranches(); await refreshTree() }
    })
  }
  async function gitCreateBranch() {
    const name = newBranchName.value.trim()
    if (!name) return
    if (await perform(() => api().createBranch(name))) {
      newBranchName.value = ''; showBranchDialog.value = false; await loadGitBranches()
    }
  }
  function gitDeleteBranch(name) {
    ask('Excluir a branch local "' + name + '"? O Git recusará excluir commits não integrados.', async () => {
      if (await perform(() => api().deleteBranch(name))) await loadGitBranches()
    })
  }
  async function loadGitCommits(reset = false) {
    if (isLoadingCommits.value) return
    const workspace = workspacePath.value
    isLoadingCommits.value = true
    try {
      const result = await api().log({ limit: 20, skip: reset ? 0 : gitCommits.value.length })
      if (workspace === workspacePath.value) gitCommits.value = reset ? result : [...gitCommits.value, ...result]
    } catch (failure) { if (workspace === workspacePath.value) report(failure) }
    finally { isLoadingCommits.value = false }
  }
  let diffSequence = 0
  async function showFileDiff(file, staged = false) {
    const request = ++diffSequence, workspace = workspacePath.value
    try {
      const content = await api().diff(file, staged)
      if (request !== diffSequence || workspace !== workspacePath.value) return
      diffFilePath.value = file; diffStaged.value = staged
      diffContent.value = content || 'Sem diferenças nesta versão do arquivo.'
      showDiffModal.value = true
    } catch (failure) { if (request === diffSequence && workspace === workspacePath.value) report(failure) }
  }
  function formatCommitDate(value) { return new Date(value).toLocaleString() }
  function getGitStatusIcon(status) {
    return ({ modified: 'M', added: 'A', deleted: 'D', renamed: 'R', untracked: '?', conflict: '!' })[status] || '·'
  }
  const focusRefresh = () => { if (panelActive.value && !busy.value && !isLoadingGit.value && !needsRestart.value) loadGitStatus() }
  onMounted(() => {
    window.addEventListener('focus', focusRefresh)
    timer = window.setInterval(focusRefresh, 5000)
  })
  onBeforeUnmount(() => { window.removeEventListener('focus', focusRefresh); window.clearInterval(timer) })
  provide('retroGitUi', { needsRestart, error, notice, busy, identityOpen, userName, userEmail, openIdentity, saveIdentity,
    confirmation, conflicts, panelActive, filter, gitFetch, workspacePath, remoteOpen, remoteUrl, openRemote, saveRemote })
  return {
    isGitRepo, gitStatus, gitBranch, gitCommitMessage, isLoadingGit, gitBranches, showBranchDialog,
    newBranchName, showBranchesPanel, gitCommits, showCommitsPanel, isLoadingCommits,
    showDiffModal, diffContent, diffFilePath, diffStaged, parsedDiff, stagedFiles, unstagedFiles,
    loadGitStatus, gitStageFile, gitUnstageFile, gitStageAll, gitUnstageAll, gitDiscardFile, gitCommit,
    gitInitRepo, gitPull, gitPush, loadGitBranches, gitCheckout, gitCreateBranch, gitDeleteBranch,
    loadGitCommits, showFileDiff, closeDiffModal, formatCommitDate, getGitStatusIcon,
    toggleBranchesPanel: () => { showBranchesPanel.value = !showBranchesPanel.value; if (showBranchesPanel.value) loadGitBranches() },
    openBranchDialog: () => { newBranchName.value = ''; showBranchDialog.value = true },
    closeBranchDialog: () => { showBranchDialog.value = false; newBranchName.value = '' },
    toggleCommitsPanel: () => { showCommitsPanel.value = !showCommitsPanel.value; if (showCommitsPanel.value) loadGitCommits(true) }
  }
}
