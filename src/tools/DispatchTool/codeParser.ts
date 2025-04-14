/**
 * Code parsing utilities for the CodeContextTool
 * This module provides functions to parse code and extract structural information
 */

import * as fs from 'fs'
import * as path from 'path'

/**
 * Represents a parsed code entity with structural information
 */
export interface CodeEntity {
  type: 'function' | 'class' | 'method' | 'import' | 'export' | 'variable' | 'interface' | 'type'
  name: string
  startLine: number
  endLine: number
  parentName?: string
  dependencies?: string[]
  content: string
}

/**
 * Simple regex-based code parser to extract structural information
 * This is a basic implementation that can be enhanced with a proper AST parser in the future
 * 
 * @param filePath Path to the file to parse
 * @param fileContent Content of the file
 * @returns Array of code entities
 */
export function parseCodeStructure(filePath: string, fileContent: string): CodeEntity[] {
  const entities: CodeEntity[] = []
  const extension = path.extname(filePath).toLowerCase()
  const lines = fileContent.split('\n')
  
  // Track imports for dependency information
  const imports: string[] = []
  
  // Simple regex patterns for different code structures
  // These are basic and can be improved with proper AST parsing
  const patterns = {
    import: /import\s+(?:{[^}]*}|\*\s+as\s+\w+|\w+)\s+from\s+['"]([^'"]+)['"]/g,
    export: /export\s+(?:default\s+)?(?:const|let|var|function|class|interface|type|enum)\s+(\w+)/g,
    function: /(?:export\s+)?(?:async\s+)?function\s+(\w+)/g,
    arrowFunction: /(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s*)?\([^)]*\)\s*=>/g,
    class: /(?:export\s+)?class\s+(\w+)(?:\s+extends\s+(\w+))?/g,
    method: /(?:async\s+)?(\w+)\s*\([^)]*\)\s*{/g,
    interface: /(?:export\s+)?interface\s+(\w+)/g,
    type: /(?:export\s+)?type\s+(\w+)/g,
    variable: /(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=/g,
  }
  
  // Extract imports for dependency tracking
  let match
  const importRegex = new RegExp(patterns.import)
  while ((match = importRegex.exec(fileContent)) !== null) {
    if (match[1]) {
      imports.push(match[1])
    }
  }
  
  // Process each line to find code entities
  let currentClass: string | undefined
  let currentEntity: Partial<CodeEntity> | undefined
  let bracketCount = 0
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    
    // Check for class definitions
    const classMatch = new RegExp(patterns.class).exec(line)
    if (classMatch) {
      if (currentEntity) {
        currentEntity.endLine = i - 1
        entities.push(currentEntity as CodeEntity)
      }
      
      currentClass = classMatch[1]
      currentEntity = {
        type: 'class',
        name: classMatch[1],
        startLine: i + 1,
        dependencies: classMatch[2] ? [classMatch[2]] : [],
        content: line
      }
      bracketCount = countBrackets(line)
      continue
    }
    
    // Check for function definitions
    const functionMatch = new RegExp(patterns.function).exec(line)
    if (functionMatch && !currentEntity) {
      currentEntity = {
        type: 'function',
        name: functionMatch[1],
        startLine: i + 1,
        parentName: currentClass,
        dependencies: [],
        content: line
      }
      bracketCount = countBrackets(line)
      continue
    }
    
    // Check for arrow functions
    const arrowMatch = new RegExp(patterns.arrowFunction).exec(line)
    if (arrowMatch && !currentEntity) {
      currentEntity = {
        type: 'function',
        name: arrowMatch[1],
        startLine: i + 1,
        parentName: currentClass,
        dependencies: [],
        content: line
      }
      bracketCount = countBrackets(line)
      continue
    }
    
    // Check for methods within classes
    if (currentClass && !currentEntity) {
      const methodMatch = new RegExp(patterns.method).exec(line)
      if (methodMatch) {
        currentEntity = {
          type: 'method',
          name: methodMatch[1],
          startLine: i + 1,
          parentName: currentClass,
          dependencies: [],
          content: line
        }
        bracketCount = countBrackets(line)
        continue
      }
    }
    
    // Check for interfaces
    const interfaceMatch = new RegExp(patterns.interface).exec(line)
    if (interfaceMatch && !currentEntity) {
      currentEntity = {
        type: 'interface',
        name: interfaceMatch[1],
        startLine: i + 1,
        dependencies: [],
        content: line
      }
      bracketCount = countBrackets(line)
      continue
    }
    
    // Check for type definitions
    const typeMatch = new RegExp(patterns.type).exec(line)
    if (typeMatch && !currentEntity) {
      currentEntity = {
        type: 'type',
        name: typeMatch[1],
        startLine: i + 1,
        dependencies: [],
        content: line
      }
      bracketCount = countBrackets(line)
      continue
    }
    
    // Check for variable declarations
    const varMatch = new RegExp(patterns.variable).exec(line)
    if (varMatch && !currentEntity) {
      currentEntity = {
        type: 'variable',
        name: varMatch[1],
        startLine: i + 1,
        parentName: currentClass,
        dependencies: [],
        content: line
      }
      bracketCount = countBrackets(line)
      continue
    }
    
    // If we're tracking an entity, update its content and check for end
    if (currentEntity) {
      currentEntity.content += '\n' + line
      
      // Update bracket count
      bracketCount += countBrackets(line)
      
      // If brackets are balanced and we're not in a one-liner, we've reached the end
      if (bracketCount === 0 && currentEntity.content.includes('{')) {
        currentEntity.endLine = i + 1
        entities.push(currentEntity as CodeEntity)
        currentEntity = undefined
      }
      // For one-liners or entities without brackets
      else if (bracketCount === 0 && !currentEntity.content.includes('{')) {
        currentEntity.endLine = i + 1
        entities.push(currentEntity as CodeEntity)
        currentEntity = undefined
      }
    }
  }
  
  // Add the last entity if it's still open
  if (currentEntity) {
    currentEntity.endLine = lines.length
    entities.push(currentEntity as CodeEntity)
  }
  
  // Add dependency information to all entities
  entities.forEach(entity => {
    entity.dependencies = entity.dependencies || []
    entity.dependencies.push(...imports)
  })
  
  return entities
}

/**
 * Count the net change in bracket depth for a line of code
 * 
 * @param line Line of code
 * @returns Net change in bracket depth (positive for opening, negative for closing)
 */
function countBrackets(line: string): number {
  const openCount = (line.match(/{/g) || []).length
  const closeCount = (line.match(/}/g) || []).length
  return openCount - closeCount
}

/**
 * Extract code chunks based on logical structure
 * 
 * @param filePath Path to the file
 * @param fileContent Content of the file
 * @returns Array of code chunks with structural information
 */
export function extractCodeChunks(filePath: string, fileContent: string): { 
  chunks: string[], 
  entities: CodeEntity[] 
} {
  const entities = parseCodeStructure(filePath, fileContent)
  const chunks: string[] = []
  
  // Create chunks based on entities
  entities.forEach(entity => {
    const lines = fileContent.split('\n')
    const chunk = lines.slice(entity.startLine - 1, entity.endLine).join('\n')
    chunks.push(chunk)
  })
  
  // If no entities were found, use the whole file as a chunk
  if (chunks.length === 0) {
    chunks.push(fileContent)
  }
  
  return { chunks, entities }
}

/**
 * Get dependency information for a file
 * 
 * @param filePath Path to the file
 * @param fileContent Content of the file
 * @returns Object with imports and exports
 */
export function getDependencyInfo(filePath: string, fileContent: string): {
  imports: string[],
  exports: string[]
} {
  const imports: string[] = []
  const exports: string[] = []
  
  // Extract imports
  const importRegex = /import\s+(?:{[^}]*}|\*\s+as\s+\w+|\w+)\s+from\s+['"]([^'"]+)['"]/g
  let match
  while ((match = importRegex.exec(fileContent)) !== null) {
    if (match[1]) {
      imports.push(match[1])
    }
  }
  
  // Extract exports
  const exportRegex = /export\s+(?:default\s+)?(?:const|let|var|function|class|interface|type|enum)\s+(\w+)/g
  while ((match = exportRegex.exec(fileContent)) !== null) {
    if (match[1]) {
      exports.push(match[1])
    }
  }
  
  return { imports, exports }
}
