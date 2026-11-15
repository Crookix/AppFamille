'use client';

import * as React from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

/** Durée de la sortie, à garder égale à celle de `.sheet-panel[data-closing]`. */
const EXIT_MS = 220;

/**
 * Feuille modale.
 *
 * Sur téléphone elle monte du bas, à portée de pouce, se ferme en la glissant
 * vers le bas et repart par où elle est venue ; sur écran large elle se
 * centre. Elle piège le focus, se ferme à Échap ou au clic sur le fond, et
 * bloque le défilement de la page derrière.
 */
export function Sheet({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = 'default',
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  size?: 'default' | 'large';
}) {
  const panelRef = React.useRef<HTMLDivElement>(null);
  const backdropRef = React.useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = React.useState(false);
  // La feuille reste montée le temps de sa sortie : sans cela elle
  // disparaîtrait d'un coup, alors qu'elle est entrée en glissant.
  const [present, setPresent] = React.useState(open);
  const [closing, setClosing] = React.useState(false);
  // Fermée au doigt : elle est déjà hors de l'écran, inutile de rejouer la sortie.
  const [draggedOut, setDraggedOut] = React.useState(false);
  const titleId = React.useId();
  const descId = React.useId();

  // `onClose` est souvent une fonction recréée à chaque rendu. S'il figurait
  // dans les dépendances de l'effet ci-dessous, chaque frappe ou chaque ajout
  // relancerait l'effet : le focus repartirait vers l'élément d'origine puis
  // reviendrait au premier champ — et sur téléphone, le clavier se refermerait.
  const onCloseRef = React.useRef(onClose);
  React.useEffect(() => {
    onCloseRef.current = onClose;
  });

  React.useEffect(() => setMounted(true), []);

  const wasOpen = React.useRef(open);
  React.useEffect(() => {
    if (open) {
      wasOpen.current = true;
      // Rouverte pendant sa sortie : on efface ce qu'un glissement a laissé.
      panelRef.current?.removeAttribute('style');
      backdropRef.current?.removeAttribute('style');
      setPresent(true);
      setClosing(false);
      setDraggedOut(false);
      return;
    }
    // Jamais ouverte : rien à animer.
    if (!wasOpen.current) return;
    setClosing(true);
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const timer = window.setTimeout(() => {
      setPresent(false);
      setClosing(false);
    }, reduce ? 0 : EXIT_MS);
    return () => window.clearTimeout(timer);
  }, [open]);

  // Glissement vers le bas pour fermer, sur l'entête uniquement (le corps garde
  // son défilement). Aucune mise à jour d'état pendant le geste : on écrit
  // directement le style, une fois par image, pour rester à 60 images/s.
  const drag = React.useRef<{
    startY: number;
    lastY: number;
    lastT: number;
    velocity: number;
    active: boolean;
  } | null>(null);

  function onDragStart(event: React.PointerEvent<HTMLDivElement>) {
    // Sur grand écran la feuille est centrée : pas de glissement.
    if (window.matchMedia('(min-width: 640px)').matches) return;
    if ((event.target as HTMLElement).closest('button, a, input')) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = {
      startY: event.clientY,
      lastY: event.clientY,
      lastT: event.timeStamp,
      velocity: 0,
      active: true,
    };
    if (panelRef.current) panelRef.current.style.transition = 'none';
  }

  function onDragMove(event: React.PointerEvent<HTMLDivElement>) {
    const state = drag.current;
    if (!state?.active || !panelRef.current) return;
    const dy = event.clientY - state.startY;
    // Vers le haut : une résistance qui croît, jamais un mur.
    const offset = dy >= 0 ? dy : -Math.sqrt(-dy) * 2.5;
    const dt = Math.max(1, event.timeStamp - state.lastT);
    state.velocity = (event.clientY - state.lastY) / dt; // px par ms
    state.lastY = event.clientY;
    state.lastT = event.timeStamp;
    panelRef.current.style.transform = `translateY(${offset}px)`;
    if (backdropRef.current) {
      const height = panelRef.current.offsetHeight || 1;
      backdropRef.current.style.opacity = String(Math.max(0, 1 - Math.max(0, dy) / height));
    }
  }

  function onDragEnd(event: React.PointerEvent<HTMLDivElement>) {
    const state = drag.current;
    drag.current = null;
    const panel = panelRef.current;
    if (!state?.active || !panel) return;

    const dy = event.clientY - state.startY;
    // On projette où le geste allait : un petit coup sec ferme, une traction
    // lente et courte revient (même idée que le défilement inertiel d'iOS).
    const projected = dy + state.velocity * 180;
    const dismiss = projected > panel.offsetHeight * 0.4 || state.velocity > 0.7;

    if (dismiss) {
      panel.style.transition = 'transform 0.22s cubic-bezier(0.4, 0, 1, 1)';
      panel.style.transform = 'translateY(100%)';
      if (backdropRef.current) {
        backdropRef.current.style.transition = 'opacity 0.22s ease-in';
        backdropRef.current.style.opacity = '0';
      }
      setDraggedOut(true);
      onCloseRef.current();
    } else {
      panel.style.transition = 'transform 0.35s var(--ease-out)';
      panel.style.transform = '';
      if (backdropRef.current) {
        backdropRef.current.style.transition = 'opacity 0.35s var(--ease-out)';
        backdropRef.current.style.opacity = '';
      }
    }
  }

  React.useEffect(() => {
    if (!open) return;

    const previouslyFocused = document.activeElement as HTMLElement | null;
    const { overflow } = document.body.style;
    document.body.style.overflow = 'hidden';

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (event.key !== 'Tab' || !panelRef.current) return;

      const focusables = panelRef.current.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])',
      );
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener('keydown', onKeyDown, true);

    // Laisse le temps à l'animation d'entrée avant de déplacer le focus.
    const timer = window.setTimeout(() => {
      const target = panelRef.current?.querySelector<HTMLElement>(
        '[data-autofocus], input, textarea, select, button',
      );
      target?.focus();
    }, 60);

    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      document.body.style.overflow = overflow;
      window.clearTimeout(timer);
      previouslyFocused?.focus?.();
    };
  }, [open]);

  if (!mounted || !present) return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
      <div
        ref={backdropRef}
        data-closing={closing && !draggedOut ? true : undefined}
        className="sheet-backdrop absolute inset-0 bg-ink-900/40"
        onClick={onClose}
        aria-hidden
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descId : undefined}
        data-closing={closing && !draggedOut ? true : undefined}
        className={cn(
          'sheet-panel relative flex max-h-[92dvh] w-full flex-col overflow-hidden',
          'rounded-t-[var(--radius-xl3)] bg-[var(--bg-elevated)] shadow-2xl',
          'sm:rounded-[var(--radius-xl3)]',
          size === 'large' ? 'sm:max-w-2xl' : 'sm:max-w-md',
        )}
      >
        {/* L'entête sert de poignée : on la saisit pour glisser la feuille vers
            le bas. `touch-none` empêche le navigateur de prendre le geste pour
            un défilement. Sur grand écran, elle redevient un simple entête. */}
        <div
          onPointerDown={onDragStart}
          onPointerMove={onDragMove}
          onPointerUp={onDragEnd}
          onPointerCancel={onDragEnd}
          className="flex touch-none items-start justify-between gap-4 border-b border-[var(--line)] px-5 pb-3 pt-5 sm:touch-auto"
        >
          <div
            className="absolute left-1/2 top-2 h-1.5 w-10 -translate-x-1/2 rounded-full bg-[var(--line)] sm:hidden"
            aria-hidden
          />
          <div className="min-w-0 pt-1">
            <h2 id={titleId} className="truncate text-[1.1875rem] font-extrabold tracking-tight">
              {title}
            </h2>
            {description ? (
              <p id={descId} className="mt-0.5 text-sm text-muted">
                {description}
              </p>
            ) : null}
          </div>
          <Button
            variant="ghost"
            size="iconSm"
            onClick={onClose}
            aria-label="Fermer"
            className="-mr-1.5 shrink-0"
          >
            <X className="h-5 w-5" aria-hidden />
          </Button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>

        {footer ? (
          <div className="safe-bottom border-t border-[var(--line)] bg-[var(--bg-elevated)] px-5 pt-3">
            {footer}
          </div>
        ) : null}
      </div>
    </div>,
    document.body,
  );
}

/**
 * Confirmation avant une action irréversible.
 * Toujours utilisée avant une suppression.
 */
export function ConfirmSheet({
  open,
  onClose,
  onConfirm,
  title,
  description,
  confirmLabel = 'Supprimer',
  destructive = true,
  loading,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  description: string;
  confirmLabel?: string;
  destructive?: boolean;
  loading?: boolean;
}) {
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={title}
      footer={
        <div className="flex gap-2 pb-1">
          <Button variant="outline" className="flex-1" onClick={onClose} disabled={loading}>
            Annuler
          </Button>
          <Button
            variant={destructive ? 'danger' : 'primary'}
            className="flex-1"
            onClick={onConfirm}
            loading={loading}
            data-autofocus
          >
            {confirmLabel}
          </Button>
        </div>
      }
    >
      <p className="text-sm text-muted">{description}</p>
    </Sheet>
  );
}
