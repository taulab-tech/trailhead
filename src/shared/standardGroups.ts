/**
 * SIGMA's usual trail, offered as a one-click starting point on an empty
 * Trail page. Nothing creates these automatically — the importer and
 * dashboard look groups up by these names, so a group the user creates
 * with the same name behaves identically.
 */
export const STANDARD_GROUPS: { name: string; stageOrder: number | null }[] = [
  { name: 'Hackathon', stageOrder: 1 },
  { name: 'Inspiration Event', stageOrder: 1 },
  { name: 'Class', stageOrder: 2 },
  { name: 'SIGMA', stageOrder: 3 },
  { name: 'Social', stageOrder: null },
  { name: 'Other', stageOrder: null }
]
