const ts = require('typescript');

module.exports = {
  process(source) {
    return {
      code: ts.transpileModule(source, {
        compilerOptions: {
          module: ts.ModuleKind.CommonJS,
          target: ts.ScriptTarget.ES2022,
        },
      }).outputText,
    };
  },
};
