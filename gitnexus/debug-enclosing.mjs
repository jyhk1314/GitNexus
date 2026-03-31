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

for (const m of matches) {
  const captureMap = {};
  for (const c of m.captures) captureMap[c.name] = c.node;
  
  if (captureMap['definition.property']) {
    const nameNode = captureMap['name'];
    const propTypeNode = captureMap['prop.type'];
    console.log('Property match:');
    console.log('  name:', nameNode?.text, '| type:', nameNode?.type);
    console.log('  prop.type:', propTypeNode?.text, '| type:', propTypeNode?.type);
    
    // Walk up from nameNode to find enclosing class
    let current = nameNode?.parent;
    while (current) {
      console.log('  ancestor:', current.type);
      if (current.type === 'class_specifier' || current.type === 'struct_specifier') {
        const classNameNode = current.childForFieldName('name');
        console.log('  -> found class:', classNameNode?.text);
        break;
      }
      current = current.parent;
    }
  }
}
