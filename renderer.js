/**
 * Ollama GUI Renderer - Enhanced with Think Mode & Stop Functionality
 * 
 * New Features:
 * - Think Mode toggle: Controls /no_think prefix injection
 * - Stop generation: Ability to cancel ongoing requests
 * - Enter to send: Improved keyboard UX
 * - Non-blocking UI: Processing indicator instead of full overlay
 * - Real-time feedback: Visual states for different modes
 */

class ThinkModeManager {
    constructor() {
        this.isEnabled = true; // Default to enabled (Think Mode ON)
        this.checkbox = null;
        this.description = null;
    }

    initialize(checkboxElement, descriptionElement) {
        this.checkbox = checkboxElement;
        this.description = descriptionElement;
        
        if (this.checkbox) {
            this.checkbox.checked = this.isEnabled;
            this.checkbox.addEventListener('change', () => {
                this.toggle();
            });
        }
        
        this.updateDescription();
    }

    toggle() {
        this.isEnabled = this.checkbox?.checked ?? true;
        this.updateDescription();
        
        // Visual feedback
        const inputArea = document.querySelector('.input-area');
        if (inputArea) {
            inputArea.classList.toggle('think-mode-active', this.isEnabled);
            inputArea.classList.toggle('think-mode-disabled', !this.isEnabled);
        }
        
        console.log(`🧠 Think Mode: ${this.isEnabled ? 'ENABLED' : 'DISABLED'}`);
    }

    updateDescription() {
        if (this.description) {
            this.description.textContent = this.isEnabled 
                ? 'Modo de razonamiento activado (respuestas más detalladas)'
                : 'Se agregará /no_think automáticamente (respuestas más directas)';
        }
    }

    processMessage(userMessage) {
        if (!userMessage || typeof userMessage !== 'string') {
            return userMessage;
        }

        // If Think Mode is disabled, prepend /no_think
        if (!this.isEnabled && !userMessage.trim().startsWith('/no_think')) {
            return `/no_think ${userMessage}`;
        }

        return userMessage;
    }

    getMessageType() {
        return this.isEnabled ? 'normal' : 'no-think';
    }
}

class ProcessingManager {
    constructor() {
        this.isProcessing = false;
        this.currentRequest = null;
        this.indicator = null;
        this.text = null;
        this.stopButton = null;
    }

    initialize(indicatorElement, textElement, stopButtonElement) {
        this.indicator = indicatorElement;
        this.text = textElement;
        this.stopButton = stopButtonElement;
        
        if (this.stopButton) {
            this.stopButton.addEventListener('click', () => {
                this.stop();
            });
        }
    }

    start(message = 'Generando respuesta...') {
        this.isProcessing = true;
        
        if (this.text) {
            this.text.textContent = message;
        }
        
        if (this.indicator) {
            this.indicator.classList.add('show');
        }
        
        // Add processing class to body for global state management
        document.body.classList.add('processing');
        
        console.log(`⏳ Processing started: ${message}`);
    }

    updateMessage(message) {
        if (this.text) {
            this.text.textContent = message;
        }
    }

    stop() {
        this.isProcessing = false;
        
        if (this.indicator) {
            this.indicator.classList.remove('show');
        }
        
        document.body.classList.remove('processing');
        
        // Cancel current request if exists
        if (this.currentRequest && typeof this.currentRequest.abort === 'function') {
            this.currentRequest.abort();
            console.log('🛑 Request cancelled by user');
        }
        
        console.log('✅ Processing stopped');
    }

    setRequest(request) {
        this.currentRequest = request;
    }
}

class LoadingManager {
    constructor() {
        this.loadingOverlay = null;
        this.loadingText = null;
    }

    initialize(overlayElement) {
        this.loadingOverlay = overlayElement;
        this.loadingText = overlayElement?.querySelector('p');
    }

    show(message = 'Cargando...') {
        if (this.loadingText) {
            this.loadingText.textContent = message;
        }
        
        if (this.loadingOverlay) {
            this.loadingOverlay.classList.add('show');
        }
    }

    hide() {
        if (this.loadingOverlay) {
            this.loadingOverlay.classList.remove('show');
        }
    }
}

class FileManager {
    constructor() {
        this.currentFile = null;
        this.maxPreviewSize = 4096;
        this.supportedTypes = new Set(['.json', '.txt', '.md', '.csv', '.xml']);
    }

    generateFilePreview(content) {
        if (!content || typeof content !== 'string') {
            console.warn('Invalid content provided to generateFilePreview:', typeof content);
            return '';
        }

        if (content.length === 0) return '';

        if (this.isJSONContent(content)) {
            try {
                const parsed = JSON.parse(content);
                const serialized = JSON.stringify(parsed, null, 2);
                
                if (serialized.length <= this.maxPreviewSize) {
                    return serialized;
                }
                
                return JSON.stringify(this.createStructuralPreview(parsed), null, 2);
            } catch (parseError) {
                console.warn('JSON parsing failed, using text preview:', parseError.message);
                return this.createTextPreview(content);
            }
        }

        return this.createTextPreview(content);
    }

    isJSONContent(content) {
        if (!content || typeof content !== 'string') return false;
        
        const trimmed = content.trim();
        return (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
               (trimmed.startsWith('[') && trimmed.endsWith(']'));
    }

    createTextPreview(content) {
        if (!content || typeof content !== 'string') return '';
        
        if (content.length <= this.maxPreviewSize) {
            return content;
        }
        
        const truncated = content.substring(0, this.maxPreviewSize);
        const lastSpace = truncated.lastIndexOf(' ');
        
        if (lastSpace > this.maxPreviewSize * 0.8) {
            return truncated.substring(0, lastSpace) + '...';
        }
        
        return truncated + '...';
    }

    createStructuralPreview(obj, visited = new WeakSet(), depth = 0, maxDepth = 3) {
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
            return preview;
        }

        if (typeof obj === 'object' && obj !== null) {
            const keys = Object.keys(obj);
            const preview = {};
            
            keys.slice(0, 5).forEach(key => {
                preview[key] = this.createStructuralPreview(obj[key], visited, depth + 1, maxDepth);
            });

            if (keys.length > 5) {
                preview[`...(${keys.length - 5} more properties)`] = '[...]';
            }

            return preview;
        }

        return obj;
    }

    setFile(filePath, content, size) {
        this.currentFile = {
            path: filePath,
            content: content,
            size: size,
            preview: this.generateFilePreview(content),
            loadedAt: new Date().toISOString(),
            type: this.getFileType(filePath)
        };
    }

    clearFile() {
        if (this.currentFile) {
            this.currentFile.content = null;
            this.currentFile.preview = null;
        }
        this.currentFile = null;
    }

    getFileType(filePath) {
        const ext = path.extname ? path.extname(filePath).toLowerCase() : 
                   filePath.substring(filePath.lastIndexOf('.')).toLowerCase();
        return this.supportedTypes.has(ext) ? ext : '.txt';
    }

    getFileInfo() {
        if (!this.currentFile) return null;
        
        return {
            name: this.currentFile.path.split('/').pop(),
            size: this.currentFile.size,
            path: this.currentFile.path,
            loadedAt: this.currentFile.loadedAt,
            type: this.currentFile.type
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
        this.eventCleanups = [];
        
        this.setupEventListeners();
    }

    setupEventListeners() {
        const statusCleanup = window.electronAPI.service.onStatusChanged((isRunning) => {
            this.updateServiceStatus(isRunning);
        });
        
        const ramCleanup = window.electronAPI.service.onRamUsageChanged((ramMB) => {
            this.updateRamUsage(ramMB);
        });
        
        const errorCleanup = window.electronAPI.service.onServiceError((error) => {
            this.showServiceNotification(`Service Error: ${error}`, 'error');
        });
        
        this.eventCleanups.push(statusCleanup, ramCleanup, errorCleanup);
        window.addEventListener('beforeunload', () => this.cleanup());
    }

    cleanup() {
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
            console.error('Failed to check service status:', error);
            this.updateServiceStatus(false);
        }
    }

    async startService() {
        if (this.isRunning) return;

        this.updateServiceStatus('starting');
        this.showServiceNotification('🚀 Iniciando servicio Ollama...', 'info');

        try {
            const result = await window.electronAPI.service.start();
            if (result.success) {
                this.showServiceNotification('✅ Servicio iniciado correctamente', 'success');
            } else {
                throw new Error(result.error);
            }
        } catch (error) {
            console.error('Service start failed:', error);
            this.showServiceNotification(`❌ Error: ${error.message}`, 'error');
            this.updateServiceStatus(false);
        }
    }

    async stopService() {
        if (!this.isRunning) return;

        const confirmStop = confirm('¿Detener Ollama? Esto interrumpirá operaciones activas.');
        if (!confirmStop) return;

        this.updateServiceStatus('stopping');
        this.showServiceNotification('⏹️ Deteniendo servicio...', 'info');

        try {
            const result = await window.electronAPI.service.stop();
            if (result.success) {
                this.showServiceNotification('✅ Servicio detenido', 'success');
                this.updateRamUsage(0);
            } else {
                throw new Error(result.error);
            }
        } catch (error) {
            console.error('Service stop failed:', error);
            this.showServiceNotification(`❌ Error: ${error.message}`, 'error');
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
                this.ramElement.textContent = `${(ramMB / 1024).toFixed(1)} GB`;
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
        
        // Enhanced managers
        this.fileManager = new FileManager();
        this.serviceManager = new ServiceManager();
        this.loadingManager = new LoadingManager();
        this.thinkModeManager = new ThinkModeManager();
        this.processingManager = new ProcessingManager();
        
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
            
            // Think Mode
            thinkMode: '#thinkMode',
            thinkModeDescription: '.think-mode-description',
            
            // File management
            systemPrompt: '#systemPrompt',
            selectFile: '#selectFile',
            filePath: '#filePath',
            loadFromPath: '#loadFromPath',
            fileInfo: '#fileInfo',
            
            // Chat interface
            messagesContainer: '#messagesContainer',
            messageInput: '#messageInput',
            sendMessage: '#sendMessage',
            
            // Processing
            processingIndicator: '#processingIndicator',
            processingText: '#processingText',
            stopGeneration: '#stopGeneration',
            
            // Loading
            loadingOverlay: '#loadingOverlay'
        };
        
        Object.entries(elementSelectors).forEach(([key, selector]) => {
            const element = document.querySelector(selector);
            if (element) {
                this.elements[key] = element;
            } else if (!['thinkModeDescription'].includes(key)) {
                console.warn(`Element not found: ${selector}`);
            }
        });

        // Initialize managers
        this.serviceManager.initialize(this.elements);
        this.loadingManager.initialize(this.elements.loadingOverlay);
        this.thinkModeManager.initialize(this.elements.thinkMode, this.elements.thinkModeDescription);
        this.processingManager.initialize(
            this.elements.processingIndicator, 
            this.elements.processingText, 
            this.elements.stopGeneration
        );
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
            
            // Chat
            [this.elements.sendMessage, 'click', () => this.sendMessage()],
            [this.elements.messageInput, 'keydown', this.handleKeyboardShortcuts.bind(this)]
        ];

        eventBindings.forEach(([element, event, handler]) => {
            if (element) {
                element.addEventListener(event, handler, { signal });
            }
        });

        // Enhanced keyboard handling for message input
        this.elements.messageInput?.addEventListener('keydown', (event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                this.sendMessage();
            }
        }, { signal });

        // Auto-resize message input
        this.elements.messageInput?.addEventListener('input', (event) => {
            const textarea = event.target;
            textarea.style.height = 'auto';
            textarea.style.height = Math.min(textarea.scrollHeight, 150) + 'px';
        }, { signal });

        // File path validation
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
            case key === 'Enter' && !shiftKey:
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
            case isCtrlOrCmd && key === 't':
                event.preventDefault();
                this.thinkModeManager.toggle();
                break;
            case isCtrlOrCmd && shiftKey && key === 'S':
                event.preventDefault();
                if (this.serviceManager.isRunning) {
                    this.serviceManager.stopService();
                } else {
                    this.serviceManager.startService();
                }
                break;
            case key === 'Escape':
                event.preventDefault();
                if (this.processingManager.isProcessing) {
                    this.processingManager.stop();
                }
                break;
        }
    }

    async initializeApp() {
        try {
            this.loadingManager.show('Inicializando aplicación...');
            
            const initPromises = [
                this.loadModels(),
                this.setDefaultSystemPrompt()
            ];
            
            await Promise.allSettled(initPromises);
            
        } catch (error) {
            console.error('App initialization failed:', error);
            this.showError('Error durante la inicialización');
        } finally {
            this.loadingManager.hide();
        }
    }

    async loadModels(retryCount = 0) {
        const maxRetries = 3;
        
        if (!this.serviceManager.isRunning) {
            this.showError('Servicio Ollama no ejecutándose. Inicialo primero.');
            return [];
        }

        this.loadingManager.show('Cargando modelos disponibles...');
        
        try {
            const result = await window.electronAPI.ollama.getModels();
            
            if (result.success) {
                this.populateModelSelect(result.models);
                console.log(`✅ Loaded ${result.models.length} models`);
                return result.models;
            } else {
                throw new Error(result.error);
            }
        } catch (error) {
            console.error(`Model loading attempt ${retryCount + 1} failed:`, error);
            
            if (retryCount < maxRetries) {
                const delay = 1000 * Math.pow(2, retryCount);
                this.loadingManager.show(`Reintentando en ${delay/1000}s...`);
                
                await new Promise(resolve => setTimeout(resolve, delay));
                return this.loadModels(retryCount + 1);
            } else {
                this.showError(`Error cargando modelos tras ${maxRetries + 1} intentos`);
                return [];
            }
        } finally {
            this.loadingManager.hide();
        }
    }

    async sendMessage() {
        const message = this.elements.messageInput?.value.trim();
        
        if (!message) {
            this.showError('Ingresa un mensaje');
            return;
        }

        if (!this.serviceManager.isRunning) {
            this.showError('Servicio Ollama no ejecutándose');
            return;
        }

        if (!this.currentModel) {
            this.showError('Selecciona un modelo primero');
            return;
        }

        // Process message through Think Mode manager
        const processedMessage = this.thinkModeManager.processMessage(message);
        const messageType = this.thinkModeManager.getMessageType();
        
        // Add user message to UI with type indication
        this.addMessage('user', message, messageType);
        this.elements.messageInput.value = '';
        
        // Reset textarea height
        this.elements.messageInput.style.height = 'auto';
        
        // Start processing with specific model info
        this.processingManager.start(`Generando respuesta con ${this.currentModel}...`);

        try {
            const chatParams = {
                model: this.currentModel,
                systemPrompt: this.elements.systemPrompt?.value.trim(),
                messages: [{ role: 'user', content: processedMessage }],
                fileContent: this.fileManager.currentFile?.preview ?? null
            };

            // Create AbortController for this specific request
            const requestController = new AbortController();
            this.processingManager.setRequest(requestController);

            const result = await window.electronAPI.ollama.chat(chatParams);
            
            if (result.success) {
                this.addMessage('assistant', result.response);
                this.conversationHistory.push(
                    { role: 'user', content: processedMessage },
                    { role: 'assistant', content: result.response }
                );
            } else {
                throw new Error(result.error);
            }
        } catch (error) {
            console.error('Chat failed:', error);
            this.addMessage('error', 'Error: ' + error.message);
        } finally {
            this.processingManager.stop();
        }
    }

    async pullModel() {
        const modelName = this.elements.newModelName?.value.trim();
        
        if (!modelName) {
            this.showError('Ingresa nombre del modelo');
            return;
        }

        if (!this.serviceManager.isRunning) {
            this.showError('Servicio Ollama debe estar ejecutándose');
            return;
        }

        this.processingManager.start(`Descargando ${modelName}...`);

        try {
            const result = await window.electronAPI.ollama.pullModel(modelName);
            
            if (result.success) {
                this.showSuccess(`✅ Modelo ${modelName} descargado`);
                this.elements.newModelName.value = '';
                await this.loadModels();
            } else {
                throw new Error(result.error);
            }
        } catch (error) {
            console.error('Model pull failed:', error);
            this.showError(`Error descargando: ${error.message}`);
        } finally {
            this.processingManager.stop();
        }
    }

    clearFile() {
        this.fileManager.clearFile();
        this.updateFileInfo();
        
        if (this.elements.filePath) {
            this.elements.filePath.value = '';
            this.elements.filePath.style.borderColor = '';
        }
        
        this.showSuccess('📁 Archivo eliminado de la sesión');
    }

    clearConversation() {
        this.conversationHistory = [];
        const container = this.elements.messagesContainer;
        if (container) {
            container.innerHTML = `
                <div class="welcome-message">
                    <h3>💬 Conversación limpiada</h3>
                    <p>Listo para nueva consulta</p>
                    <p><strong>Think Mode:</strong> ${this.thinkModeManager.isEnabled ? 'Activado' : 'Desactivado'}</p>
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
            this.showError('Error seleccionando archivo: ' + error.message);
        }
    }

    async loadFromPath() {
        const filePath = this.elements.filePath?.value.trim();
        if (!filePath) {
            this.showError('Ingresa ruta válida');
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
        this.processingManager.start('Procesando archivo...');

        try {
            const result = await window.electronAPI.file.read(filePath);
            
            if (result.success) {
                this.fileManager.setFile(filePath, result.content, result.size);
                this.updateFileInfo();
                
                if (this.elements.filePath) {
                    this.elements.filePath.value = filePath;
                }
                
                this.showSuccess(`✅ Archivo cargado: ${this.formatFileSize(result.size)}`);
            } else {
                throw new Error(result.error);
            }
        } catch (error) {
            this.showError('Error cargando archivo: ' + error.message);
            this.fileManager.clearFile();
            this.updateFileInfo();
        } finally {
            this.processingManager.stop();
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
                        <strong>📁 ${info.name}</strong>
                        <button class="clear-file-btn" onclick="window.ollamaApp.clearFile()" title="Quitar archivo">✕</button>
                    </div>
                    <div class="file-info-details">
                        <strong>Tamaño:</strong> ${this.formatFileSize(info.size)}<br>
                        <strong>Tipo:</strong> ${info.type}<br>
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

    showError(message, details = null) {
        console.error('❌ Error:', message, details);
        alert('Error: ' + message);
    }

    showSuccess(message) {
        console.log('✅ Success:', message);
        // Could implement toast notification
    }

    addMessage(type, content, messageType = 'normal') {
        const container = this.elements.messagesContainer;
        if (!container) return;

        const messageDiv = document.createElement('div');
        messageDiv.className = `message ${type}`;
        
        // Add special class for no-think messages
        if (type === 'user' && messageType === 'no-think') {
            messageDiv.classList.add('no-think');
        }
        
        const headerText = {
            user: '👤 Usuario',
            assistant: '🤖 Ollama',
            error: '❌ Error'
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
        this.processingManager.stop();
        console.log('🧹 OllamaRenderer destroyed and cleaned up');
    }
}

// Initialize application
document.addEventListener('DOMContentLoaded', () => {
    try {
        window.ollamaApp = new OllamaRenderer();
        
        window.addEventListener('beforeunload', () => {
            window.ollamaApp?.destroy();
        });
        
        console.log('🚀 Ollama GUI initialized successfully with Think Mode');
        
    } catch (error) {
        console.error('💥 Failed to initialize Ollama GUI:', error);
        document.body.innerHTML = `
            <div style="padding: 2rem; text-align: center; color: #dc2626; background: #1a1a1a; height: 100vh; display: flex; flex-direction: column; justify-content: center;">
                <h1 style="color: #ffffff; margin-bottom: 1rem;">❌ Error de Inicialización</h1>
                <p style="margin-bottom: 1rem;">Error al iniciar Ollama GUI. Revisa la consola.</p>
                <button onclick="location.reload()" style="padding: 0.5rem 1rem; background: #ffffff; color: #1a1a1a; border: none; border-radius: 4px; cursor: pointer;">🔄 Reintentar</button>
            </div>
        `;
    }
});
