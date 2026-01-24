<template>
  <div class="project-settings">
    <div class="settings-container">
      <!-- Left: File Browser -->
      <div class="file-browser">
        <div class="browser-toolbar">
          <button class="toolbar-btn" @click="backDirectory" title="Go Up">
            <i class="fas fa-arrow-up"></i>
          </button>
          <button class="toolbar-btn" @click="setHomeFolder" title="Home">
            <i class="fas fa-home"></i>
          </button>
        </div>
        
        <div class="current-path">
          <div class="path-info">
            <i class="fas fa-folder-open"></i>
            <span>{{ foldeName || 'Select folder...' }}</span>
          </div>
          <button 
            class="btn-open-project" 
            @click="openFolderProject"
            :disabled="!foldeHoot"
            title="Open as Project"
          >
            <i class="fas fa-check"></i>
          </button>
        </div>
        
        <div class="folder-list">
          <div 
            v-for="data in foldes" 
            :key="data.path"
            class="folder-item"
            @click="openFolder(data.label, data.path)"
          >
            <i class="fas fa-folder"></i>
            <span>{{ data.label }}</span>
          </div>
          <div v-if="foldes.length === 0" class="empty-folder">
            <p>No folders</p>
          </div>
        </div>
      </div>

      <!-- Right: Project Info -->
      <div class="project-info">
        <h3>Project Manager</h3>
        <div class="info-section">
          <button class="btn-new-project" @click="showNewProjectDialog = true">
            <i class="fas fa-plus-circle"></i>
            New Project
          </button>
          <p class="divider-text">or</p>
          <p>Select a folder to open as a project.</p>
          <p class="hint">O projeto deve seguir um dos templates (md-skeleton, 32x-skeleton, sgdk-skeleton ou sgdk-stage9-sample).</p>
        </div>
        
        <div class="working-projects">
          <h4>Working Projects</h4>
          <div v-if="workingProjects.length" class="working-list">
            <div
              v-for="proj in workingProjects"
              :key="proj.path"
              class="working-item"
              @click="openWorkingProject(proj)"
            >
              <div class="working-main">
                <i class="fas fa-thumbtack"></i>
                <div class="working-texts">
                  <div class="working-name">{{ proj.name }}</div>
                  <div class="working-path">{{ proj.path }}</div>
                </div>
              </div>
              <div class="working-actions">
                <button class="working-open" title="Open">
                  <i class="fas fa-arrow-right"></i>
                </button>
                <button class="working-remove" title="Remove" @click.stop="unpinWorkingProject(proj.path)">
                  <i class="fas fa-times"></i>
                </button>
              </div>
            </div>
          </div>
          <div v-else class="empty-working">Nenhum projeto marcado. Abra ou crie para fixar aqui.</div>
        </div>

        <div class="recent-projects">
          <h4>Recent Projects</h4>
          <div v-if="recentProjects.length" class="recent-list">
            <div 
              v-for="proj in recentProjects" 
              :key="proj.path" 
              class="recent-item"
              @click="openRecentProject(proj)"
            >
              <div class="recent-main">
                <i class="fas fa-history"></i>
                <div class="recent-texts">
                  <div class="recent-name">{{ proj.name }}</div>
                  <div class="recent-path">{{ proj.path }}</div>
                </div>
              </div>
              <button class="recent-open" title="Open">
                <i class="fas fa-arrow-right"></i>
              </button>
            </div>
          </div>
          <div v-else class="empty-recent">Nenhum projeto recente.</div>
        </div>

        <div v-if="currentProject.path" class="current-project">
          <h4>Current Project:</h4>
          <div class="project-details">
            <p><strong>Name:</strong> {{ currentProject.name }}</p>
            <p><strong>Path:</strong> {{ currentProject.path }}</p>
          </div>
        </div>
      </div>

      <!-- New Project Dialog -->
      <div v-if="showNewProjectDialog" class="dialog-overlay" @click.self="cancelNewProject">
        <div class="dialog-content">
          <div class="dialog-header">
            <h3>Create New Project</h3>
            <button class="dialog-close" @click="cancelNewProject">
              <i class="fas fa-times"></i>
            </button>
          </div>
          <div class="dialog-body">
            <div class="form-field">
              <label>Project Name:</label>
              <input 
                v-model="newProjectName" 
                type="text" 
                placeholder="MyGame"
                @keyup.enter="createNewProject"
                @keyup.esc="cancelNewProject"
                autofocus
                class="dialog-input"
              />
            </div>
            <div class="form-field">
              <label>Location:</label>
              <div class="path-input-group">
                <input 
                  v-model="newProjectPath" 
                  type="text" 
                  placeholder="Select folder..."
                  class="dialog-input"
                  readonly
                />
                <button class="btn-browse" @click="browseProjectLocation">
                  <i class="fas fa-folder-open"></i>
                </button>
              </div>
            </div>
            <div class="form-field">
              <label>Template:</label>
              <select v-model="newProjectTemplate" class="dialog-input">
                <option value="md-skeleton">Mega Drive Skeleton (Marsdev)</option>
                <option value="32x-skeleton">32X Skeleton (Marsdev)</option>
                <option value="sgdk-skeleton">SGDK Skeleton</option>
                <option value="sgdk-stage9-sample">SGDK Stage9 Sample</option>
              </select>
            </div>
          </div>
          <div class="dialog-footer">
            <button class="btn-cancel" @click="cancelNewProject">Cancel</button>
            <button 
              class="btn-confirm" 
              @click="createNewProject" 
              :disabled="!newProjectName.trim() || !newProjectPath"
            >
              Create Project
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>  
</template>

<script setup>
import { ref, onMounted, computed } from 'vue'
import { useStore } from 'vuex'
import { getRecentProjects, getWorkingProjects, removeWorkingProject } from '../data/localstorage'

const store = useStore()

  const foldeHoot = ref()
  const foldeName = ref()
  const foldes = ref([])
const showNewProjectDialog = ref(false)
const newProjectName = ref('')
const newProjectPath = ref('')
const newProjectTemplate = ref('md-skeleton')
const recentProjects = ref([])
const workingProjects = ref([])

const currentProject = computed(() => {
  return store.state.projectConfig
})

  const getPathLocal = () => {
  window.ipc?.send('current-path', { path: 'get' })
  }

const setHomeFolder = () => {
  window.ipc?.send('get-home', { home: true })
  }

  const openFolder = (label, path) => {
  window.ipc?.send('directory-navigate', { label, path })
  }

const backDirectory = () => {
  if (foldeHoot.value) {
    window.ipc?.send('back-directory-navigate', { 
      folde: foldeName.value, 
      path: foldeHoot.value 
    })
  }
  }

const openFolderProject = () => {
  if (foldeHoot.value && foldeName.value) {
    store.dispatch('loadProject', { 
      name: foldeName.value, 
      path: foldeHoot.value 
    })
    
    // Atualizar listas locais de projetos recentes/marcados
    setTimeout(() => {
      recentProjects.value = getRecentProjects()
      workingProjects.value = getWorkingProjects()
      store.dispatch('clearModalAction', 'openProject')
    }, 100)
  }
}

const browseProjectLocation = () => {
  window.ipc?.send('select-folder', {})
  window.ipc?.on('folder-selected', (result) => {
    if (result && result.path) {
      newProjectPath.value = result.path
    }
  })
}

const createNewProject = () => {
  if (!newProjectName.value.trim() || !newProjectPath.value) {
    store.dispatch('showNotification', {
      type: 'error',
      title: 'Invalid Input',
      message: 'Please provide a project name and location'
    })
    return
  }

  // Use sendSync for synchronous call
  const projectPath = window.ipc?.sendSync('create-project', {
    name: newProjectName.value.trim(),
    path: newProjectPath.value,
    template: newProjectTemplate.value
  })

  if (projectPath && projectPath.success) {
    // Carregar o novo projeto via Vuex
    store.dispatch('loadProject', {
      name: newProjectName.value.trim(),
      path: projectPath.path
    })

    // Atualizar listas e fechar diálogos
    setTimeout(() => {
      recentProjects.value = getRecentProjects()
      workingProjects.value = getWorkingProjects()
      cancelNewProject()
      store.dispatch('clearModalAction', 'openProject')
    }, 100)
  } else {
    store.dispatch('showNotification', {
      type: 'error',
      title: 'Creation Failed',
      message: projectPath?.error || 'Failed to create project'
    })
  }
}

const cancelNewProject = () => {
  showNewProjectDialog.value = false
  newProjectName.value = ''
  newProjectPath.value = ''
  newProjectTemplate.value = 'md-skeleton'
  }

const openRecentProject = (project) => {
  if (!project?.path) return
  store.dispatch('loadProject', {
    name: project.name,
    path: project.path
  })
  
  setTimeout(() => {
    recentProjects.value = getRecentProjects()
    workingProjects.value = getWorkingProjects()
    store.dispatch('clearModalAction', 'openProject')
  }, 100)
}

const openWorkingProject = (project) => {
  if (!project?.path) return
  store.dispatch('loadProject', {
    name: project.name,
    path: project.path
  })
  
  setTimeout(() => {
    recentProjects.value = getRecentProjects()
    workingProjects.value = getWorkingProjects()
    store.dispatch('clearModalAction', 'openProject')
  }, 100)
}

const unpinWorkingProject = (path) => {
  removeWorkingProject(path)
  workingProjects.value = getWorkingProjects()
}

onMounted(() => {
  getPathLocal()
  recentProjects.value = getRecentProjects()
  workingProjects.value = getWorkingProjects()
  window.ipc?.on('send-directory', res => {
    if (res) {
      foldeHoot.value = res.path
      foldeName.value = res.label
      foldes.value = res.children || []
    }
  })
})
</script>

<style scoped>
.project-settings {
  width: 100%;
  height: 100%;
  padding: 20px;
  color: #e6e8f0;
  background: linear-gradient(135deg, #0f1116 0%, #111723 60%, #0f141e 100%);
}

.settings-container {
  display: grid;
  grid-template-columns: 1.2fr 0.9fr;
  height: 100%;
  gap: 16px;
}

.file-browser {
  display: flex;
  flex-direction: column;
  background: rgba(24, 28, 36, 0.9);
  border: 1px solid #1f2937;
  border-radius: 12px;
  overflow: hidden;
  box-shadow: 0 12px 32px rgba(0,0,0,0.35);
  backdrop-filter: blur(6px);
}

.browser-toolbar {
  display: flex;
  gap: 10px;
  padding: 14px 16px;
  background: rgba(33, 40, 54, 0.9);
  border-bottom: 1px solid #1f2937;
}

.toolbar-btn {
  background: #111827;
  border: 1px solid #1f2937;
  color: #dce3f2;
  padding: 10px 14px;
  border-radius: 10px;
  cursor: pointer;
  transition: all 0.18s ease;
  box-shadow: inset 0 0 0 1px rgba(255,255,255,0.02);
}

.toolbar-btn:hover {
  background: #1b2334;
  border-color: #304159;
  color: #fff;
}

.current-path {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 16px;
  background: rgba(20, 24, 32, 0.9);
  border-bottom: 1px solid #1f2937;
}

.path-info {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1;
  color: #d8deec;
  font-size: 13px;
  letter-spacing: 0.2px;
}

.path-info i {
  color: #8bd5ff;
}

.btn-open-project {
  background: linear-gradient(120deg, #14b8a6, #0ea5e9);
  border: none;
  color: white;
  padding: 10px 16px;
  border-radius: 10px;
  cursor: pointer;
  transition: transform 0.18s ease, box-shadow 0.18s ease, filter 0.18s ease;
  display: flex;
  align-items: center;
  gap: 6px;
  box-shadow: 0 10px 24px rgba(14,165,233,0.25);
}

.btn-open-project:hover:not(:disabled) {
  filter: brightness(1.05);
  transform: translateY(-1px);
}

.btn-open-project:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.folder-list {
  flex: 1;
  overflow-y: auto;
  padding: 12px 14px;
  background: radial-gradient(circle at 20% 20%, rgba(56,78,108,0.15), transparent 32%);
}

.folder-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  border-radius: 10px;
  cursor: pointer;
  transition: all 0.18s ease;
  margin-bottom: 6px;
}

.folder-item:hover {
  background: rgba(35, 47, 68, 0.75);
  box-shadow: inset 0 0 0 1px #304159;
}

.folder-item i {
  color: #f6c344;
}

.empty-folder {
  padding: 48px 16px;
  text-align: center;
  color: #6b7280;
  font-size: 13px;
  border: 1px dashed #2f3c4f;
  border-radius: 12px;
}

.project-info {
  width: 320px;
  background: rgba(20, 24, 32, 0.95);
  border: 1px solid #1f2937;
  border-radius: 12px;
  padding: 18px;
  box-shadow: 0 12px 32px rgba(0,0,0,0.35);
}

.project-info h3 {
  margin: 0 0 16px 0;
  color: #e8ecf5;
  font-size: 18px;
  letter-spacing: 0.3px;
}

.info-section {
  margin-bottom: 24px;
  padding-bottom: 16px;
  border-bottom: 1px solid #1f2937;
}

.info-section p {
  margin: 8px 0;
  font-size: 13px;
  line-height: 1.5;
}

.hint {
  color: #7a8191;
  font-size: 12px;
  font-style: italic;
}

.current-project {
  margin-top: 24px;
  padding-top: 24px;
  border-top: 1px solid #1f2937;
}

.current-project h4 {
  margin: 0 0 12px 0;
  color: #66c7ff;
  font-size: 14px;
}

.project-details {
  background: rgba(28, 34, 46, 0.9);
  padding: 12px;
  border-radius: 10px;
  border: 1px solid #1f2937;
}

.project-details p {
  margin: 8px 0;
  font-size: 12px;
  word-break: break-all;
}

.project-details strong {
  color: #0066cc;
}

.btn-new-project {
  width: 100%;
  background: linear-gradient(120deg, #6366f1, #8b5cf6);
  border: none;
  color: white;
  padding: 12px 16px;
  border-radius: 12px;
  cursor: pointer;
  font-size: 14px;
  font-weight: 500;
  transition: transform 0.18s ease, box-shadow 0.18s ease, filter 0.18s ease;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  margin-bottom: 16px;
  box-shadow: 0 12px 26px rgba(99,102,241,0.35);
}

.btn-new-project:hover {
  filter: brightness(1.06);
  transform: translateY(-1px);
}

.divider-text {
  text-align: center;
  color: #666;
  margin: 12px 0;
  font-size: 12px;
  font-style: italic;
}

/* Dialog Styles */
.dialog-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.7);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 10001;
  backdrop-filter: blur(2px);
}

.dialog-content {
  background: #1b2230;
  border: 1px solid #253349;
  border-radius: 12px;
  min-width: 520px;
  max-width: 620px;
  box-shadow: 0 16px 42px rgba(0, 0, 0, 0.55);
}

.dialog-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px 20px;
  background: #161b26;
  border-bottom: 1px solid #253349;
  border-radius: 12px 12px 0 0;
}

.dialog-header h3 {
  margin: 0;
  font-size: 16px;
  color: #e6e8f0;
  font-weight: 500;
}

.dialog-close {
  background: transparent;
  border: none;
  color: #888;
  cursor: pointer;
  padding: 4px 8px;
  border-radius: 4px;
  transition: all 0.2s;
}

.dialog-close:hover {
  background: #333;
  color: #fff;
}

.dialog-body {
  padding: 20px;
}

.form-field {
  margin-bottom: 16px;
}

.form-field:last-of-type {
  margin-bottom: 0;
}

.form-field label {
  display: block;
  margin-bottom: 6px;
  color: #ccc;
  font-size: 13px;
  font-weight: 500;
}

.dialog-input {
  width: 100%;
  background: #111827;
  border: 1px solid #253349;
  color: #dce3f2;
  padding: 10px 12px;
  border-radius: 10px;
  font-size: 14px;
  box-sizing: border-box;
}

.dialog-input:focus {
  outline: none;
  border-color: #3b82f6;
  background: #121a27;
  box-shadow: 0 0 0 2px rgba(59,130,246,0.25);
}

.path-input-group {
  display: flex;
  gap: 8px;
}

.path-input-group .dialog-input {
  flex: 1;
}

.btn-browse {
  background: #111827;
  border: 1px solid #253349;
  color: #dce3f2;
  padding: 10px 16px;
  border-radius: 10px;
  cursor: pointer;
  transition: all 0.2s;
}

.btn-browse:hover {
  background: #1b2334;
  border-color: #304159;
  color: #fff;
}

.dialog-footer {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
  padding: 16px 20px;
  border-top: 1px solid #333;
}

.btn-cancel {
  background: #111827;
  border: 1px solid #253349;
  color: #dce3f2;
  padding: 8px 16px;
  border-radius: 10px;
  cursor: pointer;
  font-size: 13px;
  transition: all 0.2s;
}

.btn-cancel:hover {
  background: #1b2334;
  border-color: #304159;
}

.btn-confirm {
  background: linear-gradient(120deg, #10b981, #22d3ee);
  border: none;
  color: white;
  padding: 10px 18px;
  border-radius: 12px;
  cursor: pointer;
  font-size: 13px;
  transition: transform 0.18s ease, filter 0.18s ease, box-shadow 0.18s ease;
  box-shadow: 0 12px 28px rgba(16,185,129,0.35);
}

.btn-confirm:hover:not(:disabled) {
  filter: brightness(1.05);
  transform: translateY(-1px);
}

.btn-confirm:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* Recent Projects */
.recent-projects {
  background: rgba(27, 34, 46, 0.9);
  border: 1px solid #1f2937;
  border-radius: 12px;
  padding: 12px;
  margin-top: 12px;
}

.recent-projects h4 {
  margin: 0 0 10px 0;
  color: #e8ecf5;
  font-size: 13px;
  letter-spacing: 0.2px;
}

/* Working Projects */
.working-projects {
  background: rgba(27, 34, 46, 0.9);
  border: 1px solid #1f2937;
  border-radius: 12px;
  padding: 12px;
  margin-top: 12px;
}

.working-projects h4 {
  margin: 0 0 10px 0;
  color: #e8ecf5;
  font-size: 13px;
  letter-spacing: 0.2px;
}

.working-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.working-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 12px;
  border-radius: 10px;
  border: 1px solid #253349;
  background: #111827;
  cursor: pointer;
  transition: all 0.18s ease;
  gap: 10px;
}

.working-item:hover {
  border-color: #10b981;
  box-shadow: 0 10px 20px rgba(0,0,0,0.3);
}

.working-main {
  display: flex;
  align-items: center;
  gap: 10px;
}

.working-main i {
  color: #f59e0b;
}

.working-texts {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.working-name {
  color: #e6e8f0;
  font-size: 13px;
  font-weight: 600;
}

.working-path {
  color: #9ca3af;
  font-size: 11px;
  word-break: break-all;
}

.working-actions {
  display: flex;
  gap: 8px;
}

.working-open,
.working-remove {
  background: transparent;
  border: 1px solid #253349;
  color: #cdd6e5;
  padding: 8px 10px;
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.18s ease;
}

.working-item:hover .working-open {
  border-color: #10b981;
  color: #fff;
  background: #0f172a;
}

.working-item:hover .working-remove {
  border-color: #ef4444;
  color: #fff;
  background: #1b2334;
}

.empty-working {
  padding: 12px;
  border-radius: 10px;
  border: 1px dashed #2f3c4f;
  color: #7a8191;
  font-size: 12px;
}

.recent-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.recent-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 12px;
  border-radius: 10px;
  border: 1px solid #253349;
  background: #111827;
  cursor: pointer;
  transition: all 0.18s ease;
  gap: 10px;
}

.recent-item:hover {
  border-color: #3b82f6;
  box-shadow: 0 10px 20px rgba(0,0,0,0.3);
}

.recent-main {
  display: flex;
  align-items: center;
  gap: 10px;
}

.recent-main i {
  color: #9ca3af;
}

.recent-texts {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.recent-name {
  color: #e6e8f0;
  font-size: 13px;
  font-weight: 600;
}

.recent-path {
  color: #9ca3af;
  font-size: 11px;
  word-break: break-all;
}

.recent-open {
  background: transparent;
  border: 1px solid #253349;
  color: #cdd6e5;
  padding: 8px 10px;
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.18s ease;
}

.recent-item:hover .recent-open {
  border-color: #3b82f6;
  color: #fff;
  background: #1b2334;
}

.empty-recent {
  padding: 12px;
  border-radius: 10px;
  border: 1px dashed #2f3c4f;
  color: #7a8191;
  font-size: 12px;
}
</style>