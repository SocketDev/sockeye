export function isSyncCreateRequireProperty(prop) {
  return (
    (prop.type === 'ObjectProperty' || prop.type === 'Property') &&
    (prop.key?.name === 'createRequire' ||
      prop.value?.name?.includes('createRequire') ||
      prop.key?.value === 'createRequire')
  )
}

export function isSyncDirectoryUrl(node) {
  if (
    node?.type !== 'NewExpression' ||
    node.callee?.name !== 'URL' ||
    node.arguments?.length !== 2
  ) {
    return false
  }
  const { 0: relative, 1: base } = node.arguments
  return (
    isSyncStringLiteral(relative) &&
    relative.value === './' &&
    isSyncFilename(base)
  )
}

export function isSyncFilename(node) {
  return (
    isSyncIdentifier(node, '__filename') ||
    isSyncIdentifier(node, '__importMetaUrl') ||
    isSyncImportMetaUrl(node)
  )
}

export function isSyncFileUrlMember(node) {
  return (
    node?.type === 'MemberExpression' &&
    node.property?.name === 'fileURLToPath' &&
    isSyncUrlModuleCall(node.object)
  )
}

export function isSyncIdentifier(node, name) {
  return node?.type === 'Identifier' && node.name === name
}

export function isSyncImportMetaUrl(node) {
  if (node?.type !== 'MemberExpression') {
    return false
  }
  const { object, property } = node
  return (
    object?.type === 'MetaProperty' &&
    object.meta?.name === 'import' &&
    object.property?.name === 'meta' &&
    property?.name === 'url'
  )
}

export function isSyncModuleImport(init) {
  if (init?.type !== 'AwaitExpression') {
    return false
  }
  const { argument } = init
  return (
    argument?.type === 'ImportExpression' &&
    (argument.source?.value === 'module' ||
      argument.source?.value === 'node:module')
  )
}

export function isSyncModulePromise(node) {
  if (node?.type !== 'NewExpression' || node.callee?.name !== 'Promise') {
    return false
  }
  const arrow = node.arguments?.[0]
  return arrow?.type === 'ArrowFunctionExpression' && arrow.params?.length === 2
}

export function isSyncModuleRequire(init) {
  if (init?.type !== 'CallExpression' || init.callee?.name !== 'require') {
    return false
  }
  const moduleName = init.arguments?.[0]?.value
  return moduleName === 'module' || moduleName === 'node:module'
}

export function isSyncStringLiteral(node) {
  return node?.type === 'StringLiteral' || node?.type === 'Literal'
}

export function isSyncUrlModuleCall(node) {
  if (node?.type !== 'CallExpression' || node.callee?.name !== 'require') {
    return false
  }
  const moduleName = node.arguments?.[0]?.value
  return moduleName === 'node:url' || moduleName === 'url'
}
