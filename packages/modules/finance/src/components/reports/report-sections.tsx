interface ReportSectionsProps {
  items: { id: string; label: string; count?: number }[]
}

/** A phone's jump list: one chip per section, in the order of the page. A desktop shows it all and has no need. */
export function ReportSections({ items }: ReportSectionsProps) {
  return (
    <nav aria-label="Sections" className="sm:hidden">
      <ul className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
        {items.map((item) => (
          <li key={item.id} className="shrink-0">
            <a href={`#${item.id}`} className="inline-flex min-h-11 items-center gap-2 rounded-full border bg-card px-4 text-sm whitespace-nowrap text-foreground">
              {item.label}
              {item.count !== undefined && <span className="text-[13px] text-muted-foreground tabular-nums">{item.count}</span>}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  )
}
