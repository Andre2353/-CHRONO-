/**
 * ============================================================================
 * CHRONO // TM-02 — MULTI-USER FULL-STACK ARCHITECTURE (FIREBASE MODULAR v9+)
 * ============================================================================
 * Camadas Modulares:
 * 1. Segurança, Sanitização Anti-XSS, Formatação e Síntese Web Audio API (Braun)
 * 2. Camada BaaS Multi-Tenant (Firebase Auth + Cloud Firestore + Firebase Storage)
 *    com Contingência Local transparente caso `firebase-config.js` ainda esteja vazio
 * 3. Store Reativo State-Driven (ES6 Proxy + Pub/Sub Observer)
 * 4. Controladores de UI: Auth, Perfil (Avatar), CRUD de Categorias Dinâmicas e Tarefas
 * ============================================================================
 */

import {
  auth,
  db,
  storage,
  isFirebaseConfigured,
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
  storageRef,
  uploadBytes,
  getDownloadURL
} from './firebase-config.js';

/* ============================================================================
   1. CONSTANTES E UTILITÁRIOS DE SEGURANÇA / ÁUDIO
   ============================================================================ */
const LOCAL_FALLBACK_KEYS = {
  USERS: 'chrono_tm02_users_v2',
  SESSION: 'chrono_tm02_session_v2',
  CATEGORIES: 'chrono_tm02_categories_v2',
  TASKS: 'chrono_tm02_tasks_v2',
  THEME: 'chrono_tm02_theme_v2'
};

const DEFAULT_CATEGORIES_TEMPLATE = [
  { name: 'Trabalho', color: '#d97706' },
  { name: 'Casa', color: '#059669' },
  { name: 'Escola', color: '#0f766e' },
  { name: 'Compras', color: '#e11d48' }
];

const VALID_PRIORITIES = ['Baixa', 'Média', 'Alta'];

function sanitizeString(value, maxLength = 320) {
  if (typeof value !== 'string') return '';
  return value.replace(/[<>]/g, '').trim().slice(0, maxLength);
}

function generateId(prefix = 'id') {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}_${crypto.randomUUID()}`;
  }
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
}

function formatDeadline(isoString) {
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return 'Data inválida';
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  }).format(date);
}

function debounce(fn, delayMs = 180) {
  let timerId = null;
  return (...args) => {
    window.clearTimeout(timerId);
    timerId = window.setTimeout(() => fn(...args), delayMs);
  };
}

function generateInitialsAvatarDataUrl(name = 'Operador') {
  const clean = sanitizeString(name, 40) || 'OP';
  const parts = clean.split(/\s+/);
  const initials = (parts[0]?.[0] || 'O') + (parts[1]?.[0] || parts[0]?.[1] || 'P');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 96 96">
    <rect width="96" height="96" fill="#141517"/>
    <circle cx="48" cy="48" r="44" fill="none" stroke="#FF4F00" stroke-width="3"/>
    <text x="50%" y="54%" dominant-baseline="middle" text-anchor="middle" fill="#FFFFFF" font-family="monospace" font-weight="700" font-size="34">${initials.toUpperCase()}</text>
  </svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('Falha na leitura do arquivo via File API.'));
    reader.readAsDataURL(file);
  });
}

let sharedAudioCtx = null;

function playBraunBeep(type = 'alarm') {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    if (!sharedAudioCtx) sharedAudioCtx = new AudioCtx();
    if (sharedAudioCtx.state === 'suspended') sharedAudioCtx.resume();

    const now = sharedAudioCtx.currentTime;
    const pattern =
      type === 'alarm'
        ? [
            { freq: 2080, start: 0.0, duration: 0.065 },
            { freq: 2080, start: 0.11, duration: 0.065 },
            { freq: 2600, start: 0.24, duration: 0.11 }
          ]
        : [{ freq: 1760, start: 0.0, duration: 0.04 }];

    pattern.forEach(({ freq, start, duration }) => {
      const osc = sharedAudioCtx.createOscillator();
      const gain = sharedAudioCtx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, now + start);
      gain.gain.setValueAtTime(0.0001, now + start);
      gain.gain.exponentialRampToValueAtTime(0.15, now + start + 0.008);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + start + duration);
      osc.connect(gain);
      gain.connect(sharedAudioCtx.destination);
      osc.start(now + start);
      osc.stop(now + start + duration + 0.01);
    });
  } catch {
    /* Silencia se o navegador restringir áudio antes de gesto do usuário */
  }
}

/* ============================================================================
   2. STORE REATIVO CENTRAL (STATE-DRIVEN UI)
   ============================================================================ */
function createReactiveStore(initialState) {
  const listeners = new Set();
  const stateProxy = new Proxy(initialState, {
    set(target, prop, value) {
      target[prop] = value;
      if (prop === 'theme') {
        try {
          window.localStorage.setItem(LOCAL_FALLBACK_KEYS.THEME, value);
        } catch {
          /* Ignora erro de quota */
        }
      }
      listeners.forEach((listener) => listener(target, prop));
      return true;
    }
  });

  return {
    state: stateProxy,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }
  };
}

const initialTheme = window.localStorage.getItem(LOCAL_FALLBACK_KEYS.THEME) === 'dark' ? 'dark' : 'light';

const store = createReactiveStore({
  authMode: 'login',
  currentUser: null,
  categories: [],
  tasks: [],
  filterCategory: 'Todas',
  filterPriority: 'Todas',
  searchQuery: '',
  editingCategoryId: null,
  theme: initialTheme
});

/* ============================================================================
   3. REFERÊNCIAS DO DOM
   ============================================================================ */
const dom = {
  html: document.documentElement,
  globalLoader: document.getElementById('global-loader'),
  globalLoaderText: document.getElementById('global-loader-text'),
  connectionBanner: document.getElementById('connection-banner'),

  // Auth Screen
  authScreen: document.getElementById('auth-screen'),
  tabLogin: document.getElementById('tab-login'),
  tabRegister: document.getElementById('tab-register'),
  authForm: document.getElementById('auth-form'),
  registerFields: document.getElementById('register-fields'),
  authName: document.getElementById('auth-name'),
  authAvatarInput: document.getElementById('auth-avatar'),
  authAvatarPreviewWrap: document.getElementById('auth-avatar-preview-wrap'),
  authAvatarPreview: document.getElementById('auth-avatar-preview'),
  authAvatarName: document.getElementById('auth-avatar-name'),
  authEmail: document.getElementById('auth-email'),
  authPassword: document.getElementById('auth-password'),
  btnAuthSubmit: document.getElementById('btn-auth-submit'),
  btnAuthSpinner: document.getElementById('btn-auth-spinner'),
  btnAuthText: document.getElementById('btn-auth-text'),
  authThemeToggle: document.getElementById('auth-theme-toggle'),

  // Main App Shell & Profile
  appShell: document.getElementById('app-shell'),
  userAvatarImg: document.getElementById('user-avatar-img'),
  profileAvatarUpdate: document.getElementById('profile-avatar-update'),
  userDisplayName: document.getElementById('user-display-name'),
  userDisplayEmail: document.getElementById('user-display-email'),
  btnLogout: document.getElementById('btn-logout'),

  // Task Form & Image Upload
  taskForm: document.getElementById('task-form'),
  titleInput: document.getElementById('task-title'),
  descInput: document.getElementById('task-desc'),
  deadlineInput: document.getElementById('task-deadline'),
  categorySelect: document.getElementById('task-category'),
  prioritySelect: document.getElementById('task-priority'),
  taskImageInput: document.getElementById('task-image'),
  taskImagePreviewWrap: document.getElementById('task-image-preview-wrap'),
  taskImagePreview: document.getElementById('task-image-preview'),
  taskImageName: document.getElementById('task-image-name'),
  btnClearTaskImage: document.getElementById('btn-clear-task-image'),
  btnSubmitTask: document.getElementById('btn-submit-task'),
  taskSubmitSpinner: document.getElementById('task-submit-spinner'),
  taskSubmitText: document.getElementById('task-submit-text'),

  // Custom Category Manager
  categoryForm: document.getElementById('category-form'),
  categoryEditId: document.getElementById('category-edit-id'),
  categoryNameInput: document.getElementById('category-name-input'),
  categoryColorInput: document.getElementById('category-color-input'),
  categorySaveLabel: document.getElementById('category-save-label'),
  btnCancelCategoryEdit: document.getElementById('btn-cancel-category-edit'),
  customCategoriesList: document.getElementById('custom-categories-list'),

  // Workspace Controls & Metrics
  liveClock: document.getElementById('live-clock'),
  btnTestBeep: document.getElementById('btn-test-beep'),
  themeToggle: document.getElementById('theme-toggle'),
  themeLabel: document.getElementById('theme-label'),
  btnNotifyPerm: document.getElementById('btn-notify-perm'),
  notifyStatusDot: document.getElementById('notify-status-dot'),
  notifyStatusText: document.getElementById('notify-status-text'),
  statTotal: document.getElementById('stat-total'),
  statPending: document.getElementById('stat-pending'),
  statOverdue: document.getElementById('stat-overdue'),
  statCompleted: document.getElementById('stat-completed'),
  searchInput: document.getElementById('search-input'),
  btnClearCompleted: document.getElementById('btn-clear-completed'),
  categoryFilters: document.getElementById('category-filters'),
  priorityFilters: document.getElementById('priority-filters'),
  taskList: document.getElementById('task-list'),
  emptyState: document.getElementById('empty-state'),
  emptyTitle: document.getElementById('empty-title'),
  emptyDesc: document.getElementById('empty-desc'),
  btnLoadDemo: document.getElementById('btn-load-demo'),
  btnResetFilters: document.getElementById('btn-reset-filters'),

  // Lightbox Modal & Toast
  imageModal: document.getElementById('image-modal'),
  imageModalBackdrop: document.getElementById('image-modal-backdrop'),
  imageModalCaption: document.getElementById('image-modal-caption'),
  imageModalTarget: document.getElementById('image-modal-target'),
  btnCloseModal: document.getElementById('btn-close-modal'),
  toastContainer: document.getElementById('toast-container')
};

/* ============================================================================
   4. GERENCIAMENTO DE SPINNERS / LOADERS E TOASTS
   ============================================================================ */
function setGlobalLoading(isLoading, message = 'SINCRONIZANDO TELEMETRIA...') {
  dom.globalLoaderText.textContent = message;
  dom.globalLoader.hidden = !isLoading;
}

function setAuthButtonLoading(isLoading) {
  dom.btnAuthSubmit.disabled = isLoading;
  dom.btnAuthSpinner.hidden = !isLoading;
  dom.btnAuthText.textContent = isLoading
    ? 'PROCESSANDO CREDENCIAIS...'
    : store.state.authMode === 'login'
      ? 'INICIAR SESSÃO SEGURA'
      : 'REGISTRAR OPERADOR';
}

function setTaskSubmitLoading(isLoading, label = 'REGISTRAR TAREFA') {
  dom.btnSubmitTask.disabled = isLoading;
  dom.taskSubmitSpinner.hidden = !isLoading;
  dom.taskSubmitText.textContent = label;
}

function showToast({ tag = 'SISTEMA CHRONO', title, message, urgent = false }) {
  const toast = document.createElement('div');
  toast.className = `toast-item${urgent ? ' toast-urgent' : ''}`;
  toast.setAttribute('role', 'status');

  const header = document.createElement('div');
  header.className = 'toast-header';

  const tagSpan = document.createElement('span');
  tagSpan.className = 'toast-tag';
  tagSpan.textContent = tag;

  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'toast-close';
  closeBtn.textContent = '[X]';
  closeBtn.addEventListener('click', () => toast.remove());

  header.appendChild(tagSpan);
  header.appendChild(closeBtn);

  const titleEl = document.createElement('strong');
  titleEl.className = 'toast-title';
  titleEl.textContent = title;

  const msgEl = document.createElement('p');
  msgEl.className = 'toast-msg';
  msgEl.textContent = message;

  toast.appendChild(header);
  toast.appendChild(titleEl);
  toast.appendChild(msgEl);
  dom.toastContainer.appendChild(toast);

  window.setTimeout(() => {
    if (toast.parentNode) toast.remove();
  }, 6500);
}

/* ============================================================================
   5. SERVIÇOS BaaS: STORAGE (UPLOAD DE IMAGENS), AUTH E FIRESTORE
   ============================================================================ */
let unsubscribeCategories = null;
let unsubscribeTasks = null;

function cleanupRealtimeSubscriptions() {
  if (typeof unsubscribeCategories === 'function') {
    unsubscribeCategories();
    unsubscribeCategories = null;
  }
  if (typeof unsubscribeTasks === 'function') {
    unsubscribeTasks();
    unsubscribeTasks = null;
  }
}

/**
 * Faz o upload de uma imagem (Avatar ou Anexo de Tarefa) para o Firebase Storage
 * ou converte via FileReader caso esteja em modo de contingência local.
 */
async function uploadImageFile(file, pathFolder, ownerUid) {
  if (!file) return '';
  const maxBytes = 5 * 1024 * 1024;
  if (file.size > maxBytes) {
    throw new Error('A imagem selecionada excede o limite máximo de 5MB.');
  }

  if (isFirebaseConfigured() && storage) {
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
    const fullPath = `${pathFolder}/${ownerUid}/${Date.now()}_${safeName}`;
    const fileRef = storageRef(storage, fullPath);
    const snapshot = await uploadBytes(fileRef, file);
    return await getDownloadURL(snapshot.ref);
  }

  return await readFileAsDataUrl(file);
}

/**
 * Garante que um usuário recém-cadastrado receba suas 4 categorias iniciais personalizadas.
 */
async function ensureInitialUserCategories(uid) {
  if (isFirebaseConfigured() && db) {
    const q = query(collection(db, 'categories'), where('userId', '==', uid));
    const snap = await getDocs(q);
    if (!snap.empty) return;

    const batch = writeBatch(db);
    DEFAULT_CATEGORIES_TEMPLATE.forEach((cat) => {
      const newDocRef = doc(collection(db, 'categories'));
      batch.set(newDocRef, {
        userId: uid,
        name: cat.name,
        color: cat.color,
        createdAt: Date.now()
      });
    });
    await batch.commit();
    return;
  }

  // Fallback Local Multi-Tenant
  const allCats = JSON.parse(window.localStorage.getItem(LOCAL_FALLBACK_KEYS.CATEGORIES) || '[]');
  const userCats = allCats.filter((c) => c.userId === uid);
  if (userCats.length === 0) {
    const seeded = DEFAULT_CATEGORIES_TEMPLATE.map((cat) => ({
      id: generateId('cat'),
      userId: uid,
      name: cat.name,
      color: cat.color,
      createdAt: Date.now()
    }));
    window.localStorage.setItem(LOCAL_FALLBACK_KEYS.CATEGORIES, JSON.stringify([...allCats, ...seeded]));
  }
}

/**
 * Inicializa os listeners em tempo real (onSnapshot) filtrados estritamente por `userId == uid`.
 */
function startUserRealtimeSync(user) {
  cleanupRealtimeSubscriptions();

  if (isFirebaseConfigured() && db) {
    const catQuery = query(collection(db, 'categories'), where('userId', '==', user.uid));
    unsubscribeCategories = onSnapshot(catQuery, (snapshot) => {
      const cats = snapshot.docs
        .map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }))
        .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
      store.state.categories = cats;
    });

    const taskQuery = query(collection(db, 'tasks'), where('userId', '==', user.uid));
    unsubscribeTasks = onSnapshot(taskQuery, (snapshot) => {
      const userTasks = snapshot.docs.map((docSnap) => ({
        id: docSnap.id,
        ...docSnap.data()
      }));
      store.state.tasks = userTasks;
    });
    return;
  }

  // Fallback Local Multi-Tenant filtrado por user.uid
  const allCats = JSON.parse(window.localStorage.getItem(LOCAL_FALLBACK_KEYS.CATEGORIES) || '[]');
  const allTasks = JSON.parse(window.localStorage.getItem(LOCAL_FALLBACK_KEYS.TASKS) || '[]');
  store.state.categories = allCats.filter((c) => c.userId === user.uid);
  store.state.tasks = allTasks.filter((t) => t.userId === user.uid);
}

function persistLocalFallbackCollection(storageKey, currentUid, updatedUserItems) {
  const allItems = JSON.parse(window.localStorage.getItem(storageKey) || '[]');
  const otherUsersItems = allItems.filter((item) => item.userId !== currentUid);
  window.localStorage.setItem(storageKey, JSON.stringify([...otherUsersItems, ...updatedUserItems]));
}

/* ============================================================================
   6. AUTENTICAÇÃO E PERFIL DE USUÁRIO (LOGIN, CADASTRO, AVATAR, LOGOUT)
   ============================================================================ */
async function handleAuthFormSubmit(event) {
  event.preventDefault();

  const mode = store.state.authMode;
  const email = sanitizeString(dom.authEmail.value, 120).toLowerCase();
  const password = dom.authPassword.value;
  const displayName = sanitizeString(dom.authName.value, 60);
  const avatarFile = dom.authAvatarInput.files?.[0] || null;

  if (!email || !password || password.length < 6) {
    showToast({
      tag: 'CREDENCIAIS INVÁLIDAS',
      title: 'Verifique e-mail e senha',
      message: 'Informe um e-mail válido e uma senha com pelo menos 6 caracteres.',
      urgent: true
    });
    return;
  }

  if (mode === 'register' && !displayName) {
    dom.authName.focus();
    showToast({
      tag: 'CADASTRO INCOMPLETO',
      title: 'Nome do Operador obrigatório',
      message: 'Informe seu nome para configurar o perfil.',
      urgent: true
    });
    return;
  }

  setAuthButtonLoading(true);

  try {
    if (isFirebaseConfigured() && auth && db) {
      if (mode === 'login') {
        await signInWithEmailAndPassword(auth, email, password);
        playBraunBeep('click');
      } else {
        const cred = await createUserWithEmailAndPassword(auth, email, password);
        const photoURL = avatarFile
          ? await uploadImageFile(avatarFile, 'avatars', cred.user.uid)
          : generateInitialsAvatarDataUrl(displayName);

        await updateProfile(cred.user, { displayName, photoURL });
        await setDoc(doc(db, 'users', cred.user.uid), {
          uid: cred.user.uid,
          name: displayName,
          email: cred.user.email,
          photoURL,
          createdAt: Date.now()
        });
        await ensureInitialUserCategories(cred.user.uid);
        playBraunBeep('click');
      }
      dom.authForm.reset();
      dom.authAvatarPreviewWrap.hidden = true;
      return;
    }

    // Contingência Local Multi-Usuário (quando firebase-config.js ainda está vazio)
    const users = JSON.parse(window.localStorage.getItem(LOCAL_FALLBACK_KEYS.USERS) || '[]');
    if (mode === 'login') {
      const found = users.find((u) => u.email === email && u.password === password);
      if (!found) {
        throw new Error('E-mail ou senha incorretos (ou conta ainda não registrada).');
      }
      const sessionUser = {
        uid: found.uid,
        displayName: found.name,
        email: found.email,
        photoURL: found.photoURL
      };
      window.localStorage.setItem(LOCAL_FALLBACK_KEYS.SESSION, JSON.stringify(sessionUser));
      await ensureInitialUserCategories(sessionUser.uid);
      store.state.currentUser = sessionUser;
      startUserRealtimeSync(sessionUser);
      playBraunBeep('click');
    } else {
      if (users.some((u) => u.email === email)) {
        throw new Error('Este e-mail já está registrado.');
      }
      const uid = generateId('usr');
      const photoURL = avatarFile
        ? await uploadImageFile(avatarFile, 'avatars', uid)
        : generateInitialsAvatarDataUrl(displayName);

      const newUserRecord = { uid, name: displayName, email, password, photoURL, createdAt: Date.now() };
      users.push(newUserRecord);
      window.localStorage.setItem(LOCAL_FALLBACK_KEYS.USERS, JSON.stringify(users));

      const sessionUser = { uid, displayName, email, photoURL };
      window.localStorage.setItem(LOCAL_FALLBACK_KEYS.SESSION, JSON.stringify(sessionUser));
      await ensureInitialUserCategories(uid);
      store.state.currentUser = sessionUser;
      startUserRealtimeSync(sessionUser);
      playBraunBeep('click');
    }

    dom.authForm.reset();
    dom.authAvatarPreviewWrap.hidden = true;
  } catch (error) {
    showToast({
      tag: 'FALHA DE AUTENTICAÇÃO',
      title: 'Não foi possível autenticar',
      message: error.message || 'Verifique suas credenciais e tente novamente.',
      urgent: true
    });
  } finally {
    setAuthButtonLoading(false);
  }
}

async function handleProfileAvatarUpdate(event) {
  const file = event.target.files?.[0];
  const user = store.state.currentUser;
  if (!file || !user) return;

  setGlobalLoading(true, 'ENVIANDO NOVO AVATAR PARA O STORAGE...');
  try {
    const newPhotoURL = await uploadImageFile(file, 'avatars', user.uid);

    if (isFirebaseConfigured() && auth && db && auth.currentUser) {
      await updateProfile(auth.currentUser, { photoURL: newPhotoURL });
      await setDoc(doc(db, 'users', user.uid), { photoURL: newPhotoURL }, { merge: true });
    } else {
      const users = JSON.parse(window.localStorage.getItem(LOCAL_FALLBACK_KEYS.USERS) || '[]');
      const updatedUsers = users.map((u) => (u.uid === user.uid ? { ...u, photoURL: newPhotoURL } : u));
      window.localStorage.setItem(LOCAL_FALLBACK_KEYS.USERS, JSON.stringify(updatedUsers));
      const updatedSession = { ...user, photoURL: newPhotoURL };
      window.localStorage.setItem(LOCAL_FALLBACK_KEYS.SESSION, JSON.stringify(updatedSession));
    }

    store.state.currentUser = { ...user, photoURL: newPhotoURL };
    playBraunBeep('click');
    showToast({
      tag: 'PERFIL ATUALIZADO',
      title: 'Foto de perfil sincronizada',
      message: 'Seu novo avatar já está ativo no painel.'
    });
  } catch (error) {
    showToast({
      tag: 'ERRO NO UPLOAD',
      title: 'Não foi possível atualizar o avatar',
      message: error.message,
      urgent: true
    });
  } finally {
    setGlobalLoading(false);
    dom.profileAvatarUpdate.value = '';
  }
}

async function handleLogout() {
  setGlobalLoading(true, 'ENCERRANDO SESSÃO...');
  try {
    cleanupRealtimeSubscriptions();
    if (isFirebaseConfigured() && auth) {
      await signOut(auth);
    } else {
      window.localStorage.removeItem(LOCAL_FALLBACK_KEYS.SESSION);
    }
    store.state.currentUser = null;
    store.state.tasks = [];
    store.state.categories = [];
    store.state.filterCategory = 'Todas';
    store.state.filterPriority = 'Todas';
    playBraunBeep('click');
  } finally {
    setGlobalLoading(false);
  }
}

/* ============================================================================
   7. CRUD DE CATEGORIAS PERSONALIZADAS (POR USUÁRIO)
   ============================================================================ */
async function handleCategoryFormSubmit(event) {
  event.preventDefault();
  const user = store.state.currentUser;
  if (!user) return;

  const cleanName = sanitizeString(dom.categoryNameInput.value, 28);
  const color = dom.categoryColorInput.value || '#d97706';
  const editingId = store.state.editingCategoryId;

  if (!cleanName) {
    dom.categoryNameInput.focus();
    return;
  }

  const duplicate = store.state.categories.find(
    (c) => c.name.toLowerCase() === cleanName.toLowerCase() && c.id !== editingId
  );
  if (duplicate) {
    showToast({
      tag: 'CATEGORIA DUPLICADA',
      title: 'Nome já utilizado',
      message: `A categoria "${cleanName}" já existe na sua conta.`,
      urgent: true
    });
    return;
  }

  try {
    if (editingId) {
      const oldCategory = store.state.categories.find((c) => c.id === editingId);
      if (isFirebaseConfigured() && db) {
        await updateDoc(doc(db, 'categories', editingId), { name: cleanName, color });
        // Atualiza tarefas associadas à categoria editada
        const tasksToUpdate = store.state.tasks.filter((t) => t.categoryId === editingId);
        for (const taskItem of tasksToUpdate) {
          await updateDoc(doc(db, 'tasks', taskItem.id), {
            categoryName: cleanName,
            categoryColor: color
          });
        }
      } else {
        const updatedCats = store.state.categories.map((c) =>
          c.id === editingId ? { ...c, name: cleanName, color } : c
        );
        store.state.categories = updatedCats;
        persistLocalFallbackCollection(LOCAL_FALLBACK_KEYS.CATEGORIES, user.uid, updatedCats);

        const updatedTasks = store.state.tasks.map((t) =>
          t.categoryId === editingId ? { ...t, categoryName: cleanName, categoryColor: color } : t
        );
        store.state.tasks = updatedTasks;
        persistLocalFallbackCollection(LOCAL_FALLBACK_KEYS.TASKS, user.uid, updatedTasks);
      }

      if (oldCategory && store.state.filterCategory === oldCategory.id) {
        store.state.filterCategory = editingId;
      }
      resetCategoryEditForm();
      playBraunBeep('click');
      showToast({
        tag: 'CATEGORIA ATUALIZADA',
        title: cleanName,
        message: 'Nome e cor sincronizados em todas as tarefas vinculadas.'
      });
    } else {
      if (isFirebaseConfigured() && db) {
        await addDoc(collection(db, 'categories'), {
          userId: user.uid,
          name: cleanName,
          color,
          createdAt: Date.now()
        });
      } else {
        const newCat = {
          id: generateId('cat'),
          userId: user.uid,
          name: cleanName,
          color,
          createdAt: Date.now()
        };
        const updatedCats = [...store.state.categories, newCat];
        store.state.categories = updatedCats;
        persistLocalFallbackCollection(LOCAL_FALLBACK_KEYS.CATEGORIES, user.uid, updatedCats);
      }
      dom.categoryForm.reset();
      dom.categoryColorInput.value = '#d97706';
      playBraunBeep('click');
    }
  } catch (error) {
    showToast({
      tag: 'ERRO EM CATEGORIA',
      title: 'Falha ao salvar categoria',
      message: error.message,
      urgent: true
    });
  }
}

function startEditingCategory(category) {
  store.state.editingCategoryId = category.id;
  dom.categoryEditId.value = category.id;
  dom.categoryNameInput.value = category.name;
  dom.categoryColorInput.value = category.color || '#d97706';
  dom.categorySaveLabel.textContent = 'SALVAR';
  dom.btnCancelCategoryEdit.hidden = false;
  dom.categoryNameInput.focus();
}

function resetCategoryEditForm() {
  store.state.editingCategoryId = null;
  dom.categoryEditId.value = '';
  dom.categoryForm.reset();
  dom.categoryColorInput.value = '#d97706';
  dom.categorySaveLabel.textContent = 'CRIAR';
  dom.btnCancelCategoryEdit.hidden = true;
}

async function handleDeleteCategory(categoryId) {
  const user = store.state.currentUser;
  if (!user) return;

  if (store.state.categories.length <= 1) {
    showToast({
      tag: 'OPERAÇÃO BLOQUEADA',
      title: 'Mantenha ao menos 1 categoria',
      message: 'Sua conta precisa possuir pelo menos uma categoria ativa.',
      urgent: true
    });
    return;
  }

  const remainingCats = store.state.categories.filter((c) => c.id !== categoryId);
  const fallbackCat = remainingCats[0];

  try {
    if (isFirebaseConfigured() && db) {
      await deleteDoc(doc(db, 'categories', categoryId));
      const tasksUsingDeleted = store.state.tasks.filter((t) => t.categoryId === categoryId);
      for (const taskItem of tasksUsingDeleted) {
        await updateDoc(doc(db, 'tasks', taskItem.id), {
          categoryId: fallbackCat.id,
          categoryName: fallbackCat.name,
          categoryColor: fallbackCat.color
        });
      }
    } else {
      store.state.categories = remainingCats;
      persistLocalFallbackCollection(LOCAL_FALLBACK_KEYS.CATEGORIES, user.uid, remainingCats);

      const updatedTasks = store.state.tasks.map((t) =>
        t.categoryId === categoryId
          ? {
              ...t,
              categoryId: fallbackCat.id,
              categoryName: fallbackCat.name,
              categoryColor: fallbackCat.color
            }
          : t
      );
      store.state.tasks = updatedTasks;
      persistLocalFallbackCollection(LOCAL_FALLBACK_KEYS.TASKS, user.uid, updatedTasks);
    }

    if (store.state.filterCategory === categoryId) {
      store.state.filterCategory = 'Todas';
    }
    if (store.state.editingCategoryId === categoryId) {
      resetCategoryEditForm();
    }
    playBraunBeep('click');
  } catch (error) {
    showToast({
      tag: 'ERRO AO EXCLUIR',
      title: 'Não foi possível excluir a categoria',
      message: error.message,
      urgent: true
    });
  }
}

/* ============================================================================
   8. CRUD DE TAREFAS MULTI-USUÁRIO + UPLOAD DE ANEXO (FIREBASE STORAGE)
   ============================================================================ */
async function handleTaskFormSubmit(event) {
  event.preventDefault();
  const user = store.state.currentUser;
  if (!user) return;

  const cleanTitle = sanitizeString(dom.titleInput.value, 90);
  const cleanDesc = sanitizeString(dom.descInput.value, 320);
  const rawDeadline = dom.deadlineInput.value;
  const selectedCategoryId = dom.categorySelect.value;
  const selectedCat =
    store.state.categories.find((c) => c.id === selectedCategoryId) || store.state.categories[0];
  const priority = VALID_PRIORITIES.includes(dom.prioritySelect.value)
    ? dom.prioritySelect.value
    : 'Média';
  const imageFile = dom.taskImageInput.files?.[0] || null;

  if (!cleanTitle) {
    dom.titleInput.focus();
    showToast({
      tag: 'CAMPO OBRIGATÓRIO',
      title: 'Informe o título da tarefa',
      message: 'O título é indispensável para registrar a operação.',
      urgent: true
    });
    return;
  }

  if (!rawDeadline || Number.isNaN(new Date(rawDeadline).getTime())) {
    dom.deadlineInput.focus();
    showToast({
      tag: 'PRAZO INVÁLIDO',
      title: 'Defina a data e hora limite',
      message: 'Selecione um prazo válido para o agendador cronológico.',
      urgent: true
    });
    return;
  }

  setTaskSubmitLoading(true, imageFile ? 'ENVIANDO IMAGEM...' : 'SALVANDO NO BANCO...');

  try {
    let attachmentUrl = '';
    if (imageFile) {
      attachmentUrl = await uploadImageFile(imageFile, 'tasks', user.uid);
    }

    const taskPayload = {
      userId: user.uid,
      title: cleanTitle,
      description: cleanDesc,
      deadline: rawDeadline,
      categoryId: selectedCat ? selectedCat.id : 'default',
      categoryName: selectedCat ? selectedCat.name : 'Geral',
      categoryColor: selectedCat ? selectedCat.color : '#d97706',
      priority,
      imageUrl: attachmentUrl,
      completed: false,
      notified: false,
      createdAt: Date.now()
    };

    if (isFirebaseConfigured() && db) {
      await addDoc(collection(db, 'tasks'), taskPayload);
    } else {
      const localTask = { id: generateId('tsk'), ...taskPayload };
      const updated = [localTask, ...store.state.tasks];
      store.state.tasks = updated;
      persistLocalFallbackCollection(LOCAL_FALLBACK_KEYS.TASKS, user.uid, updated);
    }

    playBraunBeep('click');
    dom.taskForm.reset();
    clearTaskImageSelection();
    setDefaultFormDeadline();
    dom.titleInput.focus();

    showToast({
      tag: 'OPERAÇÃO REGISTRADA',
      title: cleanTitle,
      message: `Sincronizada na categoria ${taskPayload.categoryName}.`
    });
  } catch (error) {
    showToast({
      tag: 'FALHA AO SALVAR',
      title: 'Erro ao gravar tarefa',
      message: error.message,
      urgent: true
    });
  } finally {
    setTaskSubmitLoading(false, 'REGISTRAR TAREFA');
  }
}

async function handleTaskCardAction(event) {
  const user = store.state.currentUser;
  if (!user) return;

  const imgTrigger = event.target.closest('[data-zoom-image]');
  if (imgTrigger) {
    openImageModal(imgTrigger.dataset.zoomImage, imgTrigger.dataset.zoomTitle);
    return;
  }

  const actionBtn = event.target.closest('button[data-action]');
  if (!actionBtn) return;

  const { action, id } = actionBtn.dataset;
  const targetTask = store.state.tasks.find((t) => t.id === id);
  if (!targetTask) return;

  try {
    if (action === 'toggle') {
      playBraunBeep('click');
      const nextCompleted = !targetTask.completed;
      if (isFirebaseConfigured() && db) {
        await updateDoc(doc(db, 'tasks', id), { completed: nextCompleted });
      } else {
        const updated = store.state.tasks.map((t) =>
          t.id === id ? { ...t, completed: nextCompleted } : t
        );
        store.state.tasks = updated;
        persistLocalFallbackCollection(LOCAL_FALLBACK_KEYS.TASKS, user.uid, updated);
      }
    } else if (action === 'delete') {
      playBraunBeep('click');
      if (isFirebaseConfigured() && db) {
        await deleteDoc(doc(db, 'tasks', id));
      } else {
        const updated = store.state.tasks.filter((t) => t.id !== id);
        store.state.tasks = updated;
        persistLocalFallbackCollection(LOCAL_FALLBACK_KEYS.TASKS, user.uid, updated);
      }
    }
  } catch (error) {
    showToast({
      tag: 'ERRO DE SINCRONIZAÇÃO',
      title: 'Falha ao atualizar tarefa',
      message: error.message,
      urgent: true
    });
  }
}

/* ============================================================================
   9. RENDERIZAÇÃO REATIVA DE CATEGORIAS, MÉTRICAS E CARDS
   ============================================================================ */
function renderCategoriesUI() {
  const categories = store.state.categories;

  // 1. Select do Formulário de Tarefa
  const currentSelectVal = dom.categorySelect.value;
  dom.categorySelect.replaceChildren();
  categories.forEach((cat) => {
    const opt = document.createElement('option');
    opt.value = cat.id;
    opt.textContent = cat.name;
    dom.categorySelect.appendChild(opt);
  });
  if (categories.some((c) => c.id === currentSelectVal)) {
    dom.categorySelect.value = currentSelectVal;
  }

  // 2. Lista do Gerenciador de Categorias Lateral
  dom.customCategoriesList.replaceChildren();
  categories.forEach((cat) => {
    const li = document.createElement('li');
    li.className = 'cat-item-row';

    const left = document.createElement('div');
    left.className = 'cat-item-left';

    const dot = document.createElement('span');
    dot.className = 'cat-color-dot';
    dot.style.backgroundColor = cat.color || '#d97706';

    const nameSpan = document.createElement('span');
    nameSpan.className = 'cat-item-name';
    nameSpan.textContent = cat.name;

    left.appendChild(dot);
    left.appendChild(nameSpan);

    const actions = document.createElement('div');
    actions.className = 'cat-item-actions';

    const editBtn = document.createElement('button');
    editBtn.type = 'button';
    editBtn.className = 'btn-cat-mini';
    editBtn.textContent = 'EDITAR';
    editBtn.addEventListener('click', () => startEditingCategory(cat));

    const delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.className = 'btn-cat-mini danger';
    delBtn.textContent = 'EXCLUIR';
    delBtn.addEventListener('click', () => handleDeleteCategory(cat.id));

    actions.appendChild(editBtn);
    actions.appendChild(delBtn);

    li.appendChild(left);
    li.appendChild(actions);
    dom.customCategoriesList.appendChild(li);
  });

  // 3. Pílulas de Filtro de Categoria na Barra Principal
  dom.categoryFilters.replaceChildren();

  const allBtn = document.createElement('button');
  allBtn.type = 'button';
  allBtn.className = `filter-pill${store.state.filterCategory === 'Todas' ? ' active' : ''}`;
  allBtn.dataset.filterCategory = 'Todas';
  allBtn.textContent = 'Todas';
  dom.categoryFilters.appendChild(allBtn);

  categories.forEach((cat) => {
    const pill = document.createElement('button');
    pill.type = 'button';
    pill.className = `filter-pill${store.state.filterCategory === cat.id ? ' active' : ''}`;
    pill.dataset.filterCategory = cat.id;

    const dot = document.createElement('span');
    dot.className = 'cat-color-dot';
    dot.style.backgroundColor = cat.color || '#d97706';

    const text = document.createElement('span');
    text.textContent = cat.name;

    pill.appendChild(dot);
    pill.appendChild(text);
    dom.categoryFilters.appendChild(pill);
  });
}

function getSortedAndFilteredTasks() {
  const { tasks, filterCategory, filterPriority, searchQuery } = store.state;
  const q = searchQuery.trim().toLowerCase();

  return tasks
    .filter((task) => {
      const matchCat = filterCategory === 'Todas' || task.categoryId === filterCategory;
      const matchPrio = filterPriority === 'Todas' || task.priority === filterPriority;
      const matchSearch =
        q === '' ||
        task.title.toLowerCase().includes(q) ||
        (task.description && task.description.toLowerCase().includes(q));
      return matchCat && matchPrio && matchSearch;
    })
    .sort((a, b) => {
      if (a.completed !== b.completed) return a.completed ? 1 : -1;
      const timeA = new Date(a.deadline).getTime() || 0;
      const timeB = new Date(b.deadline).getTime() || 0;
      return timeA - timeB;
    });
}

function createTaskCardElement(task, nowMs) {
  const deadlineMs = new Date(task.deadline).getTime();
  const isOverdue = !task.completed && !Number.isNaN(deadlineMs) && nowMs >= deadlineMs;

  const article = document.createElement('article');
  article.className = `task-card${task.completed ? ' is-completed' : ''}${isOverdue ? ' is-overdue' : ''}`;
  article.dataset.id = task.id;
  article.dataset.priority = task.priority;

  // Topo: Badge de Categoria Personalizada + Badge de Prioridade
  const metaTop = document.createElement('div');
  metaTop.className = 'card-meta-top';

  const catBadge = document.createElement('span');
  catBadge.className = 'badge-category';
  const catColor = task.categoryColor || '#d97706';
  catBadge.style.color = catColor;
  catBadge.style.border = `1px solid ${catColor}`;
  catBadge.style.backgroundColor = `${catColor}18`;

  const catDot = document.createElement('span');
  catDot.className = 'cat-color-dot';
  catDot.style.backgroundColor = catColor;

  const catNameSpan = document.createElement('span');
  catNameSpan.textContent = task.categoryName || 'Categoria';

  catBadge.appendChild(catDot);
  catBadge.appendChild(catNameSpan);

  const prioBadge = document.createElement('span');
  prioBadge.className = 'badge-priority';
  prioBadge.dataset.prio = task.priority;

  if (task.priority === 'Alta') {
    const alertDot = document.createElement('span');
    alertDot.className = 'high-alert-icon';
    alertDot.setAttribute('aria-hidden', 'true');
    prioBadge.appendChild(alertDot);
  }

  const prioText = document.createElement('span');
  prioText.textContent = `Prioridade ${task.priority}`;
  prioBadge.appendChild(prioText);

  metaTop.appendChild(catBadge);
  metaTop.appendChild(prioBadge);

  // Corpo: Título + Descrição + Anexo de Imagem
  const body = document.createElement('div');
  body.className = 'card-body';

  const titleEl = document.createElement('h3');
  titleEl.className = 'task-title';
  titleEl.textContent = task.title;
  body.appendChild(titleEl);

  if (task.description) {
    const descEl = document.createElement('p');
    descEl.className = 'task-desc';
    descEl.textContent = task.description;
    body.appendChild(descEl);
  }

  if (task.imageUrl) {
    const attachmentWrap = document.createElement('div');
    attachmentWrap.className = 'card-attachment';
    attachmentWrap.dataset.zoomImage = task.imageUrl;
    attachmentWrap.dataset.zoomTitle = task.title;
    attachmentWrap.title = 'Clique para ampliar a imagem anexada';

    const img = document.createElement('img');
    img.className = 'card-attachment-img';
    img.src = task.imageUrl;
    img.alt = `Anexo da tarefa ${task.title}`;
    img.loading = 'lazy';

    attachmentWrap.appendChild(img);
    body.appendChild(attachmentWrap);
  }

  // Rodapé: Prazo + Ações
  const footer = document.createElement('footer');
  footer.className = 'card-footer';

  const deadlineMeta = document.createElement('div');
  deadlineMeta.className = 'deadline-meta';

  const deadlineLabel = document.createElement('span');
  deadlineLabel.className = 'deadline-label';
  deadlineLabel.textContent = task.completed
    ? 'STATUS: FINALIZADA'
    : isOverdue
      ? '⚠ PRAZO EXPIRADO'
      : 'PRAZO LIMITE';

  const timeEl = document.createElement('time');
  timeEl.className = 'deadline-time';
  timeEl.setAttribute('datetime', task.deadline);
  timeEl.textContent = formatDeadline(task.deadline);

  deadlineMeta.appendChild(deadlineLabel);
  deadlineMeta.appendChild(timeEl);

  const actions = document.createElement('div');
  actions.className = 'card-actions';

  const btnToggle = document.createElement('button');
  btnToggle.type = 'button';
  btnToggle.className = 'btn-card-action btn-complete';
  btnToggle.dataset.action = 'toggle';
  btnToggle.dataset.id = task.id;
  btnToggle.textContent = task.completed ? 'REABRIR' : 'CONCLUIR';

  const btnDelete = document.createElement('button');
  btnDelete.type = 'button';
  btnDelete.className = 'btn-card-action btn-delete';
  btnDelete.dataset.action = 'delete';
  btnDelete.dataset.id = task.id;
  btnDelete.textContent = 'EXCLUIR';

  actions.appendChild(btnToggle);
  actions.appendChild(btnDelete);

  footer.appendChild(deadlineMeta);
  footer.appendChild(actions);

  article.appendChild(metaTop);
  article.appendChild(body);
  article.appendChild(footer);

  return article;
}

function renderMetricsAndCards() {
  const nowMs = Date.now();
  const allTasks = store.state.tasks;

  const totalCount = allTasks.length;
  const completedCount = allTasks.filter((t) => t.completed).length;
  const pendingCount = totalCount - completedCount;
  const overdueCount = allTasks.filter((t) => {
    if (t.completed) return false;
    const ms = new Date(t.deadline).getTime();
    return !Number.isNaN(ms) && nowMs >= ms;
  }).length;

  dom.statTotal.textContent = String(totalCount).padStart(2, '0');
  dom.statPending.textContent = String(pendingCount).padStart(2, '0');
  dom.statOverdue.textContent = String(overdueCount).padStart(2, '0');
  dom.statCompleted.textContent = String(completedCount).padStart(2, '0');

  const visibleTasks = getSortedAndFilteredTasks();
  dom.taskList.replaceChildren();

  if (visibleTasks.length === 0) {
    dom.emptyState.hidden = false;
    const hasFilters =
      store.state.filterCategory !== 'Todas' ||
      store.state.filterPriority !== 'Todas' ||
      store.state.searchQuery.trim() !== '';

    dom.btnLoadDemo.hidden = allTasks.length > 0;
    dom.btnResetFilters.hidden = !hasFilters;
    return;
  }

  dom.emptyState.hidden = true;
  const fragment = document.createDocumentFragment();
  visibleTasks.forEach((task) => {
    fragment.appendChild(createTaskCardElement(task, nowMs));
  });
  dom.taskList.appendChild(fragment);
}

function renderAuthAndProfileView() {
  const user = store.state.currentUser;
  if (!user) {
    dom.authScreen.hidden = false;
    dom.appShell.hidden = true;
    return;
  }

  dom.authScreen.hidden = true;
  dom.appShell.hidden = false;
  dom.userDisplayName.textContent = user.displayName || 'Operador';
  dom.userDisplayEmail.textContent = user.email || '';
  dom.userAvatarImg.src = user.photoURL || generateInitialsAvatarDataUrl(user.displayName);
}

/* ============================================================================
   10. MOTOR DE LEMBRETES, MODAL DE IMAGEM E INICIALIZAÇÃO
   ============================================================================ */
function checkDueTasks() {
  const user = store.state.currentUser;
  if (!user) return;

  const now = Date.now();
  store.state.tasks.forEach(async (task) => {
    if (task.completed || task.notified) return;
    const deadlineMs = new Date(task.deadline).getTime();
    if (!Number.isNaN(deadlineMs) && now >= deadlineMs) {
      playBraunBeep('alarm');
      showToast({
        tag: `PRAZO ATINGIDO // ${task.priority.toUpperCase()}`,
        title: task.title,
        message: `Categoria: ${task.categoryName} — Limite: ${formatDeadline(task.deadline)}`,
        urgent: true
      });

      if ('Notification' in window && Notification.permission === 'granted') {
        try {
          new Notification(`⏰ Prazo Limite: ${task.title}`, {
            body: `[${task.categoryName}] ${task.description || 'Verifique sua tarefa agora.'}`,
            tag: task.id
          });
        } catch {
          /* Fallback alert abaixo */
        }
      }

      if (isFirebaseConfigured() && db) {
        await updateDoc(doc(db, 'tasks', task.id), { notified: true });
      } else {
        const updated = store.state.tasks.map((t) =>
          t.id === task.id ? { ...t, notified: true } : t
        );
        store.state.tasks = updated;
        persistLocalFallbackCollection(LOCAL_FALLBACK_KEYS.TASKS, user.uid, updated);
      }
    }
  });
}

function openImageModal(imageUrl, captionText) {
  dom.imageModalTarget.src = imageUrl;
  dom.imageModalCaption.textContent = captionText || 'ANEXO DA OPERAÇÃO';
  dom.imageModal.hidden = false;
}

function closeImageModal() {
  dom.imageModal.hidden = true;
  dom.imageModalTarget.src = '';
}

function clearTaskImageSelection() {
  dom.taskImageInput.value = '';
  dom.taskImagePreview.src = '';
  dom.taskImagePreviewWrap.hidden = true;
}

function setDefaultFormDeadline() {
  const defaultTime = new Date(Date.now() + 60 * 60 * 1000);
  const tzOffsetMs = defaultTime.getTimezoneOffset() * 60 * 1000;
  dom.deadlineInput.value = new Date(defaultTime.getTime() - tzOffsetMs).toISOString().slice(0, 16);
}

function applyTheme(theme) {
  dom.html.setAttribute('data-theme', theme);
  const isDark = theme === 'dark';
  dom.themeToggle.setAttribute('aria-pressed', String(isDark));
  dom.themeLabel.textContent = isDark ? 'LIGHT MODE' : 'DARK MODE';
}

function renderConnectionBanner() {
  dom.connectionBanner.hidden = false;
  if (isFirebaseConfigured()) {
    dom.connectionBanner.textContent =
      '● CONECTADO AO FIREBASE CLOUD (AUTH + FIRESTORE MULTI-TENANT + STORAGE ATIVOS)';
  } else {
    dom.connectionBanner.textContent =
      '⚡ MODO DE CONTINGÊNCIA LOCAL MULTI-USUÁRIO ATIVO — Insira suas credenciais em firebase-config.js para sincronizar na nuvem.';
  }
}

async function seedDemoTasksForCurrentUser() {
  const user = store.state.currentUser;
  if (!user) return;

  const cats = store.state.categories;
  const cat0 = cats[0] || { id: 'default', name: 'Trabalho', color: '#d97706' };
  const cat1 = cats[1] || cat0;
  const now = Date.now();
  const min = 60 * 1000;

  const sampleSvgCard = `data:image/svg+xml;utf8,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="320" viewBox="0 0 640 320">
      <rect width="640" height="320" fill="#14171C"/>
      <rect x="24" y="24" width="592" height="272" rx="12" fill="none" stroke="#FF4F00" stroke-width="2" stroke-dasharray="6 6"/>
      <circle cx="320" cy="140" r="46" fill="none" stroke="#F4F2ED" stroke-width="3"/>
      <line x1="320" y1="140" x2="345" y2="122" stroke="#FF4F00" stroke-width="4"/>
      <text x="320" y="235" text-anchor="middle" fill="#F4F2ED" font-family="monospace" font-size="18">CHRONO TELEMETRY // DIAGRAMA DE ARQUITETURA</text>
    </svg>`
  )}`;

  const demoList = [
    {
      userId: user.uid,
      title: 'Validar regras de segurança Multi-Tenant no Cloud Firestore',
      description: 'Garantir que cada documento nas coleções categories e tasks valide request.auth.uid == resource.data.userId.',
      deadline: new Date(now + 45 * min).toISOString().slice(0, 16),
      categoryId: cat0.id,
      categoryName: cat0.name,
      categoryColor: cat0.color,
      priority: 'Alta',
      imageUrl: sampleSvgCard,
      completed: false,
      notified: false,
      createdAt: now - 3600000
    },
    {
      userId: user.uid,
      title: 'Testar upload de foto anexada via Firebase Storage',
      description: 'Anexar captura de tela ou diagrama técnico diretamente no card da tarefa.',
      deadline: new Date(now + 180 * min).toISOString().slice(0, 16),
      categoryId: cat1.id,
      categoryName: cat1.name,
      categoryColor: cat1.color,
      priority: 'Média',
      imageUrl: '',
      completed: false,
      notified: false,
      createdAt: now - 1800000
    }
  ];

  setGlobalLoading(true, 'GERANDO OPERAÇÕES DE DEMONSTRAÇÃO...');
  try {
    if (isFirebaseConfigured() && db) {
      for (const item of demoList) {
        await addDoc(collection(db, 'tasks'), item);
      }
    } else {
      const withIds = demoList.map((item) => ({ id: generateId('tsk'), ...item }));
      const updated = [...withIds, ...store.state.tasks];
      store.state.tasks = updated;
      persistLocalFallbackCollection(LOCAL_FALLBACK_KEYS.TASKS, user.uid, updated);
    }
    playBraunBeep('click');
  } finally {
    setGlobalLoading(false);
  }
}

function init() {
  renderConnectionBanner();
  applyTheme(store.state.theme);
  setDefaultFormDeadline();

  store.subscribe((state, prop) => {
    if (prop === 'theme') {
      applyTheme(state.theme);
      return;
    }
    if (prop === 'currentUser') {
      renderAuthAndProfileView();
    }
    if (prop === 'categories' || prop === 'filterCategory') {
      renderCategoriesUI();
    }
    renderMetricsAndCards();
  });

  // Alternância de abas Login / Cadastro
  [dom.tabLogin, dom.tabRegister].forEach((tabBtn) => {
    tabBtn.addEventListener('click', () => {
      const mode = tabBtn.dataset.authMode;
      store.state.authMode = mode;
      const isRegister = mode === 'register';
      dom.tabLogin.classList.toggle('active', !isRegister);
      dom.tabRegister.classList.toggle('active', isRegister);
      dom.tabLogin.setAttribute('aria-selected', String(!isRegister));
      dom.tabRegister.setAttribute('aria-selected', String(isRegister));
      dom.registerFields.hidden = !isRegister;
      dom.btnAuthText.textContent = isRegister ? 'REGISTRAR OPERADOR' : 'INICIAR SESSÃO SEGURA';
      playBraunBeep('click');
    });
  });

  // Prévia de Avatar no Cadastro
  dom.authAvatarInput.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) {
      dom.authAvatarPreviewWrap.hidden = true;
      return;
    }
    dom.authAvatarPreview.src = await readFileAsDataUrl(file);
    dom.authAvatarName.textContent = file.name;
    dom.authAvatarPreviewWrap.hidden = false;
  });

  // Prévia de Anexo na Tarefa
  dom.taskImageInput.addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) {
      clearTaskImageSelection();
      return;
    }
    dom.taskImagePreview.src = await readFileAsDataUrl(file);
    dom.taskImageName.textContent = file.name;
    dom.taskImagePreviewWrap.hidden = false;
  });

  dom.btnClearTaskImage.addEventListener('click', clearTaskImageSelection);

  // Submissões e Eventos Principais
  dom.authForm.addEventListener('submit', handleAuthFormSubmit);
  dom.profileAvatarUpdate.addEventListener('change', handleProfileAvatarUpdate);
  dom.btnLogout.addEventListener('click', handleLogout);
  dom.taskForm.addEventListener('submit', handleTaskFormSubmit);
  dom.categoryForm.addEventListener('submit', handleCategoryFormSubmit);
  dom.btnCancelCategoryEdit.addEventListener('click', resetCategoryEditForm);
  dom.taskList.addEventListener('click', handleTaskCardAction);

  // Filtros Combinados e Busca com Debounce
  dom.categoryFilters.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-filter-category]');
    if (!btn) return;
    playBraunBeep('click');
    store.state.filterCategory = btn.dataset.filterCategory;
  });

  dom.priorityFilters.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-filter-priority]');
    if (!btn) return;
    playBraunBeep('click');
    store.state.filterPriority = btn.dataset.filterPriority;
    dom.priorityFilters.querySelectorAll('[data-filter-priority]').forEach((b) => {
      b.classList.toggle('active', b.dataset.filterPriority === store.state.filterPriority);
    });
  });

  const debouncedSearch = debounce((val) => {
    store.state.searchQuery = val;
  }, 160);
  dom.searchInput.addEventListener('input', (e) => debouncedSearch(e.target.value));

  // Utilitários, Tema e Modal
  const toggleThemeHandler = () => {
    playBraunBeep('click');
    store.state.theme = store.state.theme === 'dark' ? 'light' : 'dark';
  };
  dom.themeToggle.addEventListener('click', toggleThemeHandler);
  dom.authThemeToggle.addEventListener('click', toggleThemeHandler);

  dom.btnLoadDemo.addEventListener('click', seedDemoTasksForCurrentUser);
  dom.btnResetFilters.addEventListener('click', () => {
    dom.searchInput.value = '';
    store.state.filterCategory = 'Todas';
    store.state.filterPriority = 'Todas';
    store.state.searchQuery = '';
  });

  dom.btnClearCompleted.addEventListener('click', async () => {
    const user = store.state.currentUser;
    if (!user) return;
    const completed = store.state.tasks.filter((t) => t.completed);
    if (completed.length === 0) return;

    if (isFirebaseConfigured() && db) {
      for (const item of completed) {
        await deleteDoc(doc(db, 'tasks', item.id));
      }
    } else {
      const remaining = store.state.tasks.filter((t) => !t.completed);
      store.state.tasks = remaining;
      persistLocalFallbackCollection(LOCAL_FALLBACK_KEYS.TASKS, user.uid, remaining);
    }
    playBraunBeep('click');
  });

  dom.btnTestBeep.addEventListener('click', () => {
    playBraunBeep('alarm');
    showToast({
      tag: 'TESTE ACÚSTICO // WEB AUDIO API',
      title: 'Sintetizador Braun Ativo',
      message: 'Alerta sonoro e visual operacionais.'
    });
  });

  dom.btnNotifyPerm.addEventListener('click', async () => {
    if ('Notification' in window) {
      await Notification.requestPermission();
    }
  });

  dom.btnCloseModal.addEventListener('click', closeImageModal);
  dom.imageModalBackdrop.addEventListener('click', closeImageModal);

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !dom.imageModal.hidden) {
      closeImageModal();
      return;
    }
    if (!store.state.currentUser) return;
    const tag = document.activeElement?.tagName || '';
    const isTyping = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
    if ((e.ctrlKey && e.key.toLowerCase() === 'k') || (!isTyping && e.key === '/')) {
      e.preventDefault();
      dom.searchInput.focus();
    } else if (e.altKey && e.key.toLowerCase() === 'n') {
      e.preventDefault();
      dom.titleInput.focus();
    }
  });

  // Inicialização da Sessão (Firebase Auth Listener ou Sessão Local)
  if (isFirebaseConfigured() && auth) {
    setGlobalLoading(true, 'VERIFICANDO SESSÃO NO FIREBASE AUTH...');
    onAuthStateChanged(auth, async (firebaseUser) => {
      if (firebaseUser) {
        await ensureInitialUserCategories(firebaseUser.uid);
        const mappedUser = {
          uid: firebaseUser.uid,
          displayName: firebaseUser.displayName || firebaseUser.email?.split('@')[0] || 'Operador',
          email: firebaseUser.email,
          photoURL:
            firebaseUser.photoURL ||
            generateInitialsAvatarDataUrl(firebaseUser.displayName || firebaseUser.email)
        };
        store.state.currentUser = mappedUser;
        startUserRealtimeSync(mappedUser);
      } else {
        cleanupRealtimeSubscriptions();
        store.state.currentUser = null;
      }
      setGlobalLoading(false);
    });
  } else {
    const savedSession = window.localStorage.getItem(LOCAL_FALLBACK_KEYS.SESSION);
    if (savedSession) {
      try {
        const parsedUser = JSON.parse(savedSession);
        ensureInitialUserCategories(parsedUser.uid).then(() => {
          store.state.currentUser = parsedUser;
          startUserRealtimeSync(parsedUser);
        });
      } catch {
        store.state.currentUser = null;
      }
    } else {
      renderAuthAndProfileView();
    }
  }

  window.setInterval(() => {
    const now = new Date();
    dom.liveClock.textContent = now.toLocaleTimeString('pt-BR', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
  }, 1000);
  window.setInterval(checkDueTasks, 10000);
}

init();
