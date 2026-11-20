'use client';

import { useState } from 'react';
import Link from 'next/link';
import { CalendarPlus, ChevronLeft, Pencil, Users } from 'lucide-react';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardTitle } from '@/components/ui/primitives';
import { RecipeSheet } from '@/components/meals/recipe-sheet';
import type { RecipeIngredientRow, RecipeRow } from '@/lib/database.types';
import { formatQuantity } from '@/lib/ingredients';

export function RecipeDetail({ recipe, ingredients }: { recipe: RecipeRow; ingredients: RecipeIngredientRow[] }) {
  const [editing, setEditing] = useState(false);
  const steps = (recipe.steps ?? '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);

  return (
    <article className="space-y-4">
      <Link href="/recettes" className="inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-[var(--accent-text)]">
        <ChevronLeft className="h-4 w-4" aria-hidden /> Recettes du foyer
      </Link>
      <header>
        <h1 className="text-balance break-words text-[1.75rem] leading-tight font-bold tracking-tight">{recipe.name}</h1>
        <p className="mt-2 flex items-center gap-2 text-sm text-muted">
          <Users className="h-4 w-4" aria-hidden /> Pour {recipe.servings} personne{recipe.servings > 1 ? 's' : ''}
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Link href={`/repas?recette=${recipe.id}`} className={buttonVariants({ size: 'sm' })}>
            <CalendarPlus className="h-4 w-4" aria-hidden /> Planifier un repas
          </Link>
          <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
            <Pencil className="h-4 w-4" aria-hidden /> Modifier
          </Button>
        </div>
      </header>
      <Card>
        <CardTitle>Ingrédients</CardTitle>
        {ingredients.length ? (
          <ul className="mt-2 divide-y divide-[var(--line)]">
            {ingredients.map((item) => (
              <li key={item.id} className="flex items-baseline justify-between gap-4 py-2">
                <span className="min-w-0 break-words">{item.label}</span>
                <span className="shrink-0 font-semibold tabular-nums">{formatQuantity(item.quantity, item.unit)}</span>
              </li>
            ))}
          </ul>
        ) : <p className="mt-2 text-sm text-muted">Aucun ingrédient renseigné.</p>}
      </Card>
      <Card>
        <CardTitle>Préparation</CardTitle>
        {steps.length ? (
          <ol className="mt-3 list-decimal space-y-3 pl-6 leading-relaxed marker:font-bold marker:text-[var(--accent-text)]">
            {steps.map((step, index) => <li key={index} className="pl-1">{step.replace(/^\d+[.)]\s+/, '')}</li>)}
          </ol>
        ) : <p className="mt-2 text-sm text-muted">Aucune étape renseignée.</p>}
      </Card>
      {recipe.notes && <Card>
        <CardTitle>Notes de cuisine</CardTitle>
        <p className="mt-2 whitespace-pre-line leading-relaxed">{recipe.notes}</p>
      </Card>}
      {recipe.source_url && /^https?:\/\//i.test(recipe.source_url) && (
        <a href={recipe.source_url} target="_blank" rel="noopener noreferrer"
          className="inline-flex min-h-11 items-center text-sm font-semibold text-[var(--accent-text)] underline">Voir la recette d’origine</a>
      )}
      {editing && <RecipeSheet open onClose={() => setEditing(false)} recipe={recipe} initialIngredients={ingredients} />}
    </article>
  );
}
