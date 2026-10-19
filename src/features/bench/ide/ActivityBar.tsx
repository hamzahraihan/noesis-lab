import { CodeIcon, CubeIcon, ReaderIcon } from '@radix-ui/react-icons';
import type { Activity } from '../store/shell-state';

const ITEMS: ReadonlyArray<{ id: Activity; label: string; title: string; Icon: typeof CodeIcon }> =
  [
    { id: 'files', label: 'Files', title: 'Explorer — firmware files', Icon: CodeIcon },
    {
      id: 'components',
      label: 'Components',
      title: 'Components — parts catalogue (C)',
      Icon: CubeIcon,
    },
    { id: 'library', label: 'Library', title: 'Full Wokwi library', Icon: ReaderIcon },
  ];

export function ActivityBar({
  activity,
  onActivity,
}: {
  activity: Activity;
  onActivity(next: Activity): void;
}) {
  return (
    <nav
      aria-label="Activity"
      className="flex w-14 shrink-0 flex-col items-stretch border-r border-[var(--hd-border)] bg-[var(--hd-surface)] py-1"
    >
      {ITEMS.map(({ id, label, title, Icon }) => (
        <button
          key={id}
          type="button"
          onClick={() => onActivity(id)}
          aria-pressed={activity === id}
          aria-label={label}
          title={title}
          className={`flex flex-col items-center justify-center gap-0.5 py-2 transition-colors ${
            activity === id ? 'text-[var(--hd-text)]' : 'text-[var(--hd-muted)] hover:text-[var(--hd-text)]'
          }`}
        >
          <Icon className="icon" aria-hidden="true" />
          <span className="text-[9px] font-medium leading-none">{label}</span>
        </button>
      ))}
    </nav>
  );
}
