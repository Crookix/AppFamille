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

const RAYON = '1.25rem'; // --radius-xl2

export const clerkAppearanceClair = {
  variables: {
    colorPrimary: '#de6f47',          // --color-brand-500
    colorBackground: '#ffffff',       // --bg-elevated
    colorText: '#34291f',             // --color-ink-900
    colorTextSecondary: '#8a7867',    // --color-ink-500
    colorInputBackground: '#ffffff',
    colorInputText: '#34291f',
    colorNeutral: '#5a4a3c',
    colorDanger: '#c0392b',
    colorSuccess: '#4f7d52',
    borderRadius: RAYON,
    fontFamily: 'var(--font-nunito), system-ui, sans-serif',
    fontSize: '0.95rem',
  },
} as const;

export const clerkAppearanceSombre = {
  variables: {
    ...clerkAppearanceClair.variables,
    colorBackground: '#241d19',       // --bg-elevated, thème sombre
    colorText: '#f4ece3',
    colorTextSecondary: '#b8a695',
    colorInputBackground: '#2e2621',
    colorInputText: '#f4ece3',
  },
} as const;
