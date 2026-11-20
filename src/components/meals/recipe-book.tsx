'use client';

import { useState } from 'react';
import Link from 'next/link';
import { BookOpen, ChevronRight, Plus, Star } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/primitives';
import { RecipeSheet } from '@/components/meals/recipe-sheet';
import type { RecipeRow } from '@/lib/database.types';

type RecipeSummary = Pick<RecipeRow, 'id' | 'name' | 'servings' | 'is_favorite'>;

export function RecipeBook({ recipes }: { recipes: RecipeSummary[] }) {
  const [creating, setCreating] = useState(false);

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-[1.75rem] font-bold tracking-tight">Recettes du foyer</h1>
        <Button size="sm" onClick={() => setCreating(true)}>
          <Plus className="h-4 w-4" aria-hidden /> Nouvelle recette
        </Button>
      </div>
      {recipes.length ? (
        <ul className="grid gap-3 sm:grid-cols-2">
          {recipes.map((recipe) => (
            <li key={recipe.id} className="min-w-0">
              <Link href={`/recettes/${recipe.id}`}
                className="surface flex h-full items-center gap-3 rounded-[var(--radius-xl2)] p-4 hover:bg-[var(--bg-hover)]">
                <BookOpen className="h-5 w-5 shrink-0 text-[var(--accent-text)]" aria-hidden />
                <span className="min-w-0 flex-1">
                  <span className="block break-words font-semibold leading-snug">{recipe.name}</span>
                  <span className="mt-1 flex items-center gap-1.5 text-sm text-muted">
                    {recipe.servings} personne{recipe.servings > 1 ? 's' : ''}
                    {recipe.is_favorite && <Star className="h-3.5 w-3.5 text-[var(--notice-fg)]" fill="currentColor" aria-label="Favori" />}
                  </span>
                </span>
                <ChevronRight className="h-4 w-4 shrink-0 text-muted" aria-hidden />
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState icon={<BookOpen aria-hidden />} title="Votre première recette"
          description="Ajoutez un plat ou choisissez la sélection de novembre ci-dessous." className="surface" />
      )}
      <Link href="/recettes/selection-novembre"
        className="mt-4 inline-flex min-h-11 items-center gap-1.5 font-semibold text-[var(--accent-text)]">
        Les 3 recettes de novembre <ChevronRight className="h-4 w-4" aria-hidden />
      </Link>
      {creating && <RecipeSheet open onClose={() => setCreating(false)} />}
    </div>
  );
}
