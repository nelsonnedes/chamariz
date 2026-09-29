/**
 * FIREBASE CONFIGURATION - Chamariz
 * Configuração do projeto Firebase do usuário (sisweb-chamariz)
 */

const firebaseConfig = {
  apiKey: "AIzaSyArgpche232ItlcFl99FsqNabfw0z-fU_A",
  authDomain: "sisweb-chamariz.firebaseapp.com",
  projectId: "sisweb-chamariz",
  storageBucket: "sisweb-chamariz.firebasestorage.app",
  messagingSenderId: "571354629847",
  appId: "1:571354629847:web:cc9af1c952da3872239292",
  measurementId: "G-P80RDDMJMR"
};

// Inicializar Firebase se o SDK estiver carregado
let db = null;
let storage = null;
let isFirebaseInitialized = false;

try {
    if (typeof firebase !== 'undefined') {
        if (!firebase.apps.length) {
            firebase.initializeApp(firebaseConfig);
        }
        db = firebase.firestore();
        storage = firebase.storage();
        isFirebaseInitialized = true;
        console.log('✓ Firebase Cloud Sync inicializado com sucesso no projeto: sisweb-chamariz');
    } else {
        console.warn('⚠ Firebase SDK compat não carregado.');
    }
} catch (error) {
    console.error('Erro ao inicializar Firebase:', error);
}
