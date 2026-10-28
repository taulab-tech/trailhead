import React, { useEffect, useState } from 'react'
import type { EventCategory, EventDetail } from '../../../shared/types'
import CategoryPicker from './CategoryPicker'

export default function EventDetailDrawer({
  eventId,
  categories,
  onClose,
  onDeleted,
  onCategoryCreated
}: {
  eventId: string
  categories: EventCategory[]
  onClose: () => void
  onDeleted: () => void
  onCategoryCreated: (category: EventCategory) => void
}): React.JSX.Element | null {
  const [detail, setDetail] = useState<EventDetail | null>(null)
  const [name, setName] = useState('')
  const [date, setDate] = useState('')
  const [categoryId, setCategoryId] = useState<string | null>(null)

  const load = (): void => {
    window.api.getEventDetail(eventId).then((d) => {
      setDetail(d)
      if (d) {
        setName(d.name)
        setDate(d.date ?? '')
        setCategoryId(d.categoryId)
      }
    })
  }

  useEffect(load, [eventId])

  if (!detail) return null

  const save = async (): Promise<void> => {
    await window.api.updateEvent(eventId, { name, date: date || null, categoryId })
    load()
  }

  const remove = async (): Promise<void> => {
    if (!confirm(`Delete "${detail.name}" and all ${detail.attendees.length} attendance records for it? Students themselves are not deleted.`)) return
    await window.api.deleteEvent(eventId)
    onDeleted()
    onClose()
  }

  return (
    <div className="drawer-overlay" onClick={onClose}>
      <div className="drawer" onClick={(e) => e.stopPropagation()}>
        <h2>{detail.name}</h2>
        <p className="text-dim" style={{ marginTop: 0 }}>
          {detail.sourceFile} {detail.sourceSheet ? `→ ${detail.sourceSheet}` : ''}
        </p>

        <div className="section-title">Details</div>
        <div className="field-row">
          <div>
            <label>Event name</label>
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div>
            <label>Date</label>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
        </div>
        <div style={{ marginBottom: 12 }}>
          <label>Group</label>
          <CategoryPicker
            categories={categories}
            value={categoryId}
            onChange={setCategoryId}
            onCreated={onCategoryCreated}
          />
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-primary" onClick={save}>
            Save changes
          </button>
          <button className="btn btn-danger" onClick={remove}>
            Delete event
          </button>
        </div>

        <div className="section-title">Attendees ({detail.attendees.length})</div>
        {detail.attendees.map((s) => (
          <div key={s.id} style={{ padding: '7px 0', borderBottom: '1px solid var(--border-soft)' }}>
            <div>
              {s.firstName} {s.lastName}
            </div>
            <div className="text-faint">{s.emails[0] ?? 'no email'}</div>
          </div>
        ))}

        <div style={{ marginTop: 24 }}>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  )
}
