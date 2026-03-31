import Parser from 'tree-sitter';
import CPP from 'tree-sitter-cpp';
import { readFileSync } from 'fs';

const parser = new Parser();
parser.setLanguage(CPP);

const src = readFileSync('./src/core/ingestion/tree-sitter-queries.ts', 'utf-8');
const match = src.match(/export const CPP_QUERIES = `([\s\S]*?)`;/);
const fullQuery = match[1];

const serviceH = `
#pragma once
#include "user.h"

class UserService {
public:
    void process();
private:
    User* m_user;
};
`;

const tree = parser.parse(serviceH);
const q = new Parser.Query(CPP, fullQuery);
const matches = q.matches(tree.rootNode);

console.log('Matches for service.h:');
for (const m of matches) {
  const captureMap = {};
  for (const c of m.captures) captureMap[c.name] = c.node;
  
  if (captureMap['definition.property']) {
    console.log('  PROPERTY:', captureMap['name']?.text, 
      '| prop.type:', captureMap['prop.type']?.text,
      '| prop.type node type:', captureMap['prop.type']?.type);
  }
  if (captureMap['definition.method']) {
    console.log('  METHOD:', captureMap['name']?.text);
  }
  if (captureMap['definition.class']) {
    console.log('  CLASS:', captureMap['name']?.text);
  }
}

// Also check AST
function findNodes(node, type, results = []) {
  if (node.type === type) results.push(node);
  for (let i = 0; i < node.childCount; i++) findNodes(node.child(i), type, results);
  return results;
}

console.log('\nField declarations:');
const fieldDecls = findNodes(tree.rootNode, 'field_declaration');
for (const f of fieldDecls) {
  const typeNode = f.childForFieldName('type');
  const declarator = f.childForFieldName('declarator');
  console.log('  type:', typeNode?.text, '(', typeNode?.type, ')', '| declarator:', declarator?.type, '| text:', f.text.trim());
}
