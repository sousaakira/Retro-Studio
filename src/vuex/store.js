import { createStore } from 'vuex';

const store = createStore({
  state: {
    fileRequest: null,
    imageRequest: null,
    tabRequest: null
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
    }
  },
});

export default store;