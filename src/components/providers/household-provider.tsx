'use client';

import * as React from 'react';
import type { ChildRow, HouseholdMemberRow, HouseholdRow } from '@/lib/database.types';

export type HouseholdContextValue = {
  household: HouseholdRow;
  /** Membre correspondant à l'utilisateur connecté. */
  me: HouseholdMemberRow;
  members: HouseholdMemberRow[];
  children: ChildRow[];
  isAdmin: boolean;
  /** Autres foyers de l'utilisateur, s'il en a plusieurs. */
  otherHouseholds: HouseholdRow[];
};

const HouseholdContext = React.createContext<HouseholdContextValue | null>(null);

/**
 * Met à disposition le foyer, ses membres et ses enfants dans tout l'arbre
 * client.
 *
 * Ces données sont chargées une fois côté serveur puis passées ici : elles
 * changent rarement, mais sont lues par presque tous les écrans (couleur d'un
 * membre, prénom d'un enfant, avatar d'un responsable).
 */
export function HouseholdProvider({
  value,
  children,
}: {
  value: HouseholdContextValue;
  children: React.ReactNode;
}) {
  return <HouseholdContext.Provider value={value}>{children}</HouseholdContext.Provider>;
}

export function useHousehold(): HouseholdContextValue {
  const ctx = React.useContext(HouseholdContext);
  if (!ctx) {
    throw new Error('useHousehold doit être utilisé à l’intérieur de <HouseholdProvider>.');
  }
  return ctx;
}

/** Retrouve un membre par son identifiant. */
export function useMember(memberId: string | null | undefined) {
  const { members } = useHousehold();
  return React.useMemo(
    () => (memberId ? (members.find((m) => m.id === memberId) ?? null) : null),
    [members, memberId],
  );
}

/** Retrouve un enfant par son identifiant. */
export function useChild(childId: string | null | undefined) {
  const { children } = useHousehold();
  return React.useMemo(
    () => (childId ? (children.find((c) => c.id === childId) ?? null) : null),
    [children, childId],
  );
}
