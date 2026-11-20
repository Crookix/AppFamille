import type { Metadata } from 'next';
import Link from 'next/link';
import { ChevronLeft } from 'lucide-react';
import { AddRecipeSelection } from '@/components/meals/add-recipe-selection';
import { requireHousehold } from '@/lib/auth';
import { formatQuantity } from '@/lib/ingredients';
import { familyPortions, novemberRecipes, storageNote } from '@/lib/november-recipes';

export const metadata: Metadata = { title: 'Les recettes de novembre' };

export default async function NovemberSelectionPage() {
  const { household } = await requireHousehold();
  return (
    <article className="space-y-4">
      <Link href="/recettes" className="inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-[var(--accent-text)]">
        <ChevronLeft className="h-4 w-4" aria-hidden /> Recettes du foyer
      </Link>
      <header>
        <h1 className="text-[1.75rem] font-bold tracking-tight">Les recettes de novembre</h1>
        <p className="mt-1 text-sm text-muted">{familyPortions} Les trois plats se préparent à J-2.</p>
      </header>
      <AddRecipeSelection householdId={household.id} householdName={household.name} />
      {novemberRecipes.map((recipe) => (
        <details key={recipe.key} className="surface rounded-[var(--radius-xl2)] px-4">
          <summary className="cursor-pointer py-4 font-semibold">
            {recipe.name} <span className="whitespace-nowrap text-sm font-normal text-muted">· {recipe.minutes} min</span>
          </summary>
          <div className="space-y-3 pb-4">
            <h2 className="font-semibold">Ingrédients</h2>
            <ul className="list-disc space-y-1 pl-5">
              {recipe.ingredients.map(([label, quantity, unit]) => (
                <li key={label}>{label} · {formatQuantity(quantity, unit)}</li>
              ))}
            </ul>
            <h2 className="font-semibold">Préparation</h2>
            <ol className="list-decimal space-y-2 pl-5">{recipe.steps.map((step) => <li key={step}>{step}</li>)}</ol>
            <h2 className="font-semibold">Pour les enfants</h2>
            <p>{recipe.children}</p>
            <h2 className="font-semibold">À J-2</h2>
            <p>{recipe.ahead}</p>
          </div>
        </details>
      ))}
      <p className="text-sm text-muted">{storageNote}</p>
    </article>
  );
}
