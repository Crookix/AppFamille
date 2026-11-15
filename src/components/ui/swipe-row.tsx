'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';

export type SwipeAction = {
  /** Texte affiché derrière la ligne pendant le geste (jamais le seul moyen d'agir). */
  label: string;
  icon: React.ReactNode;
  /** Couleur de fond de l'action : `ok` pour valider, `danger` pour retirer. */
  tone: 'ok' | 'danger';
  onTrigger: () => void;
};

/** Distance (en part de la largeur) au-delà de laquelle le geste se valide. */
const COMMIT_RATIO = 0.4;
/** Vitesse (px/ms) qui valide un geste court mais franc. */
const COMMIT_VELOCITY = 0.6;
const EXIT_MS = 180;

/**
 * Une ligne qu'on balaye du doigt, comme dans Messages ou Rappels : à droite
 * pour valider, à gauche pour retirer.
 *
 * C'est un raccourci, jamais le seul chemin. La case à cocher et le bouton de
 * suppression restent dans la ligne, au clavier comme au lecteur d'écran ; la
 * couche d'action est donc masquée aux technologies d'assistance. Au doigt
 * seulement : à la souris, le glissement gênerait la sélection du texte.
 *
 * Aucune mise à jour d'état pendant le geste : on écrit directement le style,
 * une fois par image. `touch-action: pan-y` laisse le navigateur défiler à la
 * verticale et nous réserve l'horizontale.
 */
export function SwipeRow({
  children,
  onSwipeRight,
  onSwipeLeft,
  className,
}: {
  children: React.ReactNode;
  /** Geste vers la droite (le doigt va à droite) : valider. */
  onSwipeRight?: SwipeAction;
  /** Geste vers la gauche : retirer. */
  onSwipeLeft?: SwipeAction;
  className?: string;
}) {
  const rowRef = React.useRef<HTMLDivElement>(null);
  const leftLayerRef = React.useRef<HTMLDivElement>(null);
  const rightLayerRef = React.useRef<HTMLDivElement>(null);
  const gesture = React.useRef<{
    startX: number;
    startY: number;
    lastX: number;
    lastT: number;
    velocity: number;
    mode: 'pending' | 'x' | 'y';
    width: number;
  } | null>(null);

  function paint(dx: number, width: number, withTransition: boolean) {
    const row = rowRef.current;
    if (!row) return;
    row.style.transition = withTransition ? `transform ${EXIT_MS}ms var(--ease-out)` : 'none';
    row.style.transform = dx === 0 ? '' : `translateX(${dx}px)`;
    // La couche de validation (à gauche) apparaît quand on va à droite, et inversement.
    const progress = Math.min(1, Math.abs(dx) / (width * COMMIT_RATIO));
    if (leftLayerRef.current) leftLayerRef.current.style.opacity = dx > 0 ? String(0.35 + 0.65 * progress) : '0';
    if (rightLayerRef.current) rightLayerRef.current.style.opacity = dx < 0 ? String(0.35 + 0.65 * progress) : '0';
  }

  function onPointerDown(event: React.PointerEvent<HTMLDivElement>) {
    if (event.pointerType === 'mouse' || (!onSwipeRight && !onSwipeLeft)) return;
    const width = rowRef.current?.offsetWidth ?? 320;
    gesture.current = {
      startX: event.clientX,
      startY: event.clientY,
      lastX: event.clientX,
      lastT: event.timeStamp,
      velocity: 0,
      mode: 'pending',
      width,
    };
  }

  function onPointerMove(event: React.PointerEvent<HTMLDivElement>) {
    const g = gesture.current;
    if (!g || g.mode === 'y') return;
    const dx = event.clientX - g.startX;
    const dy = event.clientY - g.startY;

    if (g.mode === 'pending') {
      if (Math.abs(dy) > 10 && Math.abs(dy) > Math.abs(dx)) {
        g.mode = 'y'; // c'est un défilement : on s'efface
        return;
      }
      if (Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy) * 1.5) {
        g.mode = 'x';
        event.currentTarget.setPointerCapture(event.pointerId);
      } else {
        return;
      }
    }

    const dt = Math.max(1, event.timeStamp - g.lastT);
    g.velocity = (event.clientX - g.lastX) / dt;
    g.lastX = event.clientX;
    g.lastT = event.timeStamp;

    // Une direction sans action résiste fortement, puis s'arrête : jamais un mur sec.
    const allowed = dx > 0 ? onSwipeRight : onSwipeLeft;
    const offset = allowed ? dx : Math.sign(dx) * Math.sqrt(Math.abs(dx)) * 1.5;
    paint(offset, g.width, false);
  }

  function finish(event: React.PointerEvent<HTMLDivElement>, cancelled: boolean) {
    const g = gesture.current;
    gesture.current = null;
    if (!g || g.mode !== 'x') return;

    const dx = event.clientX - g.startX;
    const action = dx > 0 ? onSwipeRight : onSwipeLeft;
    const committed =
      !cancelled &&
      action &&
      (Math.abs(dx) > g.width * COMMIT_RATIO ||
        (Math.abs(g.velocity) > COMMIT_VELOCITY && Math.abs(dx) > 60 && Math.sign(g.velocity) === Math.sign(dx)));

    if (committed && action) {
      paint(Math.sign(dx) * g.width, g.width, true);
      window.setTimeout(() => {
        action.onTrigger();
        // Si la ligne reste affichée (case décochée, par exemple), on la ramène.
        paint(0, g.width, false);
      }, EXIT_MS);
    } else {
      paint(0, g.width, true);
    }
  }

  return (
    <div className={cn('relative overflow-hidden', className)}>
      {onSwipeRight ? (
        <ActionLayer ref={leftLayerRef} side="left" action={onSwipeRight} />
      ) : null}
      {onSwipeLeft ? (
        <ActionLayer ref={rightLayerRef} side="right" action={onSwipeLeft} />
      ) : null}
      <div
        ref={rowRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={(e) => finish(e, false)}
        onPointerCancel={(e) => finish(e, true)}
        className="relative touch-pan-y bg-[var(--bg-elevated)]"
      >
        {children}
      </div>
    </div>
  );
}

const ActionLayer = React.forwardRef<
  HTMLDivElement,
  { side: 'left' | 'right'; action: SwipeAction }
>(({ side, action }, ref) => (
  <div
    ref={ref}
    aria-hidden
    style={{ opacity: 0 }}
    className={cn(
      'absolute inset-y-0 flex w-full items-center gap-2 px-5 text-[0.9375rem] font-semibold text-white',
      action.tone === 'ok' ? 'bg-sage-500' : 'bg-alert-500',
      side === 'left' ? 'justify-start' : 'justify-end',
    )}
  >
    {side === 'left' ? action.icon : null}
    {action.label}
    {side === 'right' ? action.icon : null}
  </div>
));
ActionLayer.displayName = 'ActionLayer';
