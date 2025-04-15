/**
 * Improved code chunking utilities for the CodeContextTool
 * This module provides advanced functions to split code into logical chunks for better context retrieval
 */

import * as path from 'path'
import { CodeEntity, DependencyInfo, extractCodeChunksWithAST } from './improvedParser'

/**
 * Represents a code chunk with enhanced metadata
 */
export interface EnhancedCodeChunk {
  content: string
  startLine: number
  endLine: number
  type: string
  name: string
  filePath: string
  metadata: {
    language: string
    parentName?: string
    dependencies?: string[]
    documentation?: string
    isExported?: boolean
    relationshipContext?: {
      imports?: string[]
      exports?: string[]
      importedBy?: string[]
      exportsTo?: string[]
      relatedComponents?: string[]
    }
    typeDefinition?: {
      properties?: Array<{name: string, type: string}>
      methods?: Array<{name: string, parameters: string[]}>
    }
  }
}

/**
 * Split code into logical chunks with enhanced context using AST parsing
 * 
 * @param filePath Path to the file
 * @param fileContent Content of the file
 * @returns Array of enhanced code chunks
 */
export function chunkCodeWithContext(filePath: string, fileContent: string): {
  chunks: EnhancedCodeChunk[],
  entities: CodeEntity[],
  dependencies: DependencyInfo
} {
  // Parse the code and get chunks and entities
  const { chunks, entities, dependencies } = extractCodeChunksWithAST(filePath, fileContent)
  
  // Convert to enhanced chunks
  const enhancedChunks: EnhancedCodeChunk[] = chunks.map(chunk => ({
    content: chunk.content,
    startLine: chunk.startLine,
    endLine: chunk.endLine,
    type: chunk.type,
    name: chunk.name,
    filePath,
    metadata: {
      language: getLanguageFromFilePath(filePath),
      ...chunk.metadata,
      relationshipContext: {
        imports: dependencies.imports.map(imp => imp.source),
        exports: dependencies.exports.map(exp => exp.name)
      }
    }
  }))
  
  return { chunks: enhancedChunks, entities, dependencies }
}

/**
 * Group code chunks by logical relationships
 * 
 * @param chunks Array of code chunks
 * @returns Grouped chunks by category
 */
export function groupChunksByRelationship(chunks: EnhancedCodeChunk[]): Record<string, EnhancedCodeChunk[]> {
  const grouped: Record<string, EnhancedCodeChunk[]> = {
    'react-components': [],
    'functions': [],
    'classes': [],
    'types': [],
    'imports': [],
    'variables': [],
    'other': []
  }
  
  chunks.forEach(chunk => {
    switch(chunk.type) {
      case 'react-component':
        grouped['react-components'].push(chunk)
        break
      case 'function':
        grouped['functions'].push(chunk)
        break
      case 'class':
        grouped['classes'].push(chunk)
        break
      case 'interface':
      case 'type':
        grouped['types'].push(chunk)
        break
      case 'imports':
        grouped['imports'].push(chunk)
        break
      case 'variable':
        grouped['variables'].push(chunk)
        break
      default:
        grouped['other'].push(chunk)
    }
  })
  
  // Return only non-empty groups
  return Object.fromEntries(
    Object.entries(grouped).filter(([_, chunks]) => chunks.length > 0)
  )
}

/**
 * Connect chunks by their relationships
 * 
 * @param chunks Array of code chunks
 * @param fileRelationships Map of file paths to their relationships
 * @returns Enhanced chunks with relationship data
 */
export function connectChunkRelationships(
  chunks: EnhancedCodeChunk[], 
  fileRelationships?: Map<string, {
    importedBy: string[],
    exportsTo: string[]
  }>
): EnhancedCodeChunk[] {
  // First pass - create a map of entity names to their chunks
  const entityMap = new Map<string, EnhancedCodeChunk>()
  
  chunks.forEach(chunk => {
    // Skip import sections
    if (chunk.type !== 'imports') {
      entityMap.set(chunk.name, chunk)
    }
  })
  
  // Second pass - connect related entities
  return chunks.map(chunk => {
    // Connect dependencies for non-import chunks
    if (chunk.type !== 'imports' && chunk.metadata.dependencies) {
      // Find chunks that match the dependencies
      const relatedComponents = chunk.metadata.dependencies
        .filter(dep => entityMap.has(dep))
        .map(dep => entityMap.get(dep)!.name)
      
      // Add relationship context if any related components found
      if (relatedComponents.length > 0) {
        chunk.metadata.relationshipContext = {
          ...chunk.metadata.relationshipContext,
          relatedComponents
        }
      }
    }
    
    // Add file relationship data if available
    if (fileRelationships && fileRelationships.has(chunk.filePath)) {
      const relationship = fileRelationships.get(chunk.filePath)!
      
      chunk.metadata.relationshipContext = {
        ...chunk.metadata.relationshipContext,
        importedBy: relationship.importedBy,
        exportsTo: relationship.exportsTo
      }
    }
    
    return chunk
  })
}

/**
 * Find the most relevant chunks for a query
 * 
 * @param chunks Array of code chunks
 * @param query Search query
 * @param maxResults Maximum number of results to return
 * @returns Most relevant chunks
 */
export function findRelevantChunks(
  chunks: EnhancedCodeChunk[], 
  query: string, 
  maxResults: number = 10
): EnhancedCodeChunk[] {
  // Convert query to lowercase for case-insensitive matching
  const lowerQuery = query.toLowerCase()
  const queryTerms = lowerQuery.split(/\s+/)
  
  // Score each chunk for relevance
  const scoredChunks = chunks.map(chunk => {
    let score = 0
    const lowerContent = chunk.content.toLowerCase()
    const lowerName = chunk.name.toLowerCase()
    
    // Exact name match gets highest score
    if (lowerName === lowerQuery) {
      score += 100
    }
    // Name contains query
    else if (lowerName.includes(lowerQuery)) {
      score += 50
    }
    // Name contains any query term
    else {
      queryTerms.forEach(term => {
        if (lowerName.includes(term)) {
          score += 20
        }
      })
    }
    
    // Content contains query
    if (lowerContent.includes(lowerQuery)) {
      score += 30
    }
    
    // Content contains query terms
    queryTerms.forEach(term => {
      const termMatches = (lowerContent.match(new RegExp(term, 'g')) || []).length
      score += termMatches * 2  // 2 points per match
    })
    
    // Boost score for exported items
    if (chunk.metadata.isExported) {
      score += 10
    }
    
    // Boost score for documented items
    if (chunk.metadata.documentation) {
      score += 5
    }
    
    // Boost score for certain types
    switch(chunk.type) {
      case 'react-component':
        score += 15  // React components are often what people look for
        break
      case 'class':
      case 'interface':
        score += 10  // Classes and interfaces are important structural elements
        break
      case 'function':
        score += 8   // Functions are common targets
        break
      case 'type':
        score += 6   // Types provide important context
        break
      case 'imports':
        score -= 5   // Import sections are less likely to be the primary target
        break
    }
    
    return { chunk, score }
  })
  
  // Sort by score and take top results
  return scoredChunks
    .sort((a, b) => b.score - a.score)
    .slice(0, maxResults)
    .map(item => item.chunk)
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