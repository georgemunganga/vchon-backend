/**
 * VChron DB Migration Runner
 * Reads migration.sql and executes each statement against the production DB
 */
const fs = require('fs')
const path = require('path')
const { PrismaClient } = require('@prisma/client')

const p = new PrismaClient()
const sqlFile = path.join(__dirname, 'migration.sql')
const sql = fs.readFileSync(sqlFile, 'utf8')

// Split on semicolons, strip comments, filter empty
const stmts = sql
  .split(';')
  .map(s => s.trim())
  .filter(s => s.length > 0 && !s.startsWith('--'))

async function run() {
  let ok = 0
  let err = 0
  for (const stmt of stmts) {
    try {
      await p.$executeRawUnsafe(stmt)
      console.log('✓ ' + stmt.slice(0, 70).replace(/\n/g, ' '))
      ok++
    } catch (e) {
      console.error('✗ ' + e.message.slice(0, 120))
      err++
    }
  }
  await p.$disconnect()
  console.log(`\nDone: ${ok} OK, ${err} errors`)
  process.exit(err > 0 ? 1 : 0)
}

run().catch(e => {
  console.error(e)
  process.exit(1)
})
