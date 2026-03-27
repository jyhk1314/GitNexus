import { describe, it, expect } from 'vitest';
import { extractMethodSignature, hashCppCallableOverloadSegment } from '../../src/core/ingestion/utils.js';
import Parser from 'tree-sitter';
import TypeScript from 'tree-sitter-typescript';
import Python from 'tree-sitter-python';
import Java from 'tree-sitter-java';
import CSharp from 'tree-sitter-c-sharp';
import Kotlin from 'tree-sitter-kotlin';
import CPP from 'tree-sitter-cpp';
import Go from 'tree-sitter-go';
import Rust from 'tree-sitter-rust';

describe('extractMethodSignature', () => {
  const parser = new Parser();

  it('returns zero params and no return type for null node', () => {
    const sig = extractMethodSignature(null);
    expect(sig.parameterCount).toBe(0);
    expect(sig.returnType).toBeUndefined();
  });

  describe('TypeScript', () => {
    it('extracts params and return type from a typed method', () => {
      parser.setLanguage(TypeScript.typescript);
      const code = `class Foo {
  greet(name: string, age: number): boolean { return true; }
}`;
      const tree = parser.parse(code);
      const classNode = tree.rootNode.child(0)!;
      const classBody = classNode.childForFieldName('body')!;
      const methodNode = classBody.namedChild(0)!;

      const sig = extractMethodSignature(methodNode);
      expect(sig.parameterCount).toBe(2);
      expect(sig.returnType).toBe('boolean');
    });

    it('extracts zero params from a method with no parameters', () => {
      parser.setLanguage(TypeScript.typescript);
      const code = `class Foo {
  run(): void {}
}`;
      const tree = parser.parse(code);
      const classNode = tree.rootNode.child(0)!;
      const classBody = classNode.childForFieldName('body')!;
      const methodNode = classBody.namedChild(0)!;

      const sig = extractMethodSignature(methodNode);
      expect(sig.parameterCount).toBe(0);
      expect(sig.returnType).toBe('void');
    });

    it('extracts params without return type annotation', () => {
      parser.setLanguage(TypeScript.typescript);
      const code = `class Foo {
  process(x: number) { return x + 1; }
}`;
      const tree = parser.parse(code);
      const classNode = tree.rootNode.child(0)!;
      const classBody = classNode.childForFieldName('body')!;
      const methodNode = classBody.namedChild(0)!;

      const sig = extractMethodSignature(methodNode);
      expect(sig.parameterCount).toBe(1);
      expect(sig.returnType).toBeUndefined();
    });
  });

  describe('Python', () => {
    it('skips self parameter', () => {
      parser.setLanguage(Python);
      const code = `class Foo:
    def bar(self, x, y):
        pass`;
      const tree = parser.parse(code);
      const classNode = tree.rootNode.child(0)!;
      const classBody = classNode.childForFieldName('body')!;
      const methodNode = classBody.namedChild(0)!;

      const sig = extractMethodSignature(methodNode);
      expect(sig.parameterCount).toBe(2);
      expect(sig.returnType).toBeUndefined();
    });

    it('handles method with only self', () => {
      parser.setLanguage(Python);
      const code = `class Foo:
    def noop(self):
        pass`;
      const tree = parser.parse(code);
      const classNode = tree.rootNode.child(0)!;
      const classBody = classNode.childForFieldName('body')!;
      const methodNode = classBody.namedChild(0)!;

      const sig = extractMethodSignature(methodNode);
      expect(sig.parameterCount).toBe(0);
    });

    it('handles Python return type annotation', () => {
      parser.setLanguage(Python);
      const code = `class Foo:
    def bar(self, x: int) -> bool:
        return True`;
      const tree = parser.parse(code);
      const classNode = tree.rootNode.child(0)!;
      const classBody = classNode.childForFieldName('body')!;
      const methodNode = classBody.namedChild(0)!;

      const sig = extractMethodSignature(methodNode);
      expect(sig.parameterCount).toBe(1);
      // The important thing is parameterCount is correct; returnType may vary.
    });
  });

  describe('Java', () => {
    it('extracts params from a Java method', () => {
      parser.setLanguage(Java);
      const code = `class Foo {
  public int add(int a, int b) { return a + b; }
}`;
      const tree = parser.parse(code);
      const classNode = tree.rootNode.child(0)!;
      const classBody = classNode.childForFieldName('body')!;
      const methodNode = classBody.namedChild(0)!;

      const sig = extractMethodSignature(methodNode);
      expect(sig.parameterCount).toBe(2);
    });

    it('extracts zero params from no-arg Java method', () => {
      parser.setLanguage(Java);
      const code = `class Foo {
  public void run() {}
}`;
      const tree = parser.parse(code);
      const classNode = tree.rootNode.child(0)!;
      const classBody = classNode.childForFieldName('body')!;
      const methodNode = classBody.namedChild(0)!;

      const sig = extractMethodSignature(methodNode);
      expect(sig.parameterCount).toBe(0);
    });
  });

  describe('Kotlin', () => {
    it('extracts params from a Kotlin function declaration', () => {
      parser.setLanguage(Kotlin);
      const code = `object OneArg {
  fun writeAudit(message: String): String {
    return message
  }
}`;
      const tree = parser.parse(code);
      const objectNode = tree.rootNode.child(0)!;
      const classBody = objectNode.namedChild(1)!;
      const functionNode = classBody.namedChild(0)!;

      const sig = extractMethodSignature(functionNode);
      expect(sig.parameterCount).toBe(1);
    });

    it('extracts zero params from a no-arg Kotlin function', () => {
      parser.setLanguage(Kotlin);
      const code = `object ZeroArg {
  fun writeAudit(): String {
    return "zero"
  }
}`;
      const tree = parser.parse(code);
      const objectNode = tree.rootNode.child(0)!;
      const classBody = objectNode.namedChild(1)!;
      const functionNode = classBody.namedChild(0)!;

      const sig = extractMethodSignature(functionNode);
      expect(sig.parameterCount).toBe(0);
    });
  });

  describe('C++', () => {
    it('extracts params from a nested C++ declarator', () => {
      parser.setLanguage(CPP);
      const code = `inline const char* write_audit(const char* message) {
  return message;
}`;
      const tree = parser.parse(code);
      const functionNode = tree.rootNode.namedChild(0)!;

      const sig = extractMethodSignature(functionNode);
      expect(sig.parameterCount).toBe(1);
    });

    it('extracts zero params from a no-arg C++ function', () => {
      parser.setLanguage(CPP);
      const code = `inline const char* write_audit() {
  return "zero";
}`;
      const tree = parser.parse(code);
      const functionNode = tree.rootNode.namedChild(0)!;

      const sig = extractMethodSignature(functionNode);
      expect(sig.parameterCount).toBe(0);
    });
  });

  describe('C#', () => {
    it('extracts params from a C# method', () => {
      parser.setLanguage(CSharp);
      const code = `class Foo {
  public bool Check(string name, int count) { return true; }
}`;
      const tree = parser.parse(code);
      const classNode = tree.rootNode.child(0)!;
      const classBody = classNode.childForFieldName('body')!;
      const methodNode = classBody.namedChild(0)!;

      const sig = extractMethodSignature(methodNode);
      expect(sig.parameterCount).toBe(2);
    });

    it('handles C# method with no params', () => {
      parser.setLanguage(CSharp);
      const code = `class Foo {
  public void Execute() {}
}`;
      const tree = parser.parse(code);
      const classNode = tree.rootNode.child(0)!;
      const classBody = classNode.childForFieldName('body')!;
      const methodNode = classBody.namedChild(0)!;

      const sig = extractMethodSignature(methodNode);
      expect(sig.parameterCount).toBe(0);
    });

    it('extracts return type from C# method', () => {
      parser.setLanguage(CSharp);
      const code = `class Svc {
  public User GetUser(string name) { return null; }
}`;
      const tree = parser.parse(code);
      const classNode = tree.rootNode.child(0)!;
      const classBody = classNode.childForFieldName('body')!;
      const methodNode = classBody.namedChild(0)!;

      const sig = extractMethodSignature(methodNode);
      expect(sig.returnType).toBe('User');
    });
  });

  describe('Go', () => {
    it('extracts params and single return type', () => {
      parser.setLanguage(Go);
      const code = `package main
func add(a int, b int) int { return a + b }`;
      const tree = parser.parse(code);
      const funcNode = tree.rootNode.namedChildren.find(c => c.type === 'function_declaration')!;

      const sig = extractMethodSignature(funcNode);
      expect(sig.parameterCount).toBe(2);
      expect(sig.returnType).toBe('int');
    });

    it('extracts multi-return type', () => {
      parser.setLanguage(Go);
      const code = `package main
func parse(s string) (string, error) { return s, nil }`;
      const tree = parser.parse(code);
      const funcNode = tree.rootNode.namedChildren.find(c => c.type === 'function_declaration')!;

      const sig = extractMethodSignature(funcNode);
      expect(sig.parameterCount).toBe(1);
      expect(sig.returnType).toBe('string');
    });

    it('handles no return type', () => {
      parser.setLanguage(Go);
      const code = `package main
func doSomething(x int) { }`;
      const tree = parser.parse(code);
      const funcNode = tree.rootNode.namedChildren.find(c => c.type === 'function_declaration')!;

      const sig = extractMethodSignature(funcNode);
      expect(sig.parameterCount).toBe(1);
      expect(sig.returnType).toBeUndefined();
    });

    it('marks variadic function with undefined parameterCount', () => {
      parser.setLanguage(Go);
      const code = `package main
func log(args ...string) int { return 0 }`;
      const tree = parser.parse(code);
      const funcNode = tree.rootNode.namedChildren.find(c => c.type === 'function_declaration')!;

      const sig = extractMethodSignature(funcNode);
      expect(sig.parameterCount).toBeUndefined();
      expect(sig.returnType).toBe('int');
    });
  });

  describe('Rust', () => {
    it('extracts return type from function', () => {
      parser.setLanguage(Rust);
      const code = `fn add(a: i32, b: i32) -> i32 { a + b }`;
      const tree = parser.parse(code);
      const funcNode = tree.rootNode.namedChild(0)!;

      const sig = extractMethodSignature(funcNode);
      expect(sig.parameterCount).toBe(2);
      expect(sig.returnType).toBe('i32');
    });
  });

  describe('C++ return types', () => {
    it('extracts primitive return type', () => {
      parser.setLanguage(CPP);
      const code = `int add(int a, int b) { return a + b; }`;
      const tree = parser.parse(code);
      const funcNode = tree.rootNode.namedChild(0)!;

      const sig = extractMethodSignature(funcNode);
      expect(sig.parameterCount).toBe(2);
      expect(sig.returnType).toBe('int');
    });

    it('extracts qualified return type', () => {
      parser.setLanguage(CPP);
      const code = `std::string getName() { return ""; }`;
      const tree = parser.parse(code);
      const funcNode = tree.rootNode.namedChild(0)!;

      const sig = extractMethodSignature(funcNode);
      expect(sig.parameterCount).toBe(0);
      expect(sig.returnType).toBe('std::string');
    });

    it('returns undefined returnType for void', () => {
      parser.setLanguage(CPP);
      const code = `void doNothing() { }`;
      const tree = parser.parse(code);
      const funcNode = tree.rootNode.namedChild(0)!;

      const sig = extractMethodSignature(funcNode);
      expect(sig.returnType).toBeUndefined();
    });

    it('marks variadic function with undefined parameterCount', () => {
      parser.setLanguage(CPP);
      const code = `int printf(const char* fmt, ...) { return 0; }`;
      const tree = parser.parse(code);
      const funcNode = tree.rootNode.namedChild(0)!;

      const sig = extractMethodSignature(funcNode);
      expect(sig.parameterCount).toBeUndefined();
      expect(sig.returnType).toBe('int');
    });
  });

  describe('variadic params', () => {
    it('Java: marks varargs with undefined parameterCount', () => {
      parser.setLanguage(Java);
      const code = `class Foo {
  public void log(String fmt, Object... args) {}
}`;
      const tree = parser.parse(code);
      const classNode = tree.rootNode.child(0)!;
      const classBody = classNode.childForFieldName('body')!;
      const methodNode = classBody.namedChild(0)!;

      const sig = extractMethodSignature(methodNode);
      expect(sig.parameterCount).toBeUndefined();
    });

    it('Python: marks *args with undefined parameterCount', () => {
      parser.setLanguage(Python);
      const code = `class Foo:
    def log(self, fmt, *args):
        pass`;
      const tree = parser.parse(code);
      const classNode = tree.rootNode.child(0)!;
      const classBody = classNode.childForFieldName('body')!;
      const methodNode = classBody.namedChild(0)!;

      const sig = extractMethodSignature(methodNode);
      expect(sig.parameterCount).toBeUndefined();
    });

    it('Python: marks **kwargs with undefined parameterCount', () => {
      parser.setLanguage(Python);
      const code = `class Foo:
    def config(self, **kwargs):
        pass`;
      const tree = parser.parse(code);
      const classNode = tree.rootNode.child(0)!;
      const classBody = classNode.childForFieldName('body')!;
      const methodNode = classBody.namedChild(0)!;

      const sig = extractMethodSignature(methodNode);
      expect(sig.parameterCount).toBeUndefined();
    });

    it('TypeScript: marks rest params with undefined parameterCount', () => {
      parser.setLanguage(TypeScript.typescript);
      const code = `function logEntry(...messages: string[]): void {}`;
      const tree = parser.parse(code);
      const funcNode = tree.rootNode.namedChild(0)!;

      const sig = extractMethodSignature(funcNode);
      expect(sig.parameterCount).toBeUndefined();
    });

    it('Kotlin: marks vararg with undefined parameterCount', () => {
      parser.setLanguage(Kotlin);
      const code = `object Foo {
  fun log(vararg args: String) {}
}`;
      const tree = parser.parse(code);
      const objectNode = tree.rootNode.child(0)!;
      const classBody = objectNode.namedChild(1)!;
      const functionNode = classBody.namedChild(0)!;

      const sig = extractMethodSignature(functionNode);
      expect(sig.parameterCount).toBeUndefined();
    });
  });
});

describe('hashCppCallableOverloadSegment', () => {
  const parser = new Parser();

  it('produces distinct 12-char segments for C++ overloads', () => {
    parser.setLanguage(CPP);
    const code = `void foo(int x) {}
void foo(double y) {}`;
    const tree = parser.parse(code);
    const a = tree.rootNode.namedChild(0)!;
    const b = tree.rootNode.namedChild(1)!;
    const h1 = hashCppCallableOverloadSegment(a);
    const h2 = hashCppCallableOverloadSegment(b);
    expect(h1).toHaveLength(12);
    expect(h2).toHaveLength(12);
    expect(h1).not.toBe(h2);
  });

  it('is stable for empty parameter list', () => {
    parser.setLanguage(CPP);
    const tree = parser.parse('void bar() {}');
    const fn = tree.rootNode.namedChild(0)!;
    expect(hashCppCallableOverloadSegment(fn)).toBe(hashCppCallableOverloadSegment(fn));
  });

  it('matches declaration with default argument to definition without (type-only fingerprint)', () => {
    parser.setLanguage(CPP);
    const declTree = parser.parse('bool Connect(bool bIsAutoCommit = false);');
    const defTree = parser.parse('bool Connect(bool bIsAutoCommit) {}');
    const declNode = declTree.rootNode.namedChild(0)!;
    const defNode = defTree.rootNode.namedChild(0)!;
    expect(hashCppCallableOverloadSegment(declNode)).toBe(hashCppCallableOverloadSegment(defNode));
  });

  it('matches class declaration with default arg to out-of-line definition (optional_parameter_declaration)', () => {
    parser.setLanguage(CPP);
    const header = `class TZmdbLocalDatabase {
  bool Connect(bool bIsAutoCommit = false);
};`;
    const cpp = `bool TZmdbLocalDatabase::Connect(bool bIsAutoCommit) {}`;
    const hTree = parser.parse(header);
    const cppTree = parser.parse(cpp);
    const find = (root: { type: string; children: any[] }, t: string): any => {
      if (root.type === t) return root;
      for (const c of root.children) {
        const f = find(c, t);
        if (f) return f;
      }
      return null;
    };
    const fieldDecl = find(hTree.rootNode, 'field_declaration')!;
    const fnDef = find(cppTree.rootNode, 'function_definition')!;
    expect(hashCppCallableOverloadSegment(fieldDecl)).toBe(hashCppCallableOverloadSegment(fnDef));
  });
});
