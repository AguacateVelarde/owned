#!/usr/bin/env node
import { main } from '../src/cli.ts'

process.exitCode = await main(process.argv.slice(2), {
  cwd: process.cwd(),
  out: (text) => process.stdout.write(text),
  err: (text) => process.stderr.write(text),
})
