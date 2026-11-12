/**
 * CHRONO // TM-01 — Tactile Task Manager
 * Arquitetura State-Driven Reativa (ES6 Proxy + Observer) em Vanilla JS
 * Inclui: Persistência LocalStorage, Ordenação Cronológica, Prevenção XSS,
 * Síntese Acústica Braun (Web Audio API), Notification API + Fallback Alert e Busca com Debounce.
 */

(() => {
  'use strict';

  /* ==========================================================================
     1. CONSTANTES E CHAVES DE ARMAZENAMENTO
     ========================================================================== */
  const STORAGE_KEYS = {
    TASKS: 'chrono_tm01_tasks_v1',
    THEME: 'chrono_tm01_theme_v1'
  };

  const VALID_CATEGORIES = ['Trabalho', 'Casa', 'Escola', 'Compras'];
  const VALID_PRIORITIES = ['Baixa', 'Média', 'Alta'];

  /* ==========================================================================
     2. UTILITÁRIOS DE SEGURANÇA (ANTI-XSS) E FORMATAÇÃO
     ========================================================================== */
  /**
   * Sanitiza qualquer string de entrada removendo caracteres de controle e tags HTML.
   * Além disso, a renderização no DOM utiliza estritamente textContent.
   */
  function sanitizeString(value, maxLength = 320) {
    if (typeof value !== 'string') return '';
    return value
      .replace(/[<>]/g, '')
      .trim()
      .slice(0, maxLength);
  }

  function generateId() {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
    return 'tm_' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 9);
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

  /* ==========================================================================
     3. WEB AUDIO API — SINTETIZADOR DE TOQUE MECÂNICO BRAUN (ZERO ASSETS EXTERNOS)
     ========================================================================== */
  let sharedAudioCtx = null;

  function playBraunBeep(type = 'alarm') {
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;

      if (!sharedAudioCtx) {
        sharedAudioCtx = new AudioCtx();
      }
      if (sharedAudioCtx.state === 'suspended') {
        sharedAudioCtx.resume();
      }

      const now = sharedAudioCtx.currentTime;
      const pattern = type === 'alarm'
        ? [
            { freq: 2080, start: 0.0, duration: 0.065 },
            { freq: 2080, start: 0.11, duration: 0.065 },
            { freq: 2600, start: 0.24, duration: 0.11 }
          ]
        : [{ freq: 1760, start: 0.0, duration: 0.045 }];

      pattern.forEach(({ freq, start, duration }) => {
        const osc = sharedAudioCtx.createOscillator();
        const gain = sharedAudioCtx.createGain();

        osc.type = 'triangle';
        osc.frequency.setValueAtTime(freq, now + start);

        gain.gain.setValueAtTime(0.0001, now + start);
        gain.gain.exponentialRampToValueAtTime(0.16, now + start + 0.008);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + start + duration);

        osc.connect(gain);
        gain.connect(sharedAudioCtx.destination);

        osc.start(now + start);
        osc.stop(now + start + duration + 0.01);
      });
    } catch {
      /* Silencia caso o navegador bloqueie autoplay de áudio antes de interação */
    }
  }

  /* ==========================================================================
     4. PERSISTÊNCIA EM LOCALSTORAGE E DADOS DE DEMONSTRAÇÃO
     ========================================================================== */
  function loadTasksFromStorage() {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEYS.TASKS);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed.filter(
        (item) =>
          item &&
          typeof item.id === 'string' &&
          typeof item.title === 'string' &&
          VALID_CATEGORIES.includes(item.category) &&
          VALID_PRIORITIES.includes(item.priority)
      );
    } catch {
      return [];
    }
  }

  function saveTasksToStorage(tasks) {
    try {
      window.localStorage.setItem(STORAGE_KEYS.TASKS, JSON.stringify(tasks));
    } catch {
      showToast({
        tag: 'ERRO DE STORAGE',
        title: 'Falha ao persistir no navegador',
        message: 'Verifique se o armazenamento local está cheio ou bloqueado.',
        urgent: true
      });
    }
  }

  function createDemoTasks() {
    const now = Date.now();
    const min = 60 * 1000;
    const hour = 60 * min;

    return [
      {
        id: generateId(),
        title: 'Revisar contrato de arquitetura front-end e tokens de design',
        description: 'Validar contraste WCAG AA nos temas claro/escuro e inspecionar responsividade do grid assimétrico.',
        deadline: new Date(now + 25 * min).toISOString().slice(0, 16),
        priority: 'Alta',
        category: 'Trabalho',
        completed: false,
        notified: false,
        createdAt: now - 3 * hour
      },
      {
        id: generateId(),
        title: 'Entregar relatório do seminário de Sistemas Distribuídos',
        description: 'Anexar diagramas de estado reativo e referências bibliográficas em formato PDF.',
        deadline: new Date(now - 40 * min).toISOString().slice(0, 16),
        priority: 'Alta',
        category: 'Escola',
        completed: false,
        notified: true,
        createdAt: now - 5 * hour
      },
      {
        id: generateId(),
        title: 'Comprar lâmpadas filamento LED 2700K e suporte de mesa',
        description: 'Verificar especificações de luminária articulada para bancada de estudo.',
        deadline: new Date(now + 4 * hour).toISOString().slice(0, 16),
        priority: 'Média',
        category: 'Compras',
        completed: false,
        notified: false,
        createdAt: now - 2 * hour
      },
      {
        id: generateId(),
        title: 'Organizar backup local do servidor doméstico NAS',
        description: 'Limpar snapshots antigos e testar restauração automática.',
        deadline: new Date(now + 24 * hour).toISOString().slice(0, 16),
        priority: 'Baixa',
        category: 'Casa',
        completed: true,
        notified: true,
        createdAt: now - 12 * hour
      }
    ];
  }

  /* ==========================================================================
     5. STORE REATIVO (PROXY + PUB/SUB OBSERVER)
     ========================================================================== */
  function createReactiveStore(initialState) {
    const listeners = new Set();

    const stateProxy = new Proxy(initialState, {
      set(target, property, value) {
        target[property] = value;
        if (property === 'tasks') {
          saveTasksToStorage(value);
        }
        if (property === 'theme') {
          try {
            window.localStorage.setItem(STORAGE_KEYS.THEME, value);
          } catch {
            /* Ignora restrição de storage */
          }
        }
        listeners.forEach((listener) => listener(target, property));
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

  const savedTheme = window.localStorage.getItem(STORAGE_KEYS.THEME) || 'light';

  const store = createReactiveStore({
    tasks: loadTasksFromStorage(),
    filterCategory: 'Todas',
    filterPriority: 'Todas',
    searchQuery: '',
    theme: savedTheme === 'dark' ? 'dark' : 'light'
  });

  /* ==========================================================================
     6. ELEMENTOS DO DOM
     ========================================================================== */
  const dom = {
    html: document.documentElement,
    taskForm: document.getElementById('task-form'),
    titleInput: document.getElementById('task-title'),
    descInput: document.getElementById('task-desc'),
    deadlineInput: document.getElementById('task-deadline'),
    categorySelect: document.getElementById('task-category'),
    prioritySelect: document.getElementById('task-priority'),
    taskList: document.getElementById('task-list'),
    emptyState: document.getElementById('empty-state'),
    emptyTitle: document.getElementById('empty-title'),
    emptyDesc: document.getElementById('empty-desc'),
    btnLoadDemo: document.getElementById('btn-load-demo'),
    btnResetFilters: document.getElementById('btn-reset-filters'),
    btnClearCompleted: document.getElementById('btn-clear-completed'),
    searchInput: document.getElementById('search-input'),
    categoryFilters: document.getElementById('category-filters'),
    priorityFilters: document.getElementById('priority-filters'),
    statTotal: document.getElementById('stat-total'),
    statPending: document.getElementById('stat-pending'),
    statOverdue: document.getElementById('stat-overdue'),
    statCompleted: document.getElementById('stat-completed'),
    liveClock: document.getElementById('live-clock'),
    themeToggle: document.getElementById('theme-toggle'),
    themeLabel: document.getElementById('theme-label'),
    btnNotifyPerm: document.getElementById('btn-notify-perm'),
    notifyStatusDot: document.getElementById('notify-status-dot'),
    notifyStatusText: document.getElementById('notify-status-text'),
    btnTestBeep: document.getElementById('btn-test-beep'),
    toastContainer: document.getElementById('toast-container')
  };

  /* ==========================================================================
     7. SISTEMA DE NOTIFICAÇÕES (TOAST IN-APP + NOTIFICATION API + ALERT FALLBACK)
     ========================================================================== */
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
    closeBtn.setAttribute('aria-label', 'Fechar notificação');
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
      if (toast.parentNode) {
        toast.remove();
      }
    }, 6500);
  }

  function updateNotificationStatusUI() {
    if (!('Notification' in window)) {
      dom.notifyStatusDot.className = 'status-dot denied';
      dom.notifyStatusText.textContent = 'API NÃO SUPORTADA (FALLBACK ALERT)';
      return;
    }

    const perm = Notification.permission;
    if (perm === 'granted') {
      dom.notifyStatusDot.className = 'status-dot granted';
      dom.notifyStatusText.textContent = 'NOTIFICAÇÕES ATIVAS';
    } else if (perm === 'denied') {
      dom.notifyStatusDot.className = 'status-dot denied';
      dom.notifyStatusText.textContent = 'BLOQUEADO (USANDO ALERT)';
    } else {
      dom.notifyStatusDot.className = 'status-dot';
      dom.notifyStatusText.textContent = 'ATIVAR ALERTAS DO SISTEMA';
    }
  }

  async function requestSystemNotificationPermission() {
    if (!('Notification' in window)) {
      showToast({
        tag: 'MODO FALLBACK',
        title: 'Notification API indisponível',
        message: 'Este navegador usará alert() e Toast visual quando um prazo vencer.'
      });
      return;
    }

    try {
      const result = await Notification.requestPermission();
      updateNotificationStatusUI();
      playBraunBeep('click');
      if (result === 'granted') {
        showToast({
          tag: 'PERMISSÃO CONCEDIDA',
          title: 'Alertas nativos habilitados',
          message: 'Você receberá notificações do sistema quando o horário limite chegar.'
        });
      }
    } catch {
      updateNotificationStatusUI();
    }
  }

  function dispatchDeadlineReminder(task) {
    playBraunBeep('alarm');

    showToast({
      tag: `PRAZO ATINGIDO // ${task.priority.toUpperCase()}`,
      title: task.title,
      message: `Categoria: ${task.category} — Limite: ${formatDeadline(task.deadline)}`,
      urgent: true
    });

    if ('Notification' in window && Notification.permission === 'granted') {
      try {
        new Notification(`⏰ Prazo Limite: ${task.title}`, {
          body: `[${task.category} | Prioridade ${task.priority}] ${task.description || 'Verifique sua tarefa agora.'}`,
          tag: task.id
        });
        return;
      } catch {
        /* Continua para o fallback alert() */
      }
    }

    window.setTimeout(() => {
      window.alert(
        `⏰ LEMBRETE CHRONO TM-01\n\nTarefa: ${task.title}\nCategoria: ${task.category} | Prioridade: ${task.priority}\nPrazo: ${formatDeadline(task.deadline)}`
      );
    }, 120);
  }

  function checkDueTasks() {
    const now = Date.now();
    let mutated = false;

    const updatedTasks = store.state.tasks.map((task) => {
      if (task.completed || task.notified) return task;
      const deadlineMs = new Date(task.deadline).getTime();
      if (!Number.isNaN(deadlineMs) && now >= deadlineMs) {
        mutated = true;
        dispatchDeadlineReminder(task);
        return { ...task, notified: true };
      }
      return task;
    });

    if (mutated) {
      store.state.tasks = updatedTasks;
    } else {
      renderMetricsAndCards();
    }
  }

  /* ==========================================================================
     8. ORDENAÇÃO INTELIGENTE, FILTRAGEM (AND) E RENDERIZAÇÃO SEGURA (DOM API)
     ========================================================================== */
  function getSortedAndFilteredTasks() {
    const { tasks, filterCategory, filterPriority, searchQuery } = store.state;
    const normalizedQuery = searchQuery.trim().toLowerCase();

    const filtered = tasks.filter((task) => {
      const matchesCategory = filterCategory === 'Todas' || task.category === filterCategory;
      const matchesPriority = filterPriority === 'Todas' || task.priority === filterPriority;
      const matchesSearch =
        normalizedQuery === '' ||
        task.title.toLowerCase().includes(normalizedQuery) ||
        (task.description && task.description.toLowerCase().includes(normalizedQuery));

      return matchesCategory && matchesPriority && matchesSearch;
    });

    return filtered.sort((a, b) => {
      // 1. Pendentes primeiro, Concluídas ao final
      if (a.completed !== b.completed) {
        return a.completed ? 1 : -1;
      }
      // 2. Menor data/hora limite para a maior
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

    // Topo: Categoria + Prioridade
    const metaTop = document.createElement('div');
    metaTop.className = 'card-meta-top';

    const catBadge = document.createElement('span');
    catBadge.className = 'badge-category';
    catBadge.dataset.cat = task.category;
    catBadge.textContent = task.category;

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

    // Corpo: Título + Descrição (Sanitizados com textContent)
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

    // Rodapé: Prazo + Botões de Ação
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
    btnToggle.setAttribute(
      'aria-label',
      task.completed ? `Reabrir tarefa ${task.title}` : `Marcar tarefa ${task.title} como concluída`
    );
    btnToggle.textContent = task.completed ? 'REABRIR' : 'CONCLUIR';

    const btnDelete = document.createElement('button');
    btnDelete.type = 'button';
    btnDelete.className = 'btn-card-action btn-delete';
    btnDelete.dataset.action = 'delete';
    btnDelete.dataset.id = task.id;
    btnDelete.setAttribute('aria-label', `Excluir tarefa ${task.title}`);
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

  function formatMetricNumber(num) {
    return String(num).padStart(2, '0');
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

    dom.statTotal.textContent = formatMetricNumber(totalCount);
    dom.statPending.textContent = formatMetricNumber(pendingCount);
    dom.statOverdue.textContent = formatMetricNumber(overdueCount);
    dom.statCompleted.textContent = formatMetricNumber(completedCount);

    const visibleTasks = getSortedAndFilteredTasks();
    dom.taskList.replaceChildren();

    if (visibleTasks.length === 0) {
      dom.emptyState.hidden = false;
      const hasActiveFilters =
        store.state.filterCategory !== 'Todas' ||
        store.state.filterPriority !== 'Todas' ||
        store.state.searchQuery.trim() !== '';

      if (allTasks.length === 0) {
        dom.emptyTitle.textContent = 'Nenhuma operação ativa no radar';
        dom.emptyDesc.textContent =
          'Sua fila cronológica está vazia. Cadastre uma nova tarefa no painel lateral ou carregue os dados de demonstração.';
        dom.btnLoadDemo.hidden = false;
        dom.btnResetFilters.hidden = true;
      } else if (hasActiveFilters) {
        dom.emptyTitle.textContent = 'Nenhuma tarefa corresponde aos filtros';
        dom.emptyDesc.textContent =
          'Ajuste a busca textual ou limpe a combinação atual de Categoria e Prioridade.';
        dom.btnLoadDemo.hidden = true;
        dom.btnResetFilters.hidden = false;
      }
      return;
    }

    dom.emptyState.hidden = true;
    const fragment = document.createDocumentFragment();
    visibleTasks.forEach((task) => {
      fragment.appendChild(createTaskCardElement(task, nowMs));
    });
    dom.taskList.appendChild(fragment);
  }

  function applyTheme(theme) {
    dom.html.setAttribute('data-theme', theme);
    const isDark = theme === 'dark';
    dom.themeToggle.setAttribute('aria-pressed', String(isDark));
    dom.themeLabel.textContent = isDark ? 'LIGHT MODE' : 'DARK MODE';
  }

  function syncFilterButtonsUI() {
    const catButtons = dom.categoryFilters.querySelectorAll('[data-filter-category]');
    catButtons.forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.filterCategory === store.state.filterCategory);
    });

    const prioButtons = dom.priorityFilters.querySelectorAll('[data-filter-priority]');
    prioButtons.forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.filterPriority === store.state.filterPriority);
    });
  }

  /* ==========================================================================
     9. AÇÕES DE NEGÓCIO E EVENT LISTENERS
     ========================================================================== */
  function setDefaultFormDeadline() {
    const defaultTime = new Date(Date.now() + 60 * 60 * 1000);
    const tzOffsetMs = defaultTime.getTimezoneOffset() * 60 * 1000;
    const localISOTime = new Date(defaultTime.getTime() - tzOffsetMs).toISOString().slice(0, 16);
    dom.deadlineInput.value = localISOTime;
  }

  function handleFormSubmit(event) {
    event.preventDefault();

    const cleanTitle = sanitizeString(dom.titleInput.value, 90);
    const cleanDesc = sanitizeString(dom.descInput.value, 320);
    const rawDeadline = dom.deadlineInput.value;
    const category = VALID_CATEGORIES.includes(dom.categorySelect.value)
      ? dom.categorySelect.value
      : 'Trabalho';
    const priority = VALID_PRIORITIES.includes(dom.prioritySelect.value)
      ? dom.prioritySelect.value
      : 'Média';

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
        message: 'Selecione uma data/hora válida para o motor de lembretes.',
        urgent: true
      });
      return;
    }

    const newTask = {
      id: generateId(),
      title: cleanTitle,
      description: cleanDesc,
      deadline: rawDeadline,
      category,
      priority,
      completed: false,
      notified: false,
      createdAt: Date.now()
    };

    store.state.tasks = [newTask, ...store.state.tasks];
    playBraunBeep('click');

    dom.taskForm.reset();
    setDefaultFormDeadline();
    dom.titleInput.focus();

    showToast({
      tag: 'REGISTRO CONFIRMADO',
      title: newTask.title,
      message: `Agendada em ${newTask.category} (${newTask.priority}) para ${formatDeadline(newTask.deadline)}.`
    });
  }

  function handleCardActionClick(event) {
    const actionBtn = event.target.closest('button[data-action]');
    if (!actionBtn) return;

    const { action, id } = actionBtn.dataset;
    if (!id) return;

    if (action === 'toggle') {
      playBraunBeep('click');
      store.state.tasks = store.state.tasks.map((task) =>
        task.id === id ? { ...task, completed: !task.completed } : task
      );
    } else if (action === 'delete') {
      playBraunBeep('click');
      store.state.tasks = store.state.tasks.filter((task) => task.id !== id);
    }
  }

  function updateLiveClock() {
    const now = new Date();
    dom.liveClock.textContent = now.toLocaleTimeString('pt-BR', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
    dom.liveClock.setAttribute('datetime', now.toISOString());
  }

  function registerKeyboardShortcuts() {
    window.addEventListener('keydown', (event) => {
      const activeTag = document.activeElement ? document.activeElement.tagName : '';
      const isTyping = activeTag === 'INPUT' || activeTag === 'TEXTAREA' || activeTag === 'SELECT';

      // Ctrl+K ou '/' fora de campos de texto -> Foca na busca
      if ((event.ctrlKey && event.key.toLowerCase() === 'k') || (!isTyping && event.key === '/')) {
        event.preventDefault();
        dom.searchInput.focus();
        dom.searchInput.select();
        return;
      }

      // Alt+N -> Foca no campo de título de nova tarefa
      if (event.altKey && event.key.toLowerCase() === 'n') {
        event.preventDefault();
        dom.titleInput.focus();
      }
    });
  }

  /* ==========================================================================
     10. INICIALIZAÇÃO DO SISTEMA
     ========================================================================== */
  function init() {
    // Inscreve a UI no Store Reativo
    store.subscribe((state, changedProp) => {
      if (changedProp === 'theme') {
        applyTheme(state.theme);
      } else {
        syncFilterButtonsUI();
        renderMetricsAndCards();
      }
    });

    // Aplica estado inicial
    applyTheme(store.state.theme);
    setDefaultFormDeadline();
    updateNotificationStatusUI();
    updateLiveClock();
    renderMetricsAndCards();

    // Eventos de Formulário e Cards
    dom.taskForm.addEventListener('submit', handleFormSubmit);
    dom.taskList.addEventListener('click', handleCardActionClick);

    // Eventos de Filtros Combinados (AND)
    dom.categoryFilters.addEventListener('click', (event) => {
      const btn = event.target.closest('[data-filter-category]');
      if (!btn) return;
      playBraunBeep('click');
      store.state.filterCategory = btn.dataset.filterCategory;
    });

    dom.priorityFilters.addEventListener('click', (event) => {
      const btn = event.target.closest('[data-filter-priority]');
      if (!btn) return;
      playBraunBeep('click');
      store.state.filterPriority = btn.dataset.filterPriority;
    });

    // Busca Instantânea com Debounce
    const handleDebouncedSearch = debounce((value) => {
      store.state.searchQuery = value;
    }, 160);

    dom.searchInput.addEventListener('input', (event) => {
      handleDebouncedSearch(event.target.value);
    });

    // Botões Utilitários e Empty State (P2)
    dom.btnLoadDemo.addEventListener('click', () => {
      playBraunBeep('click');
      store.state.tasks = createDemoTasks();
      showToast({
        tag: 'DADOS DE DEMONSTRAÇÃO',
        title: '4 tarefas carregadas com sucesso',
        message: 'Experimente os filtros combinados de Categoria e Prioridade.'
      });
    });

    dom.btnResetFilters.addEventListener('click', () => {
      playBraunBeep('click');
      dom.searchInput.value = '';
      store.state.filterCategory = 'Todas';
      store.state.filterPriority = 'Todas';
      store.state.searchQuery = '';
    });

    dom.btnClearCompleted.addEventListener('click', () => {
      const completedCount = store.state.tasks.filter((t) => t.completed).length;
      if (completedCount === 0) {
        showToast({
          tag: 'LIMPEZA DE FILA',
          title: 'Nenhuma tarefa concluída',
          message: 'Marque tarefas como concluídas antes de limpar o histórico.'
        });
        return;
      }
      playBraunBeep('click');
      store.state.tasks = store.state.tasks.filter((t) => !t.completed);
      showToast({
        tag: 'HISTÓRICO LIMPO',
        title: `${completedCount} tarefa(s) concluída(s) removida(s)`,
        message: 'O armazenamento local foi atualizado.'
      });
    });

    // Alternância de Tema (Dark Mode)
    dom.themeToggle.addEventListener('click', () => {
      playBraunBeep('click');
      store.state.theme = store.state.theme === 'dark' ? 'light' : 'dark';
    });

    // Permissão de Notificação e Teste Acústico Braun
    dom.btnNotifyPerm.addEventListener('click', requestSystemNotificationPermission);
    dom.btnTestBeep.addEventListener('click', () => {
      playBraunBeep('alarm');
      showToast({
        tag: 'TESTE DE ALERTA // WEB AUDIO API',
        title: 'Sinal Acústico Braun ET66 Ativo',
        message: 'O sintetizador nativo e o módulo de Toast estão operacionais.'
      });
    });

    // Atalhos de Teclado e Loops Cronológicos
    registerKeyboardShortcuts();
    window.setInterval(updateLiveClock, 1000);
    window.setInterval(checkDueTasks, 10000);
    checkDueTasks();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
