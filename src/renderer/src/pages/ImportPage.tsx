import React, { useCallback, useEffect, useRef, useState } from 'react'
import type {
  ColumnMapping,
  EventCategory,
  ImportResult,
  MappableField,
  ParsedSheet,
  ParsedWorkbook
} from '../../../shared/types'
import { FIELD_LABELS, FIELD_OPTIONS } from '../lib/fieldLabels'
import CategoryPicker from '../components/CategoryPicker'
import ImportRowsReview, { type ReviewRow } from '../components/ImportRowsReview'

interface SheetConfig {
  key: string
  filePath: string
  fileName: string
  sheet: ParsedSheet
  included: boolean
  eventName: string
  eventDate: string
  categoryId: string | null
  mapping: ColumnMapping
  view: 'students' | 'mapping' | null
  rows: ReviewRow[]
  removed: ReviewRow[]
}

function sheetKey(filePath: string, sheetName: string): string {
  return `${filePath}::${sheetName}`
}

export default function ImportPage({
  onImported,
  onNavigate
}: {
  onImported: () => void
  onNavigate: (page: string) => void
}): React.JSX.Element {
  const [dragActive, setDragActive] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sheets, setSheets] = useState<SheetConfig[]>([])
  const [results, setResults] = useState<ImportResult[] | null>(null)
  const [importing, setImporting] = useState(false)
  const [lookupsQueued, setLookupsQueued] = useState<number | null>(null)
  const [categories, setCategories] = useState<EventCategory[]>([])
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    window.api.listCategories().then(setCategories)
  }, [])

  const addWorkbook = useCallback(async (filePath: string) => {
    try {
      const parsed: ParsedWorkbook = await window.api.previewImport(filePath)
      const configs: SheetConfig[] = parsed.sheets
        .filter((s) => s.rowCount > 0)
        .map((sheet) => ({
          key: sheetKey(parsed.filePath, sheet.sheetName),
          filePath: parsed.filePath,
          fileName: parsed.fileName,
          sheet,
          included: true,
          eventName: sheet.suggestedEventName,
          eventDate: sheet.suggestedDate ?? '',
          categoryId: sheet.suggestedCategoryId,
          mapping: { ...sheet.suggestedMapping },
          view: 'students' as const,
          rows: sheet.rows.map((values, id) => ({ id, values })),
          removed: []
        }))
      setSheets((prev) => {
        const existingKeys = new Set(prev.map((s) => s.key))
        return [...prev, ...configs.filter((c) => !existingKeys.has(c.key))]
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [])

  const handleFiles = useCallback(
    async (paths: string[]) => {
      setError(null)
      setLoading(true)
      setResults(null)
      for (const p of paths) {
        await addWorkbook(p)
      }
      setLoading(false)
    },
    [addWorkbook]
  )

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      setDragActive(false)
      const paths: string[] = []
      for (const file of Array.from(e.dataTransfer.files)) {
        const p = window.api.getPathForFile(file)
        if (p) paths.push(p)
      }
      const valid = paths.filter((p) => /\.(xlsx|xls|csv)$/i.test(p))
      if (valid.length === 0) {
        setError('Drop a .xlsx, .xls, or .csv file.')
        return
      }
      handleFiles(valid)
    },
    [handleFiles]
  )

  const browse = useCallback(async () => {
    const paths = await window.api.pickFiles()
    if (paths.length) handleFiles(paths)
  }, [handleFiles])

  const updateSheet = (key: string, patch: Partial<SheetConfig>): void => {
    setSheets((prev) => prev.map((s) => (s.key === key ? { ...s, ...patch } : s)))
  }

  const updateMapping = (key: string, header: string, field: MappableField): void => {
    setSheets((prev) =>
      prev.map((s) => (s.key === key ? { ...s, mapping: { ...s.mapping, [header]: field } } : s))
    )
  }

  const editRow = (key: string, id: number, header: string, value: string): void => {
    setSheets((prev) =>
      prev.map((s) =>
        s.key === key
          ? { ...s, rows: s.rows.map((r) => (r.id === id ? { ...r, values: { ...r.values, [header]: value } } : r)) }
          : s
      )
    )
  }

  const removeRow = (key: string, id: number): void => {
    setSheets((prev) =>
      prev.map((s) => {
        if (s.key !== key) return s
        const row = s.rows.find((r) => r.id === id)
        return row ? { ...s, rows: s.rows.filter((r) => r.id !== id), removed: [...s.removed, row] } : s
      })
    )
  }

  const restoreRows = (key: string): void => {
    setSheets((prev) =>
      prev.map((s) =>
        s.key === key ? { ...s, rows: [...s.rows, ...s.removed].sort((a, b) => a.id - b.id), removed: [] } : s
      )
    )
  }

  const baseRequest = (s: SheetConfig) => ({
    filePath: s.filePath,
    fileName: s.fileName,
    sheetName: s.sheet.sheetName,
    eventName: s.eventName.trim() || s.sheet.suggestedEventName,
    eventDate: s.eventDate.trim() || null,
    categoryId: s.categoryId,
    mapping: s.mapping
  })

  // A sheet that splits by year gets a computed per-year date for every row
  // that has a parseable year — the sheet-level date is only a fallback for
  // any leftover rows that don't, so it shouldn't block import the way it
  // does for a plain single-event sheet.
  const hasActiveYearSplit = (s: SheetConfig): boolean =>
    !!s.sheet.yearSplitPreview && s.mapping[s.sheet.yearSplitPreview.column] === 'yearInProgram'

  const missingDates = sheets.filter((s) => s.included && !s.eventDate.trim() && !hasActiveYearSplit(s))

  const runImport = async (): Promise<void> => {
    if (missingDates.length > 0) {
      setError(
        `Set a date before importing — missing for: ${missingDates
          .map((s) => s.eventName.trim() || s.sheet.suggestedEventName)
          .join(', ')}`
      )
      return
    }
    setImporting(true)
    setError(null)
    const included = sheets.filter((s) => s.included)
    const collected: ImportResult[] = []
    try {
      for (const s of included) {
        const result = await window.api.commitImport({
          ...baseRequest(s),
          rows: s.rows.map((r) => r.values)
        })
        collected.push(result)
      }
      setResults(collected)
      setLookupsQueued(null)
      setSheets([])
      onImported()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setImporting(false)
    }
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Import attendance</h1>
          <p>Drag in event/program spreadsheets — every sheet becomes one event roster.</p>
        </div>
      </div>

      <div
        className={`dropzone ${dragActive ? 'drag-active' : ''}`}
        onDragOver={(e) => {
          e.preventDefault()
          setDragActive(true)
        }}
        onDragLeave={() => setDragActive(false)}
        onDrop={onDrop}
        onClick={browse}
      >
        <div className="dropzone-icon">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M12 15V3M7 8l5-5 5 5M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4" />
          </svg>
        </div>
        <h3>Drop spreadsheets here</h3>
        <p>.xlsx, .xls or .csv — or click to browse{loading ? ' · reading file…' : ''}</p>
        <input ref={fileInputRef} type="file" style={{ display: 'none' }} />
      </div>

      {error && (
        <div className="card" style={{ marginTop: 16, borderColor: 'var(--danger)' }}>
          <span className="badge badge-danger">Error</span> <span style={{ marginLeft: 8 }}>{error}</span>
        </div>
      )}

      {results && (
        <div className="card" style={{ marginTop: 16 }}>
          <div className="section-title" style={{ marginTop: 0 }}>
            Import complete
          </div>
          <table>
            <thead>
              <tr>
                <th>Event</th>
                <th>Rows</th>
                <th>New students</th>
                <th>Matched existing</th>
                <th>New duplicate flags</th>
                <th>Skipped blank</th>
              </tr>
            </thead>
            <tbody>
              {results.map((r, i) => {
                const rowsToRender =
                  r.events.length > 0
                    ? r.events
                    : [{ eventId: '', eventName: '—', rowsProcessed: 0, newStudents: 0, matchedExisting: 0 }]
                return rowsToRender.map((ev, j) => (
                  <tr key={`${i}-${j}`}>
                    <td>{ev.eventName}</td>
                    <td>{ev.rowsProcessed}</td>
                    <td>{ev.newStudents}</td>
                    <td>{ev.matchedExisting}</td>
                    {j === 0 ? (
                      <>
                        <td rowSpan={rowsToRender.length}>
                          {r.newDuplicateSuggestions > 0 ? (
                            <span className="badge badge-warn">{r.newDuplicateSuggestions}</span>
                          ) : (
                            0
                          )}
                        </td>
                        <td rowSpan={rowsToRender.length}>{r.skippedBlankRows}</td>
                      </>
                    ) : null}
                  </tr>
                ))
              })}
            </tbody>
          </table>
          {(() => {
            const newIds = results.flatMap((r) => r.newStudentIds)
            if (newIds.length === 0) return null
            return (
              <div className="import-lookup">
                {lookupsQueued === null ? (
                  <>
                    <div>
                      <b>Find where the new students work?</b>
                      <p className="text-dim">
                        Looks up {newIds.length} new student{newIds.length === 1 ? '' : 's'} on LinkedIn in the
                        background, one every few seconds. You review every match before anything is saved.
                      </p>
                    </div>
                    <button
                      className="btn btn-primary btn-sm"
                      onClick={async () => setLookupsQueued(await window.api.enqueueLookups(newIds))}
                    >
                      Find LinkedIn matches for {newIds.length} new student{newIds.length === 1 ? '' : 's'}
                    </button>
                  </>
                ) : (
                  <>
                    <div>
                      <b>
                        {lookupsQueued > 0
                          ? `Looking up ${lookupsQueued} student${lookupsQueued === 1 ? '' : 's'} in the background.`
                          : 'Those students are already queued or have a position.'}
                      </b>
                      <p className="text-dim">You can keep working — matches appear under Students → LinkedIn matches.</p>
                    </div>
                    <button className="btn btn-sm" onClick={() => onNavigate('lookups')}>
                      Review matches →
                    </button>
                  </>
                )}
              </div>
            )
          })()}
        </div>
      )}

      {sheets.length > 0 && (
        <>
          <div className="toolbar" style={{ marginTop: 22 }}>
            <div className="section-title" style={{ margin: 0 }}>
              {sheets.length} sheet{sheets.length > 1 ? 's' : ''} ready to import
            </div>
            <div className="spacer" />
            <button className="btn btn-ghost btn-sm" onClick={() => setSheets([])}>
              Clear all
            </button>
            {missingDates.length > 0 && (
              <span className="text-faint" style={{ fontSize: 11.5, color: 'var(--danger)' }}>
                {missingDates.length} sheet{missingDates.length > 1 ? 's need' : ' needs'} a date
              </span>
            )}
            <button
              className="btn btn-primary"
              disabled={importing || missingDates.length > 0}
              onClick={runImport}
            >
              {importing ? 'Importing…' : `Import ${sheets.filter((s) => s.included).length} sheet(s)`}
            </button>
          </div>

          {sheets.map((s) => (
            <div className="card" key={s.key}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14 }}>
                <input
                  type="checkbox"
                  checked={s.included}
                  onChange={(e) => updateSheet(s.key, { included: e.target.checked })}
                  style={{ marginTop: 8 }}
                />
                <div style={{ flex: 1 }}>
                  <div className="text-faint mono" style={{ fontSize: 11, marginBottom: 6 }}>
                    {s.fileName} → sheet &quot;{s.sheet.sheetName}&quot; · {s.rows.length} row
                    {s.rows.length === 1 ? '' : 's'}
                    {s.removed.length > 0 ? ` (${s.removed.length} removed)` : ''}
                  </div>
                  <div className="field-row-3">
                    <div>
                      <label>Event / program name</label>
                      <input
                        type="text"
                        value={s.eventName}
                        onChange={(e) => updateSheet(s.key, { eventName: e.target.value })}
                      />
                    </div>
                    <div>
                      <label>
                        Date{' '}
                        {!s.eventDate.trim() &&
                          (hasActiveYearSplit(s) ? (
                            <span className="text-faint">(fallback only)</span>
                          ) : (
                            <span style={{ color: 'var(--danger)' }}>*</span>
                          ))}
                      </label>
                      <input
                        type="date"
                        required={!hasActiveYearSplit(s)}
                        value={s.eventDate}
                        onChange={(e) => updateSheet(s.key, { eventDate: e.target.value })}
                        style={
                          !s.eventDate.trim() && !hasActiveYearSplit(s)
                            ? { borderColor: 'var(--danger)' }
                            : undefined
                        }
                      />
                    </div>
                    <div>
                      <label>Group</label>
                      <CategoryPicker
                        categories={categories}
                        value={s.categoryId}
                        onChange={(categoryId) => updateSheet(s.key, { categoryId })}
                        onCreated={(cat) => setCategories((prev) => [...prev, cat])}
                      />
                    </div>
                  </div>
                  {s.sheet.yearSplitPreview &&
                    s.mapping[s.sheet.yearSplitPreview.column] === 'yearInProgram' && (
                      <p className="text-dim" style={{ margin: '8px 0', fontSize: 12.5 }}>
                        <span className="badge badge-warn">Splits by year</span>{' '}
                        This sheet mixes {s.sheet.yearSplitPreview.years.length} cohort years — importing
                        will create {s.sheet.yearSplitPreview.years.length} separate events, one per year (
                        {s.sheet.yearSplitPreview.years.join(', ')}), instead of one &quot;{s.eventName || s.sheet.suggestedEventName}&quot; event.
                      </p>
                    )}

                  <div className="sheet-tabs" role="tablist">
                    <button
                      role="tab"
                      aria-selected={s.view === 'students'}
                      className={`sheet-tab ${s.view === 'students' ? 'is-active' : ''}`}
                      onClick={() => updateSheet(s.key, { view: s.view === 'students' ? null : 'students' })}
                    >
                      Students <span className="sheet-tab-count">{s.rows.length}</span>
                    </button>
                    <button
                      role="tab"
                      aria-selected={s.view === 'mapping'}
                      className={`sheet-tab ${s.view === 'mapping' ? 'is-active' : ''}`}
                      onClick={() => updateSheet(s.key, { view: s.view === 'mapping' ? null : 'mapping' })}
                    >
                      Column mapping
                    </button>
                  </div>

                  {s.view === 'students' && (
                    <ImportRowsReview
                      request={baseRequest(s)}
                      headers={s.sheet.headers}
                      mapping={s.mapping}
                      rows={s.rows}
                      removed={s.removed}
                      onEdit={(id, header, value) => editRow(s.key, id, header, value)}
                      onRemove={(id) => removeRow(s.key, id)}
                      onRestoreAll={() => restoreRows(s.key)}
                    />
                  )}

                  {s.view === 'mapping' && (
                    <table className="mapping-table" style={{ marginTop: 12 }}>
                      <thead>
                        <tr>
                          <th>Spreadsheet column</th>
                          <th>Maps to</th>
                          <th>Sample</th>
                        </tr>
                      </thead>
                      <tbody>
                        {s.sheet.headers.map((h) => (
                          <tr key={h}>
                            <td className="mono">{h}</td>
                            <td>
                              <select
                                value={s.mapping[h] ?? 'ignore'}
                                onChange={(e) =>
                                  updateMapping(s.key, h, e.target.value as MappableField)
                                }
                              >
                                {FIELD_OPTIONS.map((f) => (
                                  <option key={f} value={f}>
                                    {FIELD_LABELS[f]}
                                  </option>
                                ))}
                              </select>
                            </td>
                            <td className="text-dim">{s.sheet.sampleRows[0]?.[h] ?? ''}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              </div>
            </div>
          ))}
        </>
      )}
    </div>
  )
}
