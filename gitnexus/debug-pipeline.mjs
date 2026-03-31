import { runPipeline } from './src/core/pipeline.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturePath = path.join(__dirname, 'test/fixtures/lang-resolution/cpp-member-field');

const graph = await runPipeline(fixturePath, () => {});

console.log('Property nodes:');
for (const node of graph.iterNodes()) {
  if (node.label === 'Property') {
    console.log('  ', node.properties.name, '| description:', node.properties.description);
  }
}

console.log('\nMethod nodes:');
for (const node of graph.iterNodes()) {
  if (node.label === 'Method') {
    console.log('  ', node.properties.name, '| file:', path.basename(node.properties.filePath));
  }
}

console.log('\nCALLS edges:');
for (const rel of graph.iterRelationships()) {
  if (rel.type === 'CALLS') {
    const from = graph.getNode(rel.sourceId);
    const to = graph.getNode(rel.targetId);
    console.log('  ', from?.properties.name, '->', to?.properties.name, '(', to?.properties.filePath ? path.basename(to.properties.filePath) : '?', ')');
  }
}
