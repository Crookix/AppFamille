/**
 * Apparence de Clerk, accordée à MyFamily.
 *
 * On passe par `variables` plutôt que par des surcharges de classes.
 * `appearance.elements` demande de connaître les noms internes des éléments de
 * Clerk : ils changent d'une version à l'autre, et une clé devenue obsolète ne
 * lève aucune erreur — elle est simplement ignorée, et l'écran se dégrade en
 * silence. `variables` est l'interface publique, et elle suffit.
 *
 * Les valeurs sont en dur, et c'est voulu : Clerk s'affiche dans une iframe
 * qui n'hérite pas des variables CSS de la page. Un `var(--brand-500)` y
 * arriverait vide.
 *
 * Les deux jeux de couleurs correspondent aux thèmes clair et sombre de
 * `globals.css` ; c'est le seul endroit du code où ils sont dupliqués.
 */

const RAYON = '1rem'; // --radius-xl2

export const clerkAppearanceClair = {
  variables: {
    colorPrimary: '#bc4b2b',          // --color-brand-500
    colorBackground: '#ffffff',       // --bg-elevated
    colorText: '#000000',             // --color-ink-900
    colorTextSecondary: '#636366',    // --color-ink-500
    colorInputBackground: '#e9e9ef',
    colorInputText: '#000000',
    colorNeutral: '#3a3a3c',
    colorDanger: '#d70015',
    colorSuccess: '#208038',
    borderRadius: RAYON,
    fontFamily: '-apple-system, BlinkMacSystemFont, system-ui, sans-serif',
    fontSize: '0.95rem',
  },
} as const;

export const clerkAppearanceSombre = {
  variables: {
    ...clerkAppearanceClair.variables,
    colorBackground: '#1c1c1e',       // --bg-elevated, thème sombre
    colorText: '#ffffff',
    colorTextSecondary: '#aeaeb2',
    colorInputBackground: '#2c2c2e',
    colorInputText: '#ffffff',
  },
} as const;
