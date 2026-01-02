let tabs = [];
const RECENT_KEY = 'recentProjects';
const RECENT_LIMIT = 8;
const WORKING_KEY = 'workingProjects';
const WORKING_LIMIT = 12;

function getDataTab() {
  return localStorage.getItem('tabs');
}

function setDataTab(name, path) {
  const data = getDataTab();

  if (data) {
    tabs = JSON.parse(data);
  }
  const exists = tabs.some(tab => tab?.name === name);
  if (!exists) {
    tabs.push({ name, path });
    localStorage.setItem('tabs', JSON.stringify(tabs));
  }
}

function removeDataTab() {
  // Implemente a remoção conforme necessário
}


function setDataProject(foldeName, foldeHoot) {
  const project = {
    fold: foldeName,
    name: foldeName,
    path: foldeHoot
  }
  console.log('project >>> ',project)
  localStorage.setItem('project', JSON.stringify(project));
  addRecentProject(project);
  addWorkingProject(project);
}

function updateTabs(value){
  console.log('<><><> ',value)
  // if (!value) {
  //   console.log('Update tabs on localStorage')
  // }
  localStorage.setItem('tabs', JSON.stringify(value));
}

function getRecentProjects() {
  try {
    return JSON.parse(localStorage.getItem(RECENT_KEY)) || [];
  } catch (e) {
    console.warn('Failed to parse recent projects', e);
    return [];
  }
}

function addRecentProject(project) {
  if (!project?.path || !project?.name) return;
  const current = getRecentProjects();
  const filtered = current.filter(p => p.path !== project.path);
  const entry = {
    name: project.name,
    path: project.path,
    template: project.template || null,
    lastOpenedAt: new Date().toISOString()
  };
  filtered.unshift(entry);
  const trimmed = filtered.slice(0, RECENT_LIMIT);
  localStorage.setItem(RECENT_KEY, JSON.stringify(trimmed));
}

function getWorkingProjects() {
  try {
    return JSON.parse(localStorage.getItem(WORKING_KEY)) || [];
  } catch (e) {
    console.warn('Failed to parse working projects', e);
    return [];
  }
}

function addWorkingProject(project) {
  if (!project?.path || !project?.name) return;
  const current = getWorkingProjects();
  const filtered = current.filter(p => p.path !== project.path);
  const entry = {
    name: project.name,
    path: project.path,
    template: project.template || null,
    pinnedAt: new Date().toISOString()
  };
  filtered.unshift(entry);
  const trimmed = filtered.slice(0, WORKING_LIMIT);
  localStorage.setItem(WORKING_KEY, JSON.stringify(trimmed));
}

function removeWorkingProject(path) {
  if (!path) return;
  const current = getWorkingProjects();
  const filtered = current.filter(p => p.path !== path);
  localStorage.setItem(WORKING_KEY, JSON.stringify(filtered));
}

export {
  setDataTab,
  removeDataTab,
  updateTabs,
  setDataProject,
  getRecentProjects,
  addRecentProject,
  getWorkingProjects,
  addWorkingProject,
  removeWorkingProject
};
