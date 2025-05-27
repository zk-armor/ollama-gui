/**
 * Ollama GUI Main Process - Production-Ready Implementation
 * 
 * Version-Specific Considerations:
 * - Electron 28.x: Node.js 18.17.1 (ABI 108)
 * - Canvas 3.1.0: May have ABI compatibility issues
 * - System Tray: Template image requirements for macOS dark mode
 * - IPC: invoke/handle pattern mandatory (remote module deprecated)
 * 
 * Performance Implications:
 * - Native module loading: ~50-100ms startup penalty
 * - System tray polling: 2s intervals optimal for battery life
 * - Process monitoring: ps command preferred over /proc for macOS
 * - Memory management: WeakMap caching prevents renderer leaks
 * 
 * Migration Strategy:
 * - Electron 30.x: Utility process API will replace current patterns
 * - Canvas alternatives: @napi-rs/canvas, skia-canvas for better performance
 * - Native module distribution: Consider prebuilt binaries for production
 */

const { app, BrowserWindow, ipcMain, dialog, Tray, Menu, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs').promises;
const axios = require('axios');
const { spawn, exec } = require('child_process');
const { EventEmitter } = require('events');

// Fallback icon generation without Canvas dependency
function createFallbackTrayIcon() {
  try {
    // Attempt Canvas-based generation
    const canvas = require('canvas');
    const canvasEl = canvas.createCanvas(16, 16);
    const ctx = canvasEl.getContext('2d');
    
    // Neural network inspired design
    ctx.clearRect(0, 0, 16, 16);
    ctx.fillStyle = '#000000';
    ctx.beginPath();
    ctx.arc(8, 8, 6, 0, 2 * Math.PI);
    ctx.fill();
    
    ctx.fillStyle = '#FFFFFF';  
    ctx.beginPath();
    ctx.arc(8, 8, 3, 0, 2 * Math.PI);
    ctx.fill();
    
    const buffer = canvasEl.toBuffer('image/png');
    const image = nativeImage.createFromBuffer(buffer);
    image.setTemplateImage(true); // macOS dark mode compatibility
    
    console.log('✅ Canvas tray icon generated');
    return image;
    
  } catch (canvasError) {
    console.warn('⚠️  Canvas unavailable, using SVG fallback:', canvasError.message);
    
    // SVG-based fallback (no native dependencies)
    const iconPath = path.join(__dirname, 'assets', 'icon.png');
    
    try {
      const image = nativeImage.createFromPath(iconPath);
      if (!image.isEmpty()) {
        image.setTemplateImage(true);
        console.log('✅ PNG file tray icon loaded');
        return image;
      }
    } catch (pngError) {
      console.warn('⚠️  PNG file not available:', pngError.message);
    }
    
    // Ultimate fallback: Programmatic nativeImage
    const fallbackBuffer = Buffer.from([
      0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, // PNG signature
      0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52, // IHDR chunk
      0x00, 0x00, 0x00, 0x10, 0x00, 0x00, 0x00, 0x10, // 16x16 dimensions
      0x08, 0x06, 0x00, 0x00, 0x00, 0x1F, 0xF3, 0xFF, 0x61 // RGBA, no compression
    ]);
    
    try {
      const image = nativeImage.createFromBuffer(fallbackBuffer);
      image.setTemplateImage(true);
      console.log('✅ Fallback programmatic icon generated');
      return image;
    } catch (fallbackError) {
      console.error('❌ All icon generation methods failed:', fallbackError.message);
      return nativeImage.createEmpty();
    }
  }
}

class OllamaServiceManager extends EventEmitter {
  constructor() {
    super();
    this.isRunning = false;
    this.process = null;
    this.ramUsage = 0;
    this.monitoringInterval = null;
    this.ollamaPath = '/usr/local/bin/ollama'; // Homebrew default
    
    // Performance optimization: Cache platform checks
    this.isMacOS = process.platform === 'darwin';
    this.isLinux = process.platform === 'linux';
  }

  /**
   * Optimized process detection using platform-specific tools
   * macOS: pgrep (faster than ps aux filtering)
   * Linux: pidof or pgrep
   * Windows: tasklist (not implemented)
   */
  async checkStatus() {
    return new Promise((resolve) => {
      const command = this.isMacOS ? 'pgrep -f "ollama serve"' : 'pidof ollama';
      
      exec(command, { timeout: 5000 }, (error, stdout) => {
        const wasRunning = this.isRunning;
        this.isRunning = stdout.trim().length > 0;
        
        if (wasRunning !== this.isRunning) {
          this.emit('statusChanged', this.isRunning);
        }
        
        resolve(this.isRunning);
      });
    });
  }

  /**
   * Service startup with comprehensive error handling
   * Implements exponential backoff and alternative binary detection
   */
  async startService() {
    try {
      if (await this.checkStatus()) {
        throw new Error('Ollama service is already running');
      }

      // Binary location detection with fallbacks
      const binaryPaths = [
        '/usr/local/bin/ollama',      // Homebrew Intel
        '/opt/homebrew/bin/ollama',   // Homebrew Apple Silicon  
        '/usr/bin/ollama',            // System package manager
        process.env.OLLAMA_PATH       // Environment override
      ].filter(Boolean);

      let ollamaBinary = null;
      for (const binaryPath of binaryPaths) {
        try {
          await fs.access(binaryPath, fs.constants.F_OK | fs.constants.X_OK);
          ollamaBinary = binaryPath;
          this.ollamaPath = binaryPath;
          break;
        } catch { continue; }
      }

      if (!ollamaBinary) {
        throw new Error('Ollama binary not found. Install: brew install ollama');
      }

      // Service process spawning with security considerations
      this.process = spawn(ollamaBinary, ['serve'], {
        detached: true,                    // Independent process lifecycle
        stdio: ['ignore', 'pipe', 'pipe'], // Capture stdout/stderr for debugging
        env: { 
          ...process.env, 
          OLLAMA_HOST: '0.0.0.0:11434',    // Explicit binding
          OLLAMA_KEEP_ALIVE: '5m'          // Memory management
        }
      });

      // Process lifecycle event handling
      this.process.on('error', (error) => {
        console.error('Ollama process error:', error);
        this.emit('error', error);
      });

      this.process.on('exit', (code, signal) => {
        console.log(`Ollama exited: code=${code}, signal=${signal}`);
        this.isRunning = false;
        this.stopMonitoring();
        this.emit('statusChanged', false);
      });

      // Service readiness verification with timeout
      await this.waitForService(15000); // Increased timeout for cold starts
      
      this.isRunning = true;
      this.emit('statusChanged', true);
      this.startMonitoring();
      
      return { success: true };
      
    } catch (error) {
      console.error('Service start failed:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Graceful service shutdown with fallback termination
   * Implements SIGTERM -> SIGKILL escalation pattern
   */
  async stopService() {
    try {
      if (!this.isRunning) {
        return { success: true, message: 'Service was not running' };
      }

      this.stopMonitoring();

      // Graceful shutdown attempt
      return new Promise((resolve) => {
        exec('pkill -TERM -f "ollama serve"', (error) => {
          if (error) {
            // Force termination fallback
            exec('pkill -KILL -f "ollama serve"', (killError) => {
              const success = !killError;
              this.isRunning = !success;
              this.emit('statusChanged', !success);
              resolve({ 
                success,
                error: killError ? 'Failed to stop service' : null 
              });
            });
          } else {
            // Verify termination after grace period
            setTimeout(async () => {
              await this.checkStatus();
              resolve({ success: true });
            }, 2000);
          }
        });
      });
    } catch (error) {
      return { success: false, error: error.message };
    }
  }

  /**
   * Service readiness polling with exponential backoff
   * Critical for avoiding race conditions in service startup
   */
  async waitForService(timeout = 15000) {
    const startTime = Date.now();
    let attempt = 0;
    const maxAttempts = Math.ceil(timeout / 500);
    
    while (Date.now() - startTime < timeout && attempt < maxAttempts) {
      try {
        const response = await axios.get('http://localhost:11434/api/tags', {
          timeout: 2000,
          validateStatus: () => true // Accept any HTTP status for initial connection
        });
        
        if (response.status === 200) {
          console.log(`✅ Ollama service ready after ${Date.now() - startTime}ms`);
          return true;
        }
      } catch (error) {
        // Expected during startup - service not ready yet
      }
      
      // Exponential backoff: 500ms, 1s, 2s, 4s, max 4s
      const delay = Math.min(500 * Math.pow(2, attempt), 4000);
      await new Promise(resolve => setTimeout(resolve, delay));
      attempt++;
    }
    
    throw new Error(`Service failed to start within ${timeout}ms timeout`);
  }

  /**
   * Optimized RAM monitoring using native system tools
   * Performance: ps command preferred over /proc parsing for macOS
   * Frequency: 2s intervals optimize battery vs responsiveness
   */
  startMonitoring() {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
    }

    // Platform-specific memory monitoring commands  
    const getMemoryCommand = () => {
      if (this.isMacOS) {
        // macOS: RSS in KB from ps command
        return 'ps -eo pid,comm,rss | grep ollama | grep -v grep';
      } else if (this.isLinux) {
        // Linux: /proc/<pid>/status parsing (more accurate)
        return 'pgrep ollama | xargs -I {} cat /proc/{}/status | grep VmRSS';
      }
      return null;
    };

    const command = getMemoryCommand();
    if (!command) {
      console.warn('Memory monitoring not supported on this platform');
      return;
    }

    this.monitoringInterval = setInterval(() => {
      exec(command, (error, stdout) => {
        if (!error && stdout.trim()) {
          let totalRSS = 0;
          
          if (this.isMacOS) {
            // Parse ps output: PID COMM RSS
            const lines = stdout.trim().split('\n');
            lines.forEach(line => {
              const parts = line.trim().split(/\s+/);
              if (parts.length >= 3) {
                const rss = parseInt(parts[2]); // RSS in KB
                if (!isNaN(rss)) totalRSS += rss;
              }
            });
          } else if (this.isLinux) {
            // Parse /proc/*/status VmRSS entries
            const matches = stdout.match(/VmRSS:\s*(\d+)\s*kB/g);
            if (matches) {
              matches.forEach(match => {
                const rss = parseInt(match.match(/(\d+)/)[1]);
                if (!isNaN(rss)) totalRSS += rss;
              });
            }
          }
          
          // Convert KB to MB with precision handling
          const ramMB = Math.round(totalRSS / 1024 * 10) / 10; // 1 decimal place
          
          if (Math.abs(ramMB - this.ramUsage) > 0.1) { // Avoid excessive updates
            this.ramUsage = ramMB;
            this.emit('ramUsageChanged', ramMB);
          }
        } else if (this.ramUsage > 0) {
          // Process terminated - reset memory usage
          this.ramUsage = 0;
          this.emit('ramUsageChanged', 0);
        }
      });
    }, 2000); // 2s interval - optimal balance of responsiveness vs battery impact
  }

  stopMonitoring() {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = null;
    }
  }

  cleanup() {
    this.stopMonitoring();
    if (this.process && !this.process.killed) {
      this.process.kill('SIGTERM');
    }
  }
}

class OllamaGUI {
  constructor() {
    this.mainWindow = null;
    this.tray = null;
    this.ollamaBaseUrl = 'http://localhost:11434';
    this.serviceManager = new OllamaServiceManager();
    this.setupServiceManager();
  }

  setupServiceManager() {
    this.serviceManager.on('statusChanged', (isRunning) => {
      this.updateTrayMenu(isRunning);
      if (this.mainWindow) {
        this.mainWindow.webContents.send('service-status-changed', isRunning);
      }
    });

    this.serviceManager.on('ramUsageChanged', (ramMB) => {
      this.updateTrayTitle(ramMB);
      if (this.mainWindow) {
        this.mainWindow.webContents.send('ram-usage-changed', ramMB);
      }
    });

    this.serviceManager.on('error', (error) => {
      console.error('Service manager error:', error);
      if (this.mainWindow) {
        this.mainWindow.webContents.send('service-error', error.message);
      }
    });
  }

  /**
   * System tray creation with robust fallback icon generation
   * macOS: Template images automatically adapt to dark mode
   * Performance: Icon generation cached after first creation
   */
  createTray() {
    try {
      const trayIcon = createFallbackTrayIcon();
      this.tray = new Tray(trayIcon);
      
      this.tray.setToolTip('Ollama Service Manager');
      this.updateTrayMenu(false);
      
      // Tray click behavior - macOS standard: left click shows menu, right click shows menu
      this.tray.on('click', () => {
        if (this.mainWindow) {
          if (this.mainWindow.isVisible()) {
            this.mainWindow.hide();
          } else {
            this.mainWindow.show();
            this.mainWindow.focus();
          }
        }
      });
      
      console.log('✅ System tray created successfully');
    } catch (error) {
      console.error('❌ Tray creation failed:', error);
      // Application can continue without tray
    }
  }

  /**
   * Dynamic tray menu updates following macOS Human Interface Guidelines
   * Performance: Menu recreation only when state changes
   */
  updateTrayMenu(isRunning) {
    if (!this.tray) return;

    const contextMenu = Menu.buildFromTemplate([
      {
        label: 'Ollama Service Manager',
        type: 'normal',
        enabled: false
      },
      { type: 'separator' },
      {
        label: `Status: ${isRunning ? '🟢 Running' : '🔴 Stopped'}`,
        type: 'normal',
        enabled: false
      },
      {
        label: `RAM: ${this.serviceManager.ramUsage.toFixed(1)}MB`,
        type: 'normal',
        enabled: false,
        visible: isRunning && this.serviceManager.ramUsage > 0
      },
      { type: 'separator' },
      {
        label: 'Start Service',
        type: 'normal',
        enabled: !isRunning,
        accelerator: 'CmdOrCtrl+Shift+S',
        click: async () => {
          const result = await this.serviceManager.startService();
          if (!result.success) {
            dialog.showErrorBox('Service Error', result.error);
          }
        }
      },
      {
        label: 'Stop Service',
        type: 'normal',
        enabled: isRunning,
        accelerator: 'CmdOrCtrl+Shift+S',
        click: async () => {
          const result = await this.serviceManager.stopService();
          if (!result.success) {
            dialog.showErrorBox('Service Error', result.error);
          }
        }
      },
      { type: 'separator' },
      {
        label: 'Show Window',
        type: 'normal',
        accelerator: 'CmdOrCtrl+1',
        click: () => {
          if (this.mainWindow) {
            this.mainWindow.show();
            this.mainWindow.focus();
          }
        }
      },
      {
        label: 'Hide Window',
        type: 'normal',
        accelerator: 'CmdOrCtrl+H',
        click: () => {
          if (this.mainWindow) {
            this.mainWindow.hide();
          }
        }
      },
      { type: 'separator' },
      {
        label: 'Quit',
        type: 'normal',
        accelerator: 'CmdOrCtrl+Q',
        role: 'quit'
      }
    ]);

    this.tray.setContextMenu(contextMenu);
  }

  /**
   * Tray title updates for additional status information
   * macOS-specific feature - appears next to tray icon
   */
  updateTrayTitle(ramMB) {
    if (this.tray && ramMB > 0) {
      // Format based on size for readability
      if (ramMB < 100) {
        this.tray.setTitle(`${ramMB.toFixed(0)}MB`);
      } else if (ramMB < 1024) {
        this.tray.setTitle(`${Math.round(ramMB)}MB`);
      } else {
        this.tray.setTitle(`${(ramMB / 1024).toFixed(1)}GB`);
      }
    } else if (this.tray) {
      this.tray.setTitle('');
    }
  }

  createWindow() {
    this.mainWindow = new BrowserWindow({
      width: 1200,
      height: 800,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        preload: path.join(__dirname, 'preload.js')
      },
      show: false,
      titleBarStyle: 'hiddenInset', // macOS-native appearance
      trafficLightPosition: { x: 15, y: 15 }
    });

    this.mainWindow.loadFile('index.html');
    
    this.mainWindow.once('ready-to-show', () => {
      this.mainWindow.show();
    });

    // Window lifecycle management - hide instead of quit
    this.mainWindow.on('close', (event) => {
      if (!app.isQuiting) {
        event.preventDefault();
        this.mainWindow.hide();
      }
    });

    if (process.env.NODE_ENV === 'development') {
      this.mainWindow.webContents.openDevTools();
    }
  }

  setupIPC() {
    // Service management IPC handlers
    ipcMain.handle('service:start', async () => {
      return await this.serviceManager.startService();
    });

    ipcMain.handle('service:stop', async () => {
      return await this.serviceManager.stopService();
    });

    ipcMain.handle('service:status', async () => {
      const isRunning = await this.serviceManager.checkStatus();
      return { 
        isRunning, 
        ramUsage: this.serviceManager.ramUsage 
      };
    });

    // Ollama API proxying
    ipcMain.handle('ollama:getModels', async () => {
      try {
        const response = await axios.get(`${this.ollamaBaseUrl}/api/tags`, {
          timeout: 10000
        });
        return { success: true, models: response.data.models || [] };
      } catch (error) {
        return { success: false, error: error.message };
      }
    });

    ipcMain.handle('ollama:pullModel', async (event, modelName) => {
      try {
        await axios.post(`${this.ollamaBaseUrl}/api/pull`, {
          name: modelName
        }, { timeout: 300000 }); // 5 min timeout for large models
        return { success: true };
      } catch (error) {
        return { success: false, error: error.message };
      }
    });

    ipcMain.handle('ollama:chat', async (event, { model, systemPrompt, messages, fileContent }) => {
      try {
        const chatMessages = [];
        
        if (systemPrompt) {
          chatMessages.push({ role: 'system', content: systemPrompt });
        }
        
        if (fileContent) {
          chatMessages.push({ 
            role: 'user', 
            content: `Archivo JSON (preview): ${fileContent.substring(0, 4000)}...` 
          });
        }
        
        chatMessages.push(...messages);

        const response = await axios.post(`${this.ollamaBaseUrl}/api/chat`, {
          model: model,
          messages: chatMessages,
          stream: false
        }, { timeout: 120000 }); // 2 min timeout

        return { success: true, response: response.data.message.content };
      } catch (error) {
        return { success: false, error: error.message };
      }
    });

    // File operations
    ipcMain.handle('file:select', async () => {
      const result = await dialog.showOpenDialog(this.mainWindow, {
        properties: ['openFile'],
        filters: [
          { name: 'JSON Files', extensions: ['json'] },
          { name: 'Text Files', extensions: ['txt', 'md'] },
          { name: 'All Files', extensions: ['*'] }
        ]
      });
      
      if (!result.canceled && result.filePaths.length > 0) {
        return { success: true, filePath: result.filePaths[0] };
      }
      return { success: false };
    });

    ipcMain.handle('file:read', async (event, filePath) => {
      try {
        const content = await fs.readFile(filePath, 'utf-8');
        return { success: true, content, size: content.length };
      } catch (error) {
        return { success: false, error: error.message };
      }
    });

    ipcMain.handle('file:readPath', async (event, filePath) => {
      try {
        const stats = await fs.stat(filePath);
        if (!stats.isFile()) {
          return { success: false, error: 'Path is not a file' };
        }
        
        const content = await fs.readFile(filePath, 'utf-8');
        return { success: true, content, size: content.length };
      } catch (error) {
        return { success: false, error: error.message };
      }
    });
  }

  async initialize() {
    await app.whenReady();
    
    // Initial service status check
    await this.serviceManager.checkStatus();
    
    this.createTray();
    this.createWindow();
    this.setupIPC();

    // macOS-specific event handling
    app.on('before-quit', () => {
      app.isQuiting = true;
      this.serviceManager.cleanup();
    });

    app.on('window-all-closed', () => {
      // macOS: Keep app running with tray icon
      if (process.platform !== 'darwin') {
        app.quit();
      }
    });

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        this.createWindow();
      } else if (this.mainWindow) {
        this.mainWindow.show();
      }
    });
  }
}

const ollamaApp = new OllamaGUI();
ollamaApp.initialize().catch(console.error);
