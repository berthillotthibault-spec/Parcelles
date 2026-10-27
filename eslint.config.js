// Configuration ESLint (flat config) : outil de développement uniquement, jamais chargé par l'application.
// Ce fichier n'est pas dans CORE de sw.js et aucun module servi ne l'importe.
// Lancer : `npm run lint`. Voir ARCHITECTURE.md, « Lint et vérification de types ».
import js from '@eslint/js';
import globals from 'globals';

// Règles communes : no-undef / no-unused-vars / no-shadow / eqeqeq / no-implicit-globals / prefer-const.
// no-undef reste une erreur partout (bug potentiel). Les règles de style restent des avertissements :
// le nombre total est figé par --max-warnings dans package.json et ne doit que baisser.
const rules = {
  'no-undef': 'error',
  'no-unused-vars': ['warn', {args: 'none', caughtErrors: 'none', ignoreRestSiblings: true, varsIgnorePattern: '^_'}],
  'no-shadow': ['warn', {builtinGlobals: false, hoist: 'functions'}],
  eqeqeq: ['error', 'smart'],
  'no-implicit-globals': 'error',
  'prefer-const': ['warn', {destructuring: 'all'}],
  // Code existant écrit en style compact : ces règles du jeu recommandé ne signalent pas de bug ici.
  'no-empty': ['warn', {allowEmptyCatch: true}],
  'no-cond-assign': ['error', 'except-parens'],
  'no-control-regex': 'off',
  // Espaces fines insécables voulues (typographie française « : », « € ») et BOM des exports CSV.
  'no-irregular-whitespace': ['error', {skipStrings: true, skipTemplates: true, skipComments: true, skipRegExps: true}],
  'no-useless-escape': 'warn',
  'no-misleading-character-class': 'warn',
  'no-prototype-builtins': 'warn',
  'no-async-promise-executor': 'warn',
  'no-fallthrough': 'warn',
  'no-case-declarations': 'warn',
  'no-useless-assignment': 'warn',
  'preserve-caught-error': 'off',
};

// Globales posées par les scripts vendus (index.html) et par config.js.
const appGlobals = {
  L: 'readonly', XLSX: 'readonly', shp: 'readonly', firebase: 'readonly',
  PARCELLES_FIREBASE_CONFIG: 'readonly', PARCELLES_SATELLITE_ENDPOINT: 'readonly', PARCELLES_EPHY_ENDPOINT: 'readonly',
};

const confusingGlobals = ['event', 'name', 'status', 'length', 'top', 'parent', 'self', 'close', 'closed', 'open', 'opener',
  'find', 'stop', 'print', 'frames', 'external', 'origin', 'screen', 'blur', 'focus', 'scroll'];

export default [
  {
    ignores: [
      'node_modules/**', 'audit/**', 'dist-github-root/**',
      // Dossiers d'outillage des agents (non suivis) : .claude/worktrees/** contient des copies complètes du dépôt.
      '.claude/**', '.cursor/**', '.kiro/**', '**/worktrees/**',
      '*.min.js', 'support.js', 'Parcelles v3.dc.html',
    ],
  },
  js.configs.recommended,
  {
    linterOptions: {reportUnusedDisableDirectives: 'warn'},
    rules,
  },
  // Modules ES servis au navigateur (racine du dépôt).
  {
    files: ['*.js'],
    languageOptions: {ecmaVersion: 'latest', sourceType: 'module', globals: {...globals.browser, ...appGlobals}},
    rules: {
      // Globales du navigateur qui masquent une variable oubliée (« name », « status », « event »…) :
      // no-undef ne les voit pas, d'où cette liste. location, history, confirm restent permis (usage voulu).
      'no-restricted-globals': ['error', ...confusingGlobals.map(name => ({name, message: `Variable « ${name} » non déclarée : globale du navigateur prise par erreur ? Écrire window.${name} si c'est voulu.`}))],
      // n° 152 : un gabarit littéral brut affecté à innerHTML/outerHTML repose sur des escapeHtml manuels.
      // Le gabarit étiqueté html`…` de safe-html.js échappe chaque interpolation : il n'est pas signalé.
      // Avertissement seulement (code existant à migrer écran par écran), compté dans le plafond --max-warnings.
      'no-restricted-syntax': ['warn', ...['innerHTML', 'outerHTML'].map(prop => ({
        selector: `AssignmentExpression[left.property.name='${prop}'][right.type='TemplateLiteral'][right.expressions.length>0]`,
        message: `${prop} = \`…\` avec interpolations : utiliser le gabarit html\`…\` (safe-html.js), qui échappe automatiquement.`,
      }))],
    },
  },
  // Scripts classiques : configuration publique (pose window.PARCELLES_*) et service worker.
  {
    files: ['config.js', 'config.example.js'],
    languageOptions: {sourceType: 'script', globals: {...globals.browser}},
  },
  {
    files: ['sw.js', 'sw-reminders.js'],
    languageOptions: {sourceType: 'script', globals: {...globals.serviceworker}},
    rules: {'no-restricted-globals': 'off'}, // « self » y désigne le worker.
  },
  {
    // Le service worker est un script classique isolé : ses fonctions de premier niveau vivent dans la
    // portée globale du worker, que seul sw-reminders.js (enveloppé dans une IIFE) partage avec lui.
    files: ['sw.js'],
    rules: {'no-implicit-globals': 'off'},
  },
  // Outils de développement : tests node:test, scripts tools/ et cette configuration.
  {
    files: ['*.mjs', 'tools/**/*.mjs', 'tests-visual/**/*.mjs', 'eslint.config.js'],
    languageOptions: {ecmaVersion: 'latest', sourceType: 'module', globals: {...globals.node, ...globals.browser, ...appGlobals}},
  },
  // Exemple de Worker Cloudflare (non servi).
  {
    files: ['tools/worker-assistant.example.js', 'tools/worker-messages.example.js'],
    languageOptions: {sourceType: 'module', globals: {...globals.serviceworker}},
  },
];
