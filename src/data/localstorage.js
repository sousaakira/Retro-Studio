let tabs = [];

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

function updateTabs(value){
  console.log('<><><> ',value)
  // if (!value) {
  //   console.log('Update tabs on localStorage')
  // }
  localStorage.setItem('tabs', JSON.stringify(value));
}

export {
  setDataTab,
  removeDataTab,
  updateTabs
};
