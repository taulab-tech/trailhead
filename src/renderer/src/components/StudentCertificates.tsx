import React, { useEffect, useState } from 'react'
import type { GroupProgress, StudentCertificate } from '../../../shared/types'

function units(value: number): string {
  // 3 rather than 3.0, but 1.5 kept as 1.5.
  return Number.isInteger(value) ? String(value) : value.toFixed(1)
}

function Bar({ percent, inProgress }: { percent: number; inProgress: number }): React.JSX.Element {
  return (
    <div className="cert-bar" role="presentation">
      <div className="cert-bar-done" style={{ width: `${Math.min(100, percent)}%` }} />
      <div className="cert-bar-underway" style={{ width: `${Math.min(100 - percent, inProgress)}%` }} />
    </div>
  )
}

function Group({ group }: { group: GroupProgress }): React.JSX.Element {
  return (
    <div className="cert-group">
      <div className="cert-group-head">
        <span className={group.satisfied ? 'cert-group-name is-done' : 'cert-group-name'}>{group.name}</span>
        {group.kind === 'elective' && group.minUnits !== null && (
          <span className="cert-group-units">
            {units(group.earnedUnits)} / {units(group.minUnits)} CU
          </span>
        )}
      </div>

      <ul className="cert-courses">
        {group.requirements.map((requirement) => (
          <li key={requirement.courseCode} className={`cert-course standing-${requirement.standing}`}>
            <span className="cert-course-mark" aria-hidden="true">
              {requirement.standing === 'completed' ? '✓' : requirement.standing === 'in_progress' ? '◐' : '○'}
            </span>
            <span className="cert-course-code">{requirement.courseCode}</span>
            <span className="cert-course-units">{units(requirement.creditUnits)} CU</span>
            {requirement.satisfiedBy && (
              <span className="cert-course-note">via {requirement.satisfiedBy}</span>
            )}
          </li>
        ))}
      </ul>

      {group.children.map((child) => (
        <div key={child.id} className="cert-group-child">
          <Group group={child} />
        </div>
      ))}
    </div>
  )
}

/**
 * How far this student is through each certificate.
 *
 * Certificates they have made no progress on are folded away — with six
 * courses between them, most students touch one or two, and listing every
 * certificate at full height would bury the one that matters.
 */
export default function StudentCertificates({
  studentId,
  onChanged
}: {
  studentId: string
  onChanged: () => void
}): React.JSX.Element | null {
  const [certificates, setCertificates] = useState<StudentCertificate[] | null>(null)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [showAll, setShowAll] = useState(false)

  const load = (): void => {
    window.api.getStudentCertificates(studentId).then(setCertificates)
  }
  useEffect(load, [studentId])

  if (!certificates || certificates.length === 0) return null

  const started = certificates.filter((c) => c.earnedUnits > 0 || c.inProgressUnits > 0 || c.declared)
  const shown = showAll ? certificates : started
  const hidden = certificates.length - started.length

  const declare = async (certificateId: string, declared: boolean): Promise<void> => {
    await window.api.setStudentCertificate(studentId, certificateId, declared)
    load()
    onChanged()
  }

  return (
    <>
      <div className="section-title">Certificates</div>

      {shown.length === 0 && <p className="text-faint cert-empty">No progress towards any certificate yet.</p>}

      {shown.map((certificate) => (
        <div key={certificate.certificateId} className="cert">
          <button
            className="cert-head"
            aria-expanded={expanded === certificate.certificateId}
            onClick={() =>
              setExpanded(expanded === certificate.certificateId ? null : certificate.certificateId)
            }
          >
            <div className="cert-head-top">
              <span className="cert-name">
                {certificate.name}
                {certificate.complete && <span className="cert-done-pill">Complete</span>}
                {certificate.declared && !certificate.complete && (
                  <span className="cert-declared-pill">Enrolled</span>
                )}
              </span>
              <span className="cert-figure">
                {units(certificate.earnedUnits)} / {units(certificate.totalUnits)} CU · {certificate.percent}%
              </span>
            </div>
            <Bar percent={certificate.percent} inProgress={
              certificate.totalUnits > 0
                ? Math.round((certificate.inProgressUnits / certificate.totalUnits) * 100)
                : 0
            } />
            {certificate.inProgressUnits > 0 && (
              <span className="cert-underway-note">
                {units(certificate.inProgressUnits)} CU under way
              </span>
            )}
          </button>

          {expanded === certificate.certificateId && (
            <div className="cert-detail">
              {certificate.groups.map((group) => (
                <Group key={group.id} group={group} />
              ))}
              <label className="cert-declare">
                <input
                  type="checkbox"
                  checked={certificate.declared}
                  onChange={(e) => declare(certificate.certificateId, e.target.checked)}
                />
                Working towards this certificate
              </label>
            </div>
          )}
        </div>
      ))}

      {hidden > 0 && (
        <button className="review-link cert-show-all" onClick={() => setShowAll(!showAll)}>
          {showAll ? 'Hide' : `Show ${hidden} other certificate${hidden === 1 ? '' : 's'}`}
        </button>
      )}
    </>
  )
}
