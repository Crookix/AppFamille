import { PullToRefresh } from '@/components/nav/pull-to-refresh';

/**
 * Fondu d'un changement d'écran, et tirer-pour-actualiser.
 *
 * Un `template` est remonté à chaque navigation (un `layout`, non) : c'est ce
 * qui rejoue l'animation. L'opacité seule, 160 ms — voir `.page-in`.
 */
export default function AppTemplate({ children }: { children: React.ReactNode }) {
  return (
    <PullToRefresh>
      <div className="page-in">{children}</div>
    </PullToRefresh>
  );
}
