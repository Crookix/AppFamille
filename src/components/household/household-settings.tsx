'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft,
  Check,
  Copy,
  Crown,
  Home,
  ShieldCheck,
  Trash2,
  UserPlus,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge, Card, ErrorNote, Field, Input } from '@/components/ui/primitives';
import { ConfirmSheet, Sheet } from '@/components/ui/sheet';
import { Avatar } from '@/components/ui/avatar';
import { useToast } from '@/components/ui/toast';
import { useHousehold } from '@/components/providers/household-provider';
import {
  createInvitationAction,
  removeMemberAction,
  renameHouseholdAction,
  revokeInvitationAction,
  setMemberRoleAction,
} from '@/lib/actions/household';
import { formatDayLong } from '@/lib/datetime';
import type { InvitationRow, ProfileRow } from '@/lib/database.types';

export function HouseholdSettings({
  invitations,
  profiles,
}: {
  invitations: InvitationRow[];
  profiles: ProfileRow[];
}) {
  const router = useRouter();
  const toast = useToast();
  const { household, members, me, isAdmin } = useHousehold();

  const [name, setName] = React.useState(household.name);
  const [renaming, setRenaming] = React.useState(false);
  const [inviting, setInviting] = React.useState(false);
  const [inviteLink, setInviteLink] = React.useState<string | null>(null);
  const [copied, setCopied] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [removingMember, setRemovingMember] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);

  const pendingInvitations = invitations.filter(
    (i) => !i.accepted_at && !i.revoked_at && new Date(i.expires_at) > new Date(),
  );

  async function rename() {
    setPending(true);
    setError(null);

    const result = await renameHouseholdAction(name);
    setPending(false);

    if (!result.ok) {
      setError(result.error);
      return;
    }
    toast.success('Foyer renommé.');
    setRenaming(false);
    router.refresh();
  }

  async function invite() {
    setPending(true);
    setError(null);

    const result = await createInvitationAction({});
    setPending(false);

    if (!result.ok) {
      setError(result.error);
      return;
    }
    setInviteLink(result.data.link);
    router.refresh();
  }

  async function copyLink() {
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

  async function toggleRole(memberId: string, current: 'admin' | 'adulte') {
    const result = await setMemberRoleAction(
      memberId,
      current === 'admin' ? 'adulte' : 'admin',
    );
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success('Rôle modifié.');
    router.refresh();
  }

  async function confirmRemove() {
    if (!removingMember) return;
    setPending(true);

    const isSelf = removingMember === me.id;
    const result = await removeMemberAction(removingMember);
    setPending(false);

    if (!result.ok) {
      toast.error(result.error);
      return;
    }

    setRemovingMember(null);
    toast.success(isSelf ? 'Vous avez quitté le foyer.' : 'Membre retiré.');
    router.push(isSelf ? '/bienvenue' : '/plus/foyer');
    router.refresh();
  }

  const memberBeingRemoved = members.find((m) => m.id === removingMember);

  return (
    <div>
      <Link
        href="/plus"
        className="mb-4 inline-flex items-center gap-1.5 text-sm font-semibold text-muted transition-colors hover:text-[var(--fg)]"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden />
        Plus
      </Link>

      <h1 className="mb-4 text-xl font-extrabold tracking-tight">Le foyer</h1>

      {/* --- Nom ---------------------------------------------------------- */}
      <Card className="mb-4">
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-brand-50 text-brand-600 dark:bg-white/5">
            <Home className="h-5 w-5" aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate font-bold">{household.name}</p>
            <p className="text-sm text-muted">
              Créé le {formatDayLong(household.created_at.slice(0, 10), { withYear: true })}
            </p>
          </div>
          {isAdmin ? (
            <Button variant="ghost" size="sm" onClick={() => setRenaming(true)}>
              Renommer
            </Button>
          ) : null}
        </div>
      </Card>

      {/* --- Membres ------------------------------------------------------ */}
      <section className="mb-4">
        <h2 className="mb-2 px-1 text-xs font-bold uppercase tracking-wide text-muted">
          Adultes du foyer
        </h2>
        <Card className="divide-y divide-[var(--line)] p-0">
          {members.map((member) => {
            const profile = profiles.find((p) => p.id === member.user_id);
            return (
              <div key={member.id} className="flex items-center gap-3 px-4 py-3">
                <Avatar
                  name={member.display_name}
                  color={member.color}
                  size="md"
                />
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-1.5 truncate font-semibold">
                    {member.display_name}
                    {member.id === me.id ? (
                      <span className="text-xs font-normal text-muted">(vous)</span>
                    ) : null}
                    {member.role === 'admin' ? (
                      <Badge tone="brand">
                        <Crown className="h-3 w-3" aria-hidden />
                        admin
                      </Badge>
                    ) : null}
                  </p>
                  <p className="truncate text-sm text-muted">{profile?.email ?? ''}</p>
                </div>

                {isAdmin && member.id !== me.id ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => toggleRole(member.id, member.role)}
                  >
                    {member.role === 'admin' ? 'Retirer admin' : 'Nommer admin'}
                  </Button>
                ) : null}

                {(isAdmin && member.id !== me.id) || member.id === me.id ? (
                  <Button
                    variant="ghost"
                    size="iconSm"
                    onClick={() => setRemovingMember(member.id)}
                    aria-label={
                      member.id === me.id
                        ? 'Quitter le foyer'
                        : `Retirer ${member.display_name}`
                    }
                  >
                    {member.id === me.id ? (
                      <X className="h-4 w-4 text-muted" aria-hidden />
                    ) : (
                      <Trash2 className="h-4 w-4 text-alert-500" aria-hidden />
                    )}
                  </Button>
                ) : null}
              </div>
            );
          })}
        </Card>
      </section>

      {/* --- Invitations --------------------------------------------------- */}
      {isAdmin ? (
        <section className="mb-4">
          <h2 className="mb-2 px-1 text-xs font-bold uppercase tracking-wide text-muted">
            Invitations
          </h2>

          {pendingInvitations.length > 0 ? (
            <Card className="mb-2 divide-y divide-[var(--line)] p-0">
              {pendingInvitations.map((invitation) => (
                <div key={invitation.id} className="flex items-center gap-3 px-4 py-3">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--bg-subtle)] text-muted">
                    <UserPlus className="h-4 w-4" aria-hidden />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">
                      {invitation.email ?? 'Lien en attente'}
                    </p>
                    <p className="text-xs text-muted">
                      Valable jusqu'au{' '}
                      {formatDayLong(invitation.expires_at.slice(0, 10), { withYear: true })}
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={async () => {
                      const result = await revokeInvitationAction(invitation.id);
                      if (!result.ok) {
                        toast.error(result.error);
                        return;
                      }
                      toast.success('Invitation annulée.');
                      router.refresh();
                    }}
                  >
                    Annuler
                  </Button>
                </div>
              ))}
            </Card>
          ) : null}

          <Button
            variant="outline"
            className="w-full"
            onClick={() => {
              setInviteLink(null);
              setInviting(true);
            }}
          >
            <UserPlus className="h-4 w-4" aria-hidden />
            Inviter un adulte
          </Button>
        </section>
      ) : (
        <p className="mb-4 flex items-start gap-2 rounded-2xl bg-[var(--bg-subtle)] px-3.5 py-2.5 text-xs text-muted">
          <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          Seul un administrateur du foyer peut inviter ou retirer un membre.
        </p>
      )}

      {/* --- Feuilles ------------------------------------------------------ */}
      <Sheet
        open={renaming}
        onClose={() => setRenaming(false)}
        title="Renommer le foyer"
        footer={
          <div className="flex gap-2 pb-1">
            <Button
              variant="outline"
              className="flex-1"
              onClick={() => setRenaming(false)}
              disabled={pending}
            >
              Annuler
            </Button>
            <Button className="flex-1" onClick={rename} loading={pending}>
              Enregistrer
            </Button>
          </div>
        }
      >
        <Field label="Nom du foyer" required>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={80}
            data-autofocus
          />
        </Field>
        {error ? <ErrorNote className="mt-3">{error}</ErrorNote> : null}
      </Sheet>

      <Sheet
        open={inviting}
        onClose={() => setInviting(false)}
        title="Inviter un adulte"
        footer={
          <div className="pb-1">
            <Button className="w-full" onClick={() => setInviting(false)}>
              Fermer
            </Button>
          </div>
        }
      >
        {inviteLink ? (
          <div>
            <p className="mb-2 text-sm font-semibold">Lien d'invitation</p>
            <div className="rounded-2xl bg-[var(--bg-subtle)] p-3">
              <p className="break-all font-mono text-xs">{inviteLink}</p>
            </div>
            <Button variant="secondary" className="mt-3 w-full" onClick={copyLink}>
              {copied ? (
                <Check className="h-4 w-4" aria-hidden />
              ) : (
                <Copy className="h-4 w-4" aria-hidden />
              )}
              {copied ? 'Copié' : 'Copier le lien'}
            </Button>
            <p className="mt-3 text-xs text-muted">
              Valable 7 jours, utilisable une seule fois, et visible uniquement
              maintenant : seule son empreinte est conservée en base.
            </p>
          </div>
        ) : (
          <>
            <p className="mb-4 text-sm text-muted">
              La personne invitée gardera son propre compte. Tout ce qui est partagé
              se synchronisera entre vous.
            </p>
            <Button className="w-full" onClick={invite} loading={pending}>
              <UserPlus className="h-4 w-4" aria-hidden />
              Créer un lien d'invitation
            </Button>
            {error ? <ErrorNote className="mt-3">{error}</ErrorNote> : null}
          </>
        )}
      </Sheet>

      <ConfirmSheet
        open={Boolean(removingMember)}
        onClose={() => setRemovingMember(null)}
        onConfirm={confirmRemove}
        loading={pending}
        title={
          removingMember === me.id ? 'Quitter ce foyer ?' : 'Retirer ce membre ?'
        }
        description={
          removingMember === me.id
            ? "Vous n'aurez plus accès au calendrier, aux tâches, aux courses ni aux gardes de ce foyer. Les données restent pour les autres membres."
            : `${memberBeingRemoved?.display_name ?? 'Cette personne'} n'aura plus accès au foyer. Ce qu'elle a créé y reste.`
        }
        confirmLabel={removingMember === me.id ? 'Quitter' : 'Retirer'}
      />
    </div>
  );
}
