import type { GroupKind } from '../shared/types'

/**
 * The three University of Saskatchewan College of Engineering certificates,
 * as published in the 2026-27 catalogue — reduced to the courses this app
 * can actually see.
 *
 * These are a starting point, not a fixture: they are written into a new
 * database once and are ordinary editable records afterwards. Courses and
 * minimums change between catalogues, and the people running this know
 * before any code does — so the Certificates screen can change all of it,
 * and nothing here is ever written over the top of what they have set.
 *
 * ## Why these are engineering courses only
 *
 * Every one of these certificates also counts COMM courses (Edwards School
 * of Business) and RCM courses towards it. None of those appear in any
 * class list the College of Engineering exports, so the app has never had a
 * record of a student taking one, and never will until somebody hands it a
 * business-school roster.
 *
 * Carrying requirements we cannot observe does not make the tracking more
 * truthful, it makes it useless: every student sits permanently short by
 * the COMM and RCM units, nobody ever reads as finished, and the one thing
 * the progress bar is for — telling apart the student who is nearly there
 * from the one who has barely started — stops working. So the seeds track
 * the GE side, and say so on the certificate.
 *
 * The consequence, stated plainly on each certificate's notes: finishing
 * here means finishing the engineering courses, not the whole catalogue
 * certificate. If the business records ever arrive, add the groups back on
 * the Certificates screen and the progress recalculates.
 *
 * Credit units are the catalogue's. They are deliberately not read from
 * class lists: a full-year course such as GE 495.6 is exported once per term
 * at 3.0 units, which would leave every capstone student short.
 *
 * Sources:
 *   programs.usask.ca/engineering/eng-innovation-cert/
 *   programs.usask.ca/engineering/eng-entrepreneurship-leading-innovative-teams/
 *   programs.usask.ca/engineering/cert-eng-entrepreneurship-new-product-market/
 */

export interface SeedCourse {
  code: string
  units: number
}

export interface SeedGroup {
  name: string
  kind: GroupKind
  /** Units needed from this group. Omitted for a required group. */
  minUnits?: number
  courses: SeedCourse[]
  /** A rule within this group, e.g. "at least 3 of the 9 must be at the 400 level". */
  children?: SeedGroup[]
}

export interface SeedSubstitution {
  replaces: string
  accepted: string
  /** The companion course that also has to be completed for it to count. */
  alsoRequires?: string
}

export interface CertificateSeed {
  name: string
  totalUnits: number | null
  notes: string | null
  groups: SeedGroup[]
  substitutions?: SeedSubstitution[]
}

/** The eight discipline capstones accepted in place of GE 495.6. */
const DISCIPLINE_CAPSTONES = ['CE 495', 'CHE 495', 'CME 495', 'EE 495', 'ENVE 495', 'EP 495', 'GEOE 495', 'ME 495']

/** Said on every certificate, so a full bar is never mistaken for a parchment. */
const GE_ONLY =
  'Tracks the engineering (GE) courses only. The COMM and RCM courses this certificate also requires are not in any class list the app receives, so a student who reads as finished here has finished the engineering side — confirm the business courses with the Edwards School before awarding it.'

export const USASK_CERTIFICATES: CertificateSeed[] = [
  {
    name: 'Engineering Innovation and Entrepreneurship',
    totalUnits: 14,
    notes:
      `College of Engineering. 14 of the catalogue's 26 credit units. A BSc Eng student who has done another capstone may count it in place of GE 495.6, provided they also complete GE 496.3. ${GE_ONLY}`,
    groups: [
      {
        name: 'Engineering courses',
        kind: 'required',
        courses: [
          { code: 'GE 431', units: 3 },
          { code: 'GE 450', units: 3 },
          { code: 'GE 451', units: 1 },
          { code: 'GE 490', units: 1 },
          { code: 'GE 495', units: 6 }
        ]
      }
    ],
    substitutions: DISCIPLINE_CAPSTONES.map((code) => ({
      replaces: 'GE 495',
      accepted: code,
      alsoRequires: 'GE 496'
    }))
  },

  {
    name: 'Engineering Entrepreneurship – Leading Innovative Teams',
    totalUnits: 10,
    notes: `Jointly delivered with the Edwards School of Business. 10 of the catalogue's 13 credit units. ${GE_ONLY}`,
    groups: [
      {
        // GE 431 is a catalogue elective, but it is the only one of the nine
        // choices the app can see — so it is listed here rather than as a
        // group of one, which would read like a bug on the screen.
        name: 'Engineering courses',
        kind: 'required',
        courses: [
          { code: 'GE 348', units: 3 },
          { code: 'GE 431', units: 3 },
          { code: 'GE 450', units: 3 },
          { code: 'GE 451', units: 1 }
        ]
      }
    ]
  },

  {
    name: 'Engineering Entrepreneurship – New Product Market',
    totalUnits: 10,
    notes: `Jointly delivered with the Edwards School of Business. 10 of the catalogue's 13 credit units. ${GE_ONLY}`,
    groups: [
      {
        // GE 450 is a catalogue elective; see the note above.
        name: 'Engineering courses',
        kind: 'required',
        courses: [
          { code: 'GE 348', units: 3 },
          { code: 'GE 431', units: 3 },
          { code: 'GE 450', units: 3 },
          { code: 'GE 490', units: 1 }
        ]
      }
    ]
  }
]

/**
 * Course prefixes the app never receives a record of. Used by the one-time
 * migration that brings a database seeded by an earlier build into line
 * with the seeds above.
 */
export const UNTRACKED_COURSE_PREFIXES = ['COMM', 'RCM']

/** True for a course code the app will never see a student complete. */
export function isUntrackedCourse(code: string): boolean {
  const prefix = code.trim().toUpperCase().split(/[\s.]/)[0]
  return UNTRACKED_COURSE_PREFIXES.includes(prefix)
}
