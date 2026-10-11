import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const vite = path.join(root, 'node_modules', 'vite', 'bin', 'vite.js')
const commands = [
  ['API', ['--watch', path.join(root, 'server', 'index.mjs')]],
  ['Web', [vite, '--host', '0.0.0.0']],
]
const children = commands.map(([name, args]) => {
  const child = spawn(process.execPath, args, { cwd: root, stdio: 'inherit', env: process.env })
  child.on('error', error => {
    console.error(`${name} server could not start:`, error.message)
    stop(1)
  })
  child.on('exit', (code, signal) => {
    if (!stopping) {
      console.error(`${name} server exited (${signal || code}).`)
      stop(code || 1)
    }
  })
  return child
})
let stopping = false
function stop(code = 0) {
  if (stopping) return
  stopping = true
  for (const child of children) if (child.exitCode === null) child.kill()
  process.exitCode = code
}
process.on('SIGINT', () => stop())
process.on('SIGTERM', () => stop())
