import { NextResponse } from 'next/server'
import { execSync } from 'child_process'
import fs from 'fs'
import path from 'path'

const SKILLS_DIR = path.join(process.cwd(), '..', '..', 'shared', 'skills')

function extractDocstring(content: string): string {
  const m = content.match(/^"""([\s\S]*?)"""/m) ?? content.match(/^'''([\s\S]*?)'''/m)
  if (!m) return ''
  return m[1].split('\n')[0].trim()
}

function isPythonRunnable(name: string): boolean {
  try { execSync(`python3 -c "import ast; ast.parse(open('${SKILLS_DIR}/${name}').read())"`, { stdio: 'pipe' }); return true }
  catch { return false }
}

export async function GET() {
  if (!fs.existsSync(SKILLS_DIR)) {
    return NextResponse.json({ skills: [], total: 0 })
  }

  const files = fs.readdirSync(SKILLS_DIR)
    .filter(f => f.endsWith('.py') && !f.startsWith('_') && !f.startsWith('test_'))
    .sort()

  const skills = files.map(file => {
    const name = file.replace('.py', '')
    let description = ''
    try {
      const content = fs.readFileSync(path.join(SKILLS_DIR, file), 'utf-8')
      description = extractDocstring(content)
    } catch { /* skip */ }

    const DISABLED = ['db_migrate', 'db_migrate_v2', 'dashboard_server']
    const enabled = !DISABLED.includes(name)

    return { id: name, name, file, description: description || `Script ${name}`, enabled }
  })

  return NextResponse.json({ skills, total: skills.length })
}
