import React, { useEffect, useState } from 'react'
import type {
  Certificate,
  CertificateDefinition,
  CertificateGroup,
  CertificateRosterEntry,
  GroupKind
} from '../../../shared/types'
import { useDataVersion } from '../DataContext'
import StudentDetailDrawer from '../components/StudentDetailDrawer'

function units(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1)
}


/**
 * What the certificate's parts add up to: every required course, plus each
 * top-level elective minimum. A certificate can state a total that differs
 * (a few do), so this is shown beside the stated one rather than replacing it.
 */
function partsAddUpTo(definition: CertificateDefinition): number {
  return definition.groups
    .filter((g) => g.parentId === null)
    .reduce((sum, group) => {
      if (group.kind === 'elective') return sum + (group.minUnits ?? 0)
      return (
        sum +
        definition.requirements
          .filter((r) => r.groupId === group.id)
          .reduce((inner, r) => inner + r.creditUnits, 0)
      )
    }, 0)
}

/* ------------------------------- roster -------------------------------- */

function Roster({ certificateId }: { certificateId: string }): React.JSX.Element {
  const [rows, setRows] = useState<CertificateRosterEntry[] | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const { version, bump } = useDataVersion()

  useEffect(() => {
    setRows(null)
    window.api.getCertificateRoster(certificateId).then(setRows)
  }, [certificateId, version])

  if (!rows) return <p className="text-faint">Loading…</p>
  if (rows.length === 0) {
    return (
      <p className="text-faint">
        Nobody has taken a course towards this certificate yet. Import a class list to see progress here.
      </p>
    )
  }

  const finished = rows.filter((r) => r.complete).length

  return (
    <>
      <p className="cert-roster-summary">
        {rows.length} student{rows.length === 1 ? '' : 's'} with progress
        {finished > 0 && ` · ${finished} complete`}
      </p>
      <div className="card" style={{ padding: 0 }}>
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Year</th>
              <th>Progress</th>
              <th>Still needs</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.studentId} onClick={() => setSelectedId(row.studentId)}>
                <td>
                  <strong>
                    {row.firstName} {row.lastName}
                  </strong>
                  {row.complete && <span className="cert-done-pill">Complete</span>}
                  {row.declared && !row.complete && <span className="cert-declared-pill">Enrolled</span>}
                </td>
                <td className="text-faint">
                  <span className={`year-label kind-${row.currentYear.kind}`}>
                    {row.currentYear.kind === 'unknown' ? '—' : row.currentYear.label}
                  </span>
                </td>
                <td>
                  <div className="cert-roster-figure">
                    {units(row.earnedUnits)} / {units(row.totalUnits)} CU · {row.percent}%
                  </div>
                  <div className="cert-bar cert-bar-sm">
                    <div className="cert-bar-done" style={{ width: `${Math.min(100, row.percent)}%` }} />
                  </div>
                </td>
                <td className="text-faint cert-missing">
                  {row.missing.length === 0 ? '—' : row.missing.join(', ')}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {selectedId && (
        <StudentDetailDrawer
          studentId={selectedId}
          onClose={() => setSelectedId(null)}
          onChanged={bump}
        />
      )}
    </>
  )
}

/* ------------------------------- editor -------------------------------- */

function GroupEditor({
  certificateId,
  group,
  definition,
  onChanged
}: {
  certificateId: string
  group: CertificateGroup
  definition: CertificateDefinition
  onChanged: () => void
}): React.JSX.Element {
  const [code, setCode] = useState('')
  const [courseUnits, setCourseUnits] = useState('3')
  const requirements = definition.requirements.filter((r) => r.groupId === group.id)
  const children = definition.groups.filter((g) => g.parentId === group.id)

  const add = async (): Promise<void> => {
    const trimmed = code.trim()
    if (!trimmed) return
    await window.api.addCertificateRequirement(group.id, trimmed, Number(courseUnits) || 0)
    setCode('')
    onChanged()
  }

  return (
    <div className="cert-edit-group">
      <div className="cert-edit-group-head">
        <strong>{group.name}</strong>
        <span className="text-faint">
          {group.kind === 'required'
            ? 'every course required'
            : `${group.minUnits === null ? '?' : units(group.minUnits)} CU needed`}
        </span>
        <button
          className="review-link danger"
          onClick={async () => {
            if (!confirm(`Remove the "${group.name}" group and its courses?`)) return
            await window.api.deleteCertificateGroup(group.id)
            onChanged()
          }}
        >
          Remove group
        </button>
      </div>

      <ul className="cert-edit-courses">
        {requirements.map((requirement) => (
          <li key={requirement.id}>
            <span className="cert-course-code">{requirement.courseCode}</span>
            <span className="cert-course-units">{units(requirement.creditUnits)} CU</span>
            <button
              className="review-link"
              onClick={async () => {
                await window.api.removeCertificateRequirement(requirement.id)
                onChanged()
              }}
            >
              Remove
            </button>
          </li>
        ))}
        {requirements.length === 0 && <li className="text-faint">No courses yet.</li>}
      </ul>

      <div className="cert-edit-add">
        <input
          type="text"
          placeholder="Course code, e.g. GE 450"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && add()}
        />
        <input
          type="number"
          min="0"
          step="0.5"
          aria-label="Credit units"
          value={courseUnits}
          onChange={(e) => setCourseUnits(e.target.value)}
        />
        <span className="text-faint">CU</span>
        <button className="btn btn-sm" onClick={add} disabled={!code.trim()}>
          Add course
        </button>
      </div>

      {children.map((child) => (
        <div key={child.id} className="cert-edit-child">
          <GroupEditor
            certificateId={certificateId}
            group={child}
            definition={definition}
            onChanged={onChanged}
          />
        </div>
      ))}

      {group.kind === 'elective' && children.length === 0 && (
        <button
          className="review-link"
          onClick={async () => {
            const name = prompt('Name for the rule within this group, e.g. "400-level electives"')
            if (!name) return
            const min = prompt('How many credit units must come from it?', '3')
            if (min === null) return
            await window.api.addCertificateGroup(certificateId, {
              name,
              kind: 'elective',
              minUnits: Number(min) || 0,
              parentId: group.id
            })
            onChanged()
          }}
        >
          Add a rule within this group
        </button>
      )}
    </div>
  )
}

function Editor({
  certificateId,
  onChanged
}: {
  certificateId: string
  onChanged: () => void
}): React.JSX.Element {
  const [definition, setDefinition] = useState<CertificateDefinition | null>(null)

  const load = (): void => {
    window.api.getCertificate(certificateId).then(setDefinition)
  }
  useEffect(load, [certificateId])

  const reload = (): void => {
    load()
    onChanged()
  }

  if (!definition) return <p className="text-faint">Loading…</p>

  const topLevel = definition.groups.filter((g) => g.parentId === null)
  const sum = partsAddUpTo(definition)
  const stated = definition.totalUnits
  const mismatch = stated !== null && stated !== sum

  return (
    <div className="cert-edit">
      {definition.notes && <p className="cert-edit-notes">{definition.notes}</p>}

      <div className={mismatch ? 'cert-total is-off' : 'cert-total'}>
        <span>
          Out of <strong>{units(stated ?? sum)} CU</strong>
          {stated === null && ' (added up from the courses below)'}
        </span>
        {mismatch && (
          <>
            <span className="cert-total-warn">
              but the courses below add up to {units(sum)} CU
            </span>
            <button
              className="review-link"
              onClick={async () => {
                await window.api.updateCertificate(definition.id, { totalUnits: sum })
                reload()
              }}
            >
              Use {units(sum)}
            </button>
          </>
        )}
      </div>

      {topLevel.map((group) => (
        <GroupEditor
          key={group.id}
          certificateId={certificateId}
          group={group}
          definition={definition}
          onChanged={reload}
        />
      ))}

      <div className="cert-edit-actions">
        <button
          className="btn btn-sm"
          onClick={async () => {
            const name = prompt('Name for the new group, e.g. "Required courses"')
            if (!name) return
            const kind: GroupKind = confirm('Is every course in this group required?\n\nOK = required, Cancel = electives')
              ? 'required'
              : 'elective'
            const min =
              kind === 'elective' ? Number(prompt('How many credit units are needed from it?', '3')) || 0 : null
            await window.api.addCertificateGroup(certificateId, { name, kind, minUnits: min })
            reload()
          }}
        >
          Add a group
        </button>
      </div>

      {definition.substitutions.length > 0 && (
        <>
          <div className="cert-edit-subheading">Substitutions</div>
          <ul className="cert-edit-courses">
            {definition.substitutions.map((substitution) => (
              <li key={substitution.id}>
                <span className="cert-course-code">{substitution.acceptedCode}</span>
                <span className="text-faint">
                  counts for {substitution.replacesCode}
                  {substitution.alsoRequiresCode && ` (with ${substitution.alsoRequiresCode})`}
                </span>
                <button
                  className="review-link"
                  onClick={async () => {
                    await window.api.removeCertificateSubstitution(substitution.id)
                    reload()
                  }}
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  )
}

/* -------------------------------- page --------------------------------- */

/**
 * Certificates: who is how far through each, and what each one is made of.
 *
 * The definitions are data, not code — the three College of Engineering
 * certificates are put in on a new database as a starting point, and
 * everything about them can be changed here when the catalogue moves.
 */
export default function CertificatesPage(): React.JSX.Element {
  const [certificates, setCertificates] = useState<Certificate[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [tab, setTab] = useState<'roster' | 'setup'>('roster')
  const { bump } = useDataVersion()

  const load = (): void => {
    window.api.listCertificates().then((rows) => {
      setCertificates(rows)
      setSelectedId((current) => current ?? rows[0]?.id ?? null)
    })
  }
  useEffect(load, [])

  const selected = certificates.find((c) => c.id === selectedId) ?? null

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Certificates</h1>
          <p>Who is working towards what, and how far along they are.</p>
        </div>
        <button
          className="btn"
          onClick={async () => {
            const name = prompt('Name of the certificate')
            if (!name?.trim()) return
            const id = await window.api.createCertificate(name.trim(), null, null)
            load()
            setSelectedId(id)
            setTab('setup')
          }}
        >
          New certificate
        </button>
      </div>

      {certificates.length === 0 ? (
        <div className="card" style={{ padding: 24 }}>
          <p style={{ marginTop: 0 }}>
            No certificates yet. A certificate is a set of courses and how many credit units are
            needed from each — add your own, or start from the three the College of Engineering
            publishes and change them to suit.
          </p>
          <button
            className="btn btn-primary"
            onClick={async () => {
              await window.api.installStarterCertificates()
              // Reload either way: if they are already there, the list on
              // screen is simply out of date.
              load()
              bump()
            }}
          >
            Add the three College of Engineering certificates
          </button>
        </div>
      ) : (
        <>
          <div className="sheet-tabs page-tabs" role="tablist">
            {certificates.map((certificate) => (
              <button
                key={certificate.id}
                role="tab"
                aria-selected={certificate.id === selectedId}
                className={`sheet-tab ${certificate.id === selectedId ? 'is-active' : ''}`}
                onClick={() => setSelectedId(certificate.id)}
              >
                {certificate.name}
              </button>
            ))}
          </div>

          {selected && (
            <>
              <div className="cert-page-actions">
                <div className="cert-toggle" role="tablist">
                  <button
                    role="tab"
                    aria-selected={tab === 'roster'}
                    className={`btn btn-sm ${tab === 'roster' ? 'btn-primary' : ''}`}
                    onClick={() => setTab('roster')}
                  >
                    Students
                  </button>
                  <button
                    role="tab"
                    aria-selected={tab === 'setup'}
                    className={`btn btn-sm ${tab === 'setup' ? 'btn-primary' : ''}`}
                    onClick={() => setTab('setup')}
                  >
                    Courses &amp; rules
                  </button>
                </div>
                <button
                  className="review-link danger"
                  onClick={async () => {
                    if (!confirm(`Delete "${selected.name}"? Student progress against it goes too.`)) return
                    await window.api.deleteCertificate(selected.id)
                    setSelectedId(null)
                    load()
                    bump()
                  }}
                >
                  Delete certificate
                </button>
              </div>

              {tab === 'roster' ? (
                <Roster certificateId={selected.id} />
              ) : (
                <Editor certificateId={selected.id} onChanged={bump} />
              )}
            </>
          )}
        </>
      )}
    </div>
  )
}
