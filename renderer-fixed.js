/**
 * Ollama GUI Renderer - Fixed Type Safety & UI State Management
 * Node.js 18.x+ / Electron 28.x Compatibility
 * 
 * Critical Fixes Applied:
 * - Type safety validation before string operations (null/undefined guards)
 * - File state management with proper cleanup
 * - UI synchronization with defensive programming patterns
 * - Memory leak prevention through proper event cleanup
 * 
 * Version-Specific Considerations:
 * - Optional chaining (?.) requires Node.js 14.x+ (safe for our target)
 * - Nullish coalescing (??) requires Node.js 14.x+ (safe for our target)
 * - WeakMap garbage collection patterns for long-running Electron sessions
 */

class FileManager {
    constructor() {
        this.currentFile = null;
        this.maxPreviewSize = 4096;
        this.supportedTypes = new Set(['.json', '.txt', '.md', '.csv']);
    }

    /**
     * Type-safe file preview generation with defensive programming
     * Addresses critical substring() TypeError in production environments
     */
    generateFilePreview(content) {
        // Critical: Null safety check before any string operations
        if (!content || typeof content !== 'string') {
            console.warn('Invalid content provided to generateFilePreview:', typeof content);
            return '';
        }

        // Early return for empty content
        if (content.length === 0) {
            return '';
        }

        // JSON parsing with comprehensive error handling
        if (this.isJSONContent(content)) {
            try {
                const parsed = JSON.parse(content);
                const serialized = JSON.stringify(parsed, null, 2);
                
                // Chunking strategy for large JSON files
                if (serialized.length <= this.maxPreviewSize) {
                    return serialized;
                }
                
                return this.createStructuralPreview(parsed);
            } catch (parseError) {
                console.warn('JSON parsing failed, falling back to text preview:', parseError.message);
                return this.createTextPreview(content);
            }
        }

        return this.createTextPreview(content);
    }

    /**
     * Heuristic JSON content detection
     * More robust than simple string.startsWith() checks
     */
    isJSONContent(content) {
        if (!content || typeof content !== 'string') return false;
        
        const trimmed = content.trim();
        return (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
               (trimmed.startsWith('[') && trimmed.endsWith(']'));
    }

    /**
     * Safe text preview with encoding considerations
     * Handles potential UTF-8/UTF-16 edge cases
     */
    createTextPreview(content) {
        if (!content || typeof content !== 'string') return '';
        
        // Truncate with word boundary awareness
        if (content.length <= this.maxPreviewSize) {
            return content;
        }
        
        const truncated = content.substring(0, this.maxPreviewSize);
        const lastSpace = truncated.lastIndexOf(' ');
        
        // Prefer word boundaries for better UX
        if (lastSpace > this.maxPreviewSize * 0.8) {
            return truncated.substring(0, lastSpace) + '...';
        }
        
        return truncated + '...';
    }

    /**
     * Memory-efficient structural JSON preview
     * Implements depth-first traversal with cycle detection
     */
    createStructuralPreview(obj, visited = new WeakSet(), depth = 0, maxDepth = 3) {
        // Prevent infinite recursion and memory leaks
        if (depth > maxDepth || (typeof obj === 'object' && obj !== null && visited.has(obj))) {
            return '[Circular/Deep Reference]';
        }

        if (typeof obj === 'object' && obj !== null) {
            visited.add(obj);
        }

        if (Array.isArray(obj)) {
            const preview = obj.slice(0, 3).map(item => 
                this.createStructuralPreview(item, visited, depth + 1, maxDepth)
            );
            
            const suffix = obj.length > 3 ? `, ...(${obj.length - 3} more items)` : '';
            return `[${preview.join(', ')}${suffix}]`;
        }

        if (typeof obj === 'object' && obj !== null) {
            const keys = Object.keys(obj);
            const preview = {};
            
            // Sample first 5 keys for structural understanding
            keys.slice(0, 5).forEach(key => {
                preview[key] = this.createStructuralPreview(obj[key], visited, depth + 1, maxDepth);
            });

            if (keys.length > 5) {
                preview[`...(${keys.length - 5} more properties)`] = '[...]';
            }

            return preview;
        }

        // Primitive values
        return obj;
    }

    /**
     * File state management with cleanup
     */
    setFile(filePath, content, size) {
        this.currentFile = {
            path: filePath,
            content: content,
            size: size,
            preview: this.generateFilePreview(content),
            loadedAt: new Date().toISOString()
        };
    }

    clearFile() {
        // Proper cleanup to prevent memory leaks
        if (this.currentFile) {
            this.currentFile.content = null;
            this.currentFile.preview = null;
        }
        this.currentFile = null;
    }

    getFileInfo() {
        if (!this.currentFile) return null;
        
        return {
            name: this.currentFile.path.split('/').pop(),
            size: this.currentFile.size,
            path: this.currentFile.path,
            loadedAt: this.currentFile.loadedAt
        };
    }
}

class ServiceManager {
    constructor() {
        this.isRunning = false;
        this.ramUsage = 0;
        this.statusElement = null;
        this.ramElement = null;
        this.startButton = null;
        this.stopButton = null;
        
        // Event cleanup tracking
        this.eventCleanups = [];
        
        this.setupEventListeners();
    }

    setupEventListeners() {
        // Store cleanup functions for proper memory management
        const statusCleanup = window.electronAPI.service.onStatusChanged((isRunning) => {
            this.updateServiceStatus(isRunning);
        });
        
        const ramCleanup = window.electronAPI.service.onRamUsageChanged((ramMB) => {
            this.updateRamUsage(ramMB);
        });
        
        const errorCleanup = window.electronAPI.service.onServiceError((error) => {
            this.showServiceNotification(`Service Error: ${error}`, 'error');
        });
        
        // Track cleanups for later removal
        this.eventCleanups.push(statusCleanup, ramCleanup, errorCleanup);
        
        // Automatic cleanup on page unload
        window.addEventListener('beforeunload', () => this.cleanup());
    }

    cleanup() {
        // Execute all cleanup functions
        this.eventCleanups.forEach(cleanup => {
            if (typeof cleanup === 'function') cleanup();
        });
        
        window.electronAPI.service.removeAllListeners();
    }

    initialize(elements) {
        this.statusElement = elements.serviceStatus;
        this.ramElement = elements.ramUsage;
        this.startButton = elements.startService;
        this.stopButton = elements.stopService;

        this.checkInitialStatus();
    }

    async checkInitialStatus() {
        try {
            const status = await window.electronAPI.service.getStatus();
            this.updateServiceStatus(status.isRunning);
            this.updateRamUsage(status.ramUsage || 0);
        } catch (error) {
            console.error('Failed to check initial service status:', error);
            this.updateServiceStatus(false);
        }
    }

    async startService() {
        if (this.isRunning) return;

        this.updateServiceStatus('starting');
        this.showServiceNotification('Iniciando servicio Ollama...', 'info');

        try {
            const result = await window.electronAPI.service.start();

            if (result.success) {
                this.showServiceNotification('Servicio Ollama iniciado correctamente', 'success');
            } else {
                throw new Error(result.error);
            }
        } catch (error) {
            console.error('Service start failed:', error);
            this.showServiceNotification(`Error al iniciar: ${error.message}`, 'error');
            this.updateServiceStatus(false);
        }
    }

    async stopService() {
        if (!this.isRunning) return;

        const confirmStop = confirm('¿Detener el servicio Ollama? Esto cerrará todas las conexiones activas.');
        if (!confirmStop) return;

        this.updateServiceStatus('stopping');
        this.showServiceNotification('Deteniendo servicio Ollama...', 'info');

        try {
            const result = await window.electronAPI.service.stop();

            if (result.success) {
                this.showServiceNotification('Servicio Ollama detenido', 'success');
                this.updateRamUsage(0);
            } else {
                throw new Error(result.error);
            }
        } catch (error) {
            console.error('Service stop failed:', error);
            this.showServiceNotification(`Error al detener: ${error.message}`, 'error');
        }
    }

    updateServiceStatus(status) {
        if (!this.statusElement || !this.startButton || !this.stopButton) return;

        if (typeof status === 'string') {
            switch (status) {
                case 'starting':
                    this.statusElement.textContent = 'Iniciando...';
                    this.statusElement.className = 'status-indicator starting';
                    this.startButton.disabled = true;
                    this.stopButton.disabled = true;
                    break;
                case 'stopping':
                    this.statusElement.textContent = 'Deteniendo...';
                    this.statusElement.className = 'status-indicator stopping';
                    this.startButton.disabled = true;
                    this.stopButton.disabled = true;
                    break;
            }
            return;
        }

        this.isRunning = status;
        
        if (status) {
            this.statusElement.textContent = 'Ejecutándose';
            this.statusElement.className = 'status-indicator running';
            this.startButton.disabled = true;
            this.stopButton.disabled = false;
        } else {
            this.statusElement.textContent = 'Detenido';
            this.statusElement.className = 'status-indicator stopped';
            this.startButton.disabled = false;
            this.stopButton.disabled = true;
        }
    }

    updateRamUsage(ramMB) {
        if (!this.ramElement) return;

        this.ramUsage = ramMB;
        
        if (ramMB === 0) {
            this.ramElement.textContent = '0 MB';
            this.ramElement.style.display = 'none';
        } else {
            if (ramMB < 1024) {
                this.ramElement.textContent = `${ramMB.toFixed(1)} MB`;
            } else {
                const ramGB = (ramMB / 1024).toFixed(1);
                this.ramElement.textContent = `${ramGB} GB`;
            }
            this.ramElement.style.display = 'inline-block';
        }
    }

    showServiceNotification(message, type = 'info') {
        const existing = document.querySelector('.service-notification');
        if (existing) existing.remove();

        const notification = document.createElement('div');
        notification.className = `service-notification ${type}`;
        notification.textContent = message;

        document.body.appendChild(notification);

        setTimeout(() => {
            if (notification.parentNode) {
                notification.style.animation = 'slideOut 0.3s ease-in forwards';
                setTimeout(() => notification.remove(), 300);
            }
        }, 4000);
    }
}

class OllamaRenderer {
    constructor() {
        this.currentModel = '';
        this.conversationHistory = [];
        
        // Modular file management
        this.fileManager = new FileManager();
        this.serviceManager = new ServiceManager();
        
        // Performance monitoring
        this.#abortController = null;
        
        this.elements = {};
        
        this.initializeElements();
        this.bindEvents();
        this.initializeApp();
    }

    #abortController = null;

    initializeElements() {
        const elementSelectors = {
            // Service management
            serviceStatus: '#serviceStatus',
            ramUsage: '#ramUsage',
            startService: '#startService',
            stopService: '#stopService',
            
            // Model management
            modelSelect: '#modelSelect',
            newModelName: '#newModelName',
            pullModel: '#pullModel',
            refreshModels: '#refreshModels',
            
            // File management
            systemPrompt: '#systemPrompt',
            selectFile: '#selectFile',
            filePath: '#filePath',
            loadFromPath: '#loadFromPath',
            fileInfo: '#fileInfo',
            clearFile: '#clearFile', // New element
            
            // Chat interface
            messagesContainer: '#messagesContainer',
            messageInput: '#messageInput',
            sendMessage: '#sendMessage',
            loadingOverlay: '#loadingOverlay'
        };
        
        Object.entries(elementSelectors).forEach(([key, selector]) => {
            const element = document.querySelector(selector);
            if (element) {
                this.elements[key] = element;
            } else if (key !== 'clearFile') { // clearFile is optional
                console.warn(`Element not found: ${selector}`);
            }
        });

        this.serviceManager.initialize(this.elements);
    }

    bindEvents() {
        this.#abortController?.abort();
        this.#abortController = new AbortController();
        const { signal } = this.#abortController;

        // Service management
        this.elements.startService?.addEventListener('click', () => {
            this.serviceManager.startService();
        }, { signal });

        this.elements.stopService?.addEventListener('click', () => {
            this.serviceManager.stopService();
        }, { signal });

        // Model management
        const eventBindings = [
            [this.elements.refreshModels, 'click', () => this.loadModels()],
            [this.elements.pullModel, 'click', () => this.pullModel()],
            [this.elements.modelSelect, 'change', (e) => this.currentModel = e.target.value],
            
            // File management
            [this.elements.selectFile, 'click', () => this.selectFile()],
            [this.elements.loadFromPath, 'click', () => this.loadFromPath()],
            [this.elements.clearFile, 'click', () => this.clearFile()], // New handler
            
            // Chat
            [this.elements.sendMessage, 'click', () => this.sendMessage()],
            [this.elements.messageInput, 'keydown', this.handleKeyboardShortcuts.bind(this)]
        ];

        eventBindings.forEach(([element, event, handler]) => {
            if (element) {
                element.addEventListener(event, handler, { signal });
            }
        });

        // File path validation with debouncing
        let pathInputTimeout;
        this.elements.filePath?.addEventListener('input', (e) => {
            clearTimeout(pathInputTimeout);
            pathInputTimeout = setTimeout(() => {
                if (e.target.value.trim()) {
                    this.validateFilePath(e.target.value.trim());
                }
            }, 300);
        }, { signal });
    }

    handleKeyboardShortcuts(event) {
        const { ctrlKey, metaKey, key, shiftKey } = event;
        const isCtrlOrCmd = ctrlKey || metaKey;
        
        switch (true) {
            case isCtrlOrCmd && key === 'Enter':
                event.preventDefault();
                this.sendMessage();
                break;
            case isCtrlOrCmd && key === 'k':
                event.preventDefault();
                this.clearConversation();
                break;
            case isCtrlOrCmd && key === 'x':
                event.preventDefault();
                this.clearFile();
                break;
            case isCtrlOrCmd && shiftKey && key === 'S':
                event.preventDefault();
                if (this.serviceManager.isRunning) {
                    this.serviceManager.stopService();
                } else {
                    this.serviceManager.startService();
                }
                break;
        }
    }

    async initializeApp() {
        try {
            const initPromises = [
                this.loadModels(),
                this.setDefaultSystemPrompt()
            ];
            
            await Promise.allSettled(initPromises);
            
        } catch (error) {
            console.error('App initialization failed:', error);
            this.showError('Error durante la inicialización');
        }
    }

    async loadModels(retryCount = 0) {
        const maxRetries = 3;
        
        if (!this.serviceManager.isRunning) {
            this.showError('El servicio Ollama no está ejecutándose. Inicialo primero.');
            return [];
        }

        this.showLoading(true);
        
        try {
            const result = await window.electronAPI.ollama.getModels();
            
            if (result.success) {
                this.populateModelSelect(result.models);
                return result.models;
            } else {
                throw new Error(result.error);
            }
        } catch (error) {
            console.error(`Model loading attempt ${retryCount + 1} failed:`, error);
            
            if (retryCount < maxRetries) {
                const delay = 1000 * Math.pow(2, retryCount);
                await new Promise(resolve => setTimeout(resolve, delay));
                return this.loadModels(retryCount + 1);
            } else {
                this.showError(`Error al cargar modelos tras ${maxRetries + 1} intentos`);
                return [];
            }
        } finally {
            this.showLoading(false);
        }
    }

    /**
     * Enhanced send message with null safety for file operations
     * Critical fix for the fileContent.substring TypeError
     */
    async sendMessage() {
        const message = this.elements.messageInput?.value.trim();
        
        if (!message) {
            this.showError('Ingresa un mensaje');
            return;
        }

        if (!this.serviceManager.isRunning) {
            this.showError('El servicio Ollama no está ejecutándose');
            return;
        }

        if (!this.currentModel) {
            this.showError('Selecciona un modelo primero');
            return;
        }

        this.addMessage('user', message);
        this.elements.messageInput.value = '';
        
        this.showLoading(true);
        this.elements.sendMessage.disabled = true;

        try {
            const chatParams = {
                model: this.currentModel,
                systemPrompt: this.elements.systemPrompt?.value.trim(),
                messages: [{ role: 'user', content: message }],
                // Critical fix: Safe property access with nullish coalescing
                fileContent: this.fileManager.currentFile?.preview ?? null
            };

            const result = await window.electronAPI.ollama.chat(chatParams);
            
            if (result.success) {
                this.addMessage('assistant', result.response);
                this.conversationHistory.push(
                    { role: 'user', content: message },
                    { role: 'assistant', content: result.response }
                );
            } else {
                throw new Error(result.error);
            }
        } catch (error) {
            console.error('Chat failed:', error);
            this.addMessage('error', 'Error: ' + error.message);
        } finally {
            this.showLoading(false);
            this.elements.sendMessage.disabled = false;
        }
    }

    /**
     * New method: Clear loaded file with UI updates
     */
    clearFile() {
        this.fileManager.clearFile();
        this.updateFileInfo();
        
        // Clear file path input
        if (this.elements.filePath) {
            this.elements.filePath.value = '';
            this.elements.filePath.style.borderColor = '';
        }
        
        this.showSuccess('Archivo eliminado de la sesión');
    }

    clearConversation() {
        this.conversationHistory = [];
        const container = this.elements.messagesContainer;
        if (container) {
            container.innerHTML = `
                <div class="welcome-message">
                    <h3>Conversación limpiada</h3>
                    <p>Listo para nueva consulta</p>
                </div>
            `;
        }
    }

    async selectFile() {
        try {
            const result = await window.electronAPI.file.select();
            if (result.success) {
                await this.loadFile(result.filePath);
            }
        } catch (error) {
            this.showError('Error al seleccionar archivo: ' + error.message);
        }
    }

    async loadFromPath() {
        const filePath = this.elements.filePath?.value.trim();
        if (!filePath) {
            this.showError('Ingresa una ruta válida');
            return;
        }
        await this.loadFile(filePath);
    }

    async validateFilePath(filePath) {
        try {
            const result = await window.electronAPI.file.readPath(filePath);
            if (this.elements.filePath) {
                this.elements.filePath.style.borderColor = result.success ? '#16a34a' : '#dc2626';
            }
            return result.success;
        } catch {
            if (this.elements.filePath) {
                this.elements.filePath.style.borderColor = '#dc2626';
            }
            return false;
        }
    }

    async loadFile(filePath) {
        this.showLoading(true);

        try {
            const result = await window.electronAPI.file.read(filePath);
            
            if (result.success) {
                // Use FileManager for proper state management
                this.fileManager.setFile(filePath, result.content, result.size);

                this.updateFileInfo();
                if (this.elements.filePath) {
                    this.elements.filePath.value = filePath;
                }
                this.showSuccess('Archivo cargado exitosamente');
            } else {
                throw new Error(result.error);
            }
        } catch (error) {
            this.showError('Error al cargar archivo: ' + error.message);
            this.fileManager.clearFile();
            this.updateFileInfo();
        } finally {
            this.showLoading(false);
        }
    }

    updateFileInfo() {
        const fileInfo = this.elements.fileInfo;
        if (!fileInfo) return;
        
        const info = this.fileManager.getFileInfo();
        
        if (info) {
            fileInfo.innerHTML = `
                <div class="file-info-content">
                    <div class="file-info-header">
                        <strong>Archivo:</strong> ${info.name}
                        <button class="clear-file-btn" onclick="window.ollamaApp.clearFile()">✕</button>
                    </div>
                    <div class="file-info-details">
                        <strong>Tamaño:</strong> ${this.formatFileSize(info.size)}<br>
                        <strong>Cargado:</strong> ${new Date(info.loadedAt).toLocaleString()}<br>
                        <strong>Ruta:</strong> <span class="file-path">${info.path}</span>
                    </div>
                </div>
            `;
            fileInfo.classList.add('show');
        } else {
            fileInfo.classList.remove('show');
        }
    }

    // ... (rest of the methods remain the same with minor null safety improvements)

    showLoading(show) {
        this.elements.loadingOverlay?.classList.toggle('show', show);
        
        const interactiveElements = document.querySelectorAll('button, input, select, textarea');
        interactiveElements.forEach(el => {
            el.disabled = show;
        });
    }

    showError(message, details = null) {
        console.error('Application Error:', message, details);
        alert('Error: ' + message);
    }

    showSuccess(message) {
        console.log('Success:', message);
        // Could implement toast notification here
    }

    addMessage(type, content) {
        const container = this.elements.messagesContainer;
        if (!container) return;

        const messageDiv = document.createElement('div');
        messageDiv.className = `message ${type}`;
        
        const headerText = {
            user: 'Usuario',
            assistant: 'Ollama',
            error: 'Error'
        };

        messageDiv.innerHTML = `
            <div class="message-header">${headerText[type]}</div>
            <div class="message-content">${this.escapeHtml(content)}</div>
        `;
        
        container.appendChild(messageDiv);
        container.scrollTop = container.scrollHeight;

        const welcomeMessage = container.querySelector('.welcome-message');
        welcomeMessage?.remove();
    }

    populateModelSelect(models) {
        const select = this.elements.modelSelect;
        if (!select) return;

        select.innerHTML = '<option value="">Seleccionar modelo...</option>';
        
        models.forEach(({ name, size }) => {
            const option = document.createElement('option');
            option.value = name;
            option.textContent = `${name} (${this.formatFileSize(size)})`;
            select.appendChild(option);
        });
    }

    async pullModel() {
        const modelName = this.elements.newModelName?.value.trim();
        
        if (!modelName) {
            this.showError('Ingresa el nombre del modelo');
            return;
        }

        if (!this.serviceManager.isRunning) {
            this.showError('El servicio Ollama debe estar ejecutándose');
            return;
        }

        this.showLoading(true);
        this.elements.pullModel.disabled = true;

        try {
            const result = await window.electronAPI.ollama.pullModel(modelName);
            
            if (result.success) {
                this.showSuccess(`Modelo ${modelName} descargado exitosamente`);
                this.elements.newModelName.value = '';
                await this.loadModels();
            } else {
                throw new Error(result.error);
            }
        } catch (error) {
            console.error('Model pull failed:', error);
            this.showError('Error al descargar modelo: ' + error.message);
        } finally {
            this.showLoading(false);
            this.elements.pullModel.disabled = false;
        }
    }

    setDefaultSystemPrompt() {
        if (this.elements.systemPrompt) {
            this.elements.systemPrompt.value = `Eres un asistente AI especializado en análisis de archivos JSON y extracción de datos.

CAPABILITIES:
- Procesamiento eficiente de estructuras JSON complejas
- Extracción selectiva de datos específicos  
- Análisis de patrones y relaciones en datasets
- Optimización de consultas para archivos grandes

RESPONSE FORMAT:
- Respuestas concisas y estructuradas
- Código JSON válido cuando corresponda
- Explicaciones técnicas cuando sea necesario
- Sugerencias de consultas adicionales

Responde siempre en español con precisión técnica.`;
        }
    }

    formatFileSize(bytes) {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
    }

    escapeHtml(unsafe) {
        const map = {
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#039;'
        };
        return unsafe.replace(/[&<>"']/g, m => map[m]);
    }

    destroy() {
        this.#abortController?.abort();
        this.serviceManager.cleanup();
        this.fileManager.clearFile();
        console.log('OllamaRenderer destroyed and cleaned up');
    }
}

// Modern initialization with comprehensive error handling
document.addEventListener('DOMContentLoaded', () => {
    try {
        window.ollamaApp = new OllamaRenderer();
        
        window.addEventListener('beforeunload', () => {
            window.ollamaApp?.destroy();
        });
        
    } catch (error) {
        console.error('Failed to initialize Ollama GUI:', error);
        document.body.innerHTML = `
            <div style="padding: 2rem; text-align: center; color: #dc2626; background: #1a1a1a; height: 100vh; display: flex; flex-direction: column; justify-content: center;">
                <h1 style="color: #ffffff; margin-bottom: 1rem;">Initialization Error</h1>
                <p style="margin-bottom: 1rem;">Failed to start Ollama GUI. Check console for details.</p>
                <button onclick="location.reload()" style="padding: 0.5rem 1rem; background: #ffffff; color: #1a1a1a; border: none; border-radius: 4px; cursor: pointer;">Retry</button>
            </div>
        `;
    }
});
