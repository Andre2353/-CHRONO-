# CHRONO // TM-01 — Tactile Editorial Task Manager

> Gerenciador de tarefas web de alta precisão construído exclusivamente com **HTML5 Semântico**, **CSS3 Moderno (Custom Properties, Grid Assimétrico, Flexbox)** e **JavaScript Puro (Vanilla ES6+ Reactive Proxy Store)**.

---

## 1. Conceito Visual: Tactile Editorial Chrono

Inspirado no funcionalismo industrial dos instrumentos **Braun (Dieter Rams — calculadora ET66 e cronógrafos DN 40)** combinado com a densidade tipográfica de ferramentas modernas como **Linear**:

- **Topologia Assimétrica:** Painel de comando lateral fixo (`<aside>`) dedicado à entrada de operações e status do sistema, acoplado a um palco principal (`<main>`) com leitura cronológica em tempo real, faixa de métricas e grid responsivo de tarefas.
- **Paleta Sem Clichês:** Superfícies em *Warm Industrial Stone* (`#F4F2ED` no Light Mode) e *Carbon Slate* (`#0E1013` no Dark Mode), com gatilhos físicos em **Signal Orange (`#FF4F00`)** e indicadores semânticos de prioridade e categoria.
- **Tipografia Técnica:** Combinação de `Space Grotesk` para leitura estrutural e `JetBrains Mono` para timestamps, relógio em tempo real, atalhos de teclado (`<kbd>`) e contadores.
- **Botões Táteis:** Sombras em camadas que simulam o curso mecânico de botões físicos ao passar o mouse e pressionar (`:active`).

---

## 2. Arquitetura Reativa em Vanilla JS (`script.js`)

```text
[ Eventos de UI / Teclado / Relógio ]
                 │
                 ▼
      [ ES6 Proxy Store ] ──────► [ Persistência Automática no localStorage ]
                 │
                 ▼
   [ Motor de Ordenação & Filtros (AND + Debounce Search) ]
                 │
                 ▼
   [ Renderização Cirúrgica Segura (DOM API + textContent) ]
```

- **Store Reativo (`Proxy` + `Observer`):** Qualquer mutação em `store.state.tasks`, `store.state.theme` ou nos estados de filtragem sincroniza automaticamente com o `localStorage` e dispara a atualização da interface.
- **Ordenação Inteligente:** As tarefas pendentes são exibidas primeiro, ordenadas da menor data/hora limite para a maior (destacando visualmente em vermelho as operações com prazo expirado), seguidas pelas tarefas concluídas ao final da fila.
- **Prevenção de XSS:** Nenhuma string fornecida pelo usuário é interpolada via `innerHTML`. Todos os nós dinâmicos são sanitizados e injetados via `document.createElement` e `textContent`.
- **Filtros Combinados (Lógica AND) + Busca com Debounce:** Permite cruzar simultaneamente **Categoria** (`Trabalho`, `Casa`, `Escola`, `Compras`), **Prioridade** (`Alta`, `Média`, `Baixa`) e busca textual em tempo real no título ou descrição.

---

## 3. Motor de Lembretes e Síntese Acústica (`Web Audio API`)

1. **Verificação Cronológica Contínua:** Um agendador verifica periodicamente se o horário limite (`deadline`) de alguma tarefa pendente foi atingido.
2. **Toque Braun Sintetizado (`AudioContext`):** Ao atingir o prazo (ou ao acionar o botão *Teste Acústico*), o navegador sintetiza em tempo real uma sequência de pulsos triangulares (`2080Hz` -> `2600Hz`) via `Web Audio API`, sem depender de arquivos `.mp3` ou `.wav` externos.
3. **Notificação Tripla com Controle de Repetição:**
   - Exibe um **Toast In-App** no canto inferior direito (`aria-live="assertive"`).
   - Dispara uma notificação nativa do sistema operacional via **Notification API** (quando autorizada) ou executa fallback automático para `window.alert()`.
   - Marca a propriedade `notified: true` no `localStorage` para garantir que o alerta dispare apenas uma vez por tarefa.

---

## 4. Atalhos de Teclado e Acessibilidade

| Atalho | Ação |
| :--- | :--- |
| `/` ou `Ctrl + K` | Foca e seleciona instantaneamente o campo de busca textual |
| `Alt + N` | Foca diretamente no campo de título para criar uma nova tarefa |

- **Semântica & Leitores de Tela:** Uso estrito de `<aside>`, `<main>`, `<header>`, `<section>`, `<article>` e `<time>`, além de regiões `aria-live="polite"` nos contadores e na listagem de tarefas.
- **Respeito a Movimento Reduzido:** Suporte nativo à media query `@media (prefers-reduced-motion: reduce)`.

---

## 5. Como Executar Localmente

Como o projeto utiliza padrões nativos da Web sem dependências de build:

```bash
# Opção 1: Abrir diretamente no navegador
open index.html   # macOS
start index.html  # Windows
xdg-open index.html # Linux

# Opção 2: Servir via HTTP local (recomendado para testar Notification API em contexto seguro localhost)
npx serve .
# ou
python -m http.server 8080
```
