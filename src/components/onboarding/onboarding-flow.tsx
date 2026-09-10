'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight, Check, Copy, FlaskConical, Plus, Trash2, UserPlus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ErrorNote, Field, Input, Select } from '@/components/ui/primitives';
import { Avatar, ColorPicker } from '@/components/ui/avatar';
import { useToast } from '@/components/ui/toast';
import { MEMBER_COLORS, nextFreeColor } from '@/lib/utils';
import { createHouseholdAction, createInvitationAction } from '@/lib/actions/household';
import { createChildAction } from '@/lib/actions/children';
import { loadDemoHouseholdAction } from '@/lib/actions/demo';

type DraftChild = {
  key: string;
  firstName: string;
  birthDate: string;
  color: string;
};

const TIMEZONES = [
  'Europe/Paris',
  'Europe/Brussels',
  'Europe/Zurich',
  'Europe/London',
  'America/Montreal',
  'Indian/Reunion',
];

/**
 * Parcours de première ouverture.
 *
 * Trois étapes courtes, pas une seule longue page : nommer le foyer, ajouter
 * les enfants (facultatif), inviter l'autre adulte (facultatif). Chaque étape
 * peut être passée — on peut se servir de l'application dès la première.
 */
export function OnboardingFlow({
  suggestedName,
  demoEnabled,
}: {
  suggestedName: string;
  demoEnabled: boolean;
}) {
  const router = useRouter();
  const toast = useToast();

  const [step, setStep] = React.useState<1 | 2 | 3>(1);
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  // Étape 1
  const [householdName, setHouseholdName] = React.useState('');
  const [displayName, setDisplayName] = React.useState(suggestedName);
  const [color, setColor] = React.useState<string>('terracotta');
  const [timezone, setTimezone] = React.useState('Europe/Paris');
  const [householdId, setHouseholdId] = React.useState<string | null>(null);

  // Étape 2
  const [draftChildren, setDraftChildren] = React.useState<DraftChild[]>([]);

  // Étape 3
  const [inviteLink, setInviteLink] = React.useState<string | null>(null);
  const [copied, setCopied] = React.useState(false);
  const [loadingDemo, setLoadingDemo] = React.useState(false);

  // Fuseau du navigateur, s'il fait partie de la liste proposée.
  React.useEffect(() => {
    try {
      const detected = Intl.DateTimeFormat().resolvedOptions().timeZone;
      if (detected && TIMEZONES.includes(detected)) setTimezone(detected);
    } catch {
      /* on garde Europe/Paris */
    }
  }, []);

  async function submitHousehold(formEvent: React.FormEvent) {
    formEvent.preventDefault();
    setPending(true);
    setError(null);

    const result = await createHouseholdAction({
      name: householdName.trim() || `Foyer ${displayName.trim()}`,
      displayName: displayName.trim(),
      timezone,
    });

    setPending(false);

    if (!result.ok) {
      setError(result.error);
      return;
    }

    setHouseholdId(result.data.householdId);
    setStep(2);
  }

  function addDraftChild() {
    setDraftChildren((current) => [
      ...current,
      {
        key: `c${Date.now()}${current.length}`,
        firstName: '',
        birthDate: '',
        color: nextFreeColor([color, ...current.map((c) => c.color)]),
      },
    ]);
  }

  async function submitChildren() {
    const filled = draftChildren.filter((c) => c.firstName.trim());
    if (filled.length === 0) {
      setStep(3);
      return;
    }

    setPending(true);
    setError(null);

    for (const child of filled) {
      const result = await createChildAction({
        firstName: child.firstName.trim(),
        birthDate: child.birthDate || null,
        color: child.color,
      });
      if (!result.ok) {
        setPending(false);
        setError(`${child.firstName} : ${result.error}`);
        return;
      }
    }

    setPending(false);
    toast.success(
      filled.length === 1 ? 'Enfant ajouté.' : `${filled.length} enfants ajoutés.`,
    );
    setStep(3);
  }

  async function generateInvite() {
    setPending(true);
    setError(null);

    const result = await createInvitationAction({});
    setPending(false);

    if (!result.ok) {
      setError(result.error);
      return;
    }
    setInviteLink(result.data.link);
  }

  async function copyInvite() {
    if (!inviteLink) return;
    try {
      await navigator.clipboard.writeText(inviteLink);
      setCopied(true);
      toast.success('Lien copié.');
      window.setTimeout(() => setCopied(false), 2500);
    } catch {
      toast.error('La copie a échoué. Sélectionnez le lien à la main.');
    }
  }

  function finish() {
    router.push('/');
    router.refresh();
  }

  /**
   * Charge le foyer d'exemple.
   *
   * Proposé ici parce que c'est le moment où l'on veut voir à quoi ressemble
   * l'application avant d'y saisir sa propre vie.
   */
  async function loadDemo() {
    setLoadingDemo(true);
    setError(null);

    const result = await loadDemoHouseholdAction();
    setLoadingDemo(false);

    if (!result.ok) {
      setError(result.error);
      return;
    }

    toast.success('Foyer de démonstration chargé.');
    router.push('/');
    router.refresh();
  }

  return (
    <div className="mx-auto w-full max-w-md">
      <StepDots current={step} />

      {step === 1 ? (
        <form onSubmit={submitHousehold} className="surface rounded-[var(--radius-xl2)] p-5">
          <h1 className="text-xl font-extrabold tracking-tight">Créons votre foyer</h1>
          <p className="mt-1 text-sm text-muted">
            Deux informations suffisent pour commencer.
          </p>

          <div className="mt-5 space-y-4">
            <Field label="Nom du foyer" required>
              <Input
                value={householdName}
                onChange={(e) => setHouseholdName(e.target.value)}
                placeholder="La maison Dupont"
                maxLength={80}
                required
                data-autofocus
              />
            </Field>

            <Field label="Votre prénom" hint="tel qu'il apparaîtra dans le foyer" required>
              <Input
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="Camille"
                maxLength={60}
                required
              />
            </Field>

            <div>
              <span className="mb-1.5 block text-sm font-semibold">Votre couleur</span>
              <div className="flex items-center gap-3">
                <Avatar name={displayName || '?'} color={color} size="md" />
                <ColorPicker value={color} onChange={setColor} options={MEMBER_COLORS} />
              </div>
            </div>

            <details className="group">
              <summary className="cursor-pointer list-none text-sm font-semibold text-brand-600">
                Options avancées
              </summary>
              <div className="mt-3">
                <Field label="Fuseau horaire" hint="pour les horaires du calendrier">
                  <Select value={timezone} onChange={(e) => setTimezone(e.target.value)}>
                    {TIMEZONES.map((tz) => (
                      <option key={tz} value={tz}>
                        {tz}
                      </option>
                    ))}
                  </Select>
                </Field>
              </div>
            </details>
          </div>

          {error ? <ErrorNote className="mt-4">{error}</ErrorNote> : null}

          <Button type="submit" className="mt-5 w-full" loading={pending}>
            Continuer
            {pending ? null : <ArrowRight className="h-4 w-4" aria-hidden />}
          </Button>
        </form>
      ) : null}

      {step === 2 ? (
        <div className="surface rounded-[var(--radius-xl2)] p-5">
          <h1 className="text-xl font-extrabold tracking-tight">Vos enfants</h1>
          <p className="mt-1 text-sm text-muted">
            Ils n'ont pas besoin de compte. Vous pourrez les associer aux événements,
            aux repas et aux gardes. C'est modifiable à tout moment.
          </p>

          <div className="mt-4 space-y-3">
            {draftChildren.map((child, index) => (
              <div
                key={child.key}
                className="rounded-2xl border border-[var(--line)] p-3.5"
              >
                <div className="flex items-start gap-3">
                  <Avatar name={child.firstName || '?'} color={child.color} size="md" />
                  <div className="min-w-0 flex-1 space-y-3">
                    <Input
                      value={child.firstName}
                      placeholder="Prénom"
                      maxLength={60}
                      aria-label={`Prénom de l'enfant ${index + 1}`}
                      onChange={(e) =>
                        setDraftChildren((current) =>
                          current.map((c) =>
                            c.key === child.key ? { ...c, firstName: e.target.value } : c,
                          ),
                        )
                      }
                    />
                    <Field label="Date de naissance" hint="facultatif">
                      <Input
                        type="date"
                        value={child.birthDate}
                        max={new Date().toISOString().slice(0, 10)}
                        onChange={(e) =>
                          setDraftChildren((current) =>
                            current.map((c) =>
                              c.key === child.key ? { ...c, birthDate: e.target.value } : c,
                            ),
                          )
                        }
                      />
                    </Field>
                    <ColorPicker
                      value={child.color}
                      onChange={(next) =>
                        setDraftChildren((current) =>
                          current.map((c) => (c.key === child.key ? { ...c, color: next } : c)),
                        )
                      }
                      options={MEMBER_COLORS}
                    />
                  </div>
                  <Button
                    variant="ghost"
                    size="iconSm"
                    aria-label={`Retirer l'enfant ${index + 1}`}
                    onClick={() =>
                      setDraftChildren((current) => current.filter((c) => c.key !== child.key))
                    }
                  >
                    <Trash2 className="h-4 w-4 text-alert-500" aria-hidden />
                  </Button>
                </div>
              </div>
            ))}

            <Button variant="outline" className="w-full" onClick={addDraftChild}>
              <Plus className="h-4 w-4" aria-hidden />
              {draftChildren.length === 0 ? 'Ajouter un enfant' : 'Ajouter un autre enfant'}
            </Button>
          </div>

          {error ? <ErrorNote className="mt-4">{error}</ErrorNote> : null}

          <div className="mt-5 flex gap-2">
            <Button variant="ghost" className="flex-1" onClick={() => setStep(3)} disabled={pending}>
              Passer
            </Button>
            <Button className="flex-1" onClick={submitChildren} loading={pending}>
              Continuer
            </Button>
          </div>
        </div>
      ) : null}

      {step === 3 ? (
        <div className="surface rounded-[var(--radius-xl2)] p-5">
          <h1 className="text-xl font-extrabold tracking-tight">Invitez l'autre adulte</h1>
          <p className="mt-1 text-sm text-muted">
            Chacun garde son propre compte ; tout ce qui est partagé se synchronise entre vous.
          </p>

          {inviteLink ? (
            <div className="mt-5">
              <p className="mb-2 text-sm font-semibold">Lien d'invitation</p>
              <div className="rounded-2xl bg-[var(--bg-subtle)] p-3">
                <p className="break-all font-mono text-xs">{inviteLink}</p>
              </div>
              <Button variant="secondary" className="mt-3 w-full" onClick={copyInvite}>
                {copied ? (
                  <Check className="h-4 w-4" aria-hidden />
                ) : (
                  <Copy className="h-4 w-4" aria-hidden />
                )}
                {copied ? 'Copié' : 'Copier le lien'}
              </Button>
              <p className="mt-2 text-xs text-muted">
                Ce lien est valable 7 jours et ne peut servir qu'une fois. Envoyez-le par
                message ; il est visible une seule fois ici.
              </p>
            </div>
          ) : (
            <Button className="mt-5 w-full" onClick={generateInvite} loading={pending}>
              {pending ? null : <UserPlus className="h-4 w-4" aria-hidden />}
              Créer un lien d'invitation
            </Button>
          )}

          {error ? <ErrorNote className="mt-4">{error}</ErrorNote> : null}

          <Button
            variant={inviteLink ? 'primary' : 'ghost'}
            className="mt-3 w-full"
            onClick={finish}
          >
            {inviteLink ? 'Terminer' : 'Plus tard'}
          </Button>
        </div>
      ) : null}

      {householdId && step > 1 ? (
        <p className="mt-4 text-center text-xs text-muted">
          Votre foyer est créé. Les étapes suivantes sont facultatives.
        </p>
      ) : null}

      {step === 1 && demoEnabled ? (
        <div className="mt-6 text-center">
          <p className="mb-2 text-sm text-muted">Envie de voir avant de vous lancer ?</p>
          <Button variant="ghost" onClick={loadDemo} loading={loadingDemo}>
            {loadingDemo ? null : <FlaskConical className="h-4 w-4" aria-hidden />}
            Explorer un foyer de démonstration
          </Button>
          <p className="mt-1.5 text-xs text-muted">
            Deux adultes, deux enfants, une nounou et une semaine d'exemples.
            Supprimable à tout moment.
          </p>
        </div>
      ) : null}
    </div>
  );
}

function StepDots({ current }: { current: 1 | 2 | 3 }) {
  const labels = ['Foyer', 'Enfants', 'Invitation'];
  return (
    <ol className="mb-5 flex items-center justify-center gap-2" aria-label="Progression">
      {labels.map((label, index) => {
        const step = index + 1;
        const done = step < current;
        const active = step === current;
        return (
          <li key={label} className="flex items-center gap-2">
            <span
              aria-current={active ? 'step' : undefined}
              className={[
                'flex h-7 items-center gap-1.5 rounded-full px-3 text-xs font-bold transition-colors',
                active
                  ? 'bg-brand-500 text-white'
                  : done
                    ? 'bg-sage-100 text-sage-700'
                    : 'bg-[var(--bg-subtle)] text-[var(--fg-muted)]',
              ].join(' ')}
            >
              {done ? <Check className="h-3 w-3" strokeWidth={3.5} aria-hidden /> : null}
              {label}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
