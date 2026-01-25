import { createStore } from 'vuex';
import { setDataProject } from '../data/localstorage';

const persistUiSettings = (settings) => {
  window.ipc?.send('save-ui-settings', JSON.parse(JSON.stringify(settings)));
};

const initialUiSettings = {
  windowControlsPosition: 'right',
  toolkitPath: '',
  editorWordWrap: 'off',
  formatterIndentStyle: 'space', // 'space' ou 'tab'
  formatterIndentSize: 2, // Número de espaços
  imageEditorPath: '',
  mapEditorPath: '',
};

const store = createStore({
  state: {
    fileRequest: null,
    imageRequest: null,
    tabRequest: null,
    // Scene system
    sceneNodes: [],
    selectedNode: null,
    // Resources
    resources: {
      sprites: [],
      tiles: [],
      tilemaps: [],
      palettes: [],
      sounds: [],
      backgrounds: []
    },
    selectedResource: null,
    // Current scene
    currentScene: null,
    // Resource editor state
    resourceEditorOpen: false,
    // Modal actions
    modalActions: {
      openProject: false,
      newProject: false,
      openSettings: false
    },
    // Current file in code editor
    currentFile: null,
    // Status bar
    statusMessage: null,
    statusType: 'info',
    // Notifications
    notifications: [],
    // Undo/Redo system
    history: {
      past: [],
      present: null,
      future: []
    },
    maxHistorySize: 50,
    uiSettings: initialUiSettings,
    viewMode: 'code', // 'code' ou 'visual'
    projectConfig: {
      name: '',
      path: '',
      template: 'md-skeleton',
      resourcePath: 'res',
      assets: []
    },
    availableEmulators: [],
    selectedEmulator: 'gen_sdl2'
  },
  mutations: {
    setAvailableEmulators(state, emulators) {
      state.availableEmulators = emulators;
    },
    setSelectedEmulator(state, emulator) {
      state.selectedEmulator = emulator;
    },
    setProjectConfig(state, config) {
      if (!config || !config.path) return;

      // Se o caminho do projeto mudou, podemos querer limpar alguns estados temporários
      const pathChanged = state.projectConfig.path !== config.path;
      
      // Mesclar config sem perder metadados importantes que podem não estar no arquivo
      const oldAssets = state.projectConfig.assets || [];
      const newAssets = config.assets || [];

      // Preservar previews se o novo asset não tiver mas o antigo tiver
      const mergedAssets = newAssets.map(newAsset => {
        const oldAsset = oldAssets.find(a => a.id === newAsset.id || a.path === newAsset.path);
        if (oldAsset && oldAsset.preview && !newAsset.preview) {
          return { ...newAsset, preview: oldAsset.preview, metadata: { ...oldAsset.metadata, ...newAsset.metadata } };
        }
        return newAsset;
      });

      state.projectConfig = { 
        ...state.projectConfig, 
        ...config,
        assets: mergedAssets
      };

      // Manter resources em sincronia
      if (state.projectConfig.assets) {
        const assets = state.projectConfig.assets;
        state.resources = {
          ...state.resources,
          sprites: assets.filter(a => a.type === 'sprite'),
          tiles: assets.filter(a => a.type === 'tile'),
          tilemaps: assets.filter(a => a.type === 'tilemap'),
          palettes: assets.filter(a => a.type === 'palette'),
          sounds: assets.filter(a => a.type === 'sound'),
          backgrounds: assets.filter(a => a.type === 'background')
        };
      }

      if (pathChanged) {
        console.log('[Store] Project path changed to:', config.path);
        // Opcional: Notificar componentes que precisam recarregar dados específicos do projeto
      }
    },
    setViewMode(state, mode) {
      state.viewMode = mode;
    },
    setFileRequest(state, data) {
      state.fileRequest = data;
    },
    setImageRequest(state, data) {
      state.imageRequest = data
    },
    setTabRequest(state, data) {
      state.tabRequest = data
    },
    // Scene mutations
    setSceneNodes(state, nodes) {
      state.sceneNodes = nodes;
    },
    addSceneNode(state, node) {
      state.sceneNodes.push(node);
    },
    removeSceneNode(state, nodeId) {
      state.sceneNodes = state.sceneNodes.filter(n => n.id !== nodeId);
      if (state.selectedNode?.id === nodeId) {
        state.selectedNode = null;
      }
    },
    updateSceneNode(state, node) {
      const index = state.sceneNodes.findIndex(n => n.id === node.id);
      if (index !== -1) {
        state.sceneNodes[index] = { ...state.sceneNodes[index], ...node };
        if (state.selectedNode?.id === node.id) {
          state.selectedNode = state.sceneNodes[index];
        }
      }
    },
    setSelectedNode(state, node) {
      state.selectedNode = node;
    },
    // Resource mutations
    setResources(state, resources) {
      state.resources = resources;
    },
    addResource(state, resource) {
      const resourceType = resource.type + 's';
      if (state.resources[resourceType]) {
        state.resources[resourceType].push(resource);
      }
    },
    removeResource(state, { type, id }) {
      const resourceType = type + 's';
      if (state.resources[resourceType]) {
        state.resources[resourceType] = state.resources[resourceType].filter(r => r.id !== id);
      }
    },
    updateResource(state, resource) {
      const resourceType = resource.type + 's';
      if (state.resources[resourceType]) {
        const index = state.resources[resourceType].findIndex(r => r.id === resource.id);
        if (index !== -1) {
          state.resources[resourceType][index] = { ...state.resources[resourceType][index], ...resource };
        }
      }
    },
    setSelectedResource(state, resource) {
      state.selectedResource = resource;
    },
    // Scene
    setCurrentScene(state, scene) {
      state.currentScene = scene;
    },
    // Resource editor
    setResourceEditorOpen(state, open) {
      state.resourceEditorOpen = open;
    },
    // Modal actions
    setModalAction(state, { action, value }) {
      state.modalActions[action] = value;
    },
    clearModalAction(state, action) {
      state.modalActions[action] = false;
    },
    // Current file
    setCurrentFile(state, filePath) {
      state.currentFile = filePath;
    },
    // Status bar
    setStatusMessage(state, { message, type = 'info' }) {
      state.statusMessage = message;
      state.statusType = type;
    },
    clearStatusMessage(state) {
      state.statusMessage = null;
      state.statusType = 'info';
    },
    // Notifications
    addNotification(state, notification) {
      state.notifications.push({
        id: Date.now() + Math.random(),
        ...notification
      });
    },
    removeNotification(state, id) {
      state.notifications = state.notifications.filter(n => n.id !== id);
    },
    // Undo/Redo
    saveHistory(state) {
      const currentState = JSON.parse(JSON.stringify(state.sceneNodes));
      
      if (state.history.present) {
        state.history.past.push(state.history.present);
        
        // Limit history size
        if (state.history.past.length > state.maxHistorySize) {
          state.history.past.shift();
        }
      }
      
      state.history.present = currentState;
      state.history.future = []; // Clear future when new action is made
    },
    undo(state) {
      if (state.history.past.length === 0) return;
      
      if (state.history.present) {
        state.history.future.unshift(state.history.present);
      }
      
      state.history.present = state.history.past.pop();
      state.sceneNodes = JSON.parse(JSON.stringify(state.history.present));
    },
    redo(state) {
      if (state.history.future.length === 0) return;
      
      if (state.history.present) {
        state.history.past.push(state.history.present);
      }
      
      state.history.present = state.history.future.shift();
      state.sceneNodes = JSON.parse(JSON.stringify(state.history.present));
    },
    clearHistory(state) {
      state.history = {
        past: [],
        present: null,
        future: []
      };
    },
    setWindowControlsPosition(state, position) {
      state.uiSettings.windowControlsPosition = position;
      persistUiSettings(state.uiSettings);
    },
    setToolkitPath(state, pathValue) {
      state.uiSettings.toolkitPath = pathValue;
      persistUiSettings(state.uiSettings);
    },
    setEditorWordWrap(state, mode) {
      state.uiSettings.editorWordWrap = mode;
      persistUiSettings(state.uiSettings);
    },
    setFormatterIndentStyle(state, style) {
      state.uiSettings.formatterIndentStyle = style; // 'space' ou 'tab'
      persistUiSettings(state.uiSettings);
    },
    setFormatterIndentSize(state, size) {
      state.uiSettings.formatterIndentSize = size;
      persistUiSettings(state.uiSettings);
    },
    setImageEditorPath(state, pathValue) {
      state.uiSettings.imageEditorPath = pathValue;
      persistUiSettings(state.uiSettings);
    },
    setMapEditorPath(state, pathValue) {
      state.uiSettings.mapEditorPath = pathValue;
      persistUiSettings(state.uiSettings);
    },
    updateAssetPreview(state, { id, preview, metadata }) {
      if (!state.projectConfig.assets) return;
      const index = state.projectConfig.assets.findIndex(a => a.id === id);
      if (index !== -1) {
        state.projectConfig.assets[index].preview = preview;
        if (metadata) {
          state.projectConfig.assets[index].metadata = { 
            ...state.projectConfig.assets[index].metadata, 
            ...metadata 
          };
        }
        
        // Sincronizar resources reativamente
        const asset = state.projectConfig.assets[index];
        const resourceType = asset.type + 's';
        if (state.resources[resourceType]) {
          const rIndex = state.resources[resourceType].findIndex(r => r.id === id);
          if (rIndex !== -1) {
            state.resources[resourceType][rIndex] = { ...state.resources[resourceType][rIndex], preview, metadata: state.projectConfig.assets[index].metadata };
          }
        }
      }
    },
    updateProjectAsset(state, asset) {
      if (!state.projectConfig.assets) state.projectConfig.assets = [];
      const index = state.projectConfig.assets.findIndex(a => a.id === asset.id);
      
      if (index !== -1) {
        state.projectConfig.assets[index] = { ...state.projectConfig.assets[index], ...asset };
      } else {
        state.projectConfig.assets.push(asset);
      }

      // Atualizar as listas de recursos filtradas manualmente para garantir reatividade
      const allAssets = state.projectConfig.assets;
      state.resources.sprites = allAssets.filter(a => a.type === 'sprite');
      state.resources.tiles = allAssets.filter(a => a.type === 'tile');
      state.resources.tilemaps = allAssets.filter(a => a.type === 'tilemap');
      state.resources.palettes = allAssets.filter(a => a.type === 'palette');
      state.resources.sounds = allAssets.filter(a => a.type === 'sound');
      state.resources.backgrounds = allAssets.filter(a => a.type === 'background');
    }
  },
  actions: {
    updateFileRequest({ commit }, data) {
      commit('setFileRequest', data);
    },
    updateFileImage({ commit }, data) {
      commit('setImageRequest', data)
    },
    updateTab({ commit }, data) {
      commit('setTabRequest', data)
    },
    async initSettings({ commit, dispatch }) {
      try {
        const settings = await window.ipc?.invoke('get-ui-settings');
        if (settings) {
          Object.keys(settings).forEach(key => {
            if (key === 'toolkitPath') commit('setToolkitPath', settings[key]);
            if (key === 'editorWordWrap') commit('setEditorWordWrap', settings[key]);
            if (key === 'windowControlsPosition') commit('setWindowControlsPosition', settings[key]);
            if (key === 'formatterIndentStyle') commit('setFormatterIndentStyle', settings[key]);
            if (key === 'formatterIndentSize') commit('setFormatterIndentSize', settings[key]);
            if (key === 'imageEditorPath') commit('setImageEditorPath', settings[key]);
            if (key === 'mapEditorPath') commit('setMapEditorPath', settings[key]);
          });
        }
        
        // Inicializar emuladores
        dispatch('fetchEmulators');
      } catch (error) {
        console.error('[Store] Error initializing settings:', error);
      }
    },
    async fetchEmulators({ commit }) {
      window.ipc?.send('get-available-emulators');
      window.ipc?.send('get-emulator-config');
      
      // Escutar uma vez para inicializar
      window.ipc?.once('available-emulators', (data) => {
        if (data.success) {
          commit('setAvailableEmulators', data.emulators || []);
        }
      });
      
      window.ipc?.once('emulator-config', (data) => {
        if (data.success && data.config) {
          commit('setSelectedEmulator', data.config.selectedEmulator || 'gen_sdl2');
        }
      });
    },
    async loadProject({ commit, dispatch, state }, { name, path }) {
      if (!path) return;
      
      console.log('[Store] Loading project:', name, path);
      
      // Se o projeto for diferente do atual, podemos querer limpar as abas
      const isNewProject = state.projectConfig.path !== path;
      
      const config = {
        name: name || path.split(/[/\\]/).pop(),
        path: path,
        assets: []
      };

      commit('setProjectConfig', config);
      
      // Usar a utilidade central para persistir e atualizar listas de recentes/marcados
      setDataProject(config.name, config.path);
      
      if (isNewProject) {
        // Limpar abas se mudar de projeto
        localStorage.removeItem('tabs');
        commit('setCurrentFile', null);
        commit('setCurrentScene', null);
        commit('setSceneNodes', []);
        commit('clearHistory');
        // Notificar MainLayout para limpar abas reativamente
        dispatch('updateTab', { action: 'clearAll' });
      }

      // Solicitar carregamento de arquivos e configuração real do disco
      window.ipc?.send('req-projec', { path });
      
      dispatch('showNotification', {
        type: 'success',
        title: 'Projeto Carregado',
        message: `Projeto "${config.name}" agora é o ativo.`
      });
    },
    // Scene actions
    addSceneNode({ commit, dispatch }, node) {
      dispatch('saveHistoryBeforeAction');
      commit('addSceneNode', node);
    },
    removeSceneNode({ commit, dispatch }, nodeId) {
      dispatch('saveHistoryBeforeAction');
      commit('removeSceneNode', nodeId);
    },
    updateSceneNode({ commit }, node) {
      // Only save history if it's a significant change (not every mouse move)
      // This will be handled by the component
      commit('updateSceneNode', node);
    },
    saveHistoryBeforeAction({ commit, state }) {
      // Only save if there's a change
      const currentState = JSON.stringify(state.sceneNodes);
      const lastState = state.history.present ? JSON.stringify(state.history.present) : null;
      
      if (currentState !== lastState) {
        commit('saveHistory');
      }
    },
    // Undo/Redo actions
    undo({ commit, state }) {
      if (state.history.past.length > 0) {
        commit('undo');
        return true;
      }
      return false;
    },
    redo({ commit, state }) {
      if (state.history.future.length > 0) {
        commit('redo');
        return true;
      }
      return false;
    },
    clearHistory({ commit }) {
      commit('clearHistory');
    },
    updateSelectedNode({ commit }, node) {
      commit('setSelectedNode', node);
    },
    // Resource actions
    addResource({ commit }, resource) {
      commit('addResource', resource);
    },
    removeResource({ commit }, { type, id }) {
      commit('removeResource', { type, id });
    },
    updateResource({ commit }, resource) {
      commit('updateResource', resource);
    },
    updateSelectedResource({ commit }, resource) {
      commit('setSelectedResource', resource);
    },
    openResourceEditor({ commit }, resource) {
      commit('setSelectedResource', resource);
      commit('setResourceEditorOpen', true);
    },
    closeResourceEditor({ commit }) {
      commit('setResourceEditorOpen', false);
      commit('setSelectedResource', null);
    },
    // Scene
    setCurrentScene({ commit }, scene) {
      commit('setCurrentScene', scene);
    },
    // Modal actions
    openProjectDialog({ dispatch }) {
      window.ipc?.send('select-folder', {});
      window.ipc?.once('folder-selected', (result) => {
        if (result && result.path) {
          dispatch('loadProject', { path: result.path });
        }
      });
    },
    openSettings({ commit }) {
      commit('setModalAction', { action: 'openSettings', value: true });
    },
    clearModalAction({ commit }, action) {
      commit('clearModalAction', action);
    },
    // Status bar
    setStatusMessage({ commit }, { message, type = 'info' }) {
      commit('setStatusMessage', { message, type });
      // Auto-clear after 3 seconds
      if (message) {
        setTimeout(() => {
          commit('clearStatusMessage');
        }, 3000);
      }
    },
    clearStatusMessage({ commit }) {
      commit('clearStatusMessage');
    },
    // Notifications
    showNotification({ commit }, notification) {
      const id = Date.now() + Math.random();
      const newNotification = { ...notification, id };
      commit('addNotification', newNotification);
      // Auto-remove after 5 seconds
      if (!notification.persistent) {
        setTimeout(() => {
          commit('removeNotification', id);
        }, 5000);
      }
    },
    removeNotification({ commit }, id) {
      commit('removeNotification', id);
    },
    setWindowControlsPosition({ commit }, position) {
      commit('setWindowControlsPosition', position);
    },
    setToolkitPath({ commit }, pathValue) {
      commit('setToolkitPath', pathValue);
    },
    setEditorWordWrap({ commit }, mode) {
      commit('setEditorWordWrap', mode);
    },
    setFormatterIndentStyle({ commit }, style) {
      commit('setFormatterIndentStyle', style);
    },
    setFormatterIndentSize({ commit }, size) {
      commit('setFormatterIndentSize', size);
    },
    setImageEditorPath({ commit }, pathValue) {
      commit('setImageEditorPath', pathValue);
    },
    setMapEditorPath({ commit }, pathValue) {
      commit('setMapEditorPath', pathValue);
    },
    async loadAssetPreview({ commit, state }, asset) {
      if (!asset || !asset.path || asset.preview) return;
      
      try {
        const projectPath = state.projectConfig.path;
        if (!projectPath) return;

        if (['sprite', 'tile', 'background'].includes(asset.type)) {
          const result = await window.ipc.invoke('get-asset-preview', {
            projectPath,
            assetPath: asset.path
          });
          
          if (result && result.success) {
            commit('updateAssetPreview', { id: asset.id, preview: result.preview });
          }
        } else if (asset.type === 'palette') {
          const result = await window.ipc.invoke('get-palette-colors', {
            projectPath,
            assetPath: asset.path
          });
          
          if (result && result.success) {
            // Aqui poderíamos gerar o canvas da paleta se quiséssemos
            // Mas por enquanto apenas salvamos as cores no metadata
            commit('updateAssetPreview', { 
              id: asset.id, 
              metadata: { colors: result.colors } 
            });
          }
        }
      } catch (error) {
        console.error('[Store] Error loading asset preview:', error);
      }
    },
    async loadAllMissingPreviews({ dispatch, state }) {
      const assets = state.projectConfig.assets || [];
      for (const asset of assets) {
        if (!asset.preview) {
          await dispatch('loadAssetPreview', asset);
        }
      }
    }
  },
});

export default store;