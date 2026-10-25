import { simple as walkSimple } from 'acorn-walk'

export function findWasmImportsDeclaration(node, mjsContent) {
  const bodyStatements = node.body.body
  for (let i = 0, { length } = bodyStatements; i < length; i += 1) {
    const stmt = bodyStatements[i]
    if (stmt.type === 'VariableDeclaration') {
      const { declarations } = stmt
      for (
        let index = 0, { length: declarationCount } = declarations;
        index < declarationCount;
        index += 1
      ) {
        const decl = declarations[index]
        const varName = decl.id?.name
        if (!varName) {
          continue
        }

        if (decl.init?.type === 'ObjectExpression') {
          const stmtCode = mjsContent.slice(stmt.start, stmt.end)
          const importsSetup = stmtCode.endsWith(';')
            ? stmtCode
            : `${stmtCode};`
          return { __proto__: null, importsParam: varName, importsSetup }
        }

        if (
          decl.init &&
          (decl.init.type === 'CallExpression' ||
            decl.init.type === 'NewExpression')
        ) {
          const stmtCode = mjsContent.slice(stmt.start, stmt.end)
          const importsSetup = stmtCode.endsWith(';')
            ? stmtCode
            : `${stmtCode};`
          return { __proto__: null, importsParam: varName, importsSetup }
        }
      }
    }
  }
  return undefined
}

export function getWasmImports(node, mjsContent) {
  const paramNames = node.params.map(param =>
    param.type === 'AssignmentPattern' ? param.left.name : param.name,
  )

  let importsParam = paramNames[0] || 'imports'
  let importsSetup = ''

  const paramCounts = {}
  let foundInstantiate = false

  walkSimple(node, {
    CallExpression(callNode) {
      const { callee } = callNode

      if (
        callee.type === 'MemberExpression' &&
        callee.object.type === 'Identifier' &&
        callee.object.name === 'WebAssembly' &&
        callee.property.type === 'Identifier' &&
        (callee.property.name === 'instantiate' ||
          callee.property.name === 'instantiateStreaming')
      ) {
        const importsArg = callNode.arguments[1]
        if (importsArg && importsArg.type === 'Identifier') {
          const argName = importsArg.name
          if (paramNames.includes(argName)) {
            paramCounts[argName] = (paramCounts[argName] || 0) + 1
            foundInstantiate = true
          }
        }
      }
    },
  })

  const paramEntries = Object.entries(paramCounts)
  if (paramEntries.length > 0) {
    const sortedParams = paramEntries.toSorted(([, a], [, b]) => b - a)
    importsParam = sortedParams[0][0]
  }

  if (!foundInstantiate) {
    const localImports = findWasmImportsDeclaration(node, mjsContent)
    if (localImports) {
      importsParam = localImports.importsParam
      importsSetup = localImports.importsSetup
    }
  }

  if (!foundInstantiate && !importsSetup && paramNames.length === 0) {
    importsParam = 'info'
    importsSetup = 'var info={};'
  }

  return { __proto__: null, importsParam, importsSetup }
}

export function isAsyncWasmLoader(node) {
  let hasAsyncWebAssemblyCall = false
  let hasLoadingMechanism = false
  let isNotAlreadySync = true

  walkSimple(node, {
    CallExpression(callNode) {
      const callee = callNode.callee

      if (
        callee.type === 'MemberExpression' &&
        callee.object.type === 'Identifier' &&
        callee.object.name === 'WebAssembly' &&
        callee.property.type === 'Identifier' &&
        (callee.property.name === 'instantiate' ||
          callee.property.name === 'instantiateStreaming')
      ) {
        hasAsyncWebAssemblyCall = true
      }

      if (callee.type === 'Identifier' && callee.name === 'fetch') {
        hasLoadingMechanism = true
      }
    },
    Identifier(idNode) {
      if (idNode.name === 'wasmBinary') {
        hasLoadingMechanism = true
      }
    },
    NewExpression(newNode) {
      const callee = newNode.callee
      if (
        callee.type === 'MemberExpression' &&
        callee.object.type === 'Identifier' &&
        callee.object.name === 'WebAssembly' &&
        callee.property.type === 'Identifier' &&
        callee.property.name === 'Instance'
      ) {
        isNotAlreadySync = false
      }
    },
  })

  return hasAsyncWebAssemblyCall && hasLoadingMechanism && isNotAlreadySync
}
