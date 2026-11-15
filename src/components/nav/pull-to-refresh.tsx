'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { RefreshCw } from 'lucide-react';

/** Distance de tirage (après résistance) qui déclenche l'actualisation. */
const THRESHOLD = 64;
/** Le tirage s'écrase : au-delà, chaque pixel de doigt compte pour moins. */
const MAX_PULL = 110;

/**
 * Tirer l'écran vers le bas pour actualiser, comme sur un iPhone.
 *
 * `overscroll-behavior-y: none` (globals.css) coupe le rebond et l'actualisation
 * du navigateur : sans ce composant, la PWA n'aurait aucun moyen de se
 * rafraîchir. Il agit seulement en haut de page, sur un geste d'abord
 * vertical, et jamais pendant qu'une feuille est ouverte (elle verrouille le
 * défilement de la page).
 *
 * Aucune mise à jour d'état pendant le tirage : on écrit directement le style,
 * une fois par image.
 */
export function PullToRefresh({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [spinning, setSpinning] = React.useState(false);
  const indicatorRef = React.useRef<HTMLDivElement>(null);

  // Le tour d'actualisation dure au moins une demi-seconde : plus court, le
  // pictogramme clignote sans qu'on ait pu le voir.
  React.useEffect(() => {
    if (pending) {
      setSpinning(true);
      return;
    }
    const timer = window.setTimeout(() => setSpinning(false), 500);
    return () => window.clearTimeout(timer);
  }, [pending]);

  React.useEffect(() => {
    let startX = 0;
    let startY = 0;
    let mode: 'idle' | 'pending' | 'pull' | 'ignore' = 'idle';
    let distance = 0;

    function paint(pull: number, animate: boolean) {
      const el = indicatorRef.current;
      if (!el) return;
      const progress = Math.min(1, pull / THRESHOLD);
      el.style.transition = animate ? 'transform 0.3s var(--ease-out), opacity 0.2s' : 'none';
      el.style.opacity = String(progress);
      el.style.transform = `translate(-50%, ${pull - 40}px) rotate(${progress * 270}deg)`;
    }

    function onStart(event: TouchEvent) {
      const modalOpen = document.body.style.overflow === 'hidden';
      if (window.scrollY > 0 || modalOpen || event.touches.length !== 1) {
        mode = 'ignore';
        return;
      }
      startX = event.touches[0].clientX;
      startY = event.touches[0].clientY;
      distance = 0;
      mode = 'pending';
    }

    function onMove(event: TouchEvent) {
      if (mode === 'idle' || mode === 'ignore') return;
      const dx = event.touches[0].clientX - startX;
      const dy = event.touches[0].clientY - startY;

      if (mode === 'pending') {
        if (Math.abs(dx) > 8 && Math.abs(dx) > Math.abs(dy)) {
          mode = 'ignore'; // geste horizontal : une ligne qu'on balaye
          return;
        }
        if (dy < -8 || window.scrollY > 0) {
          mode = 'ignore'; // on remonte dans la page
          return;
        }
        if (dy > 8) mode = 'pull';
        else return;
      }

      // Résistance : le doigt parcourt plus que l'indicateur.
      distance = Math.min(MAX_PULL, dy * 0.5);
      if (event.cancelable) event.preventDefault();
      paint(Math.max(0, distance), false);
    }

    function onEnd() {
      const wasPulling = mode === 'pull';
      mode = 'idle';
      if (!wasPulling) return;
      if (distance >= THRESHOLD) {
        paint(THRESHOLD * 0.75, true);
        startTransition(() => router.refresh());
      } else {
        paint(0, true);
      }
    }

    document.addEventListener('touchstart', onStart, { passive: true });
    document.addEventListener('touchmove', onMove, { passive: false });
    document.addEventListener('touchend', onEnd);
    document.addEventListener('touchcancel', onEnd);
    return () => {
      document.removeEventListener('touchstart', onStart);
      document.removeEventListener('touchmove', onMove);
      document.removeEventListener('touchend', onEnd);
      document.removeEventListener('touchcancel', onEnd);
    };
  }, [router, startTransition]);

  // Une fois l'actualisation finie, l'indicateur remonte.
  React.useEffect(() => {
    if (!spinning) {
      const el = indicatorRef.current;
      if (el) {
        el.style.transition = 'transform 0.3s var(--ease-out), opacity 0.2s';
        el.style.opacity = '0';
        el.style.transform = 'translate(-50%, -40px)';
      }
    }
  }, [spinning]);

  return (
    <>
      <div
        ref={indicatorRef}
        aria-hidden
        style={{ opacity: 0, transform: 'translate(-50%, -40px)' }}
        className="pointer-events-none fixed left-1/2 top-[calc(3.5rem+env(safe-area-inset-top))] z-20 flex h-9 w-9 items-center justify-center rounded-full bg-[var(--bg-elevated)] text-[var(--fg-muted)] shadow-[0_2px_10px_rgb(0_0_0/0.18)] md:hidden"
      >
        <RefreshCw className={spinning ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} aria-hidden />
      </div>
      {children}
    </>
  );
}
