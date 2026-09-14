/**
 * Types de la base MyFamily.
 *
 * Écrits à la main pour rester alignés sur `supabase/migrations`. Une fois le
 * projet Supabase provisionné, ils peuvent être régénérés fidèlement avec :
 *
 *   npx supabase gen types typescript --project-id <ref> > src/lib/database.types.ts
 *
 * `Insert` et `Update` sont dérivés de `Row` par le helper `Table` ci-dessous
 * plutôt que recopiés, pour qu'ils ne puissent pas diverger.
 */

/** Colonnes toujours fournies par la base. */
type Generated = 'id' | 'created_at' | 'updated_at';

type Table<Row, Required extends keyof Row = never> = {
  Row: Row;
  Insert: Pick<Row, Required> & Partial<Omit<Row, Required>>;
  Update: Partial<Row>;
  Relationships: [];
};

// --- Énumérations -----------------------------------------------------------

export type HouseholdRole = 'admin' | 'adulte';

export type EventCategory =
  | 'famille'
  | 'ecole'
  | 'sante'
  | 'activite'
  | 'voyage'
  | 'garde'
  | 'perso';

export type EventKind = 'standard' | 'deplacement' | 'garde';
export type EventOrigin = 'tribu' | 'google';
export type GoogleShareMode = 'details' | 'disponibilite';
export type TransportMode =
  | 'train'
  | 'avion'
  | 'voiture'
  | 'bus'
  | 'bateau'
  | 'velo'
  | 'autre';

export type TaskStatus = 'a_faire' | 'en_cours' | 'termine';
export type TaskPriority = 'basse' | 'normale' | 'haute';

export type ShopAisle =
  | 'fruits_legumes'
  | 'boucherie_poissonnerie'
  | 'frais'
  | 'epicerie'
  | 'surgeles'
  | 'boissons'
  | 'boulangerie'
  | 'maison'
  | 'hygiene'
  | 'bebe'
  | 'autre';

export type MealSlot = 'petit_dejeuner' | 'dejeuner' | 'diner';
export type ChildcareStatus = 'prevue' | 'a_confirmer' | 'confirmee' | 'annulee';
export type PaymentStatus = 'a_payer' | 'paye';

export type RecoKind = 'film' | 'serie' | 'theatre' | 'cadeau' | 'autre';
export type RecoStatus = 'idee' | 'en_cours' | 'fait';

export type NotificationKind =
  | 'tache_attribuee'
  | 'tache_terminee'
  | 'evenement_modifie'
  | 'evenement_ajoute'
  | 'rappel'
  | 'garde_a_confirmer'
  | 'invitation_acceptee'
  | 'sync_google';

// --- Lignes -----------------------------------------------------------------

export type ProfileRow = {
  id: string;
  email: string | null;
  full_name: string | null;
  avatar_url: string | null;
  created_at: string;
  updated_at: string;
};

export type HouseholdRow = {
  id: string;
  name: string;
  timezone: string;
  is_demo: boolean;
  // Devient NULL quand son fondateur supprime son compte (migration 0017).
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type HouseholdMemberRow = {
  id: string;
  household_id: string;
  user_id: string;
  role: HouseholdRole;
  display_name: string;
  color: string;
  avatar_path: string | null;
  created_at: string;
  updated_at: string;
};

export type InvitationRow = {
  id: string;
  household_id: string;
  email: string | null;
  role: HouseholdRole;
  token_hash: string;
  expires_at: string;
  // Devient NULL quand son émetteur supprime son compte (migration 0017).
  created_by: string | null;
  accepted_at: string | null;
  accepted_by: string | null;
  revoked_at: string | null;
  created_at: string;
};

export type ChildRow = {
  id: string;
  household_id: string;
  first_name: string;
  birth_date: string | null;
  color: string;
  photo_path: string | null;
  school_name: string | null;
  school_contact: string | null;
  notes: string | null;
  allergies: string | null;
  archived: boolean;
  created_at: string;
  updated_at: string;
};

export type ChildActivityRow = {
  id: string;
  household_id: string;
  child_id: string;
  label: string;
  weekday: number | null;
  start_time: string | null;
  end_time: string | null;
  location: string | null;
  notes: string | null;
  created_at: string;
};

export type GoogleAccountRow = {
  id: string;
  user_id: string;
  google_sub: string;
  email: string | null;
  scopes: string[];
  calendar_authorized: boolean;
  connected_at: string;
  last_error: string | null;
  revoked_at: string | null;
  created_at: string;
  updated_at: string;
};

/**
 * Jetons OAuth chiffrés.
 *
 * La table n'a aucune policy RLS : elle est inaccessible depuis le navigateur,
 * et seul le rôle `service_role` peut la lire côté serveur.
 */
export type GoogleCredentialRow = {
  google_account_id: string;
  access_token_enc: string | null;
  refresh_token_enc: string | null;
  token_expires_at: string | null;
  updated_at: string;
};

export type GoogleDeletionQueueRow = {
  id: string;
  household_id: string;
  google_calendar_ref: string;
  google_event_id: string;
  origin: EventOrigin;
  requested_at: string;
  processed_at: string | null;
  error_message: string | null;
};

export type GoogleCalendarRow = {
  id: string;
  google_account_id: string;
  household_id: string;
  google_calendar_id: string;
  summary: string | null;
  description: string | null;
  time_zone: string | null;
  background_color: string | null;
  access_role: string | null;
  is_primary: boolean;
  is_selected: boolean;
  is_write_target: boolean;
  share_mode: GoogleShareMode;
  sync_token: string | null;
  last_sync_at: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
};

export type EventRow = {
  id: string;
  household_id: string;
  title: string;
  description: string | null;
  category: EventCategory;
  kind: EventKind;
  starts_at: string;
  ends_at: string;
  all_day: boolean;
  timezone: string;
  location: string | null;
  address: string | null;
  responsible_member_id: string | null;
  dropoff_member_id: string | null;
  pickup_member_id: string | null;
  recurrence_rule: string | null;
  recurring_parent_id: string | null;
  original_starts_at: string | null;
  is_cancelled: boolean;
  origin: EventOrigin;
  google_calendar_ref: string | null;
  is_busy_only: boolean;
  revision: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type EventParticipantRow = {
  id: string;
  household_id: string;
  event_id: string;
  member_id: string | null;
  child_id: string | null;
};

export type EventReminderRow = {
  id: string;
  household_id: string;
  event_id: string;
  minutes_before: number;
  created_at: string;
};

export type TripDetailRow = {
  event_id: string;
  household_id: string;
  transport_mode: TransportMode;
  departure_place: string | null;
  departure_at: string | null;
  departure_tz: string;
  arrival_place: string | null;
  arrival_at: string | null;
  arrival_tz: string;
  carrier_number: string | null;
  booking_ref: string | null;
  seat_info: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type AttachmentRow = {
  id: string;
  household_id: string;
  event_id: string | null;
  storage_path: string;
  file_name: string;
  mime_type: string | null;
  size_bytes: number | null;
  uploaded_by: string | null;
  created_at: string;
};

export type GoogleEventLinkRow = {
  id: string;
  household_id: string;
  event_id: string;
  google_calendar_ref: string;
  google_event_id: string;
  google_ical_uid: string | null;
  google_recurring_event_id: string | null;
  etag: string | null;
  remote_updated_at: string | null;
  pushed_revision: number | null;
  last_synced_at: string | null;
  deleted_remotely: boolean;
  created_at: string;
  updated_at: string;
};

export type GoogleSyncRunRow = {
  id: string;
  household_id: string;
  google_calendar_ref: string | null;
  direction: 'import' | 'export' | 'complet';
  status: 'en_cours' | 'succes' | 'echec';
  imported_count: number;
  updated_count: number;
  exported_count: number;
  deleted_count: number;
  error_message: string | null;
  started_at: string;
  finished_at: string | null;
};

export type TaskRow = {
  id: string;
  household_id: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  assignee_id: string | null;
  due_date: string | null;
  due_time: string | null;
  parent_task_id: string | null;
  position: number;
  child_id: string | null;
  event_id: string | null;
  recurrence_rule: string | null;
  completed_at: string | null;
  completed_by: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type TaskCompletionRow = {
  id: string;
  household_id: string;
  task_id: string;
  title: string;
  due_date: string | null;
  completed_at: string;
  completed_by: string | null;
};

export type ShoppingListRow = {
  id: string;
  household_id: string;
  name: string;
  is_default: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type ShoppingItemRow = {
  id: string;
  household_id: string;
  list_id: string;
  label: string;
  label_key: string;
  quantity: number | null;
  unit: string | null;
  note: string | null;
  aisle: ShopAisle;
  is_checked: boolean;
  checked_at: string | null;
  checked_by: string | null;
  source: 'manuel' | 'repas';
  source_meal_id: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type FrequentItemRow = {
  id: string;
  household_id: string;
  label: string;
  label_key: string;
  unit: string | null;
  aisle: ShopAisle;
  use_count: number;
  last_used_at: string;
};

export type ChecklistRow = {
  id: string;
  household_id: string;
  name: string;
  note: string | null;
  position: number;
  last_reset_at: string | null;
  last_reset_by: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type ChecklistItemRow = {
  id: string;
  household_id: string;
  checklist_id: string;
  label: string;
  position: number;
  is_checked: boolean;
  checked_at: string | null;
  checked_by: string | null;
  created_at: string;
  updated_at: string;
};

export type RecommendationRow = {
  id: string;
  household_id: string;
  kind: RecoKind;
  status: RecoStatus;
  title: string;
  author: string | null;
  note: string | null;
  url: string | null;
  rating: number | null;
  recipient_label: string | null;
  recipient_child_id: string | null;
  occasion: string | null;
  price: number | null;
  suggested_by: string | null;
  done_at: string | null;
  done_by: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type RecommendationWantRow = {
  id: string;
  household_id: string;
  recommendation_id: string;
  member_id: string;
  created_at: string;
};

export type RecipeRow = {
  id: string;
  household_id: string;
  name: string;
  servings: number;
  steps: string | null;
  source_url: string | null;
  notes: string | null;
  is_favorite: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type RecipeIngredientRow = {
  id: string;
  household_id: string;
  recipe_id: string;
  label: string;
  label_key: string;
  quantity: number | null;
  unit: string | null;
  aisle: ShopAisle;
  position: number;
};

export type MealRow = {
  id: string;
  household_id: string;
  meal_date: string;
  slot: MealSlot;
  title: string;
  recipe_id: string | null;
  servings: number | null;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type MealParticipantRow = {
  id: string;
  household_id: string;
  meal_id: string;
  member_id: string | null;
  child_id: string | null;
};

export type NannyRow = {
  id: string;
  household_id: string;
  name: string;
  phone: string | null;
  email: string | null;
  color: string;
  notes: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export type NannyRateRow = {
  id: string;
  household_id: string;
  nanny_id: string;
  hourly_rate: number;
  effective_from: string;
  created_at: string;
};

export type ChildcareSessionRow = {
  id: string;
  household_id: string;
  nanny_id: string;
  event_id: string | null;
  scheduled_start: string;
  scheduled_end: string;
  actual_start: string | null;
  actual_end: string | null;
  unpaid_break_minutes: number;
  adjustment_minutes: number;
  adjustment_reason: string | null;
  adjusted_by: string | null;
  adjusted_at: string | null;
  applied_hourly_rate: number;
  status: ChildcareStatus;
  location: string | null;
  notes: string | null;
  confirmed_at: string | null;
  confirmed_by: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  /** Colonnes calculées par la base. */
  scheduled_minutes: number;
  worked_minutes: number | null;
};

export type ChildcareSessionChildRow = {
  id: string;
  household_id: string;
  session_id: string;
  child_id: string;
};

export type ChildcareExtraRow = {
  id: string;
  household_id: string;
  session_id: string;
  label: string;
  amount: number;
  created_at: string;
};

export type NannySettlementRow = {
  id: string;
  household_id: string;
  nanny_id: string;
  month: string;
  status: PaymentStatus;
  paid_at: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type ChildcareSessionTotalsRow = {
  session_id: string;
  household_id: string;
  nanny_id: string;
  scheduled_start: string;
  scheduled_end: string;
  status: ChildcareStatus;
  scheduled_minutes: number;
  worked_minutes: number | null;
  applied_hourly_rate: number;
  extras_total: number;
  hours_amount: number | null;
  total_amount: number | null;
};

export type NotificationRow = {
  id: string;
  household_id: string;
  user_id: string;
  kind: NotificationKind;
  title: string;
  body: string | null;
  link: string | null;
  actor_user_id: string | null;
  read_at: string | null;
  created_at: string;
};

export type NotificationPreferenceRow = {
  id: string;
  household_id: string;
  user_id: string;
  tasks_assigned: boolean;
  tasks_completed: boolean;
  events_changed: boolean;
  event_reminders: boolean;
  childcare_to_confirm: boolean;
  google_sync_errors: boolean;
  push_enabled: boolean;
  created_at: string;
  updated_at: string;
};

// --- Schéma -----------------------------------------------------------------

export type Database = {
  public: {
    Tables: {
      profiles: Table<ProfileRow, 'id'>;
      households: Table<HouseholdRow, 'name' | 'created_by'>;
      household_members: Table<HouseholdMemberRow, 'household_id' | 'user_id' | 'display_name'>;
      invitations: Table<
        InvitationRow,
        'household_id' | 'token_hash' | 'expires_at' | 'created_by'
      >;
      children: Table<ChildRow, 'household_id' | 'first_name'>;
      child_activities: Table<ChildActivityRow, 'household_id' | 'child_id' | 'label'>;
      google_accounts: Table<GoogleAccountRow, 'user_id' | 'google_sub'>;
      google_credentials: Table<GoogleCredentialRow, 'google_account_id'>;
      google_deletion_queue: Table<
        GoogleDeletionQueueRow,
        'household_id' | 'google_calendar_ref' | 'google_event_id' | 'origin'
      >;
      google_calendars: Table<
        GoogleCalendarRow,
        'google_account_id' | 'household_id' | 'google_calendar_id'
      >;
      events: Table<EventRow, 'household_id' | 'title' | 'starts_at' | 'ends_at'>;
      event_participants: Table<EventParticipantRow, 'household_id' | 'event_id'>;
      event_reminders: Table<
        EventReminderRow,
        'household_id' | 'event_id' | 'minutes_before'
      >;
      trip_details: Table<TripDetailRow, 'event_id' | 'household_id'>;
      attachments: Table<
        AttachmentRow,
        'household_id' | 'storage_path' | 'file_name'
      >;
      google_event_links: Table<
        GoogleEventLinkRow,
        'household_id' | 'event_id' | 'google_calendar_ref' | 'google_event_id'
      >;
      google_sync_runs: Table<GoogleSyncRunRow, 'household_id' | 'direction' | 'status'>;
      tasks: Table<TaskRow, 'household_id' | 'title'>;
      task_completions: Table<TaskCompletionRow, 'household_id' | 'task_id' | 'title'>;
      shopping_lists: Table<ShoppingListRow, 'household_id' | 'name'>;
      shopping_items: Table<
        ShoppingItemRow,
        'household_id' | 'list_id' | 'label' | 'label_key'
      >;
      frequent_items: Table<FrequentItemRow, 'household_id' | 'label' | 'label_key'>;
      recipes: Table<RecipeRow, 'household_id' | 'name'>;
      recommendations: Table<RecommendationRow, 'household_id' | 'kind' | 'title'>;
      checklists: Table<ChecklistRow, 'household_id' | 'name'>;
      checklist_items: Table<ChecklistItemRow, 'household_id' | 'checklist_id' | 'label'>;
      recommendation_wants: Table<
        RecommendationWantRow,
        'household_id' | 'recommendation_id' | 'member_id'
      >;
      recipe_ingredients: Table<
        RecipeIngredientRow,
        'household_id' | 'recipe_id' | 'label' | 'label_key'
      >;
      meals: Table<MealRow, 'household_id' | 'meal_date' | 'slot' | 'title'>;
      meal_participants: Table<MealParticipantRow, 'household_id' | 'meal_id'>;
      nannies: Table<NannyRow, 'household_id' | 'name'>;
      nanny_rates: Table<
        NannyRateRow,
        'household_id' | 'nanny_id' | 'hourly_rate' | 'effective_from'
      >;
      childcare_sessions: Table<
        Omit<ChildcareSessionRow, 'scheduled_minutes' | 'worked_minutes'> & {
          scheduled_minutes: number;
          worked_minutes: number | null;
        },
        | 'household_id'
        | 'nanny_id'
        | 'scheduled_start'
        | 'scheduled_end'
        | 'applied_hourly_rate'
      >;
      childcare_session_children: Table<
        ChildcareSessionChildRow,
        'household_id' | 'session_id' | 'child_id'
      >;
      childcare_extras: Table<
        ChildcareExtraRow,
        'household_id' | 'session_id' | 'label' | 'amount'
      >;
      nanny_settlements: Table<NannySettlementRow, 'household_id' | 'nanny_id' | 'month'>;
      notifications: Table<
        NotificationRow,
        'household_id' | 'user_id' | 'kind' | 'title'
      >;
      notification_preferences: Table<
        NotificationPreferenceRow,
        'household_id' | 'user_id'
      >;
    };
    Views: {
      childcare_session_totals: {
        Row: ChildcareSessionTotalsRow;
        Relationships: [];
      };
    };
    Functions: {
      create_household: {
        Args: { p_name: string; p_display_name?: string | null; p_timezone?: string };
        Returns: string;
      };
      accept_invitation: {
        Args: { p_token: string };
        Returns: string;
      };
      ensure_profile: {
        Args: {
          p_email?: string | null;
          p_full_name?: string | null;
          p_avatar_url?: string | null;
          p_provider?: string | null;
        };
        Returns: string;
      };
      invitation_preview: {
        Args: { p_token: string };
        Returns: {
          state: 'valide' | 'invalide' | 'expiree' | 'revoquee' | 'deja_acceptee';
          household_name: string | null;
          inviter_name: string | null;
          expires_at: string | null;
        }[];
      };
      nanny_rate_at: {
        Args: { p_nanny_id: string; p_on: string };
        Returns: number | null;
      };
      is_household_member: { Args: { p_household_id: string }; Returns: boolean };
      is_household_admin: { Args: { p_household_id: string }; Returns: boolean };
      current_member_id: { Args: { p_household_id: string }; Returns: string | null };
    };
    Enums: {
      household_role: HouseholdRole;
      event_category: EventCategory;
      event_kind: EventKind;
      event_origin: EventOrigin;
      google_share_mode: GoogleShareMode;
      transport_mode: TransportMode;
      task_status: TaskStatus;
      task_priority: TaskPriority;
      shop_aisle: ShopAisle;
      reco_kind: RecoKind;
      reco_status: RecoStatus;
      meal_slot: MealSlot;
      childcare_status: ChildcareStatus;
      payment_status: PaymentStatus;
      notification_kind: NotificationKind;
    };
    CompositeTypes: Record<string, never>;
  };
};

export type { Generated };
