import { readFileSync } from 'node:fs'
import AdmZip from 'adm-zip'

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
const zip = new AdmZip()

zip.addLocalFolder('dist', '', /^(?!(.*\.map$)).*$/)

const filename = `upwork-audit-ai-v${pkg.version}.zip`
zip.writeZip(filename)
console.log(`Package cree : ${filename}`)