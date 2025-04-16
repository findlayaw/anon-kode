/**
 * Improved code parsing utilities for the ContextEngine
 * This module uses AST-based parsing for more reliable code structure analysis
 */

import * as fs from 'fs'
import * as path from 'path'
import * as parser from '@babel/parser'
import traverse from '@babel/traverse'
import * as t from '@babel/types'

/**
 * Represents a parsed code entity with structural information
 */
export interface CodeEntity {
  type: 'function' | 'class' | 'method' | 'import' | 'export' | 'variable' | 'interface' | 'type' | 'jsx' | 'react-component'
  name: string
  startLine: number
  endLine: number
  startColumn?: number
  endColumn?: number
  parentName?: string
  dependencies?: string[]
  content: string
  documentation?: string
  childEntities?: CodeEntity[]
  isExported?: boolean
}

/**
 * Represents a dependency relationship between code entities
 */
export interface DependencyInfo {
  imports: Array<{
    source: string
    specifiers: Array<{name: string, alias?: string}>
    isDefault?: boolean
    startLine: number
  }>
  exports: Array<{
    name: string
    isDefault?: boolean
    startLine: number
  }>
  importedBy?: string[]
  exportsTo?: string[]
}

/**
 * AST-based code parser to extract accurate structural information
 * 
 * @param filePath Path to the file to parse
 * @param fileContent Content of the file
 * @returns Object containing code entities and dependency information
 */
export function parseCodeWithAST(filePath: string, fileContent: string): {
  entities: CodeEntity[],
  dependencies: DependencyInfo
} {
  // Initialize return structures
  const entities: CodeEntity[] = []
  const dependencies: DependencyInfo = {
    imports: [],
    exports: []
  }

  // Define file extension and determine parser plugins
  const extension = path.extname(filePath).toLowerCase()
  const isTypeScript = extension === '.ts' || extension === '.tsx'
  const isJSX = extension === '.jsx' || extension === '.tsx'
  const isReact = isJSX || fileContent.includes('import React') || fileContent.includes('from "react"') || fileContent.includes("from 'react'")

  // Configure parser plugins based on file type
  const plugins: parser.ParserPlugin[] = [
    'jsx',
    'classProperties',
    'decorators-legacy',
    'objectRestSpread',
  ]
  
  if (isTypeScript) {
    plugins.push('typescript')
  }

  // Add additional plugins for React files
  if (isReact) {
    plugins.push('react')
  }

  // Try to parse the file with AST
  try {
    // Parse the code into an AST
    const ast = parser.parse(fileContent, {
      sourceType: 'module',
      plugins,
      locations: true,
      ranges: true,
      tokens: true,
      errorRecovery: true,
    })

    // Lines array for extracting content
    const lines = fileContent.split('\n')

    // First pass to extract imports and exports for dependency tracking
    traverse(ast, {
      ImportDeclaration(path) {
        const node = path.node
        const importSource = node.source.value

        // Skip relative imports with no file extension
        const specifiers = node.specifiers.map(specifier => {
          if (t.isImportDefaultSpecifier(specifier)) {
            return { name: specifier.local.name, isDefault: true }
          } else if (t.isImportSpecifier(specifier)) {
            return { 
              name: specifier.imported ? 
                    (specifier.imported.type === 'Identifier' ? specifier.imported.name : specifier.imported.value) 
                    : specifier.local.name,
              alias: specifier.local.name !== (specifier.imported?.type === 'Identifier' ? 
                                            specifier.imported.name : 
                                            specifier.imported?.value) ? 
                      specifier.local.name : undefined
            }
          } else if (t.isImportNamespaceSpecifier(specifier)) {
            return { name: '*', alias: specifier.local.name }
          }
          return { name: 'unknown' }
        })

        dependencies.imports.push({
          source: importSource,
          specifiers: specifiers as Array<{name: string, alias?: string}>,
          isDefault: node.specifiers.some(s => t.isImportDefaultSpecifier(s)),
          startLine: node.loc?.start.line || 0
        })
      },

      ExportNamedDeclaration(path) {
        const node = path.node
        
        // Handle named exports
        if (node.declaration) {
          // Exported declaration (function, class, variable)
          if (t.isFunctionDeclaration(node.declaration) && node.declaration.id) {
            dependencies.exports.push({
              name: node.declaration.id.name,
              isDefault: false,
              startLine: node.loc?.start.line || 0
            })
          } else if (t.isClassDeclaration(node.declaration) && node.declaration.id) {
            dependencies.exports.push({
              name: node.declaration.id.name,
              isDefault: false,
              startLine: node.loc?.start.line || 0
            })
          } else if (t.isVariableDeclaration(node.declaration)) {
            // Get all variables in the declaration
            node.declaration.declarations.forEach(declarator => {
              if (t.isIdentifier(declarator.id)) {
                dependencies.exports.push({
                  name: declarator.id.name,
                  isDefault: false,
                  startLine: node.loc?.start.line || 0
                })
              }
            })
          } else if (t.isTSInterfaceDeclaration(node.declaration) && node.declaration.id) {
            dependencies.exports.push({
              name: node.declaration.id.name,
              isDefault: false,
              startLine: node.loc?.start.line || 0
            })
          } else if (t.isTSTypeAliasDeclaration(node.declaration) && node.declaration.id) {
            dependencies.exports.push({
              name: node.declaration.id.name,
              isDefault: false,
              startLine: node.loc?.start.line || 0
            })
          }
        }
        
        // Export specifiers (export { x, y })
        if (node.specifiers && node.specifiers.length > 0) {
          node.specifiers.forEach(specifier => {
            if (t.isExportSpecifier(specifier) && t.isIdentifier(specifier.exported)) {
              dependencies.exports.push({
                name: specifier.exported.name,
                isDefault: false,
                startLine: node.loc?.start.line || 0
              })
            }
          })
        }
      },

      ExportDefaultDeclaration(path) {
        const node = path.node
        let name = 'default'

        // If the default export is a named declaration, get its name
        if (t.isFunctionDeclaration(node.declaration) && node.declaration.id) {
          name = node.declaration.id.name
        } else if (t.isClassDeclaration(node.declaration) && node.declaration.id) {
          name = node.declaration.id.name
        } else if (t.isIdentifier(node.declaration)) {
          name = node.declaration.name
        }

        dependencies.exports.push({
          name: name,
          isDefault: true,
          startLine: node.loc?.start.line || 0
        })
      }
    })

    // Function to extract comments/documentation
    const getDocumentation = (path: any): string | undefined => {
      const comments = path.node.leadingComments
      if (comments && comments.length > 0) {
        return comments.map((comment: any) => comment.value).join('\n')
      }
      return undefined
    }

    // Second pass to extract code entities
    traverse(ast, {
      // Class declarations
      ClassDeclaration(path) {
        const node = path.node
        if (!node.id) return

        const className = node.id.name
        const startLine = node.loc?.start.line || 0
        const endLine = node.loc?.end.line || 0
        const isExported = path.parent.type === 'ExportNamedDeclaration' || 
                          path.parent.type === 'ExportDefaultDeclaration'
        
        // Extract the class content
        const classContent = lines.slice(startLine - 1, endLine).join('\n')

        // Detect if this is a React component
        const isReactComponent = node.superClass && 
                                (t.isIdentifier(node.superClass) && 
                                (node.superClass.name === 'Component' || 
                                 node.superClass.name === 'PureComponent' || 
                                 node.superClass.name === 'React.Component' || 
                                 node.superClass.name === 'React.PureComponent'))

        // Create class entity
        const classEntity: CodeEntity = {
          type: isReactComponent ? 'react-component' : 'class',
          name: className,
          startLine,
          endLine,
          content: classContent,
          dependencies: [],
          childEntities: [],
          documentation: getDocumentation(path),
          isExported
        }

        // Get superclass if extends something
        if (node.superClass) {
          if (t.isIdentifier(node.superClass)) {
            classEntity.dependencies = [node.superClass.name]
          }
        }

        // Add the class entity
        entities.push(classEntity)
      },

      // Class methods
      ClassMethod(path) {
        const node = path.node
        if (!t.isIdentifier(node.key)) return
        
        const methodName = node.key.name
        const startLine = node.loc?.start.line || 0
        const endLine = node.loc?.end.line || 0
        
        // Find parent class
        let parentName
        let parentPath = path.findParent(p => p.isClassDeclaration())
        if (parentPath && t.isClassDeclaration(parentPath.node) && parentPath.node.id) {
          parentName = parentPath.node.id.name
        }

        // Extract method content
        const methodContent = lines.slice(startLine - 1, endLine).join('\n')

        // Add method entity
        const methodEntity: CodeEntity = {
          type: 'method',
          name: methodName,
          startLine,
          endLine,
          parentName,
          content: methodContent,
          dependencies: [],
          documentation: getDocumentation(path)
        }

        // Add method to parent class's children if parent exists
        if (parentName) {
          const parentEntity = entities.find(e => e.type === 'class' && e.name === parentName)
          if (parentEntity && parentEntity.childEntities) {
            parentEntity.childEntities.push(methodEntity)
          }
        } else {
          entities.push(methodEntity)
        }
      },

      // Function declarations
      FunctionDeclaration(path) {
        const node = path.node
        if (!node.id) return
        
        const functionName = node.id.name
        const startLine = node.loc?.start.line || 0
        const endLine = node.loc?.end.line || 0
        const isExported = path.parent.type === 'ExportNamedDeclaration' || 
                          path.parent.type === 'ExportDefaultDeclaration'
        
        // Extract function content
        const functionContent = lines.slice(startLine - 1, endLine).join('\n')

        // Check if this is a React component (function returning JSX)
        const isReactComponent = isReact && 
                              (functionName.match(/^[A-Z]/) !== null) && // Component names start with uppercase
                              hasJSXReturn(node)

        // Add function entity
        entities.push({
          type: isReactComponent ? 'react-component' : 'function',
          name: functionName,
          startLine,
          endLine,
          content: functionContent,
          dependencies: [],
          documentation: getDocumentation(path),
          isExported
        })
      },

      // Variable declarations that might be functions or components
      VariableDeclarator(path) {
        const node = path.node
        if (!t.isIdentifier(node.id)) return
        
        const varName = node.id.name
        const isExported = path.findParent(p => 
                          p.isExportNamedDeclaration() || 
                          p.isExportDefaultDeclaration()) !== null
                        
        // Skip if no initialization
        if (!node.init) return

        // Determine variable type and content
        let entityType: CodeEntity['type'] = 'variable'
        
        // Check for arrow functions
        if (t.isArrowFunctionExpression(node.init) || t.isFunctionExpression(node.init)) {
          entityType = 'function'
          
          // Check if this is a React component (returns JSX or starts with capital letter)
          if (isReact && 
              ((varName.match(/^[A-Z]/) !== null) || // Component names start with uppercase 
              (hasJSXReturn(node.init)))) { 
            entityType = 'react-component'
          }
        }
        
        // Capture the declaration statement for context
        const declarationPath = path.findParent(p => p.isVariableDeclaration())
        if (!declarationPath || !declarationPath.node.loc) return
        
        const startLine = declarationPath.node.loc.start.line
        const endLine = declarationPath.node.loc.end.line
        
        // Extract variable content
        const variableContent = lines.slice(startLine - 1, endLine).join('\n')
        
        // Add variable entity
        entities.push({
          type: entityType,
          name: varName,
          startLine,
          endLine,
          content: variableContent,
          dependencies: [],
          documentation: getDocumentation(declarationPath),
          isExported
        })
      },

      // TypeScript interfaces
      TSInterfaceDeclaration(path) {
        const node = path.node
        
        const interfaceName = node.id.name
        const startLine = node.loc?.start.line || 0
        const endLine = node.loc?.end.line || 0
        const isExported = path.parent.type === 'ExportNamedDeclaration' || 
                          path.parent.type === 'ExportDefaultDeclaration'
        
        // Extract interface content
        const interfaceContent = lines.slice(startLine - 1, endLine).join('\n')
        
        // Get extended interfaces
        const extendedInterfaces: string[] = []
        if (node.extends) {
          node.extends.forEach(extension => {
            if (t.isTSExpressionWithTypeArguments(extension) && 
                t.isIdentifier(extension.expression)) {
              extendedInterfaces.push(extension.expression.name)
            }
          })
        }

        // Extract interface properties and their types
        const interfaceProperties: Array<{name: string, type: string}> = []
        if (node.body && node.body.body) {
          node.body.body.forEach(member => {
            if (t.isTSPropertySignature(member) && member.key) {
              let propName = '';
              
              // Handle different key types
              if (t.isIdentifier(member.key)) {
                propName = member.key.name;
              } else if (t.isStringLiteral(member.key)) {
                propName = member.key.value;
              }
              
              // Skip if we couldn't get a name
              if (!propName) return;
              
              // Get the type as string
              let typeStr = 'any';
              if (member.typeAnnotation && member.typeAnnotation.typeAnnotation) {
                // Extract the line content for the type
                const typeLine = lines[member.typeAnnotation.loc.start.line - 1];
                const typeStart = member.typeAnnotation.loc.start.column;
                const typeEnd = member.typeAnnotation.loc.end.column;
                
                try {
                  // Try to extract the type string from the line
                  typeStr = typeLine.substring(typeStart, typeEnd).replace(/^:\s*/, '');
                } catch (e) {
                  // Fallback for any parsing issues
                  typeStr = 'unknown';
                }
              }
              
              // Add the property
              interfaceProperties.push({
                name: propName,
                type: typeStr
              });
            }
          });
        }
        
        // Add interface entity with enhanced metadata
        entities.push({
          type: 'interface',
          name: interfaceName,
          startLine,
          endLine,
          content: interfaceContent,
          dependencies: extendedInterfaces,
          documentation: getDocumentation(path),
          isExported,
          childEntities: interfaceProperties.map(prop => ({
            type: 'property',
            name: prop.name,
            startLine: 0, // We don't track individual property lines
            endLine: 0,
            content: `${prop.name}: ${prop.type}`,
            parentName: interfaceName
          }))
        })
      },

      // TypeScript type aliases
      TSTypeAliasDeclaration(path) {
        const node = path.node
        
        const typeName = node.id.name
        const startLine = node.loc?.start.line || 0
        const endLine = node.loc?.end.line || 0
        const isExported = path.parent.type === 'ExportNamedDeclaration' || 
                          path.parent.type === 'ExportDefaultDeclaration'
        
        // Extract type content
        const typeContent = lines.slice(startLine - 1, endLine).join('\n')
        
        // Extract dependent types from the type annotation
        const dependencies: string[] = []
        
        // Analyze the type to find relationships
        const extractTypeDependencies = (typeNode: any) => {
          if (!typeNode) return;
          
          // References to other types via identifiers
          if (t.isTSTypeReference(typeNode) && t.isIdentifier(typeNode.typeName)) {
            dependencies.push(typeNode.typeName.name);
          }
          
          // Union types
          if (t.isTSUnionType(typeNode) && typeNode.types) {
            typeNode.types.forEach((unionType: any) => extractTypeDependencies(unionType));
          }
          
          // Intersection types
          if (t.isTSIntersectionType(typeNode) && typeNode.types) {
            typeNode.types.forEach((intersectionType: any) => extractTypeDependencies(intersectionType));
          }
          
          // Array types
          if (t.isTSArrayType(typeNode) && typeNode.elementType) {
            extractTypeDependencies(typeNode.elementType);
          }
          
          // Tuple types
          if (t.isTSTupleType(typeNode) && typeNode.elementTypes) {
            typeNode.elementTypes.forEach((elementType: any) => extractTypeDependencies(elementType));
          }
        };
        
        // Extract dependencies from the type definition
        if (node.typeAnnotation) {
          extractTypeDependencies(node.typeAnnotation);
        }
        
        // For object types, extract property structure
        const typeProperties: Array<{name: string, type: string}> = []
        
        // Try to extract properties from object type definitions
        if (t.isTSTypeLiteral(node.typeAnnotation)) {
          node.typeAnnotation.members.forEach((member: any) => {
            if (t.isTSPropertySignature(member) && member.key) {
              let propName = '';
              
              // Handle different key types
              if (t.isIdentifier(member.key)) {
                propName = member.key.name;
              } else if (t.isStringLiteral(member.key)) {
                propName = member.key.value;
              }
              
              if (propName && member.typeAnnotation) {
                // Get the line for this property
                const typeLine = lines[member.loc.start.line - 1];
                const typeStr = typeLine.substring(
                  member.typeAnnotation.loc.start.column,
                  member.typeAnnotation.loc.end.column
                ).replace(/^:\s*/, '');
                
                typeProperties.push({
                  name: propName,
                  type: typeStr
                });
              }
            }
          });
        }
        
        // Add type entity with enhanced dependency information
        entities.push({
          type: 'type',
          name: typeName,
          startLine,
          endLine,
          content: typeContent,
          dependencies: [...new Set(dependencies)], // Deduplicate
          documentation: getDocumentation(path),
          isExported,
          childEntities: typeProperties.length > 0 ? typeProperties.map(prop => ({
            type: 'property',
            name: prop.name,
            startLine: 0,
            endLine: 0,
            content: `${prop.name}: ${prop.type}`,
            parentName: typeName
          })) : undefined
        })
      }
    })

    return { entities, dependencies }
  } catch (error) {
    console.error(`AST parsing failed for ${filePath}. Falling back to regex parsing:`, error)
    
    // Fall back to regex-based parsing if AST parsing fails
    const { parseCodeStructure, getDependencyInfo } = require('./codeParser')
    const regexEntities = parseCodeStructure(filePath, fileContent)
    const regexDependencies = getDependencyInfo(filePath, fileContent)
    
    return {
      entities: regexEntities,
      dependencies: {
        imports: regexDependencies.imports.map(imp => ({
          source: imp,
          specifiers: [{name: '*'}],
          startLine: 0
        })),
        exports: regexDependencies.exports.map(exp => ({
          name: exp,
          startLine: 0
        }))
      }
    }
  }
}

/**
 * Helper function to check if a function or arrow function returns JSX
 */
function hasJSXReturn(node: any): boolean {
  let hasJSX = false
  
  // Function for traversing a node to find JSX
  const findJSX = (node: any) => {
    if (!node) return
    
    // Check if this node is a JSX element
    if (t.isJSXElement(node) || t.isJSXFragment(node)) {
      hasJSX = true
      return
    }
    
    // Check return statements in function bodies
    if (t.isBlockStatement(node)) {
      for (const statement of node.body) {
        if (t.isReturnStatement(statement) && statement.argument) {
          findJSX(statement.argument)
        }
      }
    }
    
    // For arrow functions with expression bodies (not block statements)
    if (t.isArrowFunctionExpression(node) && !t.isBlockStatement(node.body)) {
      findJSX(node.body)
    }
  }
  
  // Check the function body
  if (t.isFunctionDeclaration(node) || t.isFunctionExpression(node)) {
    findJSX(node.body)
  } else if (t.isArrowFunctionExpression(node)) {
    findJSX(node.body)
  }
  
  return hasJSX
}

/**
 * Extract code chunks based on logical structure using AST parsing
 * 
 * @param filePath Path to the file
 * @param fileContent Content of the file
 * @returns Object with code chunks and entities
 */
export function extractCodeChunksWithAST(filePath: string, fileContent: string): { 
  chunks: Array<{
    content: string,
    startLine: number,
    endLine: number,
    type: string,
    name: string,
    metadata: Record<string, any>
  }>, 
  entities: CodeEntity[],
  dependencies: DependencyInfo
} {
  // Parse the code with AST
  const { entities, dependencies } = parseCodeWithAST(filePath, fileContent)
  
  // Create chunks from entities
  const chunks = entities.map(entity => ({
    content: entity.content,
    startLine: entity.startLine,
    endLine: entity.endLine,
    type: entity.type,
    name: entity.name,
    metadata: {
      parentName: entity.parentName,
      dependencies: entity.dependencies,
      documentation: entity.documentation,
      isExported: entity.isExported
    }
  }))
  
  // Extract import section as a separate chunk
  if (dependencies.imports.length > 0) {
    // Sort imports by startLine to find the import section
    const sortedImports = [...dependencies.imports].sort((a, b) => a.startLine - b.startLine)
    const firstImportLine = sortedImports[0].startLine
    const lastImportLine = sortedImports[sortedImports.length - 1].startLine
    
    // Find the end of the import section (might be more than one line per import)
    const lines = fileContent.split('\n')
    let endLine = lastImportLine
    while (endLine < lines.length && 
          (lines[endLine].trim().startsWith('import ') || lines[endLine].trim() === '')) {
      endLine++
    }
    
    // Create the import chunk
    const importContent = lines.slice(firstImportLine - 1, endLine).join('\n')
    chunks.push({
      content: importContent,
      startLine: firstImportLine,
      endLine: endLine,
      type: 'imports',
      name: 'imports',
      metadata: {
        sources: dependencies.imports.map(imp => imp.source)
      }
    })
  }
  
  // If no entities or chunks were found, use the whole file as a chunk
  if (chunks.length === 0) {
    const lines = fileContent.split('\n')
    chunks.push({
      content: fileContent,
      startLine: 1,
      endLine: lines.length,
      type: 'file',
      name: path.basename(filePath),
      metadata: {
        language: getLanguageFromFilePath(filePath)
      }
    })
  }
  
  return { chunks, entities, dependencies }
}

/**
 * Get detailed dependency information for a file using AST parsing
 * 
 * @param filePath Path to the file
 * @param fileContent Content of the file
 * @returns Detailed dependency information
 */
export function getDependencyInfoWithAST(filePath: string, fileContent: string): DependencyInfo {
  const { dependencies } = parseCodeWithAST(filePath, fileContent)
  return dependencies
}

/**
 * Get the programming language from a file path
 */
function getLanguageFromFilePath(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase()
  
  switch (ext) {
    case '.js':
      return 'javascript'
    case '.jsx':
      return 'jsx'
    case '.ts':
      return 'typescript'
    case '.tsx':
      return 'tsx'
    case '.py':
      return 'python'
    case '.rb':
      return 'ruby'
    case '.java':
      return 'java'
    case '.go':
      return 'go'
    case '.php':
      return 'php'
    case '.c':
    case '.cpp':
    case '.cc':
      return 'cpp'
    case '.cs':
      return 'csharp'
    case '.html':
      return 'html'
    case '.css':
      return 'css'
    case '.md':
      return 'markdown'
    case '.json':
      return 'json'
    case '.yml':
    case '.yaml':
      return 'yaml'
    default:
      return 'text'
  }
}