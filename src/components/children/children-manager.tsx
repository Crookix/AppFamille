'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ChevronRight, Plus, Users } from 'lucide-react';
import { Sheet } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Card, EmptyState, ErrorNote, Field, Input, Textarea } from '@/components/ui/primitives';
import { Avatar, ColorPicker } from '@/components/ui/avatar';
import { useToast } from '@/components/ui/toast';
import { useHousehold } from '@/components/providers/household-provider';
import {
  archiveChildAction,
  createChildAction,
  restoreChildAction,
  updateChildAction,
} from '@/lib/actions/children';
import { MEMBER_COLORS, nextFreeColor } from '@/lib/utils';
import type { ChildRow } from '@/lib/database.types';

/** Âge en années, ou en mois avant deux ans. */
export function formatAge(birthDate: string | null): string | null {
  if (!birthDate) return null;

  const birth = new Date(`${birthDate}T12:00:00Z`);
  const now = new Date();
  if (Number.isNaN(birth.getTime()) || birth > now) return null;

  const months =
    (now.getUTCFullYear() - birth.getUTCFullYear()) * 12 +
    (now.getUTCMonth() - birth.getUTCMonth()) -
    (now.getUTCDate() < birth.getUTCDate() ? 1 : 0);

  if (months < 24) return `${months} mois`;
  return `${Math.floor(months / 12)} ans`;
}

export function ChildrenManager({ archived }: { archived: ChildRow[] }) {
  const router = useRouter();
  const { children } = useHousehold();

  const [editing, setEditing] = React.useState<ChildRow | null>(null);
  const [creating, setCreating] = React.useState(false);
  const [showArchived, setShowArchived] = React.useState(false);

  return (
    <div>
      <h1 className="mb-4 text-xl font-extrabold tracking-tight">Enfants</h1>

      {children.length === 0 ? (
        <EmptyState
          icon={<Users className="h-7 w-7" aria-hidden />}
          title="Aucun enfant"
          description="Les enfants n'ont pas besoin de compte. Ajoutez-les pour les associer aux événements, aux repas et aux gardes."
          className="surface"
          action={
            <Button onClick={() => setCreating(true)}>
              <Plus className="h-4 w-4" aria-hidden />
              Ajouter un enfant
            </Button>
          }
        />
      ) : (
        <Card className="divide-y divide-[var(--line)] p-0">
          {children.map((child) => {
            const age = formatAge(child.birth_date);
            return (
              <Link
                key={child.id}
                href={`/plus/enfants/${child.id}`}
                className="flex items-center gap-3.5 px-4 py-3 transition-colors first:rounded-t-[var(--radius-xl2)] last:rounded-b-[var(--radius-xl2)] hover:bg-[var(--bg-subtle)]"
              >
                <Avatar name={child.first_name} color={child.color} size="md" />
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold">{child.first_name}</span>
                  <span className="block truncate text-sm text-muted">
                    {[age, child.school_name].filter(Boolean).join(' · ') || 'Fiche à compléter'}
                  </span>
                </span>
                <ChevronRight className="h-4 w-4 shrink-0 text-muted" aria-hidden />
              </Link>
            );
          })}
        </Card>
      )}

      {children.length > 0 ? (
        <Button variant="outline" className="mt-3 w-full" onClick={() => setCreating(true)}>
          <Plus className="h-4 w-4" aria-hidden />
          Ajouter un enfant
        </Button>
      ) : null}

      {archived.length > 0 ? (
        <div className="mt-6">
          <button
            type="button"
            onClick={() => setShowArchived((v) => !v)}
            className="text-sm font-semibold text-brand-600 underline underline-offset-2"
          >
            {showArchived ? 'Masquer' : 'Afficher'} les fiches archivées ({archived.length})
          </button>

          {showArchived ? (
            <Card className="mt-2 divide-y divide-[var(--line)] p-0">
              {archived.map((child) => (
                <div key={child.id} className="flex items-center gap-3 px-4 py-3">
                  <Avatar name={child.first_name} color={child.color} size="sm" />
                  <span className="min-w-0 flex-1 truncate text-sm">{child.first_name}</span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={async () => {
                      await restoreChildAction(child.id);
                      router.refresh();
                    }}
                  >
                    Restaurer
                  </Button>
                </div>
              ))}
            </Card>
          ) : null}
        </div>
      ) : null}

      <ChildSheet open={creating} onClose={() => setCreating(false)} />
      <ChildSheet
        open={Boolean(editing)}
        onClose={() => setEditing(null)}
        child={editing}
      />
    </div>
  );
}

/** Formulaire de fiche enfant, utilisé pour la création et la modification. */
export function ChildSheet({
  open,
  onClose,
  child,
}: {
  open: boolean;
  onClose: () => void;
  child?: ChildRow | null;
}) {
  const router = useRouter();
  const toast = useToast();
  const { children } = useHousehold();

  const [firstName, setFirstName] = React.useState('');
  const [birthDate, setBirthDate] = React.useState('');
  const [color, setColor] = React.useState('sauge');
  const [schoolName, setSchoolName] = React.useState('');
  const [schoolContact, setSchoolContact] = React.useState('');
  const [allergies, setAllergies] = React.useState('');
  const [notes, setNotes] = React.useState('');
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [confirmingArchive, setConfirmingArchive] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;

    setError(null);
    setConfirmingArchive(false);

    if (child) {
      setFirstName(child.first_name);
      setBirthDate(child.birth_date ?? '');
      setColor(child.color);
      setSchoolName(child.school_name ?? '');
      setSchoolContact(child.school_contact ?? '');
      setAllergies(child.allergies ?? '');
      setNotes(child.notes ?? '');
    } else {
      setFirstName('');
      setBirthDate('');
      setColor(nextFreeColor(children.map((c) => c.color)));
      setSchoolName('');
      setSchoolContact('');
      setAllergies('');
      setNotes('');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, child?.id]);

  async function submit(formEvent: React.FormEvent) {
    formEvent.preventDefault();
    setError(null);

    if (!firstName.trim()) {
      setError('Le prénom est obligatoire.');
      return;
    }

    setPending(true);

    const payload = {
      firstName: firstName.trim(),
      birthDate: birthDate || null,
      color,
      schoolName,
      schoolContact,
      allergies,
      notes,
    };

    const result = child
      ? await updateChildAction(child.id, payload)
      : await createChildAction(payload);

    setPending(false);

    if (!result.ok) {
      setError(result.error);
      return;
    }

    toast.success(child ? 'Fiche modifiée.' : 'Enfant ajouté.');
    onClose();
    router.refresh();
  }

  async function archive() {
    if (!child) return;
    setPending(true);
    const result = await archiveChildAction(child.id);
    setPending(false);

    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success('Fiche archivée.');
    onClose();
    router.push('/plus/enfants');
    router.refresh();
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={child ? `Modifier ${child.first_name}` : 'Nouvel enfant'}
      footer={
        confirmingArchive ? (
          <div className="pb-1">
            <p className="mb-3 text-sm text-muted">
              La fiche sera archivée. Les événements, repas et gardes passés restent
              intacts, et les bilans conservent leurs montants.
            </p>
            <div className="flex gap-2">
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => setConfirmingArchive(false)}
              >
                Annuler
              </Button>
              <Button variant="danger" className="flex-1" onClick={archive} loading={pending}>
                Archiver
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex gap-2 pb-1">
            {child ? (
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => setConfirmingArchive(true)}
              >
                Archiver
              </Button>
            ) : null}
            <Button variant="outline" className="flex-1" onClick={onClose} disabled={pending}>
              Annuler
            </Button>
            <Button className="flex-1" onClick={submit} loading={pending}>
              Enregistrer
            </Button>
          </div>
        )
      }
    >
      <form onSubmit={submit} className="space-y-5">
        <div className="flex items-center gap-3">
          <Avatar name={firstName || '?'} color={color} size="lg" />
          <div className="min-w-0 flex-1">
            <Field label="Prénom" required>
              <Input
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                maxLength={60}
                required
                data-autofocus
              />
            </Field>
          </div>
        </div>

        <div>
          <span className="mb-1.5 block text-sm font-semibold">Couleur</span>
          <ColorPicker value={color} onChange={setColor} options={MEMBER_COLORS} />
        </div>

        <Field label="Date de naissance" hint="facultatif">
          <Input
            type="date"
            value={birthDate}
            max={new Date().toISOString().slice(0, 10)}
            onChange={(e) => setBirthDate(e.target.value)}
          />
        </Field>

        <Field label="École ou crèche" hint="facultatif">
          <Input
            value={schoolName}
            onChange={(e) => setSchoolName(e.target.value)}
            placeholder="École Jules-Ferry"
            maxLength={120}
          />
        </Field>

        <Field label="Contact utile" hint="facultatif">
          <Input
            value={schoolContact}
            onChange={(e) => setSchoolContact(e.target.value)}
            placeholder="Secrétariat 01 23 45 67 89"
            maxLength={200}
          />
        </Field>

        <Field label="Allergies" hint="visible sur la fiche">
          <Textarea
            value={allergies}
            onChange={(e) => setAllergies(e.target.value)}
            rows={2}
            placeholder="Arachides"
          />
        </Field>

        <Field label="Consignes et notes" hint="facultatif">
          <Textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            placeholder="Doudou indispensable pour la sieste"
          />
        </Field>

        {error ? <ErrorNote>{error}</ErrorNote> : null}
      </form>
    </Sheet>
  );
}
