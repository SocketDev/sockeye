import { builtinModules } from 'node:module'
import {
  isSyncDirectoryUrl,
  isSyncFilename,
  isSyncFileUrlMember,
  isSyncIdentifier,
  isSyncStringLiteral,
} from './transform-node-predicates.mts'

const builtinModulesSet = new Set(builtinModules)

export function buildCallExpressionHandler(config) {
  const context = { __proto__: null, ...config } as typeof config
  return function visitCallExpression(node, ancestors) {
    if (
      rewriteSyncCall(node, context) ||
      rewriteFileUrlCall(node, context) ||
      rewriteDynamicImportCall(node, ancestors, context)
    ) {
      return
    }
    rewriteBuiltinRequire(node, ancestors, context)
  }
}

export function rewriteBuiltinRequire(node, ancestors, config) {
  const { safeOverwrite } = { __proto__: null, ...config } as typeof config
  if (
    !isSyncIdentifier(node.callee, 'require') ||
    node.arguments?.length !== 1
  ) {
    return
  }
  const { 0: arg } = node.arguments
  if (!isSyncStringLiteral(arg)) {
    return
  }
  const moduleName = arg.value
  const parent = ancestors[ancestors.length - 2]
  if (
    (moduleName === 'node:url' || moduleName === 'url') &&
    parent.type === 'MemberExpression' &&
    parent.property?.name === 'fileURLToPath'
  ) {
    return
  }
  if (builtinModulesSet.has(moduleName) && !moduleName.startsWith('node:')) {
    safeOverwrite(arg.start, arg.end, `"node:${moduleName}"`)
  }
}

export function rewriteDynamicImportCall(node, ancestors, config) {
  const { safeOverwrite, topLevelStatementsToRemove } = {
    __proto__: null,
    ...config,
  } as typeof config
  const parent = ancestors[ancestors.length - 2]
  if (
    node.callee?.type !== 'ImportExpression' ||
    parent.type === 'AwaitExpression'
  ) {
    return false
  }
  if (
    node.arguments?.[0]?.value === 'module' &&
    parent.type === 'VariableDeclarator' &&
    parent.id?.type === 'ObjectPattern'
  ) {
    const declaration = ancestors.findLast(
      frame => frame.type === 'VariableDeclaration',
    )
    if (declaration && ancestors.some(frame => frame.type === 'Program')) {
      topLevelStatementsToRemove.push(declaration)
    }
  } else {
    safeOverwrite(node.callee.start, node.callee.end, 'require')
  }
  return true
}

export function rewriteFileUrlCall(node, config) {
  const { safeOverwrite } = { __proto__: null, ...config } as typeof config
  const memberCall = isSyncFileUrlMember(node.callee)
  if (!memberCall && node.callee?.name !== 'fileURLToPath') {
    return false
  }
  const arg = node.arguments?.[0]
  const filename = memberCall
    ? isSyncFilename(arg)
    : isSyncIdentifier(arg, '__filename')
  if (filename) {
    safeOverwrite(node.start, node.end, '__filename')
  } else if (isSyncDirectoryUrl(arg)) {
    safeOverwrite(node.start, node.end, '__dirname')
  }
  return true
}

export function rewriteSyncCall(node, config) {
  const { mjsContent, safeOverwrite, safeRemove } = {
    __proto__: null,
    ...config,
  } as typeof config
  if (
    node.callee?.type === 'MemberExpression' &&
    node.callee.property?.name === 'catch'
  ) {
    safeRemove(node.callee.property.start - 1, node.end)
    return true
  }
  if (isSyncIdentifier(node.callee, 'fa') && node.arguments?.length === 1) {
    const { 0: arg } = node.arguments
    safeOverwrite(
      node.start,
      node.end,
      `(moduleRtn = ${mjsContent.slice(arg.start, arg.end)})`,
    )
    return true
  }
  if (node.callee?.name === 'findWasmBinary') {
    safeOverwrite(node.start, node.end, "''")
    return true
  }
  return false
}
