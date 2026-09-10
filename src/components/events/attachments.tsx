'use client';

import * as React from 'react';
import { Download, FileText, Image as ImageIcon, Paperclip, Trash2, Upload } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { ErrorNote, Spinner } from '@/components/ui/primitives';
import { ConfirmSheet } from '@/components/ui/sheet';
import { useToast } from '@/components/ui/toast';
import { useHousehold } from '@/components/providers/household-provider';
import type { AttachmentRow } from '@/lib/database.types';
import {
  deleteAttachmentAction,
  getAttachmentUrlAction,
} from '@/lib/actions/attachments';

const MAX_SIZE = 25 * 1024 * 1024; // aligné sur la limite du bucket

/** Nettoie un nom de fichier pour en faire un segment de chemin sûr. */
function safeFileName(name: string) {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9._-]/g, '-')
    .replace(/-+/g, '-')
    .slice(-80);
}

function humanSize(bytes: number | null) {
  if (bytes === null) return '';
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} ko`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`;
}

export type PendingUpload = { id: string; file: File };

/**
 * Dépôt et consultation des pièces jointes d'un événement.
 *
 * Les fichiers sont rangés sous `<foyer>/<événement>/…` dans un bucket privé :
 * c'est ce premier segment que contrôlent les policies de stockage. Ils
 * restent inaccessibles même si l'événement est synchronisé avec Google, car
 * seul Tribu délivre les liens de consultation.
 */
export function AttachmentsField({
  eventId,
  initial = [],
  onPendingChange,
}: {
  /** `null` tant que l'événement n'est pas créé : les fichiers sont mis en attente. */
  eventId: string | null;
  initial?: AttachmentRow[];
  onPendingChange?: (files: File[]) => void;
}) {
  const supabase = createClient();
  const toast = useToast();
  const { household, me } = useHousehold();

  const [attachments, setAttachments] = React.useState<AttachmentRow[]>(initial);
  const [pending, setPending] = React.useState<PendingUpload[]>([]);
  const [uploading, setUploading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [toDelete, setToDelete] = React.useState<AttachmentRow | null>(null);
  const [deleting, setDeleting] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    onPendingChange?.(pending.map((p) => p.file));
  }, [pending, onPendingChange]);

  async function handleFiles(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) return;
    setError(null);

    const accepted: File[] = [];
    for (const file of Array.from(fileList)) {
      if (file.size > MAX_SIZE) {
        setError(`« ${file.name} » dépasse 25 Mo et n'a pas été ajouté.`);
        continue;
      }
      accepted.push(file);
    }
    if (accepted.length === 0) return;

    // Événement pas encore créé : on garde les fichiers de côté, ils seront
    // téléversés juste après l'enregistrement.
    if (!eventId) {
      setPending((current) => [
        ...current,
        ...accepted.map((file) => ({ id: `${file.name}-${Date.now()}`, file })),
      ]);
      return;
    }

    setUploading(true);
    for (const file of accepted) {
      const uploaded = await uploadOne(file, eventId);
      if (uploaded) setAttachments((current) => [...current, uploaded]);
    }
    setUploading(false);
  }

  async function uploadOne(file: File, targetEventId: string): Promise<AttachmentRow | null> {
    const path = `${household.id}/${targetEventId}/${crypto.randomUUID()}-${safeFileName(file.name)}`;

    const { error: uploadError } = await supabase.storage
      .from('attachments')
      .upload(path, file, { contentType: file.type || 'application/octet-stream' });

    if (uploadError) {
      setError(`« ${file.name} » n'a pas pu être envoyé.`);
      return null;
    }

    const { data, error: insertError } = await supabase
      .from('attachments')
      .insert({
        household_id: household.id,
        event_id: targetEventId,
        storage_path: path,
        file_name: file.name.slice(0, 200),
        mime_type: file.type || null,
        size_bytes: file.size,
        uploaded_by: me.user_id,
      })
      .select('*')
      .single();

    if (insertError || !data) {
      // La ligne n'a pas pu être écrite : on retire le fichier pour ne pas
      // laisser d'orphelin dans le stockage.
      await supabase.storage.from('attachments').remove([path]);
      setError(`« ${file.name} » n'a pas pu être enregistré.`);
      return null;
    }

    return data;
  }

  async function download(attachment: AttachmentRow) {
    const result = await getAttachmentUrlAction(attachment.id);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    window.open(result.data.url, '_blank', 'noopener,noreferrer');
  }

  async function confirmDelete() {
    if (!toDelete) return;
    setDeleting(true);
    const result = await deleteAttachmentAction(toDelete.id);
    setDeleting(false);

    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    setAttachments((current) => current.filter((a) => a.id !== toDelete.id));
    setToDelete(null);
    toast.success('Pièce jointe supprimée.');
  }

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <span className="text-sm font-semibold">Pièces jointes</span>
        <span className="text-xs text-muted">Billets, ordonnances, réservations…</span>
      </div>

      <ul className="space-y-1.5">
        {attachments.map((attachment) => (
          <li
            key={attachment.id}
            className="flex items-center gap-2.5 rounded-2xl border border-[var(--line)] px-3 py-2"
          >
            <FileIcon mime={attachment.mime_type} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold">
                {attachment.file_name}
              </span>
              <span className="block text-xs text-muted">
                {humanSize(attachment.size_bytes)}
              </span>
            </span>
            <Button
              variant="ghost"
              size="iconSm"
              onClick={() => download(attachment)}
              aria-label={`Ouvrir ${attachment.file_name}`}
            >
              <Download className="h-4 w-4" aria-hidden />
            </Button>
            <Button
              variant="ghost"
              size="iconSm"
              onClick={() => setToDelete(attachment)}
              aria-label={`Supprimer ${attachment.file_name}`}
            >
              <Trash2 className="h-4 w-4 text-alert-500" aria-hidden />
            </Button>
          </li>
        ))}

        {pending.map((item) => (
          <li
            key={item.id}
            className="flex items-center gap-2.5 rounded-2xl border border-dashed border-[var(--line)] px-3 py-2"
          >
            <FileIcon mime={item.file.type} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold">{item.file.name}</span>
              <span className="block text-xs text-muted">
                {humanSize(item.file.size)} · envoyé à l'enregistrement
              </span>
            </span>
            <Button
              variant="ghost"
              size="iconSm"
              onClick={() => setPending((current) => current.filter((p) => p.id !== item.id))}
              aria-label={`Retirer ${item.file.name}`}
            >
              <Trash2 className="h-4 w-4 text-alert-500" aria-hidden />
            </Button>
          </li>
        ))}
      </ul>

      {attachments.length === 0 && pending.length === 0 ? (
        <p className="rounded-2xl bg-[var(--bg-subtle)] px-3.5 py-3 text-sm text-muted">
          Aucun document pour le moment.
        </p>
      ) : null}

      <input
        ref={inputRef}
        type="file"
        multiple
        className="sr-only"
        onChange={(e) => {
          handleFiles(e.target.files);
          e.target.value = '';
        }}
      />

      <Button
        type="button"
        variant="outline"
        className="mt-2 w-full"
        onClick={() => inputRef.current?.click()}
        disabled={uploading}
      >
        {uploading ? <Spinner className="h-4 w-4" /> : <Upload className="h-4 w-4" aria-hidden />}
        {uploading ? 'Envoi en cours…' : 'Ajouter un document'}
      </Button>

      {error ? <ErrorNote className="mt-2">{error}</ErrorNote> : null}

      <ConfirmSheet
        open={Boolean(toDelete)}
        onClose={() => setToDelete(null)}
        onConfirm={confirmDelete}
        loading={deleting}
        title="Supprimer cette pièce jointe ?"
        description={`« ${toDelete?.file_name ?? ''} » sera définitivement supprimé du foyer.`}
      />
    </div>
  );
}

function FileIcon({ mime }: { mime: string | null }) {
  const isImage = mime?.startsWith('image/');
  return (
    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[var(--bg-subtle)] text-[var(--fg-muted)]">
      {isImage ? (
        <ImageIcon className="h-4 w-4" aria-hidden />
      ) : mime === 'application/pdf' ? (
        <FileText className="h-4 w-4" aria-hidden />
      ) : (
        <Paperclip className="h-4 w-4" aria-hidden />
      )}
    </span>
  );
}

/**
 * Téléverse les fichiers mis en attente pendant la création d'un événement.
 * Appelé par le formulaire une fois l'identifiant de l'événement connu.
 */
export async function uploadPendingAttachments(
  files: File[],
  householdId: string,
  eventId: string,
  userId: string,
): Promise<{ uploaded: number; failed: string[] }> {
  if (files.length === 0) return { uploaded: 0, failed: [] };

  const supabase = createClient();
  const failed: string[] = [];
  let uploaded = 0;

  for (const file of files) {
    const path = `${householdId}/${eventId}/${crypto.randomUUID()}-${safeFileName(file.name)}`;

    const { error: uploadError } = await supabase.storage
      .from('attachments')
      .upload(path, file, { contentType: file.type || 'application/octet-stream' });

    if (uploadError) {
      failed.push(file.name);
      continue;
    }

    const { error: insertError } = await supabase.from('attachments').insert({
      household_id: householdId,
      event_id: eventId,
      storage_path: path,
      file_name: file.name.slice(0, 200),
      mime_type: file.type || null,
      size_bytes: file.size,
      uploaded_by: userId,
    });

    if (insertError) {
      await supabase.storage.from('attachments').remove([path]);
      failed.push(file.name);
      continue;
    }

    uploaded += 1;
  }

  return { uploaded, failed };
}
