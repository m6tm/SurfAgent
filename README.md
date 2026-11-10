# SurfAgent

Extension Chrome (Manifest V3) de **navigation web autonome**, concue pour etre integree par d'autres outils et applications.

SurfAgent embarque un orchestrateur multi-agents (LangGraph) dans le service worker : il route chaque demande utilisateur entre conversation simple et mode agent, decide via un serveur Laya auto-heberge (System 1) ou un LLM de secours, retient le contexte des pages visitees dans une memoire vectorielle locale, et expose le tout par un protocole de messages simple que n'importe quelle surface (popup, content script, application tierce) peut consommer.

## Cas d'usage d'integration

- **Applications web** : injecter le champ flottant ou appeler le service worker directement pour deleguer une navigation a l'agent.
- **Outils developpeur / CLIs** : consommer les routes de messages (`AGENTS:ASK`, `AGENTS:INGEST_PAGE`, `MODELS:*`, `LAYA:*`) comme API interne du navigateur.
- **Workflows d'automatisation** : indexation RAG de pages, sauvegarde et recherche de memoire, recuperation de contenu web, orchestration multi-etapes avec plan affichable.

## Architecture

```
src/
├── agents/              Orchestrateur multi-agents (LangChain / LangGraph)
│   ├── graph.ts         Graphe : route -> retrieve -> chat | agent
│   ├── router.ts        Routeur (Laya prioritaire, fallback LLM JSON)
│   ├── laya.ts          Client Laya AI (protocole Jev /v1/systemone)
│   ├── tools.ts         Outils agent : search_memory, save_memory, fetch_web
│   ├── codexApi.ts      Acces backend Codex (auth, SSE, catalogue modeles)
│   ├── codexChatModel.ts Adapteur LangChain <-> backend Codex
│   ├── state.ts         Etat partage du graphe (reducer LangGraph)
│   └── rag/             Memoire vectorielle locale (IndexedDB)
│       ├── store.ts     Store + similarite cosinus + deduplication par URL
│       ├── embeddings.ts Embeddings locaux (aucun appel reseau)
│       └── ingest.ts    Ingestion pages / conversations / notes
├── background/          Service worker MV3 (module, chargement paresseux)
│   └── index.ts         Routeur de messages (protocole d'integration)
├── content/             Content script (injection shadow DOM)
│   ├── FloatingAssistant.tsx  UI flottante : chat, mode badge, plan de todos
│   ├── markdown.ts      Renderer Markdown -> HTML (tables, listes, citations)
│   └── content.css      Design glassmorphism premium
├── popup/               Popup (etat de connexion)
├── options/             Page options (auth, endpoint Laya)
└── shared/
    ├── config.ts        Constantes (endpoints IA, cles de stockage)
    ├── messaging.ts     sendToBackground / sendToTab
    └── types.ts         Protocole de messages (union discriminante) + types
```

## Protocole de messages (point d'integration)

Toute interaction passe par une union discriminante `RuntimeMessage` (`src/shared/types.ts`) et `sendToBackground` (`src/shared/messaging.ts`). Routes disponibles :

| Message | Payload | Reponse |
| --- | --- | --- |
| `AGENTS:ASK` | `{ question, page }` | `AgentTurnResult` : mode choisi, source de routage, confiance, reponse Markdown, todos, avertissement |
| `AGENTS:INGEST_PAGE` | `{ page }` | Nombre de chunks indexes (deduplique par URL) |
| `PAGE:ASK` | `{ question, page, files? }` | Reponse directe du modele (sans orchestration) |
| `MODELS:LIST` / `MODELS:SELECT` | - / `{ model }` | Catalogue du compte + modele actif |
| `LAYA:GET` / `LAYA:SET` / `LAYA:TEST` | - / `{ endpoint }` | Endpoint Laya configure, test de connectivite |
| `AUTH:*` | - | Connexion ChatGPT (device-code), statut, deconnexion |

Un tour `AGENTS:ASK` renvoie un resultat typique :

```json
{
  "mode": "agent",
  "routingSource": "laya",
  "confidence": 0.88,
  "answer": "## Reponse ...",
  "todos": [{ "id": "todo-1", "label": "Recuperer la page", "status": "done" }],
  "warning": null
}
```

## Orchestration

1. **Routage** : Laya (System 1, une passe, sorties typees) decide entre conversation simple et mode agent ; sans serveur Laya configure, un LLM repond en JSON structure avec le meme contrat.
2. **Retrieval** : recherche vectorielle (cosinus) dans la memoire locale ; ingestion automatique de la page courante a l'ouverture de l'assistant, deduplique par URL.
3. **Chat** : reponse directe au modele avec contexte RAG + page.
4. **Agent** : planification JSON (todos + appels d'outils bornes a 5), execution sequentielle (`search_memory`, `save_memory`, `fetch_web`), synthese finale. Degradation propre vers le chat si le plan n'est pas parsable.

Le service worker demarre en ~5 ko ; les modules LangGraph et RAG (1 Mo) sont charges a la demande au premier tour d'agent.

## Authentification

L'extension reprend le circuit du client open-source **Codex CLI** (aucune application a creer sur `platform.openai.com`) :

1. **Device-code flow** : demande de code d'appareil au backend OpenAI avec le client OAuth public de Codex (`app_EMoamEEZ73f0CkXaXp7hrann`), l'utilisateur valide sur `auth.openai.com/codex/device`, l'extension poll jusqu'a la validation.
2. **Backend IA** : appels vers `chatgpt.com/backend-api/codex` (Responses API en SSE), catalogue de modeles compte-specifique via `/models?client_version=1.0.0` (cache 1 h).

Notes :

- Utilisation **non officielle** du backend abonnement ChatGPT ; les endpoints peuvent changer sans preavis.
- Requiert un compte ChatGPT avec acces a Codex ; les modeles dependant du plan.
- Tokens dans `chrome.storage.local` (survivent au rechargement), catalogue de modeles dans `chrome.storage.session`.
- Usage personnel uniquement, dans le respect des conditions OpenAI.

## Laya AI (optionnel)

Laya est un modele de decision System 1 auto-heberge (serveur HTTP compatible Jev). Configurer l'endpoint (par defaut `http://127.0.0.1:9500`) dans la page options. Sans Laya, chaque decision bascule automatiquement sur le fallback LLM — le systeme reste entierement fonctionnel.

## Installation (dev)

```bash
pnpm install
pnpm build
```

1. Ouvrir `chrome://extensions`
2. Activer le mode developpeur
3. "Charger l'extension non empaquetee" -> selectionner `dist/`

Mode dev avec HMR (popup + options uniquement ; le content script doit etre recharge en rechargant l'extension) :

```bash
pnpm dev
```

## Scripts

| Commande | Action |
| --- | --- |
| `pnpm dev` | Dev server Vite (HMR popup/options) |
| `pnpm build` | Build production dans `dist/` |
| `pnpm typecheck` | TypeScript strict (no emit) |
| `pnpm icons` | Regeneration des icones PNG |
| `pnpm zip` | Archive `dist/` -> `surfagent-v<version>.zip` |

## Tech stack

- TypeScript strict, React 19, Vite 8 (rolldown) + `@crxjs/vite-plugin` 2
- LangChain / LangGraph pour l'orchestration multi-agents
- Memoire vectorielle locale (IndexedDB, embeddings locaux, zero appel reseau)
- Gestionnaire de paquets : **pnpm**

## Limites connues

- Pages internes de Chrome (`chrome://...`) et Chrome Web Store bloquent l'injection.
- L'execution d'actions navigateur (clic, formulaire) est a venir ; le mode agent couvre aujourd'hui la memoire et la recuperation web.
- Tests manquants : protocole de messages, renderer Markdown, outils agent.
