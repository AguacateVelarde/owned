export function getDb() {
  return { orders: { find: (id: string) => ({ id, userId: 'u1' }) } }
}
