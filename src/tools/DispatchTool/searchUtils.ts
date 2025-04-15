/**
 * Search utility functions for the CodeContextTool
 * This module provides advanced search functions to improve result completeness and accuracy
 */

import * as fs from 'fs'
import * as path from 'path'
import { findPathWithCorrectCase, findSimilarPaths, normalizePath } from './filePathUtils'
import { EnhancedCodeChunk, findRelevantChunks } from './improvedChunking'

/**
 * Search mode options for different types of searches
 */
export type SearchMode = 'hybrid' | 'keyword' | 'semantic'

/**
 * Represents a search result with metadata
 */
export interface SearchResult {
  filePath: string
  content: string
  chunks: EnhancedCodeChunk[]
  relevanceScore: number
  matchContext?: string
  formattedDisplayPath?: string
}

/**
 * Advanced search options
 */
export interface SearchOptions {
  fileType?: string
  directory?: string
  includeSubdirectories?: boolean
  includeDependencies?: boolean
  maxResults?: number
  searchMode?: SearchMode
}

/**
 * Extract search terms from a natural language query
 * 
 * @param query The natural language query
 * @returns Array of extracted search terms
 */
export function extractSearchTerms(query: string): string[] {
  // Remove common words and punctuation
  const cleanedQuery = query.toLowerCase()
    .replace(/[.,;:!?'"()\[\]{}]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  // Split into words
  const words = cleanedQuery.split(' ')

  // Filter out common words and very short words
  const stopWords = new Set([
    'the', 'and', 'or', 'a', 'an', 'in', 'on', 'at', 'to', 'for', 'with', 'by',
    'about', 'as', 'of', 'that', 'this', 'these', 'those', 'from', 'is', 'are',
    'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had', 'do', 'does', 
    'did', 'will', 'would', 'should', 'could', 'may', 'might', 'must', 'can',
    'where', 'when', 'how', 'what', 'who', 'which', 'why', 'i', 'me', 'my', 'mine',
    'you', 'your', 'yours', 'we', 'us', 'our', 'ours', 'they', 'them', 'their',
    'theirs', 'code', 'function', 'class', 'method', 'file'
  ])

  // Extract meaningful terms (non-stop words and words with 3+ characters)
  const searchTerms = words.filter(word => 
    !stopWords.has(word) && (word.length > 2 || /^[A-Z][a-z]*$/.test(word))
  )

  return searchTerms
}

/**
 * Extract possible file names from a query
 * 
 * @param query The search query
 * @returns Array of potential file names
 */
export function extractPotentialFileNames(query: string): string[] {
  const potentialFileNames: string[] = []

  // Match camelCase or PascalCase identifiers
  const camelOrPascalCase = /\b([A-Z][a-z0-9]+[A-Z]?[a-z0-9]*)+\b/g
  const camelCaseMatches = query.match(camelOrPascalCase) || []
  potentialFileNames.push(...camelCaseMatches)

  // Match filenames with extensions
  const fileWithExtension = /\b[\w.-]+\.(js|jsx|ts|tsx|css|html|md|json|yml|yaml)\b/g
  const fileMatches = query.match(fileWithExtension) || []
  potentialFileNames.push(...fileMatches)

  // Match words that are likely component names
  const componentNames = /\b([A-Z][a-z0-9]+)(View|Component|Page|Form|Modal|Dialog|Card|List|Item|Button|Input|Container)\b/g
  const componentMatches = query.match(componentNames) || []
  potentialFileNames.push(...componentMatches)

  // Match kebab-case identifiers
  const kebabCase = /\b([a-z][a-z0-9]*-[a-z0-9-]+)\b/g
  const kebabCaseMatches = query.match(kebabCase) || []
  potentialFileNames.push(...kebabCaseMatches)

  // Match snake_case identifiers
  const snakeCase = /\b([a-z][a-z0-9]*_[a-z0-9_]+)\b/g
  const snakeCaseMatches = query.match(snakeCase) || []
  potentialFileNames.push(...snakeCaseMatches)

  // Filter out duplicates and return
  return [...new Set(potentialFileNames)]
}

/**
 * Create advanced glob patterns based on the search terms
 * 
 * @param searchTerms Search terms extracted from query
 * @param fileType Optional file type to filter by
 * @returns Array of advanced glob patterns
 */
export function createAdvancedGlobPatterns(
  searchTerms: string[],
  potentialFileNames: string[],
  fileType?: string,
  directory?: string
): string[] {
  const patterns: string[] = []
  const extensions = fileType ? 
    [fileType] : 
    ['js', 'jsx', 'ts', 'tsx', 'json', 'md', 'css', 'html']
  
  const extensionPattern = fileType ? 
    `.${fileType}` : 
    `.{${extensions.join(',')}}`
  
  const baseDir = directory || '**'
  
  // For each potential file name, create specific patterns
  potentialFileNames.forEach(fileName => {
    const nameWithoutExt = fileName.includes('.') ? 
      fileName.substring(0, fileName.lastIndexOf('.')) : 
      fileName
    
    // Exact match with extension
    patterns.push(`${baseDir}/**/${fileName}`)
    
    // Case variations
    patterns.push(`${baseDir}/**/${nameWithoutExt}${extensionPattern}`)
    patterns.push(`${baseDir}/**/${nameWithoutExt.toLowerCase()}${extensionPattern}`)
    
    // Partial matches (for kebab or snake case files)
    if (nameWithoutExt.includes('-') || nameWithoutExt.includes('_')) {
      patterns.push(`${baseDir}/**/*${nameWithoutExt}*${extensionPattern}`)
    }
  })
  
  // Create patterns for general search terms
  searchTerms.forEach(term => {
    // Skip very short terms
    if (term.length < 3) return
    
    // Basic pattern with term in filename
    patterns.push(`${baseDir}/**/*${term}*${extensionPattern}`)
    
    // For PascalCase terms, add pattern for components
    if (/^[A-Z][a-z0-9]+$/.test(term)) {
      patterns.push(`${baseDir}/**/components/**/${term}${extensionPattern}`)
      patterns.push(`${baseDir}/**/views/**/${term}${extensionPattern}`)
      patterns.push(`${baseDir}/**/pages/**/${term}${extensionPattern}`)
    }
  })
  
  // General patterns based on common directories
  if (searchTerms.some(term => 
      ['component', 'ui', 'interface', 'view'].includes(term.toLowerCase()))) {
    patterns.push(`${baseDir}/**/components/**/*${extensionPattern}`)
    patterns.push(`${baseDir}/**/ui/**/*${extensionPattern}`)
    patterns.push(`${baseDir}/**/views/**/*${extensionPattern}`)
  }
  
  if (searchTerms.some(term => 
      ['util', 'helper', 'common', 'shared'].includes(term.toLowerCase()))) {
    patterns.push(`${baseDir}/**/utils/**/*${extensionPattern}`)
    patterns.push(`${baseDir}/**/helpers/**/*${extensionPattern}`)
    patterns.push(`${baseDir}/**/common/**/*${extensionPattern}`)
    patterns.push(`${baseDir}/**/shared/**/*${extensionPattern}`)
  }
  
  if (searchTerms.some(term => 
      ['model', 'type', 'interface', 'schema'].includes(term.toLowerCase()))) {
    patterns.push(`${baseDir}/**/models/**/*${extensionPattern}`)
    patterns.push(`${baseDir}/**/types/**/*${extensionPattern}`)
    patterns.push(`${baseDir}/**/interfaces/**/*${extensionPattern}`)
    patterns.push(`${baseDir}/**/schemas/**/*${extensionPattern}`)
  }
  
  // Add a few generic patterns for broader fallback search
  patterns.push(`${baseDir}/**/*${extensionPattern}`)
  
  return [...new Set(patterns)] // Remove duplicates
}

/**
 * Create regex patterns for content search based on search terms
 * 
 * @param searchTerms Search terms extracted from query
 * @param searchMode The search mode being used
 * @returns Array of regex patterns for content search
 */
export function createContentSearchPatterns(
  searchTerms: string[],
  potentialFileNames: string[],
  searchMode: SearchMode = 'hybrid'
): string[] {
  const patterns: string[] = []
  
  // Create patterns based on search mode
  if (searchMode === 'keyword' || searchMode === 'hybrid') {
    // For each potential file name, create specific patterns
    potentialFileNames.forEach(fileName => {
      // Extract name without extension
      const nameWithoutExt = fileName.includes('.') ? 
        fileName.substring(0, fileName.lastIndexOf('.')) : 
        fileName
      
      // For component names, look for definitions
      if (/^[A-Z][a-z0-9]+/.test(nameWithoutExt)) {
        // Function component patterns
        patterns.push(`function\\s+${nameWithoutExt}\\s*\\(`)
        patterns.push(`const\\s+${nameWithoutExt}\\s*=\\s*\\(.*\\)\\s*=>`)
        // Class component pattern
        patterns.push(`class\\s+${nameWithoutExt}\\s+extends`)
        // Export patterns
        patterns.push(`export\\s+(?:default\\s+)?(?:function|class|const)\\s+${nameWithoutExt}`)
      }
      
      // For camelCase names, look for functions and variables
      if (/^[a-z][a-zA-Z0-9]+$/.test(nameWithoutExt)) {
        patterns.push(`function\\s+${nameWithoutExt}\\s*\\(`)
        patterns.push(`const\\s+${nameWithoutExt}\\s*=`)
        patterns.push(`let\\s+${nameWithoutExt}\\s*=`)
        patterns.push(`var\\s+${nameWithoutExt}\\s*=`)
      }
    })
    
    // Add patterns for general search terms
    searchTerms.forEach(term => {
      if (term.length < 3) return
      
      // Basic pattern
      patterns.push(term)
      
      // For PascalCase or camelCase terms, add more specific patterns
      if (/^[A-Za-z][a-zA-Z0-9]+$/.test(term)) {
        patterns.push(`\\b${term}\\b`)
      }
    })
  }
  
  if (searchMode === 'semantic' || searchMode === 'hybrid') {
    // For semantic search, also include related terms or partial matches
    const enhancedTerms = new Set<string>()
    
    searchTerms.forEach(term => {
      enhancedTerms.add(term)
      
      // Add variations of the term
      if (term.endsWith('s')) {
        enhancedTerms.add(term.slice(0, -1)) // singular form
      } else {
        enhancedTerms.add(`${term}s`) // plural form
      }
      
      // Add related concepts for common programming terms
      if (term === 'component' || term === 'view') {
        enhancedTerms.add('render')
        enhancedTerms.add('props')
        enhancedTerms.add('state')
        enhancedTerms.add('jsx')
        enhancedTerms.add('react')
      }
      
      if (term === 'function' || term === 'method') {
        enhancedTerms.add('return')
        enhancedTerms.add('call')
        enhancedTerms.add('invoke')
        enhancedTerms.add('parameter')
        enhancedTerms.add('argument')
      }
      
      if (term === 'data' || term === 'model') {
        enhancedTerms.add('state')
        enhancedTerms.add('store')
        enhancedTerms.add('json')
        enhancedTerms.add('fetch')
        enhancedTerms.add('api')
      }
    })
    
    // Add the enhanced terms as patterns
    enhancedTerms.forEach(term => {
      if (term.length < 3) return
      patterns.push(`\\b${term}\\b`)
    })
  }
  
  return [...new Set(patterns)] // Remove duplicates
}

/**
 * Rank search results by relevance
 * 
 * @param results Array of search results
 * @param searchTerms Search terms extracted from query
 * @returns Sorted array of search results
 */
export function rankSearchResults(
  results: SearchResult[],
  searchTerms: string[],
  potentialFileNames: string[]
): SearchResult[] {
  // Score each result
  const scoredResults = results.map(result => {
    let score = result.relevanceScore || 0
    const fileName = path.basename(result.filePath)
    const fileNameLower = fileName.toLowerCase()
    
    // Exact filename match gets highest score
    const exactFileNameMatch = potentialFileNames.some(name => 
      fileName === name || 
      fileName === `${name}.jsx` || 
      fileName === `${name}.tsx` || 
      fileName === `${name}.js` || 
      fileName === `${name}.ts`
    )
    if (exactFileNameMatch) {
      score += 100
    }
    
    // Partial filename match
    const partialFileNameMatch = potentialFileNames.some(name => 
      fileNameLower.includes(name.toLowerCase())
    )
    if (partialFileNameMatch) {
      score += 50
    }
    
    // Score based on term frequency in content
    searchTerms.forEach(term => {
      const termRegex = new RegExp(term, 'gi')
      const matches = (result.content.match(termRegex) || []).length
      score += matches * 2
    })
    
    // Boost score for certain file types
    const extension = path.extname(result.filePath).toLowerCase()
    if (extension === '.tsx' || extension === '.jsx') {
      score += 10 // Boost UI component files
    }
    
    // Boost score for files in specific directories
    const filePath = result.filePath.toLowerCase()
    if (filePath.includes('/components/')) {
      score += 8
    }
    if (filePath.includes('/pages/') || filePath.includes('/views/')) {
      score += 6
    }
    if (filePath.includes('/utils/') || filePath.includes('/helpers/')) {
      score += 4
    }
    
    return { ...result, relevanceScore: score }
  })
  
  // Sort by score in descending order
  return scoredResults.sort((a, b) => b.relevanceScore - a.relevanceScore)
}

/**
 * Ensure we have complete and readable results
 * 
 * @param results Raw search results
 * @param maxResults Maximum number of results to return
 * @returns Enhanced and filtered search results
 */
export function enhanceSearchResults(
  results: SearchResult[],
  searchTerms: string[],
  maxResults: number = 10
): SearchResult[] {
  if (results.length === 0) {
    return []
  }
  
  // Ensure each result has sufficient context
  const enhancedResults = results.map(result => {
    // If we have chunks, rank them by relevance to the search terms
    if (result.chunks && result.chunks.length > 0) {
      // Find the most relevant chunks
      const relevantChunks = findRelevantChunks(
        result.chunks, 
        searchTerms.join(' '), 
        maxResults
      )
      
      return {
        ...result,
        chunks: relevantChunks
      }
    }
    
    return result
  })
  
  // Filter out any results with no chunks or content
  const filteredResults = enhancedResults.filter(result => 
    (result.chunks && result.chunks.length > 0) || result.content
  )
  
  // Prioritize results with more matching search terms
  filteredResults.sort((a, b) => {
    const aMatches = searchTerms.filter(term => 
      a.content.toLowerCase().includes(term.toLowerCase())).length
    const bMatches = searchTerms.filter(term => 
      b.content.toLowerCase().includes(term.toLowerCase())).length
    
    return bMatches - aMatches
  })
  
  // Return the top results
  return filteredResults.slice(0, maxResults)
}

/**
 * Format search results for display
 * 
 * @param results Search results to format
 * @returns String representation of the search results
 */
export function formatSearchResults(results: SearchResult[]): string {
  if (results.length === 0) {
    return "No code sections found matching your query."
  }
  
  let output = "The following code sections were retrieved:\n\n"
  
  results.forEach((result, index) => {
    // Use formatted display path if available
    const displayPath = result.formattedDisplayPath || result.filePath
    
    output += `Path: ${displayPath}\n`
    
    // If we have chunks, display them
    if (result.chunks && result.chunks.length > 0) {
      result.chunks.forEach(chunk => {
        output += `\n${chunk.type}: ${chunk.name} (lines ${chunk.startLine}-${chunk.endLine})\n`
        output += chunk.content
        
        // Add structured metadata if available
        if (chunk.metadata.relationshipContext) {
          const relations = chunk.metadata.relationshipContext
          
          if (relations.imports?.length) {
            output += `\n\nImports: ${relations.imports.join(', ')}`
          }
          
          if (relations.exports?.length) {
            output += `\n\nExports: ${relations.exports.join(', ')}`
          }
          
          if (relations.relatedComponents?.length) {
            output += `\n\nRelated Components: ${relations.relatedComponents.join(', ')}`
          }
        }
        
        output += "\n\n"
      })
    } else {
      // Otherwise, display the file content
      output += "\n"
      output += result.content
      output += "\n\n"
    }
    
    // Add a separator between multiple results
    if (index < results.length - 1) {
      output += "----------------------------------------\n\n"
    }
  })
  
  return output
}