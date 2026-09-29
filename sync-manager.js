/**
 * SYNC MANAGER - Sincronização de dados em tempo real (Firebase Cloud + IndexedDB Local)
 * Projeto Firebase: sisweb-chamariz
 * Documento Firestore Principal: /chamariz/audioData
 */

class SyncManager {
    constructor() {
        this.dbName = 'ChamarizDB';
        this.storeName = 'audioData';
        this.db = null;
        this.isSyncing = false;
        this.listeners = [];
        this.unsubscribeFirestoreDoc = null;
        this.unsubscribeFirestoreColl = null;
        
        // Promise de inicialização
        this.ready = this.init();
    }

    /**
     * Inicializar IndexedDB e Firestore Realtime Listener
     */
    async init() {
        try {
            this.db = await this.openIndexedDB();
            console.log('✓ IndexedDB inicializado');
            
            await this.migrateFromLocalStorage();
            this.setupCloudSync();
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

                const request = indexedDB.open(this.dbName, 2);

                request.onerror = () => reject(request.error);
                request.onsuccess = () => resolve(request.result);

                request.onupgradeneeded = (event) => {
                    const db = event.target.result;
                    if (!db.objectStoreNames.contains(this.storeName)) {
                        const store = db.createObjectStore(this.storeName, { keyPath: 'id' });
                        store.createIndex('timestamp', 'timestamp', { unique: false });
                    }
                };
            } catch (error) {
                reject(error);
            }
        });
    }

    /**
     * Configurar sincronização com Firebase Firestore (/chamariz/audioData + /audios)
     */
    setupCloudSync() {
        if (typeof window.db === 'undefined' || !window.db || !window.isFirebaseInitialized) {
            console.log('ℹ Cloud Sync: Firebase não inicializado. Operando em modo local.');
            return;
        }

        try {
            // 1. Escutar o documento principal /chamariz/audioData no Firestore
            this.unsubscribeFirestoreDoc = window.db.collection('chamariz').doc('audioData')
                .onSnapshot(async (docSnapshot) => {
                    if (docSnapshot.exists) {
                        console.log('⚡ Atualização recebida do Firestore (/chamariz/audioData)');
                        const cloudData = docSnapshot.data();
                        const customAudiosDoc = cloudData.customAudios || cloudData.audios || [];
                        const defaultAudiosDoc = cloudData.defaultAudios || [];

                        // Carregar itens individuais da coleção 'audios' se houver
                        const collAudios = await this.fetchAudiosCollection();
                        
                        // Mesclar sem duplicatas
                        const mergedCustom = this.mergeAudioLists(customAudiosDoc, collAudios);
                        const fullData = { customAudios: mergedCustom, defaultAudios: defaultAudiosDoc };

                        await this.saveToIndexedDB({
                            id: 'audioData',
                            data: fullData,
                            timestamp: Date.now(),
                            source: 'firebase_doc'
                        });

                        this.notifyListeners({
                            type: 'cloud_sync',
                            data: fullData,
                            timestamp: Date.now()
                        });
                    } else {
                        console.log('ℹ Documento /chamariz/audioData ainda não existe no Firestore. Criando se houver dados locais...');
                    }
                }, (error) => {
                    console.warn('⚠ Erro no listener do Firestore (/chamariz/audioData):', error);
                });

            // 2. Escutar a coleção 'audios' em tempo real para novos itens adicionados individualmente
            this.unsubscribeFirestoreColl = window.db.collection('audios')
                .onSnapshot(async (snapshot) => {
                    if (!snapshot.empty) {
                        const collAudios = [];
                        snapshot.forEach(doc => collAudios.push({ id: doc.id, ...doc.data() }));

                        const currentLocal = await this.getAllAudios();
                        const mergedCustom = this.mergeAudioLists(currentLocal.customAudios || [], collAudios);
                        const fullData = { customAudios: mergedCustom, defaultAudios: currentLocal.defaultAudios || [] };

                        await this.saveToIndexedDB({
                            id: 'audioData',
                            data: fullData,
                            timestamp: Date.now(),
                            source: 'firebase_coll'
                        });

                        this.notifyListeners({
                            type: 'cloud_sync',
                            data: fullData,
                            timestamp: Date.now()
                        });
                    }
                }, (error) => {
                    console.warn('⚠ Erro no listener da coleção audios:', error);
                });

        } catch (error) {
            console.error('Erro ao configurar listeners do Firestore:', error);
        }
    }

    async fetchAudiosCollection() {
        try {
            if (!window.db || !window.isFirebaseInitialized) return [];
            const snapshot = await window.db.collection('audios').get();
            const list = [];
            snapshot.forEach(doc => list.push({ id: doc.id, ...doc.data() }));
            return list;
        } catch (e) {
            return [];
        }
    }

    mergeAudioLists(list1, list2) {
        const map = new Map();
        [...list1, ...list2].forEach(item => {
            const key = item.id || item.name;
            if (key) map.set(key, item);
        });
        return Array.from(map.values());
    }

    /**
     * Migrar dados do localStorage para IndexedDB
     */
    async migrateFromLocalStorage() {
        try {
            const savedData = localStorage.getItem('audioData');
            if (savedData) {
                const audioData = JSON.parse(savedData);
                await this.saveToIndexedDB({
                    id: 'audioData',
                    data: audioData,
                    timestamp: Date.now(),
                    source: 'localStorage'
                });
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
     * Obter todos os áudios (Local ou Firestore)
     */
    async getAllAudios() {
        await this.ready;

        try {
            let dbData = null;
            try {
                dbData = await this.loadFromIndexedDB('audioData');
            } catch (error) {
                console.warn('⚠ Erro ao carregar do IndexedDB:', error);
            }

            if (dbData && dbData.data) {
                return dbData.data;
            }

            const localDataStr = localStorage.getItem('audioData');
            if (localDataStr) {
                return JSON.parse(localDataStr);
            }

            return { defaultAudios: [], customAudios: [] };
        } catch (error) {
            console.error('Erro ao carregar áudios:', error);
            return { defaultAudios: [], customAudios: [] };
        }
    }

    /**
     * Adicionar um novo áudio no Firebase (Storage + Firestore) ou Local
     */
    async addAudio(audioName, audioFile, imageFile) {
        await this.ready;
        const id = 'audio_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5);
        const timestamp = Date.now();

        let audioUrl = '';
        let imageUrl = '';
        let audioStoragePath = '';
        let imageStoragePath = '';

        // Se o Firebase estiver ativo e configurado:
        if (typeof window.storage !== 'undefined' && window.storage && window.isFirebaseInitialized && navigator.onLine) {
            console.log('☁ Fazendo upload dos arquivos para o Firebase Storage...');
            
            // Upload do Áudio com Metadata adequado (MPEG-4, M4A, AAC, etc)
            const audioExt = audioFile.name.split('.').pop();
            audioStoragePath = `audios/${id}.${audioExt}`;
            const audioRef = window.storage.ref().child(audioStoragePath);
            const audioContentType = this.getAudioContentType(audioFile.name, audioFile.type);
            await audioRef.put(audioFile, { contentType: audioContentType });
            audioUrl = await audioRef.getDownloadURL();

            // Upload da Imagem
            const imageExt = imageFile.name.split('.').pop();
            imageStoragePath = `images/${id}.${imageExt}`;
            const imageRef = window.storage.ref().child(imageStoragePath);
            await imageRef.put(imageFile);
            imageUrl = await imageRef.getDownloadURL();

            const audioItem = {
                id,
                name: audioName,
                audioPath: audioUrl,
                imagePath: imageUrl,
                audioStoragePath,
                imageStoragePath,
                timestamp
            };

            // 1. Salvar no documento principal /chamariz/audioData
            const currentData = await this.getAllAudios();
            currentData.customAudios = currentData.customAudios || [];
            currentData.customAudios.push(audioItem);

            await window.db.collection('chamariz').doc('audioData').set(currentData, { merge: true });

            // 2. Salvar também na coleção /audios/{id}
            await window.db.collection('audios').doc(id).set(audioItem);

            await this.saveAudios(currentData);
            console.log('✓ Áudio e Imagem salvos no Firebase com sucesso!');
            return audioItem;

        } else {
            // Fallback Local (Base64)
            console.warn('⚠ Firebase offline. Salvando localmente.');
            const audioBase64 = await this.fileToBase64(audioFile);
            const imageBase64 = await this.fileToBase64(imageFile);

            const audioItem = {
                id,
                name: audioName,
                audioPath: audioBase64,
                imagePath: imageBase64,
                timestamp
            };

            const currentData = await this.getAllAudios();
            currentData.customAudios = currentData.customAudios || [];
            currentData.customAudios.push(audioItem);

            await this.saveAudios(currentData);
            this.broadcastChange(currentData);
            return audioItem;
        }
    }

    /**
     * Remover um áudio do Firebase ou Local
     */
    async removeAudio(audioIdOrName) {
        await this.ready;
        const currentData = await this.getAllAudios();
        const customAudios = currentData.customAudios || [];
        const target = customAudios.find(a => a.id === audioIdOrName || a.name === audioIdOrName);

        if (typeof window.db !== 'undefined' && window.db && window.isFirebaseInitialized && navigator.onLine) {
            console.log('☁ Deletando áudio do Firebase...');
            try {
                // Atualizar o documento principal /chamariz/audioData
                const updatedCustom = customAudios.filter(a => a.id !== audioIdOrName && a.name !== audioIdOrName);
                currentData.customAudios = updatedCustom;
                await window.db.collection('chamariz').doc('audioData').set(currentData, { merge: true });

                // Deletar da coleção /audios se existir ID
                if (target && target.id) {
                    await window.db.collection('audios').doc(target.id).delete().catch(e => {});
                }

                // Deletar arquivos do Storage se existirem
                if (target) {
                    if (target.audioStoragePath) {
                        await window.storage.ref().child(target.audioStoragePath).delete().catch(e => {});
                    }
                    if (target.imageStoragePath) {
                        await window.storage.ref().child(target.imageStoragePath).delete().catch(e => {});
                    }
                }
                console.log('✓ Removido do Firebase');
            } catch (error) {
                console.error('Erro ao deletar do Firebase:', error);
            }
        }

        // Remover do cache local
        currentData.customAudios = customAudios.filter(a => a.id !== audioIdOrName && a.name !== audioIdOrName);
        await this.saveAudios(currentData);
        this.broadcastChange(currentData);
    }

    /**
     * Atualizar um áudio existente no Firebase ou Local
     */
    async updateAudio(audioIdOrName, newName, newAudioFile = null, newImageFile = null) {
        await this.ready;
        const currentData = await this.getAllAudios();
        const customAudios = currentData.customAudios || [];
        const target = customAudios.find(a => a.id === audioIdOrName || a.name === audioIdOrName);

        if (!target) throw new Error('Áudio não encontrado');

        let audioUrl = target.audioPath;
        let imageUrl = target.imagePath;
        let audioStoragePath = target.audioStoragePath;
        let imageStoragePath = target.imageStoragePath;

        if (typeof window.db !== 'undefined' && window.db && window.isFirebaseInitialized && navigator.onLine) {
            console.log('☁ Atualizando áudio no Firebase...');

            if (newAudioFile) {
                const audioExt = newAudioFile.name.split('.').pop();
                audioStoragePath = `audios/${target.id || 'audio_' + Date.now()}.${audioExt}`;
                const audioRef = window.storage.ref().child(audioStoragePath);
                await audioRef.put(newAudioFile);
                audioUrl = await audioRef.getDownloadURL();
            }

            if (newImageFile) {
                const imageExt = newImageFile.name.split('.').pop();
                imageStoragePath = `images/${target.id || 'image_' + Date.now()}.${imageExt}`;
                const imageRef = window.storage.ref().child(imageStoragePath);
                await imageRef.put(newImageFile);
                imageUrl = await imageRef.getDownloadURL();
            }

            target.name = newName;
            target.audioPath = audioUrl;
            target.imagePath = imageUrl;
            target.audioStoragePath = audioStoragePath;
            target.imageStoragePath = imageStoragePath;
            target.timestamp = Date.now();

            await window.db.collection('chamariz').doc('audioData').set(currentData, { merge: true });
            if (target.id) {
                await window.db.collection('audios').doc(target.id).set(target, { merge: true });
            }

        } else {
            // Atualização Local
            target.name = newName;
            if (newAudioFile) target.audioPath = await this.fileToBase64(newAudioFile);
            if (newImageFile) target.imagePath = await this.fileToBase64(newImageFile);
        }

        await this.saveAudios(currentData);
        this.broadcastChange(currentData);
    }

    /**
     * Salvar objeto completo de dados no IndexedDB e Firestore
     */
    async saveAudios(audioData) {
        await this.ready;
        const timestamp = Date.now();

        if (this.db) {
            await this.saveToIndexedDB({
                id: 'audioData',
                data: audioData,
                timestamp: timestamp,
                source: 'app'
            });
        }

        if (typeof window.db !== 'undefined' && window.db && window.isFirebaseInitialized && navigator.onLine) {
            try {
                await window.db.collection('chamariz').doc('audioData').set(audioData, { merge: true });
            } catch (e) {
                console.warn('Erro ao salvar no Firestore:', e);
            }
        }

        try {
            const json = JSON.stringify(audioData);
            if (json.length < 3000000) {
                localStorage.setItem('audioData', json);
            } else {
                localStorage.removeItem('audioData');
            }
        } catch (e) {
            console.warn('⚠ LocalStorage cota excedida:', e);
        }

        this.notifyListeners({
            type: 'save',
            data: audioData,
            timestamp: timestamp
        });

        return true;
    }

    /**
     * Forçar Sincronização Manual com Firestore
     */
    async syncData() {
        if (this.isSyncing) return;
        this.isSyncing = true;
        try {
            if (typeof window.db !== 'undefined' && window.db && window.isFirebaseInitialized && navigator.onLine) {
                console.log('🔄 Buscando dados atualizados do Firestore...');
                const docSnap = await window.db.collection('chamariz').doc('audioData').get();
                let cloudData = { customAudios: [], defaultAudios: [] };
                
                if (docSnap.exists) {
                    const data = docSnap.data();
                    cloudData.customAudios = data.customAudios || data.audios || [];
                    cloudData.defaultAudios = data.defaultAudios || [];
                }

                const collAudios = await this.fetchAudiosCollection();
                cloudData.customAudios = this.mergeAudioLists(cloudData.customAudios, collAudios);

                await this.saveToIndexedDB({
                    id: 'audioData',
                    data: cloudData,
                    timestamp: Date.now(),
                    source: 'firebase_manual'
                });

                return cloudData;
            }
            return await this.getAllAudios();
        } catch (error) {
            console.error('Erro na sincronização manual:', error);
            return null;
        } finally {
            this.isSyncing = false;
        }
    }

    /**
     * Escutar mudanças entre abas via BroadcastChannel
     */
    setupSyncListeners() {
        if (typeof BroadcastChannel !== 'undefined') {
            try {
                this.channel = new BroadcastChannel('chamariz_sync');
                this.channel.onmessage = (event) => {
                    this.notifyListeners({
                        type: 'broadcast',
                        ...event.data
                    });
                };
            } catch (error) {
                console.warn('⚠ BroadcastChannel indisponível:', error);
            }
        }
    }

    broadcastChange(audioData) {
        if (this.channel) {
            try {
                this.channel.postMessage({
                    type: 'audio_update',
                    data: audioData,
                    timestamp: Date.now()
                });
            } catch (error) {
                console.warn('⚠ Erro no broadcast:', error);
            }
        }
    }

    onDataChange(callback) {
        this.listeners.push(callback);
        return () => {
            this.listeners = this.listeners.filter(l => l !== callback);
        };
    }

    notifyListeners(event) {
        this.listeners.forEach(callback => {
            try { callback(event); } catch (error) { console.error('Erro no listener:', error); }
        });
    }

    getAudioContentType(filename, fileType) {
        if (fileType && (fileType.startsWith('audio/') || fileType === 'video/mp4')) {
            return fileType === 'video/mp4' ? 'audio/mp4' : fileType;
        }
        const ext = (filename || '').split('.').pop().toLowerCase();
        switch (ext) {
            case 'm4a':
            case 'mp4':
            case 'm4r': return 'audio/mp4';
            case 'aac': return 'audio/aac';
            case 'mp3': return 'audio/mpeg';
            case 'wav': return 'audio/wav';
            case 'ogg': return 'audio/ogg';
            case 'webm': return 'audio/webm';
            case 'flac': return 'audio/flac';
            case '3gp': return 'audio/3gpp';
            case 'amr': return 'audio/amr';
            case 'wma': return 'audio/x-ms-wma';
            default: return 'audio/mpeg';
        }
    }

    fileToBase64(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = () => reject(new Error('Erro ao ler arquivo'));
            reader.readAsDataURL(file);
        });
    }
}

// Instância global
try {
    window.syncManager = new SyncManager();
} catch (error) {
    console.error('Erro ao criar SyncManager:', error);
}
