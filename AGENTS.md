# AGENTS.md — SurfAgent

Extension Chrome MV3 (Vite 8 + React 19 + TypeScript strict). Gestionnaire : **pnpm**.

## Commandes

- `pnpm typecheck` : verification TS (a lancer apres toute modification)
- `pnpm build` : build dans `dist/` (a lancer pour valider)
- `pnpm icons` : regenerer les icones PNG
- `pnpm zip` : empaqueter `dist/`

## Conventions

- Tous les endpoints/internets sont centralises dans `src/shared/config.ts` (aucun endpoint en dur ailleurs).
- Protocole de messagerie = discriminated union `RuntimeMessage` dans `src/shared/types.ts` ; routes dans `src/background/index.ts`.
- Toute nouvelle action entre background et UI passe par `sendToBackground` / `sendToTab` (`src/shared/messaging.ts`).
- Les libelles utilisateur sont en francais ; le code (identifiants, commentaires, erreurs techniques) en anglais.
- Les tokens ChatGPT/Codex sont stockes dans `chrome.storage.local` afin de survivre au rechargement de l'extension. Ils sont effaces explicitement a la deconnexion (`logout()`) ou a la fermeture du navigateur selon le comportement de Chrome. Le cache des modeles reste dans `chrome.storage.session`.

## Points de vigilance

- Le content script est bundlé IIFE (pas de dynamic import) ; il monte le React dans un shadow DOM avec CSS inliné (`?inline`).
- Le scraper (`src/content/scraper.ts`) doit rester tolerant : selecteurs connus puis regex de fallback.
- L'OAuth ChatGPT utilise le client public Codex CLI (`app_EMoamEEZ73f0CkXaXp7hrann`) via le device-code flow ; les endpoints sont dans `src/shared/config.ts`.
- Files cles : `src/shared/config.ts`, `src/background/auth.ts`, `src/background/openai.ts`, `src/content/scraper.ts`, `src/content/Panel.tsx`.