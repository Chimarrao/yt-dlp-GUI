# yt-dlp GUI

Interface gráfica completa para o **yt-dlp**, feita com Electron + Vue 3 + PrimeVue.

---

## O que é Electron?

Electron é um framework que permite criar aplicativos desktop usando tecnologias web (HTML, CSS, JavaScript). Ele empacota o **Chromium** (o motor do Chrome) junto com o **Node.js** em um único executável.

Um app Electron é dividido em **3 camadas** que se comunicam entre si:

```
┌──────────────────────────────────────────────────────┐
│  MAIN PROCESS (Node.js)                              │
│  Roda no backend. Tem acesso total ao sistema:       │
│  arquivos, processos, notificações, etc.             │
│                                                      │
│  ┌────────────────────────────────────────────────┐  │
│  │  PRELOAD (ponte)                               │  │
│  │  Roda antes da página carregar. Expõe          │  │
│  │  funções seguras do Main para o Renderer.      │  │
│  └──────────────┬─────────────────────────────────┘  │
│                 │ window.api.*                        │
│  ┌──────────────▼─────────────────────────────────┐  │
│  │  RENDERER PROCESS (Chromium)                   │  │
│  │  É basicamente um navegador. Roda a UI         │  │
│  │  (Vue, HTML, CSS). NÃO tem acesso direto       │  │
│  │  ao sistema operacional.                       │  │
│  └────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────┘
```

**Por que essa separação?** Segurança. O Renderer é como uma página web — se ele tivesse acesso direto ao sistema, qualquer script malicioso poderia ler/escrever arquivos. O Preload funciona como um "porteiro": só permite as operações que nós explicitamente autorizamos.

---

## Ordem de execução

Quando o app inicia, a sequência é:

```
1. Electron inicia
2. → Carrega src/main/index.ts (Main Process)
3.   → Cria a janela (BrowserWindow)
4.   → Registra os handlers IPC (download, formatos, deps, etc.)
5.   → Inicia o clipboard watcher (clipboard.ts)
6.   → Carrega o Preload (src/preload/index.ts)
7.     → Expõe window.api com as funções seguras
8.   → Carrega o Renderer (src/renderer/index.html)
9.     → Vue monta o App (main.ts → App.vue)
10.    → Componentes usam window.api para falar com o Main
```

Quando o usuário clica em "Iniciar Download", por exemplo:

```
Renderer (App.vue)
  → chama window.api.startDownload(...)    [via Preload]
  → ipcRenderer.invoke('ytdlp:download')   [Preload → Main]
  → Main recebe e executa ytdlp.ts          [spawna yt-dlp]
  → yt-dlp imprime progresso no stdout
  → Main parseia e envia via IPC            [Main → Renderer]
  → Renderer atualiza o ProgressBar
```

---

## Estrutura de arquivos

### Configuração (raiz)

| Arquivo | O que é |
|---|---|
| `package.json` | Dependências e scripts (`dev`, `build:mac`, etc.) |
| `electron-builder.yml` | Configuração do empacotamento (ícone, nome, targets) |
| `electron.vite.config.ts` | Configuração do Vite para os 3 processos |
| `tsconfig.json` | Configuração do TypeScript |

### Main Process — `src/main/`

Roda no **backend** (Node.js). Tem acesso total ao SO.

| Arquivo | Responsabilidade |
|---|---|
| `index.ts` | **Ponto de entrada**. Cria a janela, registra todos os handlers IPC (download, formatos, dependências, diálogo de pasta), inicia o clipboard watcher. |
| `deps.ts` | Verifica se `yt-dlp` e `ffmpeg` estão instalados. Se não, instala automaticamente (brew no Mac, apt no Linux, download direto no Windows). |
| `clipboard.ts` | Monitora a área de transferência a cada 1.5s. Quando detecta uma URL do YouTube, envia para o Renderer e dispara uma notificação nativa do SO. |
| `ytdlp.ts` | Motor de download. Spawna o processo `yt-dlp`, parseia o progresso (%, velocidade, ETA) em tempo real da stdout, e envia os dados para o Renderer via IPC. Também lista formatos disponíveis de um vídeo. |

### Preload — `src/preload/`

**Ponte** entre Main e Renderer. Roda em contexto isolado.

| Arquivo | Responsabilidade |
|---|---|
| `index.ts` | Expõe `window.api` com funções tipo `startDownload()`, `listFormats()`, `checkDep()`, `onDownloadProgress()`, etc. Internamente cada uma chama `ipcRenderer.invoke()` ou `ipcRenderer.on()`. |
| `index.d.ts` | Tipagens TypeScript para que o Renderer saiba quais funções existem em `window.api`. |

### Renderer — `src/renderer/`

Roda no **Chromium** (navegador). É a interface visual.

| Arquivo | Responsabilidade |
|---|---|
| `index.html` | HTML base. Carrega a fonte Inter e define as regras CSP. |
| `src/main.ts` | Inicializa o Vue, registra PrimeVue com tema Aura escuro, ToastService, etc. |
| `src/App.vue` | **Layout principal**. Sidebar (nav) + área de conteúdo. Gerencia as views (Downloads / Configurações), escuta eventos IPC (progresso, erros, clipboard). |
| `src/stores/downloads.ts` | Store reativo — gerencia a fila de downloads (status, %, velocidade, erros) e as configurações do app (cookies, diretório, formato padrão). |
| `src/components/UrlInput.vue` | Campo de texto para colar URLs + botões "Adicionar" e "Colar". Extrai URLs do YouTube do texto colado. |
| `src/components/DownloadCard.vue` | Card de cada download na fila — mostra thumbnail, título, barra de progresso, velocidade, ETA, badges de status e botões de ação (play, cancelar, retry, remover, escolher qualidade). |
| `src/components/FormatDialog.vue` | Dialog modal que consulta os formatos disponíveis de um vídeo via `yt-dlp -j` e exibe numa tabela selecionável (resolução, codec, fps, tamanho). |
| `src/components/SettingsPanel.vue` | Painel de configurações — toggle de cookies, seleção de navegador, diretório de saída, formato padrão, e status/instalação de dependências. |

---

## Pré-requisitos

- **Node.js** ≥ 18 (recomendado 20+)
- **npm** (vem junto com o Node.js)

> O app detecta automaticamente se `yt-dlp` e `ffmpeg` estão instalados.
> Se não encontrar, você pode instalá-los pela tela de **Configurações** dentro do app.

---

## Rodando em modo desenvolvimento

```bash
# 1. Instale as dependências (só na primeira vez)
npm install

# 2. Inicie o app com hot-reload
npm run dev
```

O Electron abre automaticamente. Alterações no código do renderer recarregam ao vivo.

---

## Compilando para distribuição

### macOS (.dmg)

```bash
npm run build:mac
```

O `.dmg` será gerado em `dist/`.

### Windows (.exe / NSIS installer)

```bash
npm run build:win
```

Gera um instalador `.exe` em `dist/`. \
Se estiver compilando a partir de um Mac/Linux, é necessário instalar o [Wine](https://www.winehq.org/) para cross-compilation, ou usar uma máquina Windows / CI.

### Linux (.AppImage / .deb / .snap)

```bash
npm run build:linux
```

Gera `.AppImage`, `.deb` e `.snap` em `dist/`.

---

## Estrutura dos scripts

| Script | O que faz |
|---|---|
| `npm run dev` | Inicia o app em modo desenvolvimento com hot-reload |
| `npm start` | Roda a versão built (precisa de `npm run build` antes) |
| `npm run build` | Compila o TypeScript + Vite (sem gerar instalador) |
| `npm run build:mac` | Build + gera `.dmg` para macOS |
| `npm run build:win` | Build + gera instalador `.exe` para Windows |
| `npm run build:linux` | Build + gera `.AppImage` / `.deb` / `.snap` para Linux |
| `npm run build:unpack` | Build + gera versão descompactada (sem instalador) |
| `npm run lint` | Roda o ESLint |
| `npm run format` | Formata o código com Prettier |

---