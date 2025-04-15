/**
 * Dependency graph generation for the CodeContextTool
 * This module provides functions to analyze and visualize code dependencies and relationships
 */

import * as path from 'path'
import * as fs from 'fs'
import { CodeEntity } from './codeParser'

/**
 * Represents a node in the dependency graph
 */
export interface DependencyNode {
  id: string
  type: string
  name: string
  filePath: string
  dependencies: string[]
  children?: DependencyNode[]
}

/**
 * Represents a relationship between components
 */
export interface ComponentRelationship {
  source: string
  target: string
  type: 'import' | 'extends' | 'implements' | 'uses' | 'renders' | 'parent-child'
  sourceFile: string
  targetFile: string
}

/**
 * Build a dependency graph for a set of files
 * 
 * @param filePaths Array of file paths to analyze
 * @returns Object containing nodes and relationships
 */
export function buildDependencyGraph(filePaths: string[]): {
  nodes: DependencyNode[],
  relationships: ComponentRelationship[]
} {
  const nodes: DependencyNode[] = []
  const relationships: ComponentRelationship[] = []
  const processedFiles = new Set<string>()
  
  // Process each file
  for (const filePath of filePaths) {
    if (processedFiles.has(filePath)) continue
    processedFiles.add(filePath)
    
    try {
      // Read file content
      const fileContent = fs.readFileSync(filePath, 'utf-8')
      
      // Extract imports
      const imports = extractImports(fileContent)
      
      // Extract exports
      const exports = extractExports(fileContent)
      
      // Create nodes for each export
      for (const exportItem of exports) {
        const node: DependencyNode = {
          id: `${path.basename(filePath)}:${exportItem}`,
          type: detectNodeType(exportItem, fileContent),
          name: exportItem,
          filePath,
          dependencies: []
        }
        
        nodes.push(node)
      }
      
      // Create relationships based on imports
      for (const importItem of imports) {
        // Try to resolve the import path to an actual file
        const importedFilePath = resolveImportPath(importItem.path, filePath)
        
        if (importedFilePath && fs.existsSync(importedFilePath)) {
          // Add the imported file to the processing queue if it's not already processed
          if (!processedFiles.has(importedFilePath)) {
            filePaths.push(importedFilePath)
          }
          
          // Create relationships for each imported item
          for (const item of importItem.items) {
            relationships.push({
              source: `${path.basename(filePath)}:${item}`,
              target: `${path.basename(importedFilePath)}:${item}`,
              type: 'import',
              sourceFile: filePath,
              targetFile: importedFilePath
            })
          }
        }
      }
      
      // Detect React component relationships
      if (isReactComponent(fileContent)) {
        const componentRelationships = detectReactRelationships(fileContent, filePath)
        relationships.push(...componentRelationships)
      }
    } catch (error) {
      console.error(`Error processing file ${filePath}:`, error)
    }
  }
  
  return { nodes, relationships }
}

/**
 * Extract imports from file content
 */
function extractImports(fileContent: string): { path: string, items: string[] }[] {
  const imports: { path: string, items: string[] }[] = []
  
  // Match import statements
  const importRegex = /import\s+(?:{([^}]*)}\s+from\s+['"]([^'"]+)['"]|(\w+)\s+from\s+['"]([^'"]+)['"]|[*]\s+as\s+(\w+)\s+from\s+['"]([^'"]+)['"])/g
  
  let match
  while ((match = importRegex.exec(fileContent)) !== null) {
    if (match[1] && match[2]) {
      // Named imports: import { a, b } from 'module'
      const items = match[1].split(',').map(item => item.trim().split(' as ')[0].trim())
      imports.push({ path: match[2], items })
    } else if (match[3] && match[4]) {
      // Default import: import Name from 'module'
      imports.push({ path: match[4], items: [match[3]] })
    } else if (match[5] && match[6]) {
      // Namespace import: import * as Name from 'module'
      imports.push({ path: match[6], items: [match[5]] })
    }
  }
  
  return imports
}

/**
 * Extract exports from file content
 */
function extractExports(fileContent: string): string[] {
  const exports: string[] = []
  
  // Match export statements
  const exportRegex = /export\s+(?:default\s+)?(?:const|let|var|function|class|interface|type|enum)\s+(\w+)/g
  
  let match
  while ((match = exportRegex.exec(fileContent)) !== null) {
    if (match[1]) {
      exports.push(match[1])
    }
  }
  
  // Match default exports that reference an existing variable
  const defaultExportRegex = /export\s+default\s+(\w+)/g
  while ((match = defaultExportRegex.exec(fileContent)) !== null) {
    if (match[1] && !exports.includes(match[1])) {
      exports.push(match[1])
    }
  }
  
  return exports
}

/**
 * Detect the type of a node based on its name and file content
 */
function detectNodeType(name: string, fileContent: string): string {
  // Check for React component naming convention
  if (/^[A-Z][a-zA-Z0-9]*$/.test(name)) {
    // Look for JSX in the file
    if (fileContent.includes('return (') && (fileContent.includes('<') && fileContent.includes('>'))) {
      return 'component'
    }
    // Look for class definition
    if (fileContent.includes(`class ${name}`)) {
      return 'class'
    }
  }
  
  // Check for hook naming convention
  if (name.startsWith('use') && /^use[A-Z]/.test(name)) {
    return 'hook'
  }
  
  // Check for service naming convention
  if (name.endsWith('Service')) {
    return 'service'
  }
  
  // Check for utility naming convention
  if (name.endsWith('Util') || name.endsWith('Utils') || name.endsWith('Helper')) {
    return 'utility'
  }
  
  // Default to function if it looks like a function
  if (fileContent.includes(`function ${name}`) || fileContent.includes(`const ${name} = (`)) {
    return 'function'
  }
  
  return 'unknown'
}

/**
 * Resolve an import path to an actual file path
 */
function resolveImportPath(importPath: string, currentFilePath: string): string | null {
  // Handle relative imports
  if (importPath.startsWith('.')) {
    const basePath = path.dirname(currentFilePath)
    const resolvedPath = path.resolve(basePath, importPath)
    
    // Try with different extensions
    const extensions = ['.ts', '.tsx', '.js', '.jsx']
    
    // Check if the path exists as is
    if (fs.existsSync(resolvedPath)) {
      return resolvedPath
    }
    
    // Try with different extensions
    for (const ext of extensions) {
      const pathWithExt = `${resolvedPath}${ext}`
      if (fs.existsSync(pathWithExt)) {
        return pathWithExt
      }
    }
    
    // Try with /index.* files
    for (const ext of extensions) {
      const indexPath = path.join(resolvedPath, `index${ext}`)
      if (fs.existsSync(indexPath)) {
        return indexPath
      }
    }
  }
  
  // For non-relative imports, we would need a module resolution system
  // This is a simplified version that doesn't handle node_modules
  return null
}

/**
 * Check if a file contains a React component
 */
function isReactComponent(fileContent: string): boolean {
  // Look for React import
  if (fileContent.includes("import React") || fileContent.includes("from 'react'") || fileContent.includes('from "react"')) {
    // Look for component patterns
    return (
      // Function components
      fileContent.includes('return (') && fileContent.includes('<') && fileContent.includes('>') ||
      // Class components
      fileContent.includes('extends React.Component') || fileContent.includes('extends Component')
    )
  }
  return false
}

/**
 * Detect relationships between React components
 */
function detectReactRelationships(fileContent: string, filePath: string): ComponentRelationship[] {
  const relationships: ComponentRelationship[] = []
  
  // Extract component name from file path
  const componentName = path.basename(filePath, path.extname(filePath))
  
  // Look for components used in JSX (simplified approach)
  const jsxComponentRegex = /<([A-Z][a-zA-Z0-9]*)/g
  
  let match
  while ((match = jsxComponentRegex.exec(fileContent)) !== null) {
    if (match[1] && match[1] !== componentName) {
      relationships.push({
        source: `${path.basename(filePath)}:${componentName}`,
        target: `unknown:${match[1]}`,
        type: 'renders',
        sourceFile: filePath,
        targetFile: 'unknown' // We don't know the file without more analysis
      })
    }
  }
  
  // Look for parent-child relationships in class components
  if (fileContent.includes(`class ${componentName} extends`)) {
    const extendsMatch = fileContent.match(new RegExp(`class ${componentName} extends (\\w+)`))
    if (extendsMatch && extendsMatch[1]) {
      relationships.push({
        source: `${path.basename(filePath)}:${componentName}`,
        target: `unknown:${extendsMatch[1]}`,
        type: 'extends',
        sourceFile: filePath,
        targetFile: 'unknown'
      })
    }
  }
  
  return relationships
}

/**
 * Generate a visual representation of component relationships
 * 
 * @param relationships Array of component relationships
 * @returns Formatted string representation of the relationships
 */
export function visualizeComponentRelationships(relationships: ComponentRelationship[]): string {
  let visualization = '# Component Relationships\n\n'
  
  // Group relationships by type
  const groupedRelationships: Record<string, ComponentRelationship[]> = {}
  
  relationships.forEach(rel => {
    if (!groupedRelationships[rel.type]) {
      groupedRelationships[rel.type] = []
    }
    groupedRelationships[rel.type].push(rel)
  })
  
  // Generate visualization for each type
  for (const [type, rels] of Object.entries(groupedRelationships)) {
    visualization += `## ${type.charAt(0).toUpperCase() + type.slice(1)} Relationships\n\n`
    
    // Create a simple text-based visualization
    rels.forEach(rel => {
      const sourceName = rel.source.split(':')[1]
      const targetName = rel.target.split(':')[1]
      
      switch (type) {
        case 'import':
          visualization += `- \`${sourceName}\` imports \`${targetName}\`\n`
          break
        case 'extends':
          visualization += `- \`${sourceName}\` extends \`${targetName}\`\n`
          break
        case 'implements':
          visualization += `- \`${sourceName}\` implements \`${targetName}\`\n`
          break
        case 'uses':
          visualization += `- \`${sourceName}\` uses \`${targetName}\`\n`
          break
        case 'renders':
          visualization += `- \`${sourceName}\` renders \`${targetName}\`\n`
          break
        case 'parent-child':
          visualization += `- \`${sourceName}\` is a parent of \`${targetName}\`\n`
          break
      }
    })
    
    visualization += '\n'
  }
  
  return visualization
}

/**
 * Generate a component hierarchy visualization
 * 
 * @param relationships Array of component relationships
 * @returns Formatted string representation of the component hierarchy
 */
export function visualizeComponentHierarchy(relationships: ComponentRelationship[]): string {
  // Extract render relationships to build the hierarchy
  const renderRelationships = relationships.filter(rel => rel.type === 'renders')
  
  // Build a map of parent to children
  const hierarchy: Record<string, string[]> = {}
  
  renderRelationships.forEach(rel => {
    const parent = rel.source.split(':')[1]
    const child = rel.target.split(':')[1]
    
    if (!hierarchy[parent]) {
      hierarchy[parent] = []
    }
    
    if (!hierarchy[parent].includes(child)) {
      hierarchy[parent].push(child)
    }
  })
  
  // Find root components (those that are not children of any other component)
  const allChildren = new Set(Object.values(hierarchy).flat())
  const rootComponents = Object.keys(hierarchy).filter(component => !allChildren.has(component))
  
  // Generate the hierarchy visualization
  let visualization = '# Component Hierarchy\n\n'
  
  // Recursive function to build the hierarchy tree
  function buildHierarchyTree(component: string, depth: number): string {
    const indent = '  '.repeat(depth)
    let result = `${indent}- ${component}\n`
    
    if (hierarchy[component]) {
      for (const child of hierarchy[component]) {
        result += buildHierarchyTree(child, depth + 1)
      }
    }
    
    return result
  }
  
  // Build the tree starting from each root component
  for (const root of rootComponents) {
    visualization += buildHierarchyTree(root, 0)
  }
  
  return visualization
}
