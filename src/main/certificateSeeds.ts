import type { GroupKind } from '../shared/types'

/**
 * The three University of Saskatchewan College of Engineering certificates,
 * as published in the 2026-27 catalogue.
 *
 * These are a starting point, not a fixture: they are written into a new
 * database once and are ordinary editable records afterwards. Courses and
 * minimums change between catalogues, and the people running this know
 * before any code does — so the Certificates screen can change all of it,
 * and nothing here is ever written over the top of what they have set.
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
  /** A rule within this group, e.g. "at least 3 of the 9 must be COMM". */
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

export const USASK_CERTIFICATES: CertificateSeed[] = [
  {
    name: 'Engineering Innovation and Entrepreneurship',
    totalUnits: 26,
    notes:
      'College of Engineering. A BSc Eng student who has done another capstone may count it in place of GE 495.6, provided they also complete GE 496.3.',
    groups: [
      {
        name: 'Required courses',
        kind: 'required',
        courses: [
          { code: 'COMM 201', units: 3 },
          { code: 'GE 431', units: 3 },
          { code: 'GE 450', units: 3 },
          { code: 'GE 451', units: 1 },
          { code: 'GE 490', units: 1 },
          { code: 'GE 495', units: 6 }
        ]
      },
      {
        name: 'Electives',
        kind: 'elective',
        minUnits: 9,
        courses: [
          { code: 'RCM 402', units: 3 },
          { code: 'RCM 404', units: 3 },
          { code: 'RCM 409', units: 3 }
        ],
        children: [
          {
            // "at least 3 credit units of which must be COMM courses"
            name: 'COMM electives',
            kind: 'elective',
            minUnits: 3,
            courses: [
              { code: 'COMM 204', units: 3 },
              { code: 'COMM 205', units: 3 },
              { code: 'COMM 211', units: 3 },
              { code: 'COMM 341', units: 3 }
            ]
          }
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
    totalUnits: 13,
    notes: 'Jointly delivered with the Edwards School of Business. Open to undergraduates, or as a stand-alone program.',
    groups: [
      {
        name: 'Required courses',
        kind: 'required',
        courses: [
          { code: 'GE 348', units: 3 },
          { code: 'GE 450', units: 3 },
          { code: 'GE 451', units: 1 },
          { code: 'COMM 205', units: 3 }
        ]
      },
      {
        name: 'Electives',
        kind: 'elective',
        minUnits: 3,
        courses: [
          { code: 'COMM 201', units: 3 },
          { code: 'COMM 211', units: 3 },
          { code: 'COMM 247', units: 3 },
          { code: 'COMM 340', units: 3 },
          { code: 'COMM 368', units: 3 },
          { code: 'COMM 495', units: 3 },
          { code: 'RCM 404', units: 3 },
          { code: 'RCM 409', units: 3 },
          { code: 'GE 431', units: 3 }
        ]
      }
    ]
  },

  {
    name: 'Engineering Entrepreneurship – New Product Market',
    totalUnits: 13,
    notes: 'Jointly delivered with the Edwards School of Business. Open to undergraduates, or as a stand-alone program.',
    groups: [
      {
        name: 'Required courses',
        kind: 'required',
        courses: [
          { code: 'GE 348', units: 3 },
          { code: 'GE 431', units: 3 },
          { code: 'GE 490', units: 1 },
          { code: 'COMM 204', units: 3 }
        ]
      },
      {
        name: 'Electives',
        kind: 'elective',
        minUnits: 3,
        courses: [
          { code: 'COMM 205', units: 3 },
          { code: 'COMM 211', units: 3 },
          { code: 'COMM 304', units: 3 },
          { code: 'COMM 358', units: 3 },
          { code: 'GE 450', units: 3 },
          { code: 'RCM 400', units: 3 },
          { code: 'RCM 401', units: 3 },
          { code: 'RCM 404', units: 3 }
        ]
      }
    ]
  }
]
