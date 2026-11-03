import React, { useEffect, useMemo, useState } from 'react'
import type { ColumnMapping, ImportPreview, ImportSheetRequest } from '../../../shared/types'
import { FIELD_LABELS } from '../lib/fieldLabels'

export interface ReviewRow {
  /** Stable id: the row's position in the original sheet. */
  id: number
  values: Record<string, string>
}

const PREVIEW_DEBOUNCE_MS = 350

/**
 * Every row the sheet will import, with the mapped columns editable in place,
 * a per-row remove button, and a dry-run status (new / already on file /
 * repeat / skipped) computed by the real importer without saving anything.
 */
export default function ImportRowsReview({
  request,
  headers,
  mapping,
  rows,
  removed,
  onEdit,
  onRemove,
  onRestoreAll,
  rejectedUpdates,
  onToggleUpdate
}: {
  request: Omit<ImportSheetRequest, 'rows'>
  headers: string[]
  mapping: ColumnMapping
  rows: ReviewRow[]
  removed: ReviewRow[]
  onEdit: (id: number, header: string, value: string) => void
  onRemove: (id: number) => void
  onRestoreAll: () => void
  rejectedUpdates: string[]
  onToggleUpdate: (key: string) => void
}): React.JSX.Element {
  const [preview, setPreview] = useState<ImportPreview | null>(null)
  const [previewError, setPreviewError] = useState<string | null>(null)

  const columns = headers.filter((h) => mapping[h] && mapping[h] !== 'ignore')
  const extraColumns = headers.length - columns.length

  // Size each column's inputs to its longest value (within reason) so emails
  // and long names aren't cut off.
  const columnWidths = useMemo(() => {
    const widths: Record<string, string> = {}
    for (const h of columns) {
      const longest = rows.reduce((max, r) => Math.max(max, (r.values[h] ?? '').length), 0)
      widths[h] = `${Math.min(Math.max(longest, 8), 40) + 2}ch`
    }
    return widths
  }, [rows, columns.join('|')])

  useEffect(() => {
    let cancelled = false
    const timer = setTimeout(() => {
      window.api
        .previewImportRows({ ...request, rows: rows.map((r) => r.values), rejectedUpdates })
        .then((p) => {
          if (cancelled) return
          setPreview(p)
          setPreviewError(null)
        })
        .catch((err) => {
          if (!cancelled) setPreviewError(err instanceof Error ? err.message : String(err))
        })
    }, PREVIEW_DEBOUNCE_MS)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
    // The request object is rebuilt every render; only these parts affect matching.
  }, [rows, mapping, request.filePath, request.sheetName, request.eventName, request.eventDate, request.categoryId])

  const repeats = preview ? preview.rows.filter((r) => r.status === 'repeat').length : 0
  const updates = preview?.updates ?? []
  const rejected = new Set(rejectedUpdates)
  const accepted = updates.filter((u) => !rejected.has(u.key)).length

  return (
    <div className="review">
      <div className="review-summary">
        {preview ? (
          <>
            <span className="review-stat">
              <span className="review-dot is-new" />
              <b>{preview.newStudents}</b> new
            </span>
            <span className="review-stat">
              <span className="review-dot is-existing" />
              <b>{preview.matchedExisting - repeats}</b> already in Trailhead
            </span>
            {repeats > 0 && (
              <span className="review-stat">
                <span className="review-dot is-repeat" />
                <b>{repeats}</b> listed twice
              </span>
            )}
            {preview.skippedBlankRows > 0 && (
              <span className="review-stat">
                <span className="review-dot is-skipped" />
                <b>{preview.skippedBlankRows}</b> will be skipped
              </span>
            )}
            {preview.blanksFilled > 0 && (
              <span className="review-stat text-dim">
                <b>{preview.blanksFilled}</b> blank detail{preview.blanksFilled === 1 ? '' : 's'} filled in
              </span>
            )}
            {preview.newDuplicateSuggestions > 0 && (
              <span className="review-stat text-dim">
                {preview.newDuplicateSuggestions} possible duplicate
                {preview.newDuplicateSuggestions === 1 ? '' : 's'} to review after import
              </span>
            )}
          </>
        ) : previewError ? (
          <span style={{ color: 'var(--danger)' }}>Couldn’t check these rows: {previewError}</span>
        ) : (
          <span className="text-faint">Checking rows against existing students…</span>
        )}
        <span className="spacer" />
        {removed.length > 0 && (
          <span className="text-dim">
            {removed.length} removed ·{' '}
            <button className="review-link" onClick={onRestoreAll}>
              Restore
            </button>
          </span>
        )}
      </div>

      {updates.length > 0 && (
        <div className="review-updates">
          <div className="review-updates-head">
            <strong>
              {updates.length} detail{updates.length === 1 ? '' : 's'} would change on students already on
              file
            </strong>
            <span className="text-faint">
              {accepted} of {updates.length} will be applied
            </span>
            <span className="spacer" />
            <button
              className="review-link"
              disabled={accepted === updates.length}
              onClick={() => updates.forEach((u) => rejected.has(u.key) && onToggleUpdate(u.key))}
            >
              Apply all
            </button>
            <button
              className="review-link"
              disabled={accepted === 0}
              onClick={() => updates.forEach((u) => !rejected.has(u.key) && onToggleUpdate(u.key))}
            >
              Keep existing
            </button>
          </div>
          <ul className="review-updates-list">
            {updates.map((update) => (
              <li key={update.key} className={rejected.has(update.key) ? 'is-rejected' : ''}>
                <label>
                  <input
                    type="checkbox"
                    checked={!rejected.has(update.key)}
                    onChange={() => onToggleUpdate(update.key)}
                  />
                  <span className="review-update-name">{update.studentName}</span>
                  <span className="text-faint">{update.label}</span>
                  <span className="review-update-from">{update.from}</span>
                  <span className="review-update-arrow">→</span>
                  <span className="review-update-to">{update.to}</span>
                  {update.fromManual && <span className="review-update-flag">typed in by hand</span>}
                </label>
              </li>
            ))}
          </ul>
        </div>
      )}

      {columns.length === 0 ? (
        <div className="empty-state" style={{ padding: 28 }}>
          No columns are mapped yet — open Column mapping to choose which columns hold names, emails and so on.
        </div>
      ) : (
        <div className="review-scroll">
          <table className="review-table">
            <thead>
              <tr>
                <th className="review-num">#</th>
                <th className="review-status-col">Status</th>
                {columns.map((h) => (
                  <th key={h}>
                    {FIELD_LABELS[mapping[h]]}
                    {FIELD_LABELS[mapping[h]].toLowerCase() !== h.toLowerCase() && (
                      <span className="review-source">{h}</span>
                    )}
                  </th>
                ))}
                <th className="review-actions" aria-label="Remove" />
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => {
                const outcome = preview?.rows[i]
                return (
                  <tr key={row.id} className={outcome?.status === 'skipped' ? 'is-skipped' : ''}>
                    <td className="review-num">{row.id + 1}</td>
                    <td className="review-status-col">
                      {!outcome ? (
                        <span className="text-faint">…</span>
                      ) : outcome.status === 'new' ? (
                        <span className="review-status is-new">New</span>
                      ) : outcome.status === 'existing' ? (
                        <span className="review-status is-existing" title={outcome.matchedName}>
                          Existing{outcome.matchedName ? ` · ${outcome.matchedName}` : ''}
                        </span>
                      ) : outcome.status === 'repeat' ? (
                        <span className="review-status is-repeat">
                          Same as #{(rows[outcome.repeatOfRow ?? 0]?.id ?? 0) + 1}
                        </span>
                      ) : (
                        <span className="review-status is-skipped" title="Rows need a name or an email">
                          Skipped
                        </span>
                      )}
                    </td>
                    {columns.map((h) => (
                      <td key={h}>
                        <input
                          className="review-cell"
                          type="text"
                          style={{ width: columnWidths[h] }}
                          value={row.values[h] ?? ''}
                          aria-label={`${FIELD_LABELS[mapping[h]]}, row ${row.id + 1}`}
                          onChange={(e) => onEdit(row.id, h, e.target.value)}
                        />
                      </td>
                    ))}
                    <td className="review-actions">
                      <button
                        className="review-remove"
                        title="Don’t import this row"
                        aria-label={`Remove row ${row.id + 1}`}
                        onClick={() => onRemove(row.id)}
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" aria-hidden="true">
                          <path d="M6 6l12 12M18 6L6 18" />
                        </svg>
                      </button>
                    </td>
                  </tr>
                )
              })}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={columns.length + 3} className="empty-state" style={{ padding: 24 }}>
                    Every row has been removed.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
      {extraColumns > 0 && (
        <p className="review-note">
          {extraColumns} other column{extraColumns === 1 ? ' isn’t' : 's aren’t'} mapped to a field — their
          values are still saved with each attendance record.
        </p>
      )}
    </div>
  )
}
