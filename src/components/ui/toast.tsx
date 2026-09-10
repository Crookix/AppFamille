'use client';

import * as React from 'react';
import { createPortal } from 'react-dom';
import { AlertCircle, CheckCircle2, Info } from 'lucide-react';
import { cn } from '@/lib/utils';

type ToastTone = 'success' | 'error' | 'info';

type Toast = {
  id: number;
  message: string;
  tone: ToastTone;
  action?: { label: string; onClick: () => void };
};

type ToastContextValue = {
  toast: (message: string, options?: { tone?: ToastTone; action?: Toast['action'] }) => void;
  success: (message: string, action?: Toast['action']) => void;
  error: (message: string) => void;
};

const ToastContext = React.createContext<ToastContextValue | null>(null);

export function useToast() {
  const ctx = React.useContext(ToastContext);
  if (!ctx) throw new Error('useToast doit être utilisé dans <ToastProvider>.');
  return ctx;
}

let nextId = 1;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = React.useState<Toast[]>([]);
  const [mounted, setMounted] = React.useState(false);

  React.useEffect(() => setMounted(true), []);

  const dismiss = React.useCallback((id: number) => {
    setToasts((current) => current.filter((t) => t.id !== id));
  }, []);

  const toast = React.useCallback<ToastContextValue['toast']>(
    (message, options) => {
      const id = nextId++;
      const tone = options?.tone ?? 'info';
      setToasts((current) => [...current.slice(-2), { id, message, tone, action: options?.action }]);
      // Les erreurs restent plus longtemps : elles demandent une lecture.
      window.setTimeout(() => dismiss(id), tone === 'error' ? 6000 : 3500);
    },
    [dismiss],
  );

  const value = React.useMemo<ToastContextValue>(
    () => ({
      toast,
      success: (message, action) => toast(message, { tone: 'success', action }),
      error: (message) => toast(message, { tone: 'error' }),
    }),
    [toast],
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      {mounted
        ? createPortal(
            <div
              // `polite` : annoncé sans interrompre la tâche en cours.
              aria-live="polite"
              aria-atomic="false"
              className="pointer-events-none fixed inset-x-0 bottom-[calc(4.75rem+env(safe-area-inset-bottom))] z-[60] flex flex-col items-center gap-2 px-4 sm:bottom-6"
            >
              {toasts.map((t) => (
                <div
                  key={t.id}
                  className={cn(
                    'animate-in-up pointer-events-auto flex w-full max-w-sm items-center gap-2.5 rounded-2xl px-4 py-3 text-sm font-medium shadow-lg',
                    t.tone === 'success' && 'bg-sage-700 text-white',
                    t.tone === 'error' && 'bg-alert-700 text-white',
                    t.tone === 'info' && 'bg-ink-900 text-white dark:bg-sand-200 dark:text-ink-900',
                  )}
                >
                  {t.tone === 'success' ? (
                    <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden />
                  ) : t.tone === 'error' ? (
                    <AlertCircle className="h-4 w-4 shrink-0" aria-hidden />
                  ) : (
                    <Info className="h-4 w-4 shrink-0" aria-hidden />
                  )}
                  <span className="min-w-0 flex-1">{t.message}</span>
                  {t.action ? (
                    <button
                      type="button"
                      onClick={() => {
                        t.action?.onClick();
                        dismiss(t.id);
                      }}
                      className="shrink-0 rounded-full px-2 py-1 text-xs font-bold underline underline-offset-2"
                    >
                      {t.action.label}
                    </button>
                  ) : null}
                </div>
              ))}
            </div>,
            document.body,
          )
        : null}
    </ToastContext.Provider>
  );
}
