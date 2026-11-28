export interface Note {
  id: string
  userId: string
  text: string
}

export interface Comment {
  id: string
  userId: string
  text: string
}

function table<Row extends { id: string }>() {
  const rows = new Map<string, Row>()
  return {
    find: (id: string): Row | null => rows.get(id) ?? null,
    where: (match: (row: Row) => boolean): Row[] => [...rows.values()].filter(match),
    insert: (row: Row): Row => {
      rows.set(row.id, row)
      return row
    },
    remove: (id: string): boolean => rows.delete(id),
  }
}

function createDb() {
  return { notes: table<Note>(), comments: table<Comment>() }
}

let db: ReturnType<typeof createDb> | undefined

export function getDb() {
  db ??= createDb()
  return db
}
