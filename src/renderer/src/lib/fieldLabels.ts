import type { MappableField } from '../../../shared/types'

export const FIELD_LABELS: Record<MappableField, string> = {
  firstName: 'First name',
  lastName: 'Last name',
  fullName: 'Full name',
  email: 'Email',
  phone: 'Phone',
  nsid: 'Student ID (NSID)',
  college: 'College',
  discipline: 'Discipline / Major',
  degree: 'Degree',
  program: 'Program',
  yearInProgram: 'Year in program / enroll year',
  ignore: '— Not used —'
}

export const FIELD_OPTIONS: MappableField[] = [
  'firstName',
  'lastName',
  'fullName',
  'email',
  'phone',
  'nsid',
  'college',
  'discipline',
  'degree',
  'program',
  'yearInProgram',
  'ignore'
]
