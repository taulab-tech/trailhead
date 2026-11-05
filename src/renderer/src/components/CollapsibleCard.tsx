import React, { useState } from 'react'

/**
 * A card that starts shut.
 *
 * The dashboard's job is to be read at a glance, and a list of thirty
 * students open by default is not a glance — it pushes everything the page
 * is actually about below the fold. So the header carries enough to decide
 * with (a count, and a line saying what is inside) and the list itself is
 * one click away.
 */
export default function CollapsibleCard({
  title,
  count,
  summary,
  defaultOpen = false,
  className,
  children
}: {
  title: string
  /** Shown as a chip beside the title. Omitted when there is nothing to count. */
  count?: number
  /** One line describing what opening it would show. */
  summary: React.ReactNode
  defaultOpen?: boolean
  className?: string
  children: React.ReactNode
}): React.JSX.Element {
  const [open, setOpen] = useState(defaultOpen)

  return (
    <div className={`card collapse-card${open ? ' is-open' : ''}${className ? ` ${className}` : ''}`}>
      <button
        type="button"
        className="collapse-head"
        aria-expanded={open}
        onClick={() => setOpen((wasOpen) => !wasOpen)}
      >
        <svg
          className="collapse-chevron"
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2.4}
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M9 6l6 6-6 6" />
        </svg>
        <span className="collapse-title">{title}</span>
        {count !== undefined && <span className="chip">{count}</span>}
        <span className="collapse-summary">{summary}</span>
      </button>
      {open && <div className="collapse-body">{children}</div>}
    </div>
  )
}
