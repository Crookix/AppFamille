'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { fail, humanizeDbError, ok, requireActiveHousehold } from './_helpers';

/** Durée de vie d'une URL signée : le temps d'ouvrir le fichier, pas plus. */
const SIGNED_URL_SECONDS = 60;

const attachmentSchema = z.object({
  eventId: z.string().uuid('Événement inconnu.'),
  storagePath: z.string().min(1).max(500),
  fileName: z.string().min(1).max(200),
  mimeType: z.string().max(200).nullable().optional(),
  sizeBytes: z.number().int().min(0),
});

/**
 * Enregistre la ligne d'une pièce jointe déjà déposée dans le stockage.
 *
 * Le fichier lui-même part du navigateur vers le bucket — ses octets n'ont
 * rien à faire dans une requête vers le serveur — mais la ligne qui le
 * référence s'écrit ici, comme toute écriture.
 *
 * Ni le foyer ni l'auteur ne viennent du navigateur : ils sont relus de la
 * session. Le chemin, lui, est vérifié — il doit commencer par l'identifiant
 * du foyer actif, faute de quoi une pièce jointe d'un foyer pourrait être
 * rattachée à un autre. La contrainte `attachments_path_scoped` dit la même
 * chose en base ; ce contrôle-ci en donne la raison en français.
 */
export async function createAttachmentAction(input: z.input<typeof attachmentSchema>) {
  const parsed = attachmentSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0].message);

  const active = await requireActiveHousehold();
  if (!active.ok) return active;

  const { supabase, household, member } = active.data;
  const { eventId, storagePath, fileName, mimeType, sizeBytes } = parsed.data;

  if (!storagePath.startsWith(`${household.id}/`)) {
    return fail("Ce fichier n'est pas rangé dans votre foyer.");
  }

  const { data: event } = await supabase
    .from('events')
    .select('id')
    .eq('id', eventId)
    .eq('household_id', household.id)
    .maybeSingle();

  if (!event) return fail('Événement introuvable.');

  const { data, error } = await supabase
    .from('attachments')
    .insert({
      household_id: household.id,
      event_id: eventId,
      storage_path: storagePath,
      file_name: fileName,
      mime_type: mimeType ?? null,
      size_bytes: sizeBytes,
      uploaded_by: member.user_id,
    })
    .select('*')
    .single();

  if (error || !data) return fail(humanizeDbError(error));

  revalidatePath('/calendrier');
  return ok(data);
}

/**
 * Délivre une URL temporaire pour consulter une pièce jointe.
 *
 * Le bucket est privé : aucun fichier n'est joignable par URL devinable. Le
 * lien n'est produit qu'après avoir vérifié que la pièce jointe appartient bien
 * au foyer de l'utilisateur, et il expire au bout d'une minute.
 *
 * Cette vérification s'ajoute aux policies Storage, qui refusent déjà l'accès
 * à un chemin dont le premier segment n'est pas un foyer dont on est membre :
 * un utilisateur d'un autre foyer se heurte donc à deux barrières.
 */
export async function getAttachmentUrlAction(attachmentId: string) {
  const active = await requireActiveHousehold();
  if (!active.ok) return active;

  const { supabase, household } = active.data;

  const { data: attachment, error } = await supabase
    .from('attachments')
    .select('storage_path, file_name, household_id')
    .eq('id', attachmentId)
    .eq('household_id', household.id)
    .maybeSingle();

  if (error || !attachment) return fail('Pièce jointe introuvable.');

  const { data, error: signError } = await supabase.storage
    .from('attachments')
    .createSignedUrl(attachment.storage_path, SIGNED_URL_SECONDS, {
      download: attachment.file_name,
    });

  if (signError || !data?.signedUrl) {
    return fail("Le lien de téléchargement n'a pas pu être créé.");
  }

  return ok({ url: data.signedUrl, fileName: attachment.file_name });
}

/** Même chose, mais pour l'aperçu d'une image (sans forcer le téléchargement). */
export async function getAttachmentPreviewUrlAction(attachmentId: string) {
  const active = await requireActiveHousehold();
  if (!active.ok) return active;

  const { supabase, household } = active.data;

  const { data: attachment } = await supabase
    .from('attachments')
    .select('storage_path, mime_type')
    .eq('id', attachmentId)
    .eq('household_id', household.id)
    .maybeSingle();

  if (!attachment) return fail('Pièce jointe introuvable.');
  if (!attachment.mime_type?.startsWith('image/')) {
    return fail("Cette pièce jointe n'est pas une image.");
  }

  const { data } = await supabase.storage
    .from('attachments')
    .createSignedUrl(attachment.storage_path, SIGNED_URL_SECONDS);

  if (!data?.signedUrl) return fail("L'aperçu n'a pas pu être créé.");
  return ok({ url: data.signedUrl });
}

/**
 * Supprime une pièce jointe.
 *
 * Le fichier est retiré du stockage AVANT la ligne : si l'inverse échouait, on
 * garderait un fichier orphelin que plus rien ne référencerait, donc que
 * personne ne pourrait supprimer.
 */
export async function deleteAttachmentAction(attachmentId: string) {
  const active = await requireActiveHousehold();
  if (!active.ok) return active;

  const { supabase, household } = active.data;

  const { data: attachment } = await supabase
    .from('attachments')
    .select('storage_path, event_id')
    .eq('id', attachmentId)
    .eq('household_id', household.id)
    .maybeSingle();

  if (!attachment) return fail('Pièce jointe introuvable.');

  const { error: storageError } = await supabase.storage
    .from('attachments')
    .remove([attachment.storage_path]);

  if (storageError) return fail("Le fichier n'a pas pu être supprimé.");

  const { error } = await supabase
    .from('attachments')
    .delete()
    .eq('id', attachmentId)
    .eq('household_id', household.id);

  if (error) return fail("La pièce jointe n'a pas pu être supprimée.");

  revalidatePath('/calendrier');
  if (attachment.event_id) revalidatePath(`/calendrier/${attachment.event_id}`);
  return ok();
}
