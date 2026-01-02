import { createStore } from 'vuex';

const hasWindowStorage = () => typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';

const getStoredUiSettings = () => {
  if (!hasWindowStorage()) return {};
  try {
    return JSON.parse(window.localStorage.getItem('uiSettings')) || {};
  } catch (error) {
    console.error('Failed to parse UI settings from storage', error);
    return {};
  }
};

const persistUiSettings = (settings) => {
  if (!hasWindowStorage()) return;
  window.localStorage.setItem('uiSettings', JSON.stringify(settings));
};

const initialUiSettings = {
  windowControlsPosition: 'right',
  toolkitPath: '',
  editorWordWrap: 'off',
  formatterIndentStyle: 'space', // 'space' ou 'tab'
  formatterIndentSize: 2, // Número de espaços
  ...getStoredUiSettings()
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
      sounds: []
    },
    selectedResource: null,
    // Current scene
    currentScene: null,
    // Resource editor state
    resourceEditorOpen: false,
    // Modal actions
    modalActions: {
      openProject: false,
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
    uiSettings: initialUiSettings
  },
  mutations: {
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
    openProjectDialog({ commit }) {
      commit('setModalAction', { action: 'openProject', value: true });
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
    }
  },
});

export default store;