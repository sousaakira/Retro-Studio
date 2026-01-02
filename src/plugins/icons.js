const extensoesFiles = ['h', 'c', 'js', 'ts', 'res', 'vue', 'html', 'css', 'scss', 'json', 'gitignore', 'log', 's'];

// eslint-disable-next-line no-unused-vars
const iconesPorExtensao = {
  'h': 'ra ra-h folder-blue',
  'c': 'ra ra-c folder-blue',
  'js': 'ra ra-js folder-yelo',
  'ts': 'fa-solid fa-code folder-blue',
  'res': 'ra ra-gnu folder-red',
  'html': 'ra ra-html folder-red',
  'json': 'ra ra-json folder-red',
  'gitignore': 'ra ra-gitignore folder-red',
  'vue': 'ra ra-vuejs folder-green',
  'css': 'fa-brands fa-css3 folder-green',
  'scss': 'fa-brands fa-css3 folder-green',
  'log': 'ra ra-log folder-green',
  's': 'ra ra-sega',
};

function isFile(fileName) {
  const extensao = fileName.split('.').pop().toLowerCase();
  return extensoesFiles.includes(extensao);
}

function obterIconePorExtensao(fileName) {
  const extensao = fileName.split('.').pop().toLowerCase();
  return iconesPorExtensao[extensao] || 'fa-solid-icon-padrao';
}
export {
  isFile,
  obterIconePorExtensao
}