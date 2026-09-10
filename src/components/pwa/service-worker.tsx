'use client';

import { useEffect } from 'react';

/**
 * Enregistre le service worker qui rend l'application installable et
 * consultable hors connexion.
 *
 * L'enregistrement est volontairement silencieux : un échec (navigation
 * privée, navigateur sans prise en charge) ne doit pas gêner l'utilisation.
 */
export function ServiceWorker() {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    if (process.env.NODE_ENV !== 'production') return;

    const register = () => {
      navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {
        /* sans effet sur le fonctionnement de l'application */
      });
    };

    if (document.readyState === 'complete') register();
    else window.addEventListener('load', register, { once: true });
  }, []);

  return null;
}
