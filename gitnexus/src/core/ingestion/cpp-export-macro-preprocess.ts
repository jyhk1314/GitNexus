/**
 * Preprocess C++ source to strip export macros before class/struct declarations.
 * tree-sitter-cpp cannot expand macros, so "class DLL_API MyClass" is misparsed.
 * Replacing the macro with nothing allows correct class_specifier parsing.
 */

/** Default export macros to strip when they appear between class/struct and the type name */
export const DEFAULT_CPP_EXPORT_MACROS = [
  'DLL_API',
  'DLL_SQLPARSE_API',
  'DLLEXPORT',
  'DLL_INTERFACE_API',
] as const;

/**
 * Strip known export macros from C++ source when they appear between
 * class/struct keyword and the type name. Enables tree-sitter to parse
 * "class DLL_API MyClass" as a class_specifier.
 *
 * @param content - Raw file content
 * @param macros - Macro names to strip (default: DEFAULT_CPP_EXPORT_MACROS)
 * @returns Preprocessed content safe for tree-sitter parsing
 */
export function preprocessCppExportMacros(
  content: string,
  macros: readonly string[] = DEFAULT_CPP_EXPORT_MACROS,
): string {
  if (macros.length === 0) return content;
  const escaped = macros.map((m) => m.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  const re = new RegExp(`\\b(class|struct)\\s+(${escaped})\\s+`, 'g');
  return content.replace(re, '$1 ');
}
