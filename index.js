const Module = require('module')
const {uniqueId} = require('lodash')
const path = require('path')

module.exports = function generateRequireForUserCode (scopedDirs, {autoDeleteCache = false} = {}) {
  const forExtensions = Object.keys(require.extensions)
  const uniqueIdForThisScopedRequire = uniqueId('__dontExtendThisScopedRequire')
  const resolvedScopedDirs = scopedDirs.map(dir => path.resolve(dir))

  const baseModule = require('./lib/stubmodule-that-does-the-require')
  // so that it can be re-used again with another scoped-dir, I delete it from the cache
  delete Module._cache[baseModule.id]
  // make relative paths work when requiring
  baseModule.filename = path.resolve(resolvedScopedDirs[0], 'stubmodule-that-does-the-require.js')
  baseModule.__scopedRequireModule = true

  const inUserCodeDirs = (modulePath) => resolvedScopedDirs.some(userCodeDir => modulePath.indexOf(userCodeDir) >= 0)

  function adjustPaths (m) {
    m.paths = m.paths.concat(resolvedScopedDirs).filter(modulePath => inUserCodeDirs(modulePath))
  }

  adjustPaths(baseModule)

  forExtensions.forEach(ext => {
    const original = require.extensions[ext]
    if (original && original[uniqueIdForThisScopedRequire]) { return }

    require.extensions[ext] = function requireThatAddsUserCodeDirs (m, filename) {
      if (((!m.parent && inUserCodeDirs(m.filename)) ||
        (m.parent && m.parent.__scopedRequireModule)) && inUserCodeDirs(m.filename)) {
        m.__scopedRequireModule = true
        adjustPaths(m)
      }

      return original(m, filename)
    }
    Object.defineProperty(require.extensions[ext], uniqueIdForThisScopedRequire, {value: true})
  })

  function deleteModuleFromCache (m) {
    if (m && m.id && m.id.endsWith('.node')) {
      m.parent = null
      return
    }
    delete Module._cache[m.id]
    const moduleChildren = m.children
    m.children = []
    moduleChildren.forEach(subModule => deleteModuleFromCache(subModule))
  }

  return {
    require: !autoDeleteCache
      ? baseModule.require.bind(baseModule)
      : function (path) {
        const moduleExports = baseModule.require.apply(baseModule, arguments)

        deleteModuleFromCache(baseModule)

        return moduleExports
      },
    scopedDirs: resolvedScopedDirs,
    clearCache: () => deleteModuleFromCache(baseModule),
    loadCodeAsModule: (code, filename) => {
      if (filename && Module._cache[filename]) {
        return Module._cache[filename]
      }

      const module = new Module(filename, baseModule)
      module.filename = filename
      module.paths = baseModule.paths
      module.__scopedRequireModule = true
      module._compile(code, module.filename || 'filename-to-make-node6-happy')
      baseModule.children.push(module)

      if (autoDeleteCache) {
        deleteModuleFromCache(baseModule)
      } else if (filename && !autoDeleteCache) {
        Module._cache[filename] = module
      }

      return module.exports
    }
  }
}
