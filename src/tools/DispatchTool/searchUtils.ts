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
 * Extract search terms from a natural language query with improved semantic understanding
 * 
 * @param query The natural language query
 * @returns Array of extracted search terms with additional semantic context
 */
export function extractSearchTerms(query: string): string[] {
  // Remove common punctuation
  const cleanedQuery = query
    .replace(/[.,;:!?'"()\[\]{}]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  // Split into words, preserving case for later analysis
  const words = cleanedQuery.split(' ')

  // Extended stop words list with programming-related common terms that aren't useful search targets
  const stopWords = new Set([
    // Common English stop words
    'the', 'and', 'or', 'a', 'an', 'in', 'on', 'at', 'to', 'for', 'with', 'by',
    'about', 'as', 'of', 'that', 'this', 'these', 'those', 'from', 'is', 'are',
    'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had', 'do', 'does', 
    'did', 'will', 'would', 'should', 'could', 'may', 'might', 'must', 'can',
    'where', 'when', 'how', 'what', 'who', 'which', 'why', 'i', 'me', 'my', 'mine',
    'you', 'your', 'yours', 'we', 'us', 'our', 'ours', 'they', 'them', 'their',
    'theirs',
    
    // Common programming terms that are too generic to be useful search terms by themselves
    'code', 'function', 'class', 'method', 'file', 'object', 'variable', 'value',
    'type', 'interface', 'module', 'import', 'export', 'return', 'void', 'null',
    'undefined', 'string', 'number', 'boolean', 'array', 'any', 'get', 'set',
    'callback', 'parameter', 'argument', 'property', 'attribute'
  ])

  // Prepare an array for result terms
  const searchTerms: string[] = []
  
  // Extract terms, handling different cases
  words.forEach(word => {
    const lowerWord = word.toLowerCase()
    
    // Always include camelCase and PascalCase terms, they're likely important identifiers
    if (/^[A-Z][a-z0-9]+[A-Z]|^[a-z]+[A-Z]/.test(word)) {
      searchTerms.push(word) // Keep original case
      return
    }
    
    // Always include PascalCase terms (likely class/component names)
    if (/^[A-Z][a-z0-9]+$/.test(word)) {
      searchTerms.push(word) // Keep original case
      return
    }
    
    // Always include snake_case or kebab-case identifiers
    if (/_/.test(word) || /-/.test(word)) {
      searchTerms.push(word)
      return
    }
    
    // Skip stop words only if they're not part of a specialized programming term
    if (!stopWords.has(lowerWord) && (word.length > 2)) {
      searchTerms.push(lowerWord)
    }
  })
  
  // Extract multi-word programming concepts that might be important
  const multiWordPatterns = [
    // React and UI patterns
    /react\s+component/i, /functional\s+component/i, /class\s+component/i,
    /react\s+hook/i, /context\s+provider/i, /render\s+prop/i,
    /higher\s+order\s+component/i, /event\s+handler/i, /style\s+component/i,
    
    // Data management patterns
    /state\s+management/i, /data\s+flow/i, /form\s+validation/i,
    /data\s+fetching/i, /async\s+operation/i, /error\s+handling/i,
    /data\s+transform/i, /data\s+model/i,
    
    // Common programming patterns
    /design\s+pattern/i, /factory\s+pattern/i, /singleton\s+pattern/i,
    /observer\s+pattern/i, /dependency\s+injection/i, /type\s+checking/i,
    /code\s+splitting/i, /lazy\s+loading/i
  ]
  
  multiWordPatterns.forEach(pattern => {
    const match = cleanedQuery.match(pattern)
    if (match && match[0]) {
      // Add the multi-word concept, replacing spaces with underscores to keep it together
      searchTerms.push(match[0].replace(/\s+/g, '_'))
    }
  })
  
  // Enhance search terms with derived domain concepts
  // These help establish the search context beyond just the literal terms
  
  // UI/component related terms
  if (searchTerms.some(term => ['component', 'jsx', 'tsx', 'render', 'view', 'ui'].includes(term.toLowerCase()))) {
    searchTerms.push('component')
    searchTerms.push('render')
  }
  
  // Data management related terms
  if (searchTerms.some(term => ['state', 'store', 'data', 'model', 'schema'].includes(term.toLowerCase()))) {
    searchTerms.push('data')
    searchTerms.push('state')
  }
  
  // Form handling related terms
  if (searchTerms.some(term => ['form', 'input', 'validate', 'submit'].includes(term.toLowerCase()))) {
    searchTerms.push('form')
    searchTerms.push('input')
  }
  
  // Remove duplicates and normalize
  return [...new Set(searchTerms)]
}

/**
 * Extract possible file names from a query with enhanced pattern recognition
 * 
 * @param query The search query
 * @returns Array of potential file names
 */
export function extractPotentialFileNames(query: string): string[] {
  const potentialFileNames: string[] = []

  // Match camelCase or PascalCase identifiers
  // Improved regex to catch more variants of camelCase and PascalCase
  const camelOrPascalCase = /\b([A-Z][a-z0-9]+(?:[A-Z][a-z0-9]*)*|[a-z][a-z0-9]*(?:[A-Z][a-z0-9]*)+)\b/g
  const camelCaseMatches = query.match(camelOrPascalCase) || []
  potentialFileNames.push(...camelCaseMatches)

  // Match filenames with extensions - expanded to include more file types
  const fileWithExtension = /\b[\w.-]+\.(js|jsx|ts|tsx|css|scss|less|html|md|json|yml|yaml|xml|svg|py|rb|java|go|php|c|cpp|h|cs)\b/g
  const fileMatches = query.match(fileWithExtension) || []
  potentialFileNames.push(...fileMatches)

  // Match words that are likely component names - expanded to catch more UI component patterns
  const componentNames = /\b([A-Z][a-z0-9]+(?:[A-Z][a-z0-9]*)*)(View|Component|Page|Form|Modal|Dialog|Card|List|Item|Button|Input|Container|Widget|Panel|Bar|Menu|Nav|Header|Footer|Layout|Row|Column|Grid|Field|Label|Text|Icon|Image|Avatar|Chart|Graph|Table)\b/g
  const componentMatches = query.match(componentNames) || []
  potentialFileNames.push(...componentMatches)

  // Match service, utility, and other common patterns
  const utilityNames = /\b([A-Z][a-z0-9]+(?:[A-Z][a-z0-9]*)*)(Service|Util|Utils|Utility|Helper|Manager|Provider|Client|Factory|Builder|Handler|Controller|Repository|Store|Hook|Context)\b/g
  const utilityMatches = query.match(utilityNames) || []
  potentialFileNames.push(...utilityMatches)

  // Match kebab-case identifiers - improved to catch more variants
  const kebabCase = /\b([a-z][a-z0-9]*(?:-[a-z0-9]+)+)\b/g
  const kebabCaseMatches = query.match(kebabCase) || []
  potentialFileNames.push(...kebabCaseMatches)

  // Match snake_case identifiers - improved to catch more variants
  const snakeCase = /\b([a-z][a-z0-9]*(?:_[a-z0-9]+)+)\b/g
  const snakeCaseMatches = query.match(snakeCase) || []
  potentialFileNames.push(...snakeCaseMatches)

  // Match words that appear after "find", "in", "the", or similar contextual markers
  const contextualMatches: string[] = []
  const contextualPrefixes = ['find', 'in', 'the', 'for', 'about', 'how', 'where', 'implement']
  
  contextualPrefixes.forEach(prefix => {
    const prefixRegex = new RegExp(`\\b${prefix}\\s+([A-Z][a-zA-Z0-9]+|[a-z][a-z0-9]*(?:[A-Z][a-zA-Z0-9]*)+)\\b`, 'g')
    let match
    while ((match = prefixRegex.exec(query)) !== null) {
      if (match[1] && match[1].length > 2) {
        contextualMatches.push(match[1])
      }
    }
  })
  potentialFileNames.push(...contextualMatches)

  // Enhanced interface name extraction with careful attention to 'Props' patterns
  // This addresses the failed test cases for interfaces like TradeFormData and AssetFieldsProps
  
  // 1. Special handling for interfaces with the 'Props' suffix
  const propsInterfaceNames = /\b([A-Z][a-zA-Z0-9]*Props)\b/g
  const propsMatches = query.match(propsInterfaceNames) || []
  potentialFileNames.push(...propsMatches)
  
  // 2. Look for compound names that might be interface names
  const compoundInterfaceNames = /\b([A-Z][a-z0-9]+(?:[A-Z][a-z0-9]+)+(?:Data|Props|Config|Options|Settings|State|Model|Schema|Type|Interface)?)\b/g
  const compoundMatches = query.match(compoundInterfaceNames) || []
  potentialFileNames.push(...compoundMatches)
  
  // 3. Extract possible field/property names that might be part of interfaces
  // e.g., "asset" in "AssetFieldsProps" or "trade" in "TradeFormData"
  const fieldNameMatches: string[] = []
  compoundMatches.forEach(match => {
    // Split PascalCase into individual parts
    const parts = match.split(/(?=[A-Z])/).filter(p => p.length > 1);
    if (parts.length > 1) {
      // Add each individual component as a potential search term
      fieldNameMatches.push(...parts);
      
      // Also add combinations of the parts
      for (let i = 0; i < parts.length - 1; i++) {
        fieldNameMatches.push(parts[i] + parts[i+1]);
      }
    }
  });
  potentialFileNames.push(...fieldNameMatches);
  
  // 4. General interface pattern (broader than before)
  const interfaceNames = /\b(I[A-Z][a-zA-Z0-9]*|[A-Z][a-zA-Z0-9]*(?:Props|Config|Options|Settings|State|Model|Schema|Type|Interface|Form|Fields|Data))\b/g
  const interfaceMatches = query.match(interfaceNames) || []
  potentialFileNames.push(...interfaceMatches)

  // Generate additional variations for potential ambiguous cases
  const additionalVariations: string[] = []
  potentialFileNames.forEach(name => {
    // If the name is in PascalCase, add kebab-case version
    if (/^[A-Z][a-z]+(?:[A-Z][a-z]+)+$/.test(name)) {
      additionalVariations.push(
        name.replace(/([A-Z])/g, (match, letter, offset) => 
          offset > 0 ? '-' + letter.toLowerCase() : letter.toLowerCase())
      )
    }
    
    // If the name is camelCase, add snake_case version
    if (/^[a-z]+(?:[A-Z][a-z]+)+$/.test(name)) {
      additionalVariations.push(
        name.replace(/([A-Z])/g, (match, letter) => '_' + letter.toLowerCase())
      )
    }
    
    // If the name contains 'Interface' or 'Props', add both the full version and without suffix
    if (name.endsWith('Interface') || name.endsWith('Props')) {
      const baseName = name.replace(/(Interface|Props)$/, '')
      additionalVariations.push(baseName)
    }
    
    // If the name ends with 'View', 'Component', etc., also try without the suffix
    if (/(?:View|Component|Page|Form)$/.test(name)) {
      additionalVariations.push(name.replace(/(?:View|Component|Page|Form)$/, ''))
    }
  })
  
  potentialFileNames.push(...additionalVariations)

  // Filter out common words that are unlikely to be file names
  const commonWords = new Set([
    'find', 'the', 'and', 'for', 'with', 'that', 'this', 'what', 'how', 'where', 'when',
    'which', 'who', 'why', 'not', 'from', 'code', 'does', 'implement', 'implementation'
  ])
  
  // Filter out duplicates and common words, and return
  return [...new Set(potentialFileNames)]
    .filter(name => !commonWords.has(name.toLowerCase()) && name.length > 1)
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
      patterns.push(`${baseDir}/**/forms/**/${term}${extensionPattern}`)
      patterns.push(`${baseDir}/**/fields/**/${term}${extensionPattern}`)
      
      // Also look for components with View/Form suffix
      patterns.push(`${baseDir}/**/${term}View${extensionPattern}`)
      patterns.push(`${baseDir}/**/${term}Form${extensionPattern}`)
      patterns.push(`${baseDir}/**/${term}Component${extensionPattern}`)
    }
    
    // For camelCase terms, look for related files
    if (/^[a-z][a-z0-9]*[A-Z]/.test(term)) {
      patterns.push(`${baseDir}/**/utils/**/*${term}*${extensionPattern}`)
      patterns.push(`${baseDir}/**/hooks/**/use${term.charAt(0).toUpperCase() + term.slice(1)}*${extensionPattern}`)
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
        
        // Interface patterns - specifically targeting interfaces with this name
        patterns.push(`interface\\s+${nameWithoutExt}\\b`)
        patterns.push(`interface\\s+${nameWithoutExt}Props\\b`)
        patterns.push(`type\\s+${nameWithoutExt}\\b`)
        
        // Props patterns - look for components using props with this name
        patterns.push(`${nameWithoutExt}\\s*:\\s*${nameWithoutExt}Props`)
        patterns.push(`${nameWithoutExt}\\s*:\\s*React\\..*Props`)
        
        // Specific pattern for Fields components and their props
        if (nameWithoutExt.includes('Fields')) {
          patterns.push(`interface\\s+${nameWithoutExt.replace('Fields', '')}FieldsProps\\b`)
          patterns.push(`type\\s+${nameWithoutExt.replace('Fields', '')}FieldsProps\\b`)
        }
        
        // Interface extension patterns
        patterns.push(`extends\\s+${nameWithoutExt}\\b`)
      }
      
      // For camelCase names, look for functions and variables
      if (/^[a-z][a-zA-Z0-9]+$/.test(nameWithoutExt)) {
        patterns.push(`function\\s+${nameWithoutExt}\\s*\\(`)
        patterns.push(`const\\s+${nameWithoutExt}\\s*=`)
        patterns.push(`let\\s+${nameWithoutExt}\\s*=`)
        patterns.push(`var\\s+${nameWithoutExt}\\s*=`)
      }
      
      // Special pattern for interface names with 'Props' suffix
      if (nameWithoutExt.endsWith('Props')) {
        patterns.push(`interface\\s+${nameWithoutExt}\\b`)
        patterns.push(`type\\s+${nameWithoutExt}\\b`)
        
        // Also look for the component that might use this props interface
        const componentName = nameWithoutExt.replace(/Props$/, '')
        patterns.push(`function\\s+${componentName}\\b`)
        patterns.push(`const\\s+${componentName}\\s*=`)
        patterns.push(`class\\s+${componentName}\\b`)
      }
      
      // Special pattern for interface names with 'Data' suffix
      if (nameWithoutExt.endsWith('Data') || nameWithoutExt.includes('Form')) {
        patterns.push(`interface\\s+${nameWithoutExt}\\b`)
        patterns.push(`type\\s+${nameWithoutExt}\\b`)
        patterns.push(`export\\s+(?:interface|type)\\s+${nameWithoutExt}\\b`)
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
        // Add special formatting for interfaces and types
        if (chunk.type === 'interface' || chunk.type === 'type') {
          output += `\n${chunk.type.toUpperCase()}: ${chunk.name} (lines ${chunk.startLine}-${chunk.endLine})\n`
          
          // For interfaces and types, add a structured display of properties first
          if (chunk.metadata.typeDefinition?.properties?.length > 0) {
            output += "```typescript\n"
            output += `${chunk.type} ${chunk.name} {\n`
            chunk.metadata.typeDefinition.properties.forEach(prop => {
              output += `  ${prop.name}: ${prop.type};\n`
            })
            output += "}\n```\n\n"
          } else if (chunk.metadata.childEntities?.length > 0) {
            // If we have child entities but not in typeDefinition, show them
            output += "```typescript\n"
            output += `${chunk.type} ${chunk.name} {\n`
            chunk.metadata.childEntities
              .filter(entity => entity.type === 'property')
              .forEach(entity => {
                output += `  ${entity.content};\n`
              })
            output += "}\n```\n\n"
          }
          
          // Show the actual content after the structured version
          output += "Original Definition:\n"
          output += "```typescript\n"
          output += chunk.content
          output += "\n```\n"
        } else {
          // For other types, just show the content
          output += `\n${chunk.type}: ${chunk.name} (lines ${chunk.startLine}-${chunk.endLine})\n`
          output += chunk.content
        }
        
        // Add structured metadata if available
        if (chunk.metadata.relationshipContext) {
          const relations = chunk.metadata.relationshipContext
          
          // Enhanced display for interface and component relationships
          if (chunk.type === 'interface' && relations.usedInComponents?.length) {
            output += `\n\n**Used by Components**: ${relations.usedInComponents.join(', ')}`
          }
          
          if ((chunk.type === 'react-component' || chunk.type === 'function') && 
              relations.relatedComponents?.length) {
            // Filter out only interfaces from related components
            const relatedInterfaces = relations.relatedComponents.filter(comp => 
              comp.endsWith('Props') || comp.includes('Interface') || comp.includes('Type')
            )
            
            if (relatedInterfaces.length > 0) {
              output += `\n\n**Props Interface**: ${relatedInterfaces.join(', ')}`
            }
          }
          
          if (relations.extendsFrom?.length) {
            output += `\n\n**Extends**: ${relations.extendsFrom.join(', ')}`
          }
          
          if (relations.extendedBy?.length) {
            output += `\n\n**Extended By**: ${relations.extendedBy.join(', ')}`
          }
          
          // Standard relationship info
          if (relations.imports?.length) {
            output += `\n\nImports: ${relations.imports.join(', ')}`
          }
          
          if (relations.exports?.length) {
            output += `\n\nExports: ${relations.exports.join(', ')}`
          }
          
          if (relations.importedBy?.length) {
            output += `\n\nImported By: ${relations.importedBy.join(', ')}`
          }
          
          if (relations.exportsTo?.length) {
            output += `\n\nExports To: ${relations.exportsTo.join(', ')}`
          }
          
          if (relations.relatedComponents?.length) {
            output += `\n\nRelated Components: ${relations.relatedComponents.join(', ')}`
          }
        }
        
        // Add enhanced type definition information if available
        if (chunk.metadata.typeDefinition) {
          const typeDef = chunk.metadata.typeDefinition
          
          // We already displayed properties above for interfaces/types
          if (typeDef.properties?.length && chunk.type !== 'interface' && chunk.type !== 'type') {
            output += `\n\nProperties:\n`
            typeDef.properties.forEach(prop => {
              output += `- ${prop.name}: ${prop.type}\n`
            })
          }
          
          if (typeDef.methods?.length) {
            output += `\n\nMethods:\n`
            typeDef.methods.forEach(method => {
              output += `- ${method.name}(${method.parameters.join(', ')})\n`
            })
          }
          
          if (typeDef.referencedBy?.length) {
            output += `\n\nReferenced By: ${typeDef.referencedBy.join(', ')}`
          }
          
          if (typeDef.isComponentProps) {
            output += `\n\n(This is a Component Props interface)`
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
  
  // Add a summary section with relationship information
  if (results.length > 1) {
    output += "\n\n## Relationships Between Found Files\n\n"
    
    // Collect file relationship data
    const fileLinks: string[] = []
    
    results.forEach(result => {
      const displayPath = result.formattedDisplayPath || result.filePath
      const fileName = path.basename(displayPath)
      
      // Check for imports between found files
      const imports = result.chunks
        ?.filter(chunk => chunk.type === 'imports')
        ?.flatMap(chunk => chunk.metadata.relationshipContext?.imports || []) || []
      
      const foundFileImports = imports.filter(imp => 
        results.some(r => {
          const otherFileName = path.basename(r.filePath)
          return imp.includes(otherFileName.replace(/\.[^.]+$/, ''))
        })
      )
      
      if (foundFileImports.length > 0) {
        fileLinks.push(`${fileName} imports: ${foundFileImports.join(', ')}`)
      }
      
      // Check for relationships through components
      const relatedComponents = result.chunks
        ?.flatMap(chunk => chunk.metadata.relationshipContext?.relatedComponents || []) || []
      
      const foundFileRelatedComponents = relatedComponents.filter(comp => 
        results.some(r => {
          const otherFileName = path.basename(r.filePath)
          return otherFileName.startsWith(comp) || comp.includes(otherFileName.replace(/\.[^.]+$/, ''))
        })
      )
      
      if (foundFileRelatedComponents.length > 0) {
        fileLinks.push(`${fileName} references: ${foundFileRelatedComponents.join(', ')}`)
      }
    })
    
    if (fileLinks.length > 0) {
      output += fileLinks.join('\n') + '\n\n'
    } else {
      output += "No direct relationships detected between the found files.\n\n"
    }
  }
  
  return output
}