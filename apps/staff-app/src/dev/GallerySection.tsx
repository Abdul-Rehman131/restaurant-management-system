import type { ReactNode } from 'react';

export function GallerySection({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <section aria-labelledby={`${id}-title`} className="space-y-4">
      <h2 id={`${id}-title`} className="text-xl font-semibold tracking-tight">
        {title}
      </h2>
      <div className="space-y-6 rounded-lg border border-border bg-surface p-4 shadow-sm sm:p-6">
        {children}
      </div>
    </section>
  );
}

export function GalleryRow({ label, children }: { label?: string; children: ReactNode }) {
  return (
    <div className="space-y-2">
      {label && <h3 className="text-sm font-medium text-fg-muted">{label}</h3>}
      <div className="flex flex-wrap items-center gap-3">{children}</div>
    </div>
  );
}
