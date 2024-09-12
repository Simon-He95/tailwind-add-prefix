import fs from 'node:fs'
import process from 'node:process'
import fg from 'fast-glob'
import { create, generated } from './loadConfig'

export async function setup(cwd = process.cwd(), filters = ['**/*.vue'], prefix = 'tw-', ignore = ['**/node_modules/**', '**/dist/**']) {
  // 处理所有的 .vue 文件
  create(cwd)
  const entry = await fg(filters, {
    ignore,
    cwd,
    absolute: true,
  })
  for (const file of entry) {
    const content = fs.readFileSync(file, 'utf8')
    let newContent = content
    for (const match of content.matchAll(/(?<=class=")([^"]+)/g)) {
      const extracted = match[0]
      if (!extracted)
        continue

      const newExtracted = (await Promise.all(extracted.split(' ').map(async (className) => {
        const result = await generated(className)
        if (!result)
          return className

        if (className.startsWith('!'))
          return `!${prefix}${className.slice(1)}`
        return `${prefix}${className}`
      }))).join(' ')
      if (newExtracted !== extracted)
        newContent = newContent.replace(extracted, newExtracted)
    }
    if (newContent !== content)
      fs.writeFileSync(file, newContent)
  }
}
