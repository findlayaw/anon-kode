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
 * Find the most relevant chunks for a query using enhanced semantic and structural analysis
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
  const queryTerms = lowerQuery.split(/\s+/).filter(term => term.length > 1)
  
  // Extract potential entity names (PascalCase or camelCase identifiers)
  const entityNameRegex = /\b([A-Z][a-z0-9]+[A-Za-z0-9]*|[a-z][a-z0-9]*[A-Z][A-Za-z0-9]*)\b/g
  const potentialEntityNames = [...lowerQuery.matchAll(entityNameRegex)].map(match => match[0])
  
  // Category detection based on term presence
  // UI/Component related terms
  const uiTerms = [
    'component', 'style', 'render', 'form', 'view', 'layout', 'jsx', 'tsx', 'css',
    'button', 'input', 'select', 'display', 'ui', 'visual', 'element', 'container',
    'dialog', 'modal', 'panel', 'card', 'grid', 'flex', 'responsive', 'theme'
  ]
  const uiRelatedQuery = queryTerms.some(term => uiTerms.includes(term))
  
  // Data or state management terms
  const dataTerms = [
    'data', 'state', 'store', 'reducer', 'context', 'provider', 'hook', 'fetch', 'request',
    'model', 'schema', 'entity', 'json', 'api', 'service', 'client', 'server', 'backend',
    'database', 'storage', 'cache', 'prop', 'property', 'attribute', 'field', 'record'
  ]
  const dataRelatedQuery = queryTerms.some(term => dataTerms.includes(term))
  
  // Cross-file relationship terms
  const relationshipTerms = [
    'import', 'export', 'use', 'dependency', 'relation', 'connect', 'provider', 'consumer', 
    'inherit', 'extend', 'implement', 'interface', 'compose', 'mixin', 'hoc', 'wrapper',
    'parent', 'child', 'ancestor', 'descendant', 'reference', 'inject', 'module'
  ]
  const relationshipQuery = queryTerms.some(term => relationshipTerms.includes(term))
  
  // Utility or helper terms
  const utilityTerms = [
    'util', 'helper', 'format', 'convert', 'transform', 'parse', 'validate', 'check',
    'calculate', 'compute', 'generate', 'create', 'build', 'make', 'factory', 'construct',
    'function', 'method', 'tool', 'routine', 'procedure', 'operation', 'task'
  ]
  const utilityRelatedQuery = queryTerms.some(term => utilityTerms.includes(term))
  
  // Event handling terms
  const eventTerms = [
    'event', 'handler', 'listener', 'callback', 'trigger', 'emit', 'dispatch', 'fire',
    'subscribe', 'publish', 'observe', 'notify', 'on', 'handle', 'click', 'change', 
    'submit', 'input', 'keydown', 'keyup', 'mousedown', 'mouseup', 'drag'
  ]
  const eventRelatedQuery = queryTerms.some(term => eventTerms.includes(term))
  
  // Testing related terms
  const testingTerms = [
    'test', 'spec', 'mock', 'stub', 'spy', 'fixture', 'assert', 'expect', 'should',
    'describe', 'it', 'suite', 'case', 'unit', 'integration', 'e2e', 'end-to-end'
  ]
  const testingRelatedQuery = queryTerms.some(term => testingTerms.includes(term))
  
  // Weight multipliers for different match types
  const WEIGHT = {
    EXACT_NAME_MATCH: 100,
    NAME_CONTAINS_QUERY: 50,
    NAME_CONTAINS_TERM: 20,
    CONTENT_CONTAINS_QUERY: 30,
    EXACT_TERM_MATCH: 3,
    PARTIAL_TERM_MATCH: 1,
    EXPORTED_ITEM: 10,
    DOCUMENTED_ITEM: 5,
    ENTITY_NAME_MATCH: 40,
    DOMAIN_MATCH: 20,
    RELATIONSHIP_MATCH: 15,
    CONTEXT_RELEVANCE: 25
  }
  
  // Score each chunk for relevance using sophisticated matching
  const scoredChunks = chunks.map(chunk => {
    let score = 0
    const lowerContent = chunk.content.toLowerCase()
    const lowerName = chunk.name.toLowerCase()
    
    // Score by name matching
    if (lowerName === lowerQuery) {
      score += WEIGHT.EXACT_NAME_MATCH  // Exact name match
    } else if (lowerName.includes(lowerQuery)) {
      score += WEIGHT.NAME_CONTAINS_QUERY  // Name contains full query
    } else {
      // Name contains any individual query terms
      queryTerms.forEach(term => {
        if (lowerName.includes(term)) {
          score += WEIGHT.NAME_CONTAINS_TERM
        }
      })
      
      // Check for entity name matches
      potentialEntityNames.forEach(entity => {
        if (lowerName === entity.toLowerCase()) {
          score += WEIGHT.ENTITY_NAME_MATCH  // Direct entity match
        } else if (lowerName.includes(entity.toLowerCase())) {
          score += WEIGHT.ENTITY_NAME_MATCH / 2  // Partial entity match
        }
      })
    }
    
    // Score by content matching
    if (lowerContent.includes(lowerQuery)) {
      score += WEIGHT.CONTENT_CONTAINS_QUERY  // Full query match in content
    }
    
    // Analyze content for term matches with differentiated scoring
    queryTerms.forEach(term => {
      // More sophisticated term matching
      // Exact word boundaries for precise matches
      const exactTermRegex = new RegExp(`\\b${term}\\b`, 'gi')
      const exactTermMatches = (lowerContent.match(exactTermRegex) || []).length
      score += exactTermMatches * WEIGHT.EXACT_TERM_MATCH
      
      // Check for partial matches of the term (contained within other words)
      const partialTermMatches = (lowerContent.match(new RegExp(term, 'gi')) || []).length - exactTermMatches
      score += partialTermMatches * WEIGHT.PARTIAL_TERM_MATCH
      
      // Boost weight for terms in function/method/class names (important identifiers)
      const identifierRegex = new RegExp(`(function|class|const|let|var|interface|type)\\s+[^(]*${term}[^(]*\\(`, 'gi')
      const identifierMatches = (lowerContent.match(identifierRegex) || []).length
      score += identifierMatches * (WEIGHT.EXACT_TERM_MATCH * 2)
    })
    
    // Boost score for metadata attributes
    if (chunk.metadata.isExported) {
      score += WEIGHT.EXPORTED_ITEM  // Exported items are more relevant as they're part of the public API
    }
    
    if (chunk.metadata.documentation) {
      score += WEIGHT.DOCUMENTED_ITEM  // Documented items provide better context
      
      // Check if documentation contains query terms
      const docText = chunk.metadata.documentation.toLowerCase()
      queryTerms.forEach(term => {
        if (docText.includes(term)) {
          score += WEIGHT.EXACT_TERM_MATCH  // Terms in documentation are meaningful
        }
      })
    }
    
    // Sophisticated type-based scoring that considers query domain
    switch(chunk.type) {
      case 'react-component':
        score += 15
        if (uiRelatedQuery) score += WEIGHT.DOMAIN_MATCH
        // Check for component lifecycle methods or hooks
        if (lowerContent.includes('useeffect') || lowerContent.includes('componentdidmount')) {
          if (queryTerms.some(t => ['lifecycle', 'effect', 'mount', 'update'].includes(t))) {
            score += WEIGHT.CONTEXT_RELEVANCE
          }
        }
        break
        
      case 'class':
        score += 10
        if (relationshipQuery) score += WEIGHT.DOMAIN_MATCH
        // Check for inheritance/implementation patterns
        if (lowerContent.includes('extends') || lowerContent.includes('implements')) {
          if (relationshipQuery) score += WEIGHT.CONTEXT_RELEVANCE
        }
        break
        
      case 'interface':
      case 'type':
        score += 10
        if (dataRelatedQuery) score += WEIGHT.DOMAIN_MATCH
        // Check if this defines a data structure relevant to the query
        if (queryTerms.some(term => lowerContent.includes(`${term}:`))) {
          score += WEIGHT.CONTEXT_RELEVANCE  // Properties matching query terms
        }
        break
        
      case 'function':
        score += 8
        if (utilityRelatedQuery) score += WEIGHT.DOMAIN_MATCH
        // Special handling for event handlers
        if (chunk.name.startsWith('handle') || chunk.name.startsWith('on')) {
          score += 10
          if (eventRelatedQuery) score += WEIGHT.DOMAIN_MATCH
        }
        // Check for data transformation functions
        if (lowerContent.includes('return') && lowerContent.includes('map')) {
          if (dataRelatedQuery) score += WEIGHT.CONTEXT_RELEVANCE / 2
        }
        break
        
      case 'imports':
        // Imports are particularly important for relationship queries
        if (relationshipQuery) {
          score += WEIGHT.DOMAIN_MATCH
        } else {
          // Slightly reduce score for imports in non-relationship queries
          score -= 5
        }
        break
        
      case 'variable':
        if (dataRelatedQuery) score += WEIGHT.DOMAIN_MATCH / 2
        
        // Special handling for different variable types
        if (lowerContent.includes('new ') || lowerContent.includes('create')) {
          // Instance creation
          score += 5
        }
        if (lowerName.includes('style') || lowerContent.includes('style')) {
          // Styling variables
          score += 8
          if (uiRelatedQuery) score += WEIGHT.DOMAIN_MATCH / 2
        }
        if (lowerContent.includes('fetch') || lowerContent.includes('axios') || lowerContent.includes('http')) {
          // API/network calls
          score += 7
          if (queryTerms.some(t => ['api', 'request', 'fetch', 'http', 'call'].includes(t))) {
            score += WEIGHT.CONTEXT_RELEVANCE / 2
          }
        }
        break
        
      case 'method':
        score += 8
        if (chunk.name === 'render' && uiRelatedQuery) {
          // React render methods
          score += WEIGHT.DOMAIN_MATCH
        }
        if (testingRelatedQuery && (chunk.name.startsWith('test') || chunk.name.startsWith('should'))) {
          // Test methods
          score += WEIGHT.DOMAIN_MATCH
        }
        break
    }
    
    // Enhanced relationship-based scoring
    if (chunk.metadata.relationshipContext) {
      const relations = chunk.metadata.relationshipContext
      
      // Check for imports matching query terms
      if (relations.imports && relations.imports.some(imp => 
        queryTerms.some(term => imp.toLowerCase().includes(term)))) {
        score += WEIGHT.RELATIONSHIP_MATCH
        
        // Extra weight if import is likely a main dependency
        if (relations.imports.some(imp => potentialEntityNames.some(name => 
          imp.toLowerCase().includes(name.toLowerCase())))) {
          score += WEIGHT.RELATIONSHIP_MATCH / 2
        }
      }
      
      // Check for exports matching query terms
      if (relations.exports && relations.exports.some(exp => 
        queryTerms.some(term => exp.toLowerCase().includes(term)))) {
        score += WEIGHT.RELATIONSHIP_MATCH
        
        // Extra weight if export matches potential entity names
        if (relations.exports.some(exp => potentialEntityNames.some(name => 
          exp.toLowerCase() === name.toLowerCase()))) {
          score += WEIGHT.RELATIONSHIP_MATCH
        }
      }
      
      // Check for related components matching query terms or entities
      if (relations.relatedComponents && relations.relatedComponents.some(comp => 
        queryTerms.some(term => comp.toLowerCase().includes(term)) ||
        potentialEntityNames.some(name => comp.toLowerCase().includes(name.toLowerCase())))) {
        score += WEIGHT.RELATIONSHIP_MATCH * 1.5  // Higher weight for direct component relationships
      }
      
      // Check for bidirectional relationships
      if (relations.importedBy && relations.importedBy.length > 0 && 
          relations.exportsTo && relations.exportsTo.length > 0) {
        score += 5  // Bonus for components with both incoming and outgoing dependencies
      }
    }
    
    // Consider the size and complexity of the chunk
    // Moderately complex chunks (not too short, not too long) often contain the most relevant information
    const lineCount = chunk.content.split('\n').length
    if (lineCount > 5 && lineCount < 100) {
      score += 3  // Moderate size is often ideal
    } else if (lineCount > 100) {
      score -= 2  // Overly large chunks might be less focused
    }
    
    // Examine code structure for relevant patterns
    if (dataRelatedQuery && lowerContent.includes('interface') && lowerContent.includes('{')) {
      score += 8  // Data structure definitions
    }
    
    if (eventRelatedQuery && 
        (lowerContent.includes('addeventlistener') || 
         lowerContent.includes('on') && lowerContent.includes('=>'))) {
      score += 10  // Event handling patterns
    }
    
    if (uiRelatedQuery && lowerContent.includes('return') && 
        (lowerContent.includes('<') && lowerContent.includes('>'))) {
      score += 12  // JSX rendering
    }
    
    return { chunk, score }
  })
  
  // Sort by score and take top results, ensuring we maintain context
  const rankedResults = scoredChunks
    .sort((a, b) => b.score - a.score)
    .slice(0, maxResults)
    .map(item => item.chunk)
  
  // Ensure we include parent entities when we have methods/children
  // This maintains logical grouping
  const resultIds = new Set(rankedResults.map(chunk => `${chunk.filePath}:${chunk.name}`))
  const enhancedResults = [...rankedResults]
  
  // Add parent entities that aren't already included
  rankedResults.forEach(chunk => {
    if (chunk.metadata.parentName) {
      const parentId = `${chunk.filePath}:${chunk.metadata.parentName}`
      if (!resultIds.has(parentId)) {
        // Find the parent entity
        const parentChunk = chunks.find(c => 
          c.filePath === chunk.filePath && c.name === chunk.metadata.parentName)
        
        if (parentChunk) {
          enhancedResults.push(parentChunk)
          resultIds.add(parentId)
        }
      }
    }
  })
  
  // Re-sort results to maintain logical grouping
  return enhancedResults
    .sort((a, b) => {
      // First by file path
      if (a.filePath !== b.filePath) {
        return a.filePath.localeCompare(b.filePath)
      }
      
      // Then by type importance
      const typeOrder = {
        'react-component': 1,
        'class': 2,
        'interface': 3,
        'type': 4,
        'function': 5,
        'variable': 6,
        'method': 7,
        'imports': 8
      }
      
      const aTypeOrder = typeOrder[a.type as keyof typeof typeOrder] || 9
      const bTypeOrder = typeOrder[b.type as keyof typeof typeOrder] || 9
      
      if (aTypeOrder !== bTypeOrder) {
        return aTypeOrder - bTypeOrder
      }
      
      // Then by start line for natural code order
      return a.startLine - b.startLine
    })
    .slice(0, maxResults)
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