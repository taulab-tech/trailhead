import React from 'react'
import type { CourseStatus, StudentCourse } from '../../../shared/types'

const STATUS_LABEL: Record<CourseStatus, string> = {
  completed: 'Completed',
  in_progress: 'In progress',
  audited: 'Audited',
  not_completed: 'Not completed'
}

/** "202509" reads as "Fall 2025"; anything else is shown as it came in. */
function termLabel(course: StudentCourse): string {
  if (course.termLabel) return course.termLabel
  if (!course.term) return '—'
  const match = course.term.match(/^(\d{4})(\d{2})$/)
  if (!match) return course.term
  const month = Number(match[2])
  const season = month >= 9 ? 'Fall' : month <= 4 ? 'Winter' : 'Spring/Summer'
  return `${season} ${match[1]}`
}

/**
 * The courses a student has taken, newest first.
 *
 * Only appears once a class list has been imported for them — every other
 * kind of roster says someone turned up, not what they completed.
 */
export default function StudentCourses({ courses }: { courses: StudentCourse[] }): React.JSX.Element | null {
  if (courses.length === 0) return null

  const completed = courses.filter((c) => c.status === 'completed').length

  return (
    <>
      {/*
        Deliberately a count, not a credit-unit total. The units here are the
        registrar's per-term figures, which differ from the catalogue units a
        certificate counts in — GE 495 is 3.0 on a class list and 6 in the
        calendar — and two different "CU earned" numbers on one screen would
        only ever read as a bug.
      */}
      <div className="section-title">
        Courses ({courses.length}
        {completed > 0 && completed < courses.length ? ` · ${completed} completed` : ''})
      </div>
      <table className="course-table">
        <tbody>
          {courses.map((course) => (
            <tr key={course.id} className={`course-row status-${course.status}`}>
              <td className="course-code">{course.courseCode}</td>
              <td className="course-term">{termLabel(course)}</td>
              <td className="course-grade">{course.grade ?? ''}</td>
              <td className="course-status">
                <span className={`course-pill status-${course.status}`}>
                  {STATUS_LABEL[course.status]}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  )
}
