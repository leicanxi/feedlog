import { cp, mkdir } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

const source = resolve('server/db/migrations')
const destination = resolve('.output/server/db/migrations')

await mkdir(dirname(destination), { recursive: true })
await cp(source, destination, { recursive: true })

console.log('✓ Copied database migrations into the production server bundle')
