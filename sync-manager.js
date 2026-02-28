/**
 * SYNC MANAGER - Sincronização de dados em tempo real
 * Suporta: PC ↔ Mobile, Offline → Online, IndexedDB, localStorage
 */

class SyncManager {
    constructor() {
        this.dbName = 'ChamarizDB';
        this.storeName = 'audioData';
        this.db = null;
        this.isSyncing = false;
        this.syncInterval = null;
        this.listeners = [];
        this.channel = null;
        
        // Promise de inicialização para evitar condição de corrida
        this.ready = this.init();
    }

    /**
     * Inicializar IndexedDB
     */
    async init() {
        try {
            this.db = await this.openIndexedDB();
            console.log('✓ IndexedDB inicializado');
            
            await this.migrateFromLocalStorage();
            this.startAutoSync();
            this.setupSyncListeners();
            return true;
        } catch (error) {
            console.error('Erro ao inicializar SyncManager:', error);
            return false;
        }
    }

    /**
     * Abrir/Criar IndexedDB
     */
    openIndexedDB() {
        return new Promise((resolve, reject) => {
            try {
                if (!window.indexedDB) {
                    return reject(new Error('IndexedDB não suportado'));
                }

                const request = indexedDB.open(this.dbName, 1);

                request.onerror = () => reject(request.error);
                request.onsuccess = () => resolve(request.result);

                request.onupgradeneeded = (event) => {
                    const db = event.target.result;
                    if (!db.objectStoreNames.contains(this.storeName)) {
                        const store = db.createObjectStore(this.storeName, { keyPath: 'id' });
                        store.createIndex('timestamp', 'timestamp', { unique: false });
                        store.createIndex('hash', 'hash', { unique: false });
                    }
                };
            } catch (error) {
                reject(error);
            }
        });
    }

    /**
     * Migrar dados do localStorage para IndexedDB
     */
    async migrateFromLocalStorage() {
        try {
            const savedData = localStorage.getItem('audioData');
            if (savedData) {
                const audioData = JSON.parse(savedData);
                const hash = this.generateHash(audioData);
                
                await this.saveToIndexedDB({
                    id: 'audioData',
                    data: audioData,
                    timestamp: Date.now(),
                    hash: hash,
                    source: 'localStorage'
                });
                
                console.log('✓ Dados migrados do localStorage');
            }
        } catch (error) {
            console.error('Erro ao migrar dados:', error);
        }
    }

    /**
     * Salvar dados no IndexedDB
     */
    saveToIndexedDB(data) {
        return new Promise((resolve, reject) => {
            if (!this.db) return reject(new Error('DB não inicializado'));

            try {
                const transaction = this.db.transaction([this.storeName], 'readwrite');
                const store = transaction.objectStore(this.storeName);
                const request = store.put(data);

                request.onerror = () => reject(request.error);
                request.onsuccess = () => resolve(request.result);
            } catch (error) {
                reject(error);
            }
        });
    }

    /**
     * Carregar dados do IndexedDB
     */
    loadFromIndexedDB(key) {
        return new Promise((resolve, reject) => {
            if (!this.db) return reject(new Error('DB não inicializado'));

            try {
                const transaction = this.db.transaction([this.storeName], 'readonly');
                const store = transaction.objectStore(this.storeName);
                const request = store.get(key);

                request.onerror = () => reject(request.error);
                request.onsuccess = () => resolve(request.result);
            } catch (error) {
                reject(error);
            }
        });
    }

    /**
     * Obter todos os áudios sincronizados
     */
    async getAllAudios() {
        // Aguardar inicialização
        await this.ready;

        try {
            let dbData = null;
            let localData = null;

            try {
                dbData = await this.loadFromIndexedDB('audioData');
            } catch (error) {
                console.warn('⚠ Erro ao carregar IndexedDB:', error);
            }

            try {
                const localDataStr = localStorage.getItem('audioData');
                if (localDataStr) {
                    localData = JSON.parse(localDataStr);
                }
            } catch (error) {
                console.warn('⚠ Erro ao carregar localStorage:', error);
            }

            if (!dbData && !localData) {
                return { defaultAudios: [], customAudios: [] };
            }

            if (dbData && localData) {
                const dbTimestamp = dbData.timestamp || 0;
                const localTimestamp = localData.timestamp || 0;
                return dbTimestamp >= localTimestamp ? dbData.data : localData;
            }

            return dbData ? dbData.data : localData;
        } catch (error) {
            console.error('Erro ao carregar áudios:', error);
            return { defaultAudios: [], customAudios: [] };
        }
    }

    /**
     * Salvar áudios sincronizados
     */
    async saveAudios(audioData) {
        // Aguardar inicialização
        await this.ready;

        try {
            const hash = this.generateHash(audioData);
            const timestamp = Date.now();

            // Salvar no IndexedDB
            if (this.db) {
                try {
                    await this.saveToIndexedDB({
                        id: 'audioData',
                        data: audioData,
                        timestamp: timestamp,
                        hash: hash,
                        source: 'app',
                        deviceId: this.getDeviceId()
                    });
                } catch (error) {
                    console.warn('⚠ Erro ao salvar em IndexedDB:', error);
                }
            }

            // Salvar também no localStorage (apenas se for pequeno, para evitar QuotaExceededError)
            try {
                const json = JSON.stringify(audioData);
                if (json.length < 4000000) { // Limite seguro ~4MB
                    localStorage.setItem('audioData', json);
                } else {
                    console.warn('⚠ Dados muito grandes para localStorage, salvando apenas no IndexedDB.');
                    // Salvar um placeholder ou versão leve se possível, ou apenas remover o antigo para evitar inconsistência
                    localStorage.removeItem('audioData'); 
                }
                localStorage.setItem('audioData_timestamp', timestamp.toString());
            } catch (e) {
                console.warn('⚠ Erro ao salvar no localStorage (QuotaExceeded?):', e);
            }

            this.notifyListeners({
                type: 'save',
                data: audioData,
                timestamp: timestamp
            });

            return true;
        } catch (error) {
            console.error('Erro ao salvar áudios:', error);
            return false;
        }
    }

    /**
     * Sincronizar dados entre abas/dispositivos
     */
    async syncData() {
        if (this.isSyncing) return;
        
        this.isSyncing = true;
        try {
            const localData = await this.getAllAudios();
            const currentHash = this.generateHash(localData);

            let dbData = null;
            try {
                dbData = await this.loadFromIndexedDB('audioData');
            } catch (error) {
                console.warn('⚠ Erro ao carregar DB:', error);
            }
            
            if (dbData && dbData.hash !== currentHash) {
                if (dbData.timestamp > (localData.timestamp || 0)) {
            // Tentar salvar no localStorage se possível
            try {
                const json = JSON.stringify(dbData.data);
                if (json.length < 4000000) {
                    localStorage.setItem('audioData', json);
                } else {
                    localStorage.removeItem('audioData');
                }
            } catch (e) {
                console.warn('Sync: Erro ao salvar localStorage', e);
            }
                    
                    this.notifyListeners({
                        type: 'sync',
                        data: dbData.data,
                        timestamp: dbData.timestamp,
                        fromDevice: dbData.deviceId
                    });

                    return dbData.data;
                }
            }

            return localData;
        } catch (error) {
            console.error('Erro ao sincronizar dados:', error);
            return null;
        } finally {
            this.isSyncing = false;
        }
    }

    /**
     * Iniciar sincronização automática
     */
    startAutoSync() {
        this.syncInterval = setInterval(() => {
            this.syncData().catch(error => {
                console.warn('⚠ Erro na sincronização automática:', error);
            });
        }, 5000);

        window.addEventListener('focus', () => {
            this.syncData().catch(error => {
                console.warn('⚠ Erro ao sincronizar ao focar:', error);
            });
        });
        
        window.addEventListener('online', () => {
            console.log('✓ Online detectado - sincronizando dados');
            this.syncData().catch(error => {
                console.warn('⚠ Erro ao sincronizar online:', error);
            });
        });
    }

    /**
     * Parar sincronização automática
     */
    stopAutoSync() {
        if (this.syncInterval) {
            clearInterval(this.syncInterval);
            this.syncInterval = null;
        }
    }

    /**
     * Escutar mudanças em outras abas
     */
    setupSyncListeners() {
        // StorageEvent - detecta mudanças em outras abas
        window.addEventListener('storage', (event) => {
            if (event.key === 'audioData' && event.newValue) {
                try {
                    const newData = JSON.parse(event.newValue);
                    this.notifyListeners({
                        type: 'external_change',
                        data: newData,
                        source: 'other_tab'
                    });
                } catch (error) {
                    console.error('Erro ao processar mudança de aba:', error);
                }
            }
        });

        // BroadcastChannel API - melhor para PWAs (com tratamento de erro)
        if (typeof BroadcastChannel !== 'undefined') {
            try {
                this.channel = new BroadcastChannel('chamariz_sync');
                
                this.channel.onmessage = (event) => {
                    console.log('✓ Mensagem de sincronização recebida:', event.data);
                    this.notifyListeners({
                        type: 'broadcast',
                        ...event.data
                    });
                };

                this.channel.onerror = (error) => {
                    console.warn('⚠ Erro no BroadcastChannel:', error);
                };
            } catch (error) {
                console.warn('⚠ BroadcastChannel não disponível:', error);
            }
        }
    }

    /**
     * Transmitir mudanças para outras abas
     */
    broadcastChange(audioData) {
        if (this.channel) {
            try {
                this.channel.postMessage({
                    type: 'audio_update',
                    data: audioData,
                    timestamp: Date.now(),
                    deviceId: this.getDeviceId()
                });
            } catch (error) {
                console.warn('⚠ Erro ao fazer broadcast:', error);
            }
        }

        localStorage.setItem('audioData_broadcast', Date.now().toString());
    }

    /**
     * Adicionar listener para mudanças
     */
    onDataChange(callback) {
        this.listeners.push(callback);
        return () => {
            this.listeners = this.listeners.filter(l => l !== callback);
        };
    }

    /**
     * Notificar listeners
     */
    notifyListeners(event) {
        this.listeners.forEach(callback => {
            try {
                callback(event);
            } catch (error) {
                console.error('Erro no listener:', error);
            }
        });
    }

    /**
     * Gerar hash para detecção de mudanças
     */
    generateHash(data) {
        try {
            return JSON.stringify(data)
                .split('')
                .reduce((hash, char) => {
                    return ((hash << 5) - hash) + char.charCodeAt(0);
                }, 0)
                .toString(36);
        } catch (error) {
            console.warn('⚠ Erro ao gerar hash:', error);
            return '';
        }
    }

    /**
     * Obter ID único do dispositivo
     */
    getDeviceId() {
        try {
            let deviceId = localStorage.getItem('deviceId');
            if (!deviceId) {
                deviceId = 'device_' + Math.random().toString(36).substr(2, 9);
                localStorage.setItem('deviceId', deviceId);
            }
            return deviceId;
        } catch (error) {
            console.warn('⚠ Erro ao obter device ID:', error);
            return 'device_unknown';
        }
    }

    /**
     * Limpar todos os dados
     */
    async clearAll() {
        return new Promise((resolve, reject) => {
            if (!this.db) return reject(new Error('DB não inicializado'));

            try {
                const transaction = this.db.transaction([this.storeName], 'readwrite');
                const store = transaction.objectStore(this.storeName);
                const request = store.clear();

                request.onerror = () => reject(request.error);
                request.onsuccess = () => {
                    localStorage.removeItem('audioData');
                    resolve();
                };
            } catch (error) {
                reject(error);
            }
        });
    }
}

// Criar instância global com tratamento de erro
try {
    window.syncManager = new SyncManager();
} catch (error) {
    console.error('Erro ao criar SyncManager:', error);
}
