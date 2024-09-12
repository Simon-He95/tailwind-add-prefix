import fs from 'node:fs'
import process from 'node:process'
import fg from 'fast-glob'
import { create, generated } from './loadConfig'

async function setup(cwd = process.cwd(), filters = ['**/*.vue'], prefix = 'tw-', ignore = ['**/node_modules/**', '**/dist/**']) {
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
    const map = new Map()
    let i = 0
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
      // 这里替换还有可能会有问题
      // 替换后content的位置发生改变原本的match就不准确了, 要先用一个占位的唯一表示替换，并且和原本长度一样
      // 然后再替换
      if (newExtracted === extracted)
        continue
      const originLength = extracted.length
      i++
      const rest = originLength - i.toString().length
      const key = rest > 1 ? `$${'_'.repeat(rest - 1)}${i}` : new Error('不支持')
      map.set(key, newExtracted)
      newContent = newContent.slice(0, match.index) + key + newContent.slice(match.index + originLength)
    }
    for (const [key, value] of map)
      newContent = newContent.replace(key, value)
    if (newContent !== content)
      fs.writeFileSync(file, newContent)
  }
}

setup()
