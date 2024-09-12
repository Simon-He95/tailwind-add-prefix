import path from 'node:path'
import fs from 'node:fs'
import process from 'node:process'
import { getPackageInfo, resolveModule } from 'local-pkg'
import fg from 'fast-glob'
import jitiFactory from 'jiti'
import { transform } from 'sucrase'

let jiti: ReturnType<typeof jitiFactory> | null = null
export let createLoadConfig: any
export let isV4 = false
export let tailwindContext: any
export let generateRules: any

export function create(cwd = process.cwd()) {
  createLoadConfig = createCacheLoadConfig(cwd)
}

export function createCacheLoadConfig(cwd = process.cwd()) {
  let tailwindConfigPath: string
  let workspaceTailwindPackageInfo: any
  let tailwindLibPath: string
  let cssFilePath: string
  let reloadConfig: () => any
  let createContext: any
  const clear = () => {
    workspaceTailwindPackageInfo = null
    tailwindContext = null
  }
  return async () => {
    if (!cwd)
      return
    if (!tailwindContext) {
      if (!tailwindConfigPath) {
        const tailwindConfigPaths = await fg('**/**/tailwind.config.{js,cjs,mjs,ts}', {
          ignore: ['**/**/dist', '**/**/node_modules'],
          dot: true,
          onlyFiles: true,
          deep: 4,
          cwd,
          absolute: true,
        })
        tailwindConfigPath = tailwindConfigPaths[0]
      }

      if (tailwindConfigPath)
        cwd = path.resolve(tailwindConfigPath, '..')

      if (!workspaceTailwindPackageInfo) {
        workspaceTailwindPackageInfo = await getPackageInfo(
          'tailwindcss',
          {
            paths: [cwd],
          },
        )
      }
      if (
        (!workspaceTailwindPackageInfo?.version
        || !workspaceTailwindPackageInfo?.rootPath)
      )
        return

      isV4 = workspaceTailwindPackageInfo?.version?.startsWith('4') ?? false
      if (!tailwindLibPath) {
        const workspaceTailwindPackageEntry = resolveModule(
          'tailwindcss',
          {
            paths: [cwd],
          },
        )!
        tailwindLibPath = path.resolve(workspaceTailwindPackageEntry, '../../')
      }

      if (isV4) {
        if (!cssFilePath) {
          const configPath = fg
            .globSync('./**/*.css', {
              cwd,
              ignore: ['**/node_modules/**'],
            })
            .map(p => path.join(cwd, p))
            .filter(p => fs.existsSync(p))
            .filter((p) => {
              const content = fs.readFileSync(p, 'utf8')
              const tailwindCSSRegex = [
                /^@import (["'])tailwindcss\1;/,
                /^@import (["'])tailwindcss\/preflight\1/,
                /^@import (["'])tailwindcss\/utilities\1/,
                /^@import (["'])tailwindcss\/theme\1/,
              ]
              return tailwindCSSRegex.some(regex => regex.test(content))
            })
          if (configPath.length === 0)
            return

          cssFilePath = configPath.at(0)!
        }
        if (!createContext) {
          const { __unstable__loadDesignSystem } = await import(path.resolve(tailwindLibPath, './dist/lib.js'))
          createContext = __unstable__loadDesignSystem
        }
        const presetThemePath = resolveModule('tailwindcss/theme.css', {
          paths: [cwd],
        })
        if (!presetThemePath)
          return

        generateRules = (extracted: string[]) => tailwindContext.candidatesToCss(extracted)
        reloadConfig = () => {
          const css = `${fs.readFileSync(presetThemePath, 'utf8')}\n${fs.readFileSync(cssFilePath, 'utf8')}`
          tailwindContext = createContext(css)
        }
      }
      else {
        if (!tailwindConfigPath)
          return

        const { generateRules: generate } = await import(`${tailwindLibPath}/lib/lib/generateRules.js`)
        generateRules = (extracted: string[]) => generate(extracted, tailwindContext)
        if (!createContext) {
          const { createContext: create } = await import(
            `${tailwindLibPath}/lib/lib/setupContextUtils.js`,
          )
          createContext = create
        }

        const resolveConfig = (await import(`${tailwindLibPath}/resolveConfig.js`)).default

        reloadConfig = () => {
          tailwindContext = createContext(
            resolveConfig(loadConfig(tailwindConfigPath)),
          )
        }
      }
      reloadConfig()
    }

    return {
      tailwindContext,
      tailwindLibPath,
      tailwindConfigPath,
      generateRules,
      reloadConfig,
      clear,
    }
  }
}

export function loadConfig(path: string) {
  const config = (() => {
    try {
      return path ? import(path) : {}
    }
    catch {
      return lazyJiti()(path)
    }
  })()

  return config.default ?? config
}

// @internal
// This WILL be removed in some future release
// If you rely on this your stuff WILL break
export function useCustomJiti(_jiti: () => ReturnType<typeof jitiFactory>) {
  jiti = _jiti()
}

function lazyJiti() {
  return (
    jiti

    ?? (jiti = jitiFactory(__filename, {
      interopDefault: true,
      transform: opts => transform(opts.source, {
        transforms: ['typescript', 'imports'],
      }),
    }))
  )
}

export async function generated(extracted: string) {
  const { generateRules } = (await createLoadConfig())!

  return !!generateRules(extracted.split(' '))[0]
}

const generatedCssMap = new Map()
export async function generatedCss(extracted: string) {
  if (generatedCssMap.has(extracted))
    return generatedCssMap.get(extracted)

  const { generateRules } = (await createLoadConfig())!
  const generatedRules = generateRules(extracted.split(' '))
  const target = generatedRules[0][1]
  if (!target)
    return
  // 如果是 color 生成对应的 color
  let color = ''
  const keyMap: Record<string, string> = {}
  target.nodes.forEach((node: any) => {
    if (!color && node.prop?.includes('color'))
      color = node.value
    const key = node.prop
    const value = node.value
    keyMap[key] = value
  })
  if (color) {
    for (const key in keyMap) {
      const value = keyMap[key]
      color = color.replace(key, value)
    }
    color = convertToRGBA(color)
  }
  const result = [target.proxyCache.toString(), color]
  generatedCssMap.set(extracted, result)
  return result
}

const reRgbFn = /rgb\((\d+)\s+(\d+)\s+(\d+)\s*\/\s*(?:var\()?([\d.]+)\)/
export function convertToRGBA(rgbColor: string) {
  const match = rgbColor.match(reRgbFn)

  if (match) {
    const r = Number.parseInt(match[1].trim())
    const g = Number.parseInt(match[2].trim())
    const b = Number.parseInt(match[3].trim())
    const alpha = Number.parseFloat(match[4].trim())

    const rgbaColor = `rgba(${r}, ${g}, ${b}, ${alpha})`

    return rgbaColor
  }

  return rgbColor
}
