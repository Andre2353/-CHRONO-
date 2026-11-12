/**
 * ============================================================================
 * CHRONO // TM-02 — FIREBASE MODULAR CONFIGURATION (WEB SDK v9+)
 * ============================================================================
 * INSTRUÇÕES PARA CONFIGURAÇÃO DO FIREBASE:
 * 1. Acesse https://console.firebase.google.com/ e crie (ou selecione) seu projeto.
 * 2. Em "Configurações do Projeto" (ícone de engrenagem) > aba "Geral", role até
 *    "Seus aplicativos" e registre um App Web (</>).
 * 3. Copie as chaves geradas no objeto `firebaseConfig` do painel do Firebase e
 *    substitua os valores abaixo onde indicado.
 * 4. No menu lateral do Firebase Console, ative:
 *    - Authentication -> Método de login -> E-mail/senha (Ativar)
 *    - Firestore Database -> Criar banco de dados
 *    - Storage -> Começar
 * ============================================================================
 */

import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.13.1/firebase-app.js';
import {
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  updateProfile
} from 'https://www.gstatic.com/firebasejs/10.13.1/firebase-auth.js';
import {
  getFirestore,
  collection,
  doc,
  setDoc,
  addDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  onSnapshot,
  getDocs,
  writeBatch,
  serverTimestamp
} from 'https://www.gstatic.com/firebasejs/10.13.1/firebase-firestore.js';
import {
  getStorage,
  ref as storageRef,
  uploadBytes,
  getDownloadURL,
  deleteObject
} from 'https://www.gstatic.com/firebasejs/10.13.1/firebase-storage.js';

export const firebaseConfig = {
  // 👇 COLE SUA API KEY DO FIREBASE AQUI (Ex: "AIzaSyD-9x8...")
  apiKey: "",

  // 👇 COLE SEU AUTH DOMAIN AQUI (Ex: "meu-projeto.firebaseapp.com")
  authDomain: "",

  // 👇 COLE SEU PROJECT ID AQUI (Ex: "meu-projeto-id")
  projectId: "",

  // 👇 COLE SEU STORAGE BUCKET AQUI (Ex: "meu-projeto.appspot.com")
  storageBucket: "",

  // 👇 COLE SEU MESSAGING SENDER ID AQUI (Ex: "123456789012")
  messagingSenderId: "",

  // 👇 COLE SEU APP ID AQUI (Ex: "1:123456789012:web:abcdef123456")
  appId: ""
};

/**
 * Verifica se o desenvolvedor já preencheu as credenciais reais do Firebase.
 */
export function isFirebaseConfigured() {
  return Boolean(
    firebaseConfig.apiKey &&
      firebaseConfig.apiKey.trim() !== '' &&
      firebaseConfig.projectId &&
      firebaseConfig.projectId.trim() !== ''
  );
}

let app = null;
let auth = null;
let db = null;
let storage = null;

if (isFirebaseConfigured()) {
  app = initializeApp(firebaseConfig);
  auth = getAuth(app);
  db = getFirestore(app);
  storage = getStorage(app);
}

export {
  app,
  auth,
  db,
  storage,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  updateProfile,
  collection,
  doc,
  setDoc,
  addDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  onSnapshot,
  getDocs,
  writeBatch,
  serverTimestamp,
  storageRef,
  uploadBytes,
  getDownloadURL,
  deleteObject
};
