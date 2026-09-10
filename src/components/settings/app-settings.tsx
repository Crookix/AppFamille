'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft,
  Download,
  FlaskConical,
  LogOut,
  Moon,
  Repeat,
  Smartphone,
  Sun,
  SunMoon,
  Trash2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, ErrorNote, Field, Input } from '@/components/ui/primitives';
import { ConfirmSheet, Sheet } from '@/components/ui/sheet';
import { Avatar, ColorPicker } from '@/components/ui/avatar';
import { useToast } from '@/components/ui/toast';
import { createClient } from '@/lib/supabase/client';
import { useSignOut } from '@/components/providers/use-supabase';
import { useHousehold } from '@/components/providers/household-provider';
import { switchHouseholdAction, updateMyMemberAction } from '@/lib/actions/household';
import { deleteDemoHouseholdAction, loadDemoHouseholdAction } from '@/lib/actions/demo';
import { MEMBER_COLORS, cn } from '@/lib/utils';

type Theme = 'auto' | 'light' | 'dark';

export function AppSettings({
  email,
  demoEnabled,
}: {
  email: string | null;
  demoEnabled: boolean;
}) {
  const router = useRouter();
  const toast = useToast();
  const supabase = createClient();
  const deconnecter = useSignOut();
  const { household, me, otherHouseholds } = useHousehold();

  const [displayName, setDisplayName] = React.useState(me.display_name);
  const [color, setColor] = React.useState(me.color);
  const [editingProfile, setEditingProfile] = React.useState(false);
  const [theme, setTheme] = React.useState<Theme>('auto');
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [confirmDemo, setConfirmDemo] = React.useState(false);
  const [confirmDeleteDemo, setConfirmDeleteDemo] = React.useState(false);
  const [installEvent, setInstallEvent] = React.useState<Event | null>(null);

  /* Thème : le choix est propre à l'appareil, donc conservé localement. */
  React.useEffect(() => {
    try {
      const stored = localStorage.getItem('tribu-theme') as Theme | null;
      if (stored) {
        setTheme(stored);
        applyTheme(stored);
      }
    } catch {
      /* navigation privée ou stockage bloqué : on garde « auto » */
    }
  }, []);

  /* Installation de la PWA : Chrome et Edge proposent l'événement, Safari
     passe par « Partager → Sur l'écran d'accueil ». */
  React.useEffect(() => {
    function onPrompt(event: Event) {
      event.preventDefault();
      setInstallEvent(event);
    }
    window.addEventListener('beforeinstallprompt', onPrompt);
    return () => window.removeEventListener('beforeinstallprompt', onPrompt);
  }, []);

  function applyTheme(next: Theme) {
    const root = document.documentElement;
    if (next === 'auto') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', next);
  }

  function chooseTheme(next: Theme) {
    setTheme(next);
    applyTheme(next);
    try {
      localStorage.setItem('tribu-theme', next);
    } catch {
      /* sans conséquence : le thème reste appliqué pour cette session */
    }
  }

  async function saveProfile() {
    setPending(true);
    setError(null);

    const result = await updateMyMemberAction({ displayName, color });
    setPending(false);

    if (!result.ok) {
      setError(result.error);
      return;
    }
    toast.success('Profil enregistré.');
    setEditingProfile(false);
    router.refresh();
  }

  async function signOut() {
    await deconnecter();
    router.push('/connexion');
    router.refresh();
  }

  async function loadDemo() {
    setPending(true);
    const result = await loadDemoHouseholdAction();
    setPending(false);
    setConfirmDemo(false);

    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success('Foyer de démonstration chargé.');
    router.push('/');
    router.refresh();
  }

  async function deleteDemo() {
    setPending(true);
    const result = await deleteDemoHouseholdAction(household.id);
    setPending(false);
    setConfirmDeleteDemo(false);

    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success('Foyer de démonstration supprimé.');
    router.push('/bienvenue');
    router.refresh();
  }

  async function install() {
    if (!installEvent) return;
    const prompt = installEvent as Event & {
      prompt: () => Promise<void>;
      userChoice: Promise<{ outcome: string }>;
    };
    await prompt.prompt();
    const choice = await prompt.userChoice;
    if (choice.outcome === 'accepted') {
      toast.success('Tribu est installée.');
      setInstallEvent(null);
    }
  }

  return (
    <div>
      <Link
        href="/plus"
        className="mb-4 inline-flex items-center gap-1.5 text-sm font-semibold text-muted transition-colors hover:text-[var(--fg)]"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden />
        Plus
      </Link>

      <h1 className="mb-4 text-xl font-extrabold tracking-tight">Paramètres</h1>

      {/* --- Profil --------------------------------------------------------- */}
      <Card className="mb-4">
        <div className="flex items-center gap-3">
          <Avatar name={me.display_name} color={me.color} size="lg" />
          <div className="min-w-0 flex-1">
            <p className="truncate font-bold">{me.display_name}</p>
            <p className="truncate text-sm text-muted">{email ?? ''}</p>
            <p className="text-xs text-muted">
              {me.role === 'admin' ? 'Administrateur du foyer' : 'Membre adulte'}
            </p>
          </div>
          <Button variant="ghost" size="sm" onClick={() => setEditingProfile(true)}>
            Modifier
          </Button>
        </div>
      </Card>

      {/* --- Apparence ------------------------------------------------------ */}
      <section className="mb-4">
        <h2 className="mb-2 px-1 text-xs font-bold uppercase tracking-wide text-muted">
          Apparence
        </h2>
        <Card>
          <div role="radiogroup" aria-label="Thème" className="flex gap-2">
            {(
              [
                { key: 'auto', label: 'Automatique', icon: SunMoon },
                { key: 'light', label: 'Clair', icon: Sun },
                { key: 'dark', label: 'Sombre', icon: Moon },
              ] as const
            ).map(({ key, label, icon: Icon }) => (
              <button
                key={key}
                type="button"
                role="radio"
                aria-checked={theme === key}
                onClick={() => chooseTheme(key)}
                className={cn(
                  'flex flex-1 flex-col items-center gap-1.5 rounded-2xl border-2 px-2 py-3 text-xs font-semibold transition-colors',
                  theme === key
                    ? 'border-brand-500 bg-brand-50 text-brand-700 dark:bg-white/5'
                    : 'border-[var(--line)] text-[var(--fg-muted)]',
                )}
              >
                <Icon className="h-5 w-5" aria-hidden />
                {label}
              </button>
            ))}
          </div>
        </Card>
      </section>

      {/* --- Installation --------------------------------------------------- */}
      <section className="mb-4">
        <h2 className="mb-2 px-1 text-xs font-bold uppercase tracking-wide text-muted">
          Sur votre téléphone
        </h2>
        <Card>
          <div className="flex items-start gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-50 text-brand-600 dark:bg-white/5">
              <Smartphone className="h-5 w-5" aria-hidden />
            </span>
            <div className="min-w-0 flex-1">
              <p className="font-semibold">Installer Tribu</p>
              <p className="text-sm text-muted">
                {installEvent
                  ? "L'application s'ouvrira en plein écran, comme une application native."
                  : "Sur iPhone : bouton Partager, puis « Sur l'écran d'accueil ». Sur Android : menu du navigateur, puis « Installer »."}
              </p>
            </div>
          </div>
          {installEvent ? (
            <Button className="mt-3 w-full" onClick={install}>
              <Download className="h-4 w-4" aria-hidden />
              Installer
            </Button>
          ) : null}
        </Card>
      </section>

      {/* --- Autres foyers --------------------------------------------------- */}
      {otherHouseholds.length > 0 ? (
        <section className="mb-4">
          <h2 className="mb-2 px-1 text-xs font-bold uppercase tracking-wide text-muted">
            Changer de foyer
          </h2>
          <Card className="divide-y divide-[var(--line)] p-0">
            {otherHouseholds.map((other) => (
              <button
                key={other.id}
                type="button"
                onClick={async () => {
                  await switchHouseholdAction(other.id);
                  router.push('/');
                  router.refresh();
                }}
                className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-[var(--bg-subtle)]"
              >
                <Repeat className="h-4 w-4 shrink-0 text-muted" aria-hidden />
                <span className="min-w-0 flex-1 truncate font-semibold">{other.name}</span>
              </button>
            ))}
          </Card>
        </section>
      ) : null}

      {/* --- Démonstration ---------------------------------------------------- */}
      {demoEnabled ? (
        <section className="mb-4">
          <h2 className="mb-2 px-1 text-xs font-bold uppercase tracking-wide text-muted">
            Démonstration
          </h2>
          <Card>
            <div className="flex items-start gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-honey-100 text-honey-700">
                <FlaskConical className="h-5 w-5" aria-hidden />
              </span>
              <div className="min-w-0 flex-1">
                <p className="font-semibold">
                  {household.is_demo
                    ? 'Vous êtes dans le foyer de démonstration'
                    : 'Foyer de démonstration'}
                </p>
                <p className="text-sm text-muted">
                  {household.is_demo
                    ? 'Ces données sont fictives. Vous pouvez tout supprimer d’un geste.'
                    : 'Crée un second foyer, clairement identifié, avec deux enfants, une nounou et une semaine d’exemples. Votre foyer réel n’est pas touché.'}
                </p>
              </div>
            </div>

            {household.is_demo ? (
              <Button
                variant="danger"
                className="mt-3 w-full"
                onClick={() => setConfirmDeleteDemo(true)}
              >
                <Trash2 className="h-4 w-4" aria-hidden />
                Supprimer le foyer de démonstration
              </Button>
            ) : (
              <Button
                variant="outline"
                className="mt-3 w-full"
                onClick={() => setConfirmDemo(true)}
              >
                <FlaskConical className="h-4 w-4" aria-hidden />
                Charger le foyer de démonstration
              </Button>
            )}
          </Card>
        </section>
      ) : null}

      {/* --- Compte ------------------------------------------------------------ */}
      <Button variant="outline" className="w-full" onClick={signOut}>
        <LogOut className="h-4 w-4" aria-hidden />
        Se déconnecter
      </Button>

      <p className="mt-6 text-center text-xs text-muted">
        Tribu — organisation du foyer
      </p>

      {/* --- Feuilles ----------------------------------------------------------- */}
      <Sheet
        open={editingProfile}
        onClose={() => setEditingProfile(false)}
        title="Mon profil dans ce foyer"
        footer={
          <div className="flex gap-2 pb-1">
            <Button
              variant="outline"
              className="flex-1"
              onClick={() => setEditingProfile(false)}
              disabled={pending}
            >
              Annuler
            </Button>
            <Button className="flex-1" onClick={saveProfile} loading={pending}>
              Enregistrer
            </Button>
          </div>
        }
      >
        <div className="space-y-5">
          <div className="flex items-center gap-3">
            <Avatar name={displayName || '?'} color={color} size="lg" />
            <div className="min-w-0 flex-1">
              <Field label="Prénom affiché" required>
                <Input
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  maxLength={60}
                  data-autofocus
                />
              </Field>
            </div>
          </div>

          <div>
            <span className="mb-1.5 block text-sm font-semibold">Ma couleur</span>
            <ColorPicker value={color} onChange={setColor} options={MEMBER_COLORS} />
          </div>

          {error ? <ErrorNote>{error}</ErrorNote> : null}
        </div>
      </Sheet>

      <ConfirmSheet
        open={confirmDemo}
        onClose={() => setConfirmDemo(false)}
        onConfirm={loadDemo}
        loading={pending}
        destructive={false}
        title="Charger la démonstration ?"
        description="Un second foyer nommé « Foyer de démonstration » sera créé avec des données fictives. Votre foyer actuel reste intact, et vous pourrez revenir dessus à tout moment."
        confirmLabel="Charger"
      />

      <ConfirmSheet
        open={confirmDeleteDemo}
        onClose={() => setConfirmDeleteDemo(false)}
        onConfirm={deleteDemo}
        loading={pending}
        title="Supprimer la démonstration ?"
        description="Le foyer de démonstration et toutes ses données fictives seront définitivement supprimés."
      />
    </div>
  );
}
