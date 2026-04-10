import { readFile } from 'node:fs/promises'
import path from 'node:path'

const PROJECT_PATH = path.join(process.cwd(), '.vercel', 'project.json')
const EXPECTED_PROJECT_NAME = process.env.VERCEL_PROJECT_NAME?.trim() || 'job-hunter-team'
const EXPECTED_GIT_ORG = process.env.VERCEL_GIT_ORG?.trim() || 'leopu00'
const EXPECTED_GIT_REPO = process.env.VERCEL_GIT_REPO?.trim() || 'job-hunter-team'
const EXPECTED_PRODUCTION_BRANCH = process.env.VERCEL_EXPECTED_PRODUCTION_BRANCH?.trim() || 'production'
const EXPECTED_ROOT_DIRECTORY = process.env.VERCEL_EXPECTED_ROOT_DIRECTORY?.trim() || 'web'

function fail(message) {
  console.error(`ERROR: ${message}`)
  process.exit(1)
}

const token = process.env.VERCEL_TOKEN?.trim()
if (!token) fail('Missing VERCEL_TOKEN secret.')

const rawProject = await readFile(PROJECT_PATH, 'utf8').catch(() => null)
const linked = rawProject ? JSON.parse(rawProject) : null
if (linked && (!linked.projectId || !linked.orgId || !linked.projectName)) {
  fail('The linked Vercel project file is incomplete.')
}

const projectLookup = linked?.projectId || EXPECTED_PROJECT_NAME

const response = await fetch(`https://api.vercel.com/v9/projects/${projectLookup}`, {
  headers: {
    Authorization: `Bearer ${token}`,
  },
})

if (!response.ok) {
  const body = await response.text()
  fail(`Unable to read Vercel project ${projectLookup}: ${response.status} ${body}`)
}

const project = await response.json()
const productionBranch = project.link?.productionBranch
const rootDirectory = project.rootDirectory ?? null

if (project.name !== EXPECTED_PROJECT_NAME) {
  fail(`Vercel project name is ${project.name}, expected ${EXPECTED_PROJECT_NAME}.`)
}

if (project.link?.type !== 'github') {
  fail(`Vercel git provider is ${project.link?.type ?? '(unset)'}, expected github.`)
}

if (project.link?.org !== EXPECTED_GIT_ORG) {
  fail(`Vercel git org is ${project.link?.org ?? '(unset)'}, expected ${EXPECTED_GIT_ORG}.`)
}

if (project.link?.repo !== EXPECTED_GIT_REPO) {
  fail(`Vercel git repo is ${project.link?.repo ?? '(unset)'}, expected ${EXPECTED_GIT_REPO}.`)
}

if (productionBranch !== EXPECTED_PRODUCTION_BRANCH) {
  fail(`Vercel productionBranch is ${productionBranch ?? '(unset)'}, expected ${EXPECTED_PRODUCTION_BRANCH}.`)
}

if (rootDirectory !== EXPECTED_ROOT_DIRECTORY) {
  fail(`Vercel rootDirectory is ${rootDirectory ?? '(unset)'}, expected ${EXPECTED_ROOT_DIRECTORY}.`)
}

if (linked && project.id !== linked.projectId) {
  fail(`Linked project id mismatch. Repo has ${linked.projectId}, Vercel returned ${project.id}.`)
}

if (linked && project.accountId !== linked.orgId) {
  fail(`Linked org mismatch. Repo has ${linked.orgId}, Vercel returned ${project.accountId}.`)
}

if (linked && project.name !== linked.projectName) {
  fail(`Linked project name mismatch. Repo has ${linked.projectName}, Vercel returned ${project.name}.`)
}

console.log(`Verified Vercel project ${project.name}.`)
console.log(`productionBranch=${productionBranch}`)
console.log(`rootDirectory=${rootDirectory}`)
