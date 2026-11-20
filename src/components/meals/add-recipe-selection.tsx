'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { BookPlus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ErrorNote } from '@/components/ui/primitives';
import { useToast } from '@/components/ui/toast';
import { addNovemberRecipesAction } from '@/lib/actions/recipe-selection';

export function AddRecipeSelection({ householdId, householdName }: { householdId: string; householdName: string }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState('');
  function add() {
    setError('');
    startTransition(async () => {
      const result = await addNovemberRecipesAction(householdId);
      if (!result.ok) { setError(result.error); return; }
      toast.success('Les trois recettes sont dans votre carnet.');
      router.push('/recettes');
    });
  }
  return (
    <div className="space-y-2">
      <Button onClick={add} loading={pending}>
        <BookPlus className="h-4 w-4" aria-hidden /> Ajouter les 3 recettes au foyer
      </Button>
      <p className="text-sm text-muted">Carnet de {householdName}</p>
      {error && <ErrorNote>{error}</ErrorNote>}
    </div>
  );
}
