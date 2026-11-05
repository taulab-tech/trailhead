import { shortCertificateName } from './certificates'
import { CLOSE_UNITS, QUIET_MONTHS } from './reachOut'
import type { CertificateProgress } from '../shared/types'

/**
 * What to say to somebody next, worked out from where they are on the trail.
 *
 * The trail is the programme's own shape: categories with a stage order, so
 * a workshop is stop one and a capstone showcase is stop four. Somebody who
 * has only ever been to stop one has an obvious next thing; somebody at the
 * last stop with a certificate nearly finished has a different one.
 *
 * Every answer carries the fact behind it, because the point is to be
 * argued with. "Invite them to a Programs event" is useless without "they
 * have only ever been to Workshops".
 */

/** How many months of silence make picking up again the thing to mention. */
const STALE_MONTHS = QUIET_MONTHS

export interface TrailPosition {
  /** Stage order of the furthest stop they have reached, if any. */
  furthestStage: number | null
  /** The name of the category at that stop. */
  furthestStopName: string | null
  /** The next stop along that they have not been to, if there is one. */
  nextStopName: string | null
  /** True when they have reached the last stop on the trail. */
  atEnd: boolean
}

export interface NextStepInput {
  isNew: boolean
  isAlumni: boolean
  /** Events attended, counting the one being added now. */
  attendanceCount: number
  /** Months since the last sign of them before today, or null if never. */
  monthsSinceSeen: number | null
  trail: TrailPosition
  certificates: CertificateProgress[]
  /** True when the app has a job title for them. */
  hasPosition: boolean
}

export interface NextStep {
  /** The thing to do, in a few words. */
  action: string
  /** The fact it rests on. */
  because: string
}

/** The certificate they are furthest through and have not finished. */
function furthestCertificate(certificates: CertificateProgress[]): CertificateProgress | null {
  const started = certificates.filter((c) => c.earnedUnits > 0 && !c.complete)
  if (started.length === 0) return null
  return started.reduce((best, c) => (c.percent > best.percent ? c : best))
}

function units(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1)
}

/**
 * The one thing worth doing next for this person.
 *
 * Ordered by how much the fact behind it actually tells you, not by how
 * encouraging it sounds: a certificate three units from done beats a
 * general nudge along the trail, and a brand-new face beats both, because
 * what they need is to be told what happens next at all.
 */
export function nextStepFor(input: NextStepInput): NextStep {
  const { trail, certificates } = input
  const certificate = furthestCertificate(certificates)
  const remaining = certificate ? Math.max(0, certificate.totalUnits - certificate.earnedUnits) : null

  // Nothing to go on yet: the next step is the introduction. Somebody
  // created today and somebody who was on a list but has never turned up
  // both land here, and they are not the same thing to say out loud.
  if (input.isNew || input.attendanceCount <= 1) {
    return {
      action: trail.nextStopName
        ? `Tell them about ${trail.nextStopName}`
        : 'Tell them what else runs this term',
      because: input.isNew
        ? 'First time on record — nothing else is known about them yet'
        : 'On record, but this is the first event they have been to'
    }
  }

  // An alum is not being moved along a trail they have finished.
  if (input.isAlumni) {
    return input.hasPosition
      ? { action: 'Ask them to speak or mentor', because: 'An alum with a known position' }
      : { action: 'Ask where they ended up', because: 'An alum with no position on record' }
  }

  // A certificate within reach is the most concrete thing there is to say.
  if (certificate && remaining !== null && remaining > 0 && remaining <= CLOSE_UNITS) {
    return {
      action: `Ask about finishing ${shortCertificateName(certificate.name)}`,
      because: `${units(remaining)} CU short of it`
    }
  }

  // Back after a long absence: say so rather than carrying on as though
  // nothing happened.
  if (input.monthsSinceSeen !== null && input.monthsSinceSeen >= STALE_MONTHS) {
    return {
      action: 'Catch up on what they have been doing',
      because: `Not seen for ${input.monthsSinceSeen} months before today`
    }
  }

  // Moving along the trail: the next stop they have not reached.
  if (trail.nextStopName && trail.furthestStopName) {
    return {
      action: `Invite them to ${trail.nextStopName}`,
      because: `They have got as far as ${trail.furthestStopName}`
    }
  }

  // At the end of the trail with a certificate on the go.
  if (trail.atEnd && certificate) {
    return {
      action: `Keep them going on ${shortCertificateName(certificate.name)}`,
      because: `${certificate.percent}% through it, and at the end of the trail`
    }
  }

  if (trail.atEnd) {
    return {
      action: 'Point them at a certificate',
      because: 'At the end of the trail with none started'
    }
  }

  return {
    action: 'Keep them on the list',
    because: `${input.attendanceCount} events attended`
  }
}
