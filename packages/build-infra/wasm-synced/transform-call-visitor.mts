import { buildCallExpressionHandler } from './transform-call-handlers.mts'
import {
  isSyncCreateRequireProperty,
  isSyncIdentifier,
  isSyncModuleImport,
  isSyncModulePromise,
  isSyncModuleRequire,
} from './transform-node-predicates.mts'

export function buildCallVisitor(config) {
  const {
    detectedModuleVar,
    requireDeclaratorsToRemove,
    returnModuleToFix,
    safeOverwrite,
    safeRemove,
  } = { __proto__: null, ...config } as typeof config
  return {
    __proto__: null,
    CallExpression: buildCallExpressionHandler(config),
    VariableDeclaration(node) {
      if (hasCreateRequireDeclaration(node)) {
        safeRemove(node.start, node.end)
      }
    },
    VariableDeclarator(node, ancestors) {
      const parent = ancestors[ancestors.length - 2]
      if (
        node.id?.name === 'require' &&
        parent?.type === 'VariableDeclaration'
      ) {
        requireDeclaratorsToRemove.push({ node, varDecl: parent })
      }
      if (
        node.id?.name === 'ENVIRONMENT_IS_NODE' &&
        node.init?.type === 'LogicalExpression'
      ) {
        safeOverwrite(node.init.start, node.init.end, 'true')
      }
      if (isSyncModulePromise(node.init)) {
        safeOverwrite(node.init.start, node.init.end, 'null')
      }
    },
    AssignmentExpression(node, ancestors) {
      const parent = ancestors[ancestors.length - 2]
      if (
        isSyncIdentifier(node.left, 'moduleRtn') &&
        isSyncIdentifier(node.right, 'ia') &&
        parent?.type === 'ExpressionStatement'
      ) {
        safeRemove(parent.start, parent.end + 1)
      }
    },
    ReturnStatement(node, ancestors) {
      if (isSyncIdentifier(node.argument, 'moduleRtn')) {
        safeOverwrite(
          node.argument.start,
          node.argument.end,
          returnModuleVariable(ancestors, detectedModuleVar),
        )
      }
      if (
        isSyncIdentifier(node.argument, 'Module') &&
        isModuleFunctionReturn(ancestors)
      ) {
        returnModuleToFix.push({
          end: node.argument.end,
          start: node.argument.start,
        })
      }
    },
  }
}

export function hasCreateRequireDeclaration(node) {
  if (node.kind !== 'const' || node.declarations?.length !== 1) {
    return false
  }
  const declaration = node.declarations[0]
  if (
    declaration.id?.type !== 'ObjectPattern' ||
    !declaration.id.properties?.some(isSyncCreateRequireProperty)
  ) {
    return false
  }
  return (
    isSyncModuleImport(declaration.init) ||
    isSyncModuleRequire(declaration.init)
  )
}

export function isModuleFunctionReturn(ancestors) {
  const frame = ancestors.findLast(
    entry => entry.type === 'FunctionDeclaration',
  )
  return frame?.id?.name === 'Module'
}

export function returnModuleVariable(ancestors, detectedModuleVar) {
  const frame = ancestors.findLast(
    entry =>
      entry.type === 'FunctionDeclaration' ||
      entry.type === 'FunctionExpression',
  )
  return frame?.id?.name === 'Module' ? 'Module' : detectedModuleVar || 'D'
}
