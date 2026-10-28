import React, { useState } from 'react'
import type { EventCategory } from '../../../shared/types'
import { stageLabel } from '../lib/stageLabel'

const NEW_VALUE = '__new__'

export default function CategoryPicker({
  categories,
  value,
  onChange,
  onCreated
}: {
  categories: EventCategory[]
  value: string | null
  onChange: (categoryId: string | null) => void
  onCreated: (category: EventCategory) => void
}): React.JSX.Element {
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [newStage, setNewStage] = useState<string>('')

  const sorted = [...categories].sort((a, b) => {
    const sa = a.stageOrder ?? 99
    const sb = b.stageOrder ?? 99
    return sa - sb || a.name.localeCompare(b.name)
  })

  const create = async (): Promise<void> => {
    if (!newName.trim()) return
    const stageOrder = newStage.trim() === '' ? null : Number(newStage)
    const category = await window.api.createCategory(newName.trim(), stageOrder)
    onCreated(category)
    onChange(category.id)
    setCreating(false)
    setNewName('')
    setNewStage('')
  }

  if (creating) {
    return (
      <div style={{ display: 'flex', gap: 6 }}>
        <input
          type="text"
          placeholder="New category name"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          autoFocus
        />
        <select value={newStage} onChange={(e) => setNewStage(e.target.value)} style={{ maxWidth: 130 }}>
          <option value="">Not part of funnel</option>
          <option value="1">Entry</option>
          <option value="2">Middle</option>
          <option value="3">End</option>
        </select>
        <button className="btn btn-sm" onClick={create} disabled={!newName.trim()}>
          Add
        </button>
        <button className="btn btn-ghost btn-sm" onClick={() => setCreating(false)}>
          Cancel
        </button>
      </div>
    )
  }

  return (
    <select
      value={value ?? ''}
      onChange={(e) => {
        if (e.target.value === NEW_VALUE) {
          setCreating(true)
          return
        }
        onChange(e.target.value || null)
      }}
    >
      <option value="">Uncategorized</option>
      {sorted.map((c) => (
        <option key={c.id} value={c.id}>
          {c.name} ({stageLabel(c.stageOrder)})
        </option>
      ))}
      <option value={NEW_VALUE}>+ New category…</option>
    </select>
  )
}
