import { readFile } from 'node:fs/promises'
import path from 'node:path'

const PROJECT_PATH = path.join(process.cwd(), '.vercel', 'project.json')

function fail(message) {
  console.error(`ERROR: ${message}`)
  process.exit(1)
}

const token = process.env.VERCEL_TOKEN?.trim()
if (!token) fail('Missing VERCEL_TOKEN secret.')

const rawProject = await readFile(PROJECT_PATH, 'utf8').catch(() => null)
if (!rawProject) fail(`Missing linked Vercel project file at ${PROJECT_PATH}.`)

const linked = JSON.parse(rawProject)
if (!linked.projectId || !linked.orgId || !linked.projectName) {
  fail('The linked Vercel project file is incomplete.')
}

const response = await fetch(`https://api.vercel.com/v9/projects/${linked.projectId}`, {
  headers: {
    Authorization: `Bearer ${token}`,
  },
})

if (!response.ok) {
  const body = await response.text()
  fail(`Unable to read Vercel project ${linked.projectId}: ${response.status} ${body}`)
}

const project = await response.json()
const productionBranch = project.link?.productionBranch
const rootDirectory = project.rootDirectory ?? null

if (project.id !== linked.projectId) {
  fail(`Linked project id mismatch. Repo has ${linked.projectId}, Vercel returned ${project.id}.`)
}

if (project.accountId !== linked.orgId) {
  fail(`Linked org mismatch. Repo has ${linked.orgId}, Vercel returned ${project.accountId}.`)
}

if (project.name !== linked.projectName) {
  fail(`Linked project name mismatch. Repo has ${linked.projectName}, Vercel returned ${project.name}.`)
}

if (productionBranch !== 'production') {
  fail(`Vercel productionBranch is ${productionBranch ?? '(unset)'}, expected production.`)
}

if (rootDirectory !== linked.settings?.rootDirectory) {
  fail(`Vercel rootDirectory is ${rootDirectory ?? '(unset)'}, expected ${linked.settings?.rootDirectory ?? '(unset)'}.`)
}

console.log(`Verified Vercel project ${project.name}.`)
console.log(`productionBranch=${productionBranch}`)
console.log(`rootDirectory=${rootDirectory}`)
