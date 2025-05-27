const { contextBridge, ipcRenderer } = require('electron');

// Enhanced API exposure with service management capabilities
contextBridge.exposeInMainWorld('electronAPI', {
  // Ollama operations
  ollama: {
    getModels: () => ipcRenderer.invoke('ollama:getModels'),
    pullModel: (modelName) => ipcRenderer.invoke('ollama:pullModel', modelName),
    chat: (params) => ipcRenderer.invoke('ollama:chat', params)
  },
  
  // Service management operations
  service: {
    start: () => ipcRenderer.invoke('service:start'),
    stop: () => ipcRenderer.invoke('service:stop'),
    getStatus: () => ipcRenderer.invoke('service:status'),
    
    // Event listeners for real-time updates
    onStatusChanged: (callback) => {
      ipcRenderer.on('service-status-changed', (event, isRunning) => callback(isRunning));
    },
    onRamUsageChanged: (callback) => {
      ipcRenderer.on('ram-usage-changed', (event, ramMB) => callback(ramMB));
    },
    onServiceError: (callback) => {
      ipcRenderer.on('service-error', (event, error) => callback(error));
    },
    
    // Cleanup listeners (important for memory management)
    removeAllListeners: () => {
      ipcRenderer.removeAllListeners('service-status-changed');
      ipcRenderer.removeAllListeners('ram-usage-changed');
      ipcRenderer.removeAllListeners('service-error');
    }
  },
  
  // File operations
  file: {
    select: () => ipcRenderer.invoke('file:select'),
    read: (filePath) => ipcRenderer.invoke('file:read', filePath),
    readPath: (filePath) => ipcRenderer.invoke('file:readPath', filePath)
  }
});

// Expose platform information
contextBridge.exposeInMainWorld('platform', {
  isWindows: process.platform === 'win32',
  isMac: process.platform === 'darwin',
  isLinux: process.platform === 'linux'
});
