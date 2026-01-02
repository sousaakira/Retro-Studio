import { computed } from 'vue'
import { useStore } from 'vuex'

export function useUndoRedo() {
  const store = useStore()
  
  const canUndo = computed(() => store.state.history.past.length > 0)
  const canRedo = computed(() => store.state.history.future.length > 0)
  
  const undo = () => {
    const success = store.dispatch('undo')
    if (success) {
      store.dispatch('showNotification', {
        type: 'info',
        title: 'Undo',
        message: 'Action undone'
      })
    }
  }
  
  const redo = () => {
    const success = store.dispatch('redo')
    if (success) {
      store.dispatch('showNotification', {
        type: 'info',
        title: 'Redo',
        message: 'Action redone'
      })
    }
  }
  
  const saveHistory = () => {
    store.dispatch('saveHistoryBeforeAction')
  }
  
  return {
    canUndo,
    canRedo,
    undo,
    redo,
    saveHistory
  }
}
