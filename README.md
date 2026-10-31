# Upwork Profile Audit AI

Extension Chrome (Manifest V3) qui audite les profils freelances Upwork avec l'IA.

L'utilisateur s'authentifie avec son compte ChatGPT, ouvre un profil Upwork, clique sur le bouton "AI" en bas a droite, et recoit un rapport d'audit Markdown redige en francais (forces, faiblesses, mots-cles, plan d'action, note /20).

## Structure du projet

```
src/
├── background/       Service worker (MV3, module)
│   ├── index.ts      Routeur de messages
│   ├── auth.ts       OAuth "Sign in with ChatGPT" (PKCE) via chrome.identity
│   └── openai.ts     Prompt d'audit + appels API + test de connexion
├── content/          Content script (page profil Upwork)
│   ├── index.tsx     Injection shadow DOM du panneau flottant
│   ├── Panel.tsx     Interface React du panneau d'audit
│   ├── scraper.ts    Extraction des donnees du profil (selecteurs + fallbacks)
│   ├── markdown.ts   Mini-renderer Markdown -> HTML (safe)
│   └── content.css   Styles du panneau
├── popup/            Popup (etat de connexion, action d'audit)
├── options/          Page d'options (config OAuth, logout, test API)
└── shared/
    ├── config.ts     Constantes (endpoints IA, cles de stockage)
    ├── messaging.ts  Protocole de messages + fetch securise
    └── types.ts      Types partages (profil, rapport, messages)
```

## Tech stack

- TypeScript strict, React 19, Vite 8 (rolldown) + `@crxjs/vite-plugin` 2
- Gestionnaire de paquets : **pnpm**

## Installation (dev)

```bash
pnpm install
pnpm build
```

1. Ouvrir `chrome://extensions`
2. Activer le mode developpeur
3. "Charger l'extension non empaquetee" -> selectionner le dossier `dist/`

Mode dev avec HMR (popup + options uniquement ; le content script doit etre recharge en rechargant l'extension) :

```bash
pnpm dev
```

## Fonctionnement (auth + IA)

Il n'y a **pas** d'application ni de `clientId` a creer sur `platform.openai.com`. L'extension reprend le circuit utilise par le client open-source **Codex CLI** :

1. **Connexion (device-code flow)** : clic sur "Se connecter avec ChatGPT" -> le service worker demande un code d'appareil au backend OpenAI (`auth.openai.com/api/accounts/deviceauth/usercode`) avec le client OAuth public de Codex (`app_EMoamEEZ73f0CkXaXp7hrann`). Un code d'appareil est affiche ; l'utilisateur ouvre `https://auth.openai.com/codex/device`, entre le code et se connecte avec son compte ChatGPT. L'extension poll le statut (`alarms` + messages `AUTH:POLL`) jusqu'a la validation, puis echange le code contre des tokens.
2. **Backend IA** : les appels sont faits vers `https://chatgpt.com/backend-api/codex` (endpoint `/responses`, protocole "Responses API" en SSE, modèles compte-spécifiques decouverts via `/models?client_version=1.0.0`). Une seule "input" contient les donnees scrapees ; le rapport Markdown est reconstruit depuis les evenements `response.output_text.done`.

Notes importantes :

- Utilisation **non officielle** du backend abonnement ChatGPT ; OpenAI peut changer les endpoints ou la desactiver a tout moment.
- Requiert un compte ChatGPT avec acces a Codex. Les modèles disponibles dependent du plan (catalogue recupere a chaque session, cache 1 h).
- Les tokens sont stockes dans `chrome.storage.session` (effaces a la fermeture du navigateur) et rafraichis automatiquement via `refresh_token`.
- Respecte les conditions d'utilisation OpenAI ; usage personnel uniquement.

## Utilisation

1. Sur les pages web accessibles, un champ flottant s'affiche en bas de page dans chaque onglet.
2. Saisis une question puis valide-la pour obtenir une reponse basee sur le titre, l'URL et le texte visible de la page. Ces donnees ne sont envoyees qu'a la validation et sont limitees en taille.
3. Si necessaire, connecte-toi avec ChatGPT via le code d'appareil puis renvoie ta question.
4. Sur un profil Upwork (`/freelancers/*` ou `/contractors/*`), le bouton flottant "AI" reste disponible pour ouvrir l'audit detaille existant (donnees profilees, rapport structure et note /20).

Les pages internes de Chrome (par exemple `chrome://...`) et le Chrome Web Store bloquent l'injection des extensions et ne peuvent pas afficher le champ.

## Scripts

| Commande             | Action                                              |
| -------------------- | --------------------------------------------------- |
| `pnpm dev`           | Dev server Vite (HMR popup/options)                 |
| `pnpm build`         | Build production dans `dist/`                       |
| `pnpm typecheck`     | TypeScript strict (no emit)                         |
| `pnpm icons`         | Regeneration des icones PNG (via `scripts/make-icons.mjs`) |
| `pnpm zip`           | Archive `dist/` -> `upwork-audit-ai-v<version>.zip` |

## Limites connues / a venir

- Le scraper repose sur des selecteurs DOM Upwork (susceptibles de changer) avec des regex de fallback.
- L'audit est ponctuel ; pas de streaming de tokens ni d'historique persistant.
- Tests manquants (a ajouter) : scraper, renderer Markdown, protocole de messages.