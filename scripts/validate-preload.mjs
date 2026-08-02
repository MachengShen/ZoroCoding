#!/usr/bin/env node

import path from "node:path";

const failureMessage = "Sandbox preload must be one self-contained bundle";
const forbiddenIdentifiers = new Set([
  "arguments",
  "exports",
  "__filename",
  "__dirname",
  "module",
  "eval",
  "Function",
  "AsyncFunction",
  "GeneratorFunction",
  "AsyncGeneratorFunction",
]);
const forbiddenComputedProperties = new Set([
  ...forbiddenIdentifiers,
  "require",
]);

function hasUseStrictDirective(sourceFile, ast) {
  for (const statement of sourceFile.statements) {
    if (
      !ast.isExpressionStatement(statement) ||
      !ast.isStringLiteral(statement.expression)
    ) {
      return false;
    }
    const rawDirective = statement.expression.getText(sourceFile);
    if (
      rawDirective === '"use strict"' ||
      rawDirective === "'use strict'"
    ) {
      return true;
    }
  }
  return false;
}

function fail(preloadPath) {
  console.error(`${failureMessage}: ${preloadPath}`);
  process.exitCode = 1;
}

async function main() {
  const preloadPath = process.argv[2];
  if (process.argv.length !== 3 || preloadPath === undefined) {
    fail("invalid preload path");
    return;
  }

  let compiler;
  let ast;
  try {
    [compiler, ast] = await Promise.all([
      import("typescript/unstable/sync"),
      import("typescript/unstable/ast"),
    ]);
  } catch {
    fail(preloadPath);
    return;
  }

  let api;
  let snapshot;
  try {
    api = new compiler.API({ cwd: path.dirname(preloadPath) });
    snapshot = api.updateSnapshot({ openFiles: [preloadPath] });
    const project = snapshot.getDefaultProjectForFile(preloadPath);
    const sourceFile = project?.program.getSourceFile(preloadPath);
    const parseDiagnostics =
      project?.program.getSyntacticDiagnostics(preloadPath) ?? [];
    if (
      sourceFile === undefined ||
      parseDiagnostics.length > 0 ||
      !hasUseStrictDirective(sourceFile, ast)
    ) {
      fail(preloadPath);
      return;
    }

    let invalid = false;
    const visit = (node) => {
      if (invalid) return;

      if (
        ast.isImportDeclaration(node) ||
        ast.isImportEqualsDeclaration(node) ||
        ast.isImportTypeNode(node) ||
        (ast.isExportDeclaration(node) &&
          node.moduleSpecifier !== undefined) ||
        (ast.isMetaProperty(node) &&
          node.keywordToken === ast.SyntaxKind.ImportKeyword) ||
        node.kind === ast.SyntaxKind.ThisKeyword ||
        node.kind === ast.SyntaxKind.ImportKeyword
      ) {
        invalid = true;
        return;
      }

      if (
        (ast.isStringLiteral(node) ||
          ast.isNoSubstitutionTemplateLiteral(node)) &&
        forbiddenComputedProperties.has(node.text) &&
        ast.isElementAccessExpression(node.parent)
      ) {
        invalid = true;
        return;
      }

      if (
        ast.isIdentifier(node) &&
        forbiddenIdentifiers.has(node.text)
      ) {
        invalid = true;
        return;
      }

      if (ast.isIdentifier(node) && node.text === "require") {
        const call = node.parent;
        const allowed =
          ast.isCallExpression(call) &&
          call.expression === node &&
          call.questionDotToken === undefined &&
          call.arguments.length === 1 &&
          ast.isStringLiteral(call.arguments[0]) &&
          call.arguments[0].text === "electron";
        if (!allowed) {
          invalid = true;
          return;
        }
      }

      node.forEachChild(visit);
    };
    visit(sourceFile);

    if (invalid) {
      fail(preloadPath);
    }
  } catch {
    fail(preloadPath);
  } finally {
    snapshot?.dispose();
    api?.close();
  }
}

await main();
