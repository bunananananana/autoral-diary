const { contextBridge, ipcRenderer } = require('electron');

let renderMarkdown;
try {
  const { marked } = require('marked');
  marked.setOptions({ breaks: true, gfm: true });
  renderMarkdown = (text) => marked.parse(text);
} catch (e) {
  console.error('marked load failed, using fallback:', e.message);
  renderMarkdown = (text) => {
    return text
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/^### (.+)$/gm, '<h3>$1</h3>')
      .replace(/^## (.+)$/gm, '<h2>$1</h2>')
      .replace(/^# (.+)$/gm, '<h1>$1</h1>')
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.+?)\*/g, '<em>$1</em>')
      .replace(/^---$/gm, '<hr>')
      .replace(/^- (.+)$/gm, '<li>$1</li>')
      .replace(/\n/g, '<br>');
  };
}

contextBridge.exposeInMainWorld('api', {
  saveDiary: (date, content) => ipcRenderer.invoke('diary:save', date, content),
  loadDiary: (date) => ipcRenderer.invoke('diary:load', date),
  listDiaries: () => ipcRenderer.invoke('diary:list'),
  deleteDiary: (date) => ipcRenderer.invoke('diary:delete', date),
  exportDiary: (date) => ipcRenderer.invoke('diary:export', date),
  importDiary: () => ipcRenderer.invoke('diary:import'),
  openMain: () => ipcRenderer.invoke('app:open-main'),
  pickWidgetBg: () => ipcRenderer.invoke('widget:pick-bg'),
  getWidgetBg: () => ipcRenderer.invoke('widget:get-bg'),
  clearWidgetBg: () => ipcRenderer.invoke('widget:clear-bg'),
  renderMarkdown,
});
