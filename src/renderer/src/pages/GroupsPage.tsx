import React, { useEffect, useState } from 'react'
import type { EventCategory } from '../../../shared/types'
import { stageLabel } from '../lib/stageLabel'

function parseStage(raw: string): number | null {
  const trimmed = raw.trim()
  if (trimmed === '') return null
  const n = Number(trimmed)
  return Number.isFinite(n) ? n : null
}

export default function GroupsPage(): React.JSX.Element {
  const [categories, setCategories] = useState<EventCategory[]>([])
  const [eventCounts, setEventCounts] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(true)
  const [names, setNames] = useState<Record<string, string>>({})
  const [stages, setStages] = useState<Record<string, string>>({})
  const [newName, setNewName] = useState('')
  const [newStage, setNewStage] = useState('')
  const [error, setError] = useState<string | null>(null)

  const refresh = (): void => {
    setLoading(true)
    Promise.all([window.api.listCategories(), window.api.listEvents()]).then(([cats, evs]) => {
      setCategories(cats)
      setNames(Object.fromEntries(cats.map((c) => [c.id, c.name])))
      setStages(Object.fromEntries(cats.map((c) => [c.id, c.stageOrder === null ? '' : String(c.stageOrder)])))
      const counts: Record<string, number> = {}
      for (const e of evs) {
        if (!e.categoryId) continue
        counts[e.categoryId] = (counts[e.categoryId] ?? 0) + 1
      }
      setEventCounts(counts)
      setLoading(false)
    })
  }

  useEffect(refresh, [])

  const saveName = async (cat: EventCategory): Promise<void> => {
    const value = names[cat.id]?.trim()
    if (!value || value === cat.name) return
    await window.api.updateCategory(cat.id, { name: value })
    refresh()
  }

  const saveStage = async (cat: EventCategory): Promise<void> => {
    const value = parseStage(stages[cat.id] ?? '')
    if (value === cat.stageOrder) return
    await window.api.updateCategory(cat.id, { stageOrder: value })
    refresh()
  }

  const remove = async (cat: EventCategory, eventCount: number): Promise<void> => {
    const msg =
      eventCount > 0
        ? `"${cat.name}" has ${eventCount} event(s) assigned. Deleting it leaves them uncategorized (not deleted). Continue?`
        : `Delete "${cat.name}"?`
    if (!confirm(msg)) return
    await window.api.deleteCategory(cat.id)
    refresh()
  }

  const create = async (): Promise<void> => {
    setError(null)
    if (!newName.trim()) return
    const stageOrder = parseStage(newStage)
    if (newStage.trim() !== '' && stageOrder === null) {
      setError('Stage must be a number, or blank to keep it out of the funnel.')
      return
    }
    await window.api.createCategory(newName.trim(), stageOrder)
    setNewName('')
    setNewStage('')
    refresh()
  }

  const sorted = [...categories].sort((a, b) => {
    const sa = a.stageOrder ?? Infinity
    const sb = b.stageOrder ?? Infinity
    return sa - sb || a.name.localeCompare(b.name)
  })

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Funnel groups</h1>
          <p>
            Groups (Hackathon, Class, SIGMA, …) are the columns of the pathway diagram. Give two groups the
            same stage number to show them side-by-side in one column; use a decimal like 2.5 to slot a new
            group between two existing ones (e.g. a &quot;Capstone&quot; group between Class = 2 and SIGMA = 3)
            without renumbering anything else. Leave the stage blank to keep a group out of the funnel
            entirely.
          </p>
        </div>
      </div>

      <div className="card" style={{ padding: 0 }}>
        {loading ? (
          <div className="empty-state">Loading…</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Stage</th>
                <th>Position</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((cat) => (
                <tr key={cat.id}>
                  <td>
                    <input
                      type="text"
                      value={names[cat.id] ?? ''}
                      onChange={(e) => setNames((prev) => ({ ...prev, [cat.id]: e.target.value }))}
                      onBlur={() => saveName(cat)}
                      style={{ width: '100%' }}
                    />
                  </td>
                  <td>
                    <input
                      type="number"
                      step="any"
                      placeholder="not in funnel"
                      value={stages[cat.id] ?? ''}
                      onChange={(e) => setStages((prev) => ({ ...prev, [cat.id]: e.target.value }))}
                      onBlur={() => saveStage(cat)}
                      style={{ width: 130 }}
                    />
                  </td>
                  <td className="text-dim">{stageLabel(cat.stageOrder)}</td>
                  <td>
                    <button className="btn btn-ghost btn-sm" onClick={() => remove(cat, eventCounts[cat.id] ?? 0)}>
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <div className="section-title" style={{ marginTop: 0 }}>
          Add a group
        </div>
        <div className="field-row-3">
          <div>
            <label>Name</label>
            <input
              type="text"
              placeholder="e.g. Capstone"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
            />
          </div>
          <div>
            <label>Stage</label>
            <input
              type="number"
              step="any"
              placeholder="e.g. 2.5, blank = not in funnel"
              value={newStage}
              onChange={(e) => setNewStage(e.target.value)}
            />
          </div>
          <div style={{ display: 'flex', alignItems: 'flex-end' }}>
            <button className="btn btn-primary" disabled={!newName.trim()} onClick={create}>
              Add group
            </button>
          </div>
        </div>
        {error && (
          <p className="text-dim" style={{ color: 'var(--danger)', marginBottom: 0 }}>
            {error}
          </p>
        )}
      </div>
    </div>
  )
}
