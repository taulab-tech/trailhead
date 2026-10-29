/**
 * Each student's path along the trail: every event they attended, in date
 * order, with the trail stop it belongs to — and a verdict on how they moved.
 * Shared by the dashboard's path explorer and the student panel's timeline.
 */

export type JourneyStatus = 'in-order' | 'skipped' | 'out-of-order' | 'single' | 'unknown' | 'off-trail'

export interface JourneyStep {
  eventId: string
  eventName: string
  /** The event's own date, or the student's term date for an undated class roster. */
  date: string | null
  dateInferred: boolean
  categoryId: string | null
  categoryName: string | null
  /** 0-based position of the event's stop on the trail; null when its group isn't on the trail. */
  stopIndex: number | null
  /** Happened after a later stop had already been reached. */
  outOfOrder: boolean
}

export interface Journey {
  studentId: string
  steps: JourneyStep[]
  /** Distinct stops reached, ascending. */
  stops: number[]
  /** Stops in the order they were reached (repeat visits collapsed); ascending stops when order is unknown. */
  path: number[]
  status: JourneyStatus
}

export interface JourneyEvent {
  id: string
  name: string
  date: string | null
  categoryId: string | null
}

export interface JourneyCategory {
  id: string
  name: string
  stageOrder: number | null
}

export const JOURNEY_STATUS_LABELS: Record<JourneyStatus, string> = {
  'in-order': 'In order',
  skipped: 'Skipped a stop',
  'out-of-order': 'Out of order',
  single: 'One stop only',
  unknown: 'Order unknown',
  'off-trail': 'Not on the trail'
}

/** The trail's stages in order; a group's stop index is its stage's position here. */
export function trailStages(categories: JourneyCategory[]): number[] {
  return Array.from(new Set(categories.filter((c) => c.stageOrder !== null).map((c) => c.stageOrder!))).sort(
    (a, b) => a - b
  )
}

export function buildJourneys(
  events: JourneyEvent[],
  eventStudentSets: { eventId: string; studentIds: string[] }[],
  attendanceDates: { studentId: string; eventId: string; date: string }[],
  categories: JourneyCategory[]
): Map<string, Journey> {
  const stages = trailStages(categories)
  const categoryById = new Map(categories.map((c) => [c.id, c]))
  const eventById = new Map(events.map((e) => [e.id, e]))
  const inferred = new Map(attendanceDates.map((d) => [`${d.studentId}|${d.eventId}`, d.date]))

  const stepsByStudent = new Map<string, JourneyStep[]>()
  for (const set of eventStudentSets) {
    const event = eventById.get(set.eventId)
    if (!event) continue
    const category = event.categoryId ? categoryById.get(event.categoryId) : undefined
    const stopIndex = category?.stageOrder != null ? stages.indexOf(category.stageOrder) : null
    for (const studentId of set.studentIds) {
      const fallback = event.date ? null : inferred.get(`${studentId}|${event.id}`) ?? null
      const step: JourneyStep = {
        eventId: event.id,
        eventName: event.name,
        date: event.date ?? fallback,
        dateInferred: !event.date && !!fallback,
        categoryId: event.categoryId,
        categoryName: category?.name ?? null,
        stopIndex: stopIndex !== null && stopIndex >= 0 ? stopIndex : null,
        outOfOrder: false
      }
      if (!stepsByStudent.has(studentId)) stepsByStudent.set(studentId, [])
      stepsByStudent.get(studentId)!.push(step)
    }
  }

  const journeys = new Map<string, Journey>()
  for (const [studentId, steps] of stepsByStudent) journeys.set(studentId, classify(studentId, steps))
  return journeys
}

function classify(studentId: string, steps: JourneyStep[]): Journey {
  // Date order; same-day steps go in trail order so a tie never reads as "out of order".
  steps.sort((a, b) => {
    if (a.date && b.date && a.date !== b.date) return a.date.localeCompare(b.date)
    if (!!a.date !== !!b.date) return a.date ? -1 : 1
    return (a.stopIndex ?? 99) - (b.stopIndex ?? 99) || a.eventName.localeCompare(b.eventName)
  })

  const trail = steps.filter((s) => s.stopIndex !== null)
  const stops = Array.from(new Set(trail.map((s) => s.stopIndex!))).sort((a, b) => a - b)
  if (stops.length === 0) return { studentId, steps, stops, path: [], status: 'off-trail' }
  if (stops.length === 1) return { studentId, steps, stops, path: stops, status: 'single' }
  if (trail.some((s) => !s.date)) return { studentId, steps, stops, path: stops, status: 'unknown' }

  const path: number[] = []
  let furthest = -1
  for (const s of trail) {
    if (s.stopIndex! < furthest) s.outOfOrder = true
    furthest = Math.max(furthest, s.stopIndex!)
    if (path[path.length - 1] !== s.stopIndex) path.push(s.stopIndex!)
  }
  const outOfOrder = trail.some((s) => s.outOfOrder)
  const contiguous = stops[stops.length - 1] - stops[0] + 1 === stops.length
  return {
    studentId,
    steps,
    stops,
    path,
    status: outOfOrder ? 'out-of-order' : contiguous ? 'in-order' : 'skipped'
  }
}
