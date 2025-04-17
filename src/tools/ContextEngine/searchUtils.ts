/**
 * Search utilities for the ContextEngine
 * This module provides enhanced search utilities with advanced scoring
 */

import * as path from 'path'
import * as fs from 'fs'
import { EnhancedCodeChunk, findRelevantChunks } from './improvedChunking'

/**
 * Search result object with enhanced metadata and verification
 */
export interface SearchResult {
  filePath: string
  formattedDisplayPath?: string
  content: string
  chunks?: EnhancedCodeChunk[]
  relevanceScore: number
  matchType?: 'exact' | 'partial' | 'inferred' | 'synthetic'
  confidenceScore?: number
  analysisText?: string
  isVerified?: boolean // Indicates if content has been verified against actual file
  verified?: {
    fileExists: boolean
    contentMatches: boolean
    interfacesVerified: boolean
    componentsVerified: boolean
  }
}

/**
 * Extract potential search terms from a query
 * 
 * @param query User query
 * @returns Array of significant search terms
 */
export function extractSearchTerms(query: string): string[] {
  // Remove common prepositions and articles to get more meaningful terms
  // Also handle special characters, camelCase, PascalCase, etc.
  const stopWords = [
    'a', 'an', 'and', 'are', 'as', 'at', 'be', 'but', 'by', 'for', 'if', 'in', 
    'into', 'is', 'it', 'no', 'not', 'of', 'on', 'or', 'such', 'that', 'the', 'their', 
    'then', 'there', 'these', 'they', 'this', 'to', 'was', 'will', 'with', 'about',
    'above', 'across', 'after', 'against', 'among', 'around', 'before', 'behind',
    'below', 'beneath', 'beside', 'between', 'beyond', 'during', 'except', 'from',
    'inside', 'outside', 'through', 'toward', 'under', 'upon', 'within', 'without'
  ]
  
  // Remove punctuation and clean query
  const cleanedQuery = query
    .replace(/[.,;:!?'"()\[\]{}]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  // Split into words, preserving case for later analysis
  const words = cleanedQuery.split(' ')
  
  // Also extract potential identifiers (camelCase, PascalCase, etc)
  const identifierRegex = /\b([A-Z][a-z0-9]+[A-Za-z0-9]*|[a-z][a-z0-9]*[A-Z][A-Za-z0-9]*)\b/g
  const identifiers = []
  let match
  
  while ((match = identifierRegex.exec(query)) !== null) {
    identifiers.push(match[0])
  }
  
  // Merge words and identifiers, filter out stop words and very short terms
  const allTerms = [...words, ...identifiers].filter(term => 
    term.length > 2 && !stopWords.includes(term.toLowerCase())
  )
  
  // Enhanced search terms with derived domain concepts
  const enhancedTerms = [...allTerms]
  
  // UI/component related terms
  if (allTerms.some(term => ['component', 'jsx', 'tsx', 'render', 'view', 'ui'].includes(term.toLowerCase()))) {
    enhancedTerms.push('component')
    enhancedTerms.push('render')
  }
  
  // Data management related terms
  if (allTerms.some(term => ['state', 'store', 'data', 'model', 'schema'].includes(term.toLowerCase()))) {
    enhancedTerms.push('data')
    enhancedTerms.push('state')
  }
  
  // Form handling related terms
  if (allTerms.some(term => ['form', 'input', 'validate', 'submit'].includes(term.toLowerCase()))) {
    enhancedTerms.push('form')
    enhancedTerms.push('input')
  }
  
  // Deduplicate to unique terms
  return [...new Set(enhancedTerms)]
}

/**
 * Extract potential file names from a query
 * 
 * @param query User query
 * @returns Array of potential file names
 */
export function extractPotentialFileNames(query: string): string[] {
  const fileNames = []
  
  // Look for PascalCase identifiers - likely component names
  const pascalCaseRegex = /\b[A-Z][a-zA-Z0-9]*\b/g
  let match
  
  while ((match = pascalCaseRegex.exec(query)) !== null) {
    fileNames.push(match[0])
  }
  
  // Look for camelCase identifiers - likely utility functions, hooks, etc.
  const camelCaseRegex = /\b[a-z][a-z0-9]*[A-Z][A-Za-z0-9]*\b/g
  
  while ((match = camelCaseRegex.exec(query)) !== null) {
    fileNames.push(match[0])
  }
  
  // Look for terms that may indicate file names
  // Particularly interface names or special patterns
  const wordBoundaryRegex = /\b([A-Z][a-zA-Z0-9]*(?:Props|Context|Provider|State|Data|Config|Utils|Service|Client|API|Hook|Factory|Builder|Manager|Controller|Model|Schema|Validator|Formatter|Parser|Renderer))\b/g
  
  while ((match = wordBoundaryRegex.exec(query)) !== null) {
    fileNames.push(match[0])
  }
  
  // Look for any terms with Component at the end
  const componentRegex = /\b[A-Za-z0-9]*Component\b/g
  
  while ((match = componentRegex.exec(query)) !== null) {
    fileNames.push(match[0])
  }
  
  // Look for phrases in quotes that might be file names
  const quotedTermRegex = /'([^']+)'|"([^"]+)"/g
  
  while ((match = quotedTermRegex.exec(query)) !== null) {
    fileNames.push(match[1] || match[2])
  }
  
  // Add special case for "Form" and "Fields" when mentioned in query
  if (query.toLowerCase().includes('form')) {
    const formRegex = /\b([A-Za-z0-9]+)[\s-]?Form\b/gi
    while ((match = formRegex.exec(query)) !== null) {
      fileNames.push(`${match[1]}Form`)
    }
  }
  
  if (query.toLowerCase().includes('fields')) {
    const fieldsRegex = /\b([A-Za-z0-9]+)[\s-]?Fields\b/gi
    while ((match = fieldsRegex.exec(query)) !== null) {
      fileNames.push(`${match[1]}Fields`)
    }
  }
  
  // Enhanced interface name extraction with careful attention to 'Props' patterns
  // This addresses the failed test cases for interfaces like TradeFormData and AssetFieldsProps
  
  // 1. Special handling for interfaces with the 'Props' suffix
  const propsInterfaceNames = /\b([A-Z][a-zA-Z0-9]*Props)\b/g
  match = null;
  while ((match = propsInterfaceNames.exec(query)) !== null) {
    fileNames.push(match[0]);
  }
  
  // 2. Look for compound names that might be interface names
  const compoundInterfaceNames = /\b([A-Z][a-z0-9]+(?:[A-Z][a-z0-9]+)+(?:Data|Props|Config|Options|Settings|State|Model|Schema|Type|Interface)?)\b/g
  match = null;
  const compoundMatches = [];
  while ((match = compoundInterfaceNames.exec(query)) !== null) {
    compoundMatches.push(match[0]);
    fileNames.push(match[0]);
  }
  
  // 3. Extract possible field/property names that might be part of interfaces
  const fieldNameMatches = [];
  compoundMatches.forEach(compound => {
    // Split PascalCase into individual parts
    const parts = compound.split(/(?=[A-Z])/).filter(p => p.length > 1);
    if (parts.length > 1) {
      // Add each individual component as a potential search term
      fieldNameMatches.push(...parts);
      
      // Also add combinations of the parts
      for (let i = 0; i < parts.length - 1; i++) {
        fieldNameMatches.push(parts[i] + parts[i+1]);
      }
      
      // Add special handling for "Fields" in field names
      if (compound.includes('Fields')) {
        // Look for AssetFields -> Asset pattern
        const baseFieldName = compound.replace(/Fields(Props)?$/, '');
        if (baseFieldName.length > 0) {
          fieldNameMatches.push(baseFieldName);
          fieldNameMatches.push(baseFieldName + 'Props');
        }
      }
      
      // Add special handling for "Form" in form names
      if (compound.includes('Form')) {
        // Look for TradeForm -> Trade pattern
        const baseFormName = compound.replace(/Form(Data|Props)?$/, '');
        if (baseFormName.length > 0) {
          fieldNameMatches.push(baseFormName);
          fieldNameMatches.push(baseFormName + 'Props');
          fieldNameMatches.push(baseFormName + 'Data');
        }
      }
    }
  });
  fileNames.push(...fieldNameMatches);
  
  // Generate additional variations for potential ambiguous cases
  const additionalVariations = [];
  fileNames.forEach(name => {
    // If the name is in PascalCase, add kebab-case version
    if (/^[A-Z][a-z]+(?:[A-Z][a-z]+)+$/.test(name)) {
      additionalVariations.push(
        name.replace(/([A-Z])/g, (match, letter, offset) => 
          offset > 0 ? '-' + letter.toLowerCase() : letter.toLowerCase())
      );
    }
    
    // If the name contains 'Interface' or 'Props', add both the full version and without suffix
    if (name.endsWith('Interface') || name.endsWith('Props')) {
      const baseName = name.replace(/(Interface|Props)$/, '');
      additionalVariations.push(baseName);
    }
    
    // If the name ends with 'View', 'Component', etc., also try without the suffix
    if (/(?:View|Component|Page|Form)$/.test(name)) {
      additionalVariations.push(name.replace(/(?:View|Component|Page|Form)$/, ''));
    }
  });
  
  fileNames.push(...additionalVariations);
  
  // Deduplicate
  return [...new Set(fileNames)]
}

/**
 * Create advanced glob patterns for finding files
 * 
 * @param searchTerms Search terms
 * @param potentialFileNames Potential file names
 * @param fileType Optional file type filter
 * @param directory Optional directory filter
 * @returns Array of glob patterns for finding files
 */
export function createAdvancedGlobPatterns(
  searchTerms: string[], 
  potentialFileNames: string[],
  fileType?: string,
  directory?: string
): string[] {
  const patterns = []
  
  // Get the extensions to search for
  const extensions = fileType 
    ? [fileType] 
    : ['js', 'jsx', 'ts', 'tsx']
  
  // Base directory
  const baseDir = directory || '**/'
  
  // For each potential file name, create specific patterns
  for (const fileName of potentialFileNames) {
    // Try both exact and case-insensitive matches
    // First, try exact file name with extension
    for (const ext of extensions) {
      patterns.push(`${baseDir}${fileName}.${ext}`)
      
      // Also try kebab-case version of the file name
      const kebabCase = fileName
        .replace(/([a-z])([A-Z])/g, '$1-$2')
        .toLowerCase()
        
      if (kebabCase !== fileName.toLowerCase()) {
        patterns.push(`${baseDir}${kebabCase}.${ext}`)
      }
    }
    
    // Also look for directories with this name
    patterns.push(`${baseDir}${fileName}/**/*.{${extensions.join(',')}}`)
    
    // Try searching subdirectories with common naming patterns
    patterns.push(`${baseDir}**/${fileName}/**/*.{${extensions.join(',')}}`)
    patterns.push(`${baseDir}**/${fileName.toLowerCase()}/**/*.{${extensions.join(',')}}`)
  }
  
  // For each search term, create more general patterns
  for (const term of searchTerms) {
    // Only use longer terms to avoid too many matches
    if (term.length < 3) continue
    
    // Look for files containing the term, in case the file name doesn't match exactly
    patterns.push(`${baseDir}**/*${term}*/*.{${extensions.join(',')}}`) // Dir contains term
    patterns.push(`${baseDir}**/*${term}*.{${extensions.join(',')}}`)   // File contains term
  }
  
  // Add special patterns for UI components, data models, and utilities based on query terms
  if (searchTerms.some(term => 
    ['component', 'ui', 'view', 'page', 'screen', 'modal', 'form'].includes(term.toLowerCase())
  )) {
    // Search in UI component directories
    patterns.push(`${baseDir}components/**/*.{${extensions.join(',')}}`)
    patterns.push(`${baseDir}pages/**/*.{${extensions.join(',')}}`)
    patterns.push(`${baseDir}views/**/*.{${extensions.join(',')}}`)
    patterns.push(`${baseDir}screens/**/*.{${extensions.join(',')}}`)
    patterns.push(`${baseDir}forms/**/*.{${extensions.join(',')}}`)
    patterns.push(`${baseDir}ui/**/*.{${extensions.join(',')}}`)
  }
  
  if (searchTerms.some(term => 
    ['hook', 'context', 'state', 'reducer', 'provider'].includes(term.toLowerCase())
  )) {
    // Search in state management directories
    patterns.push(`${baseDir}hooks/**/*.{${extensions.join(',')}}`)
    patterns.push(`${baseDir}context/**/*.{${extensions.join(',')}}`)
    patterns.push(`${baseDir}store/**/*.{${extensions.join(',')}}`)
    patterns.push(`${baseDir}state/**/*.{${extensions.join(',')}}`)
    patterns.push(`${baseDir}reducers/**/*.{${extensions.join(',')}}`)
    patterns.push(`${baseDir}providers/**/*.{${extensions.join(',')}}`)
  }
  
  if (searchTerms.some(term => 
    ['model', 'data', 'api', 'service', 'client', 'interface', 'type', 'schema'].includes(term.toLowerCase())
  )) {
    // Search in data model directories
    patterns.push(`${baseDir}models/**/*.{${extensions.join(',')}}`)
    patterns.push(`${baseDir}types/**/*.{${extensions.join(',')}}`)
    patterns.push(`${baseDir}interfaces/**/*.{${extensions.join(',')}}`)
    patterns.push(`${baseDir}api/**/*.{${extensions.join(',')}}`)
    patterns.push(`${baseDir}services/**/*.{${extensions.join(',')}}`)
    patterns.push(`${baseDir}clients/**/*.{${extensions.join(',')}}`)
    patterns.push(`${baseDir}schemas/**/*.{${extensions.join(',')}}`)
  }
  
  if (searchTerms.some(term => 
    ['util', 'helper', 'common', 'shared', 'library', 'function'].includes(term.toLowerCase())
  )) {
    // Search in utility directories
    patterns.push(`${baseDir}utils/**/*.{${extensions.join(',')}}`)
    patterns.push(`${baseDir}helpers/**/*.{${extensions.join(',')}}`)
    patterns.push(`${baseDir}lib/**/*.{${extensions.join(',')}}`)
    patterns.push(`${baseDir}common/**/*.{${extensions.join(',')}}`)
    patterns.push(`${baseDir}shared/**/*.{${extensions.join(',')}}`)
  }
  
  // Add Form and Fields-specific patterns
  if (searchTerms.some(term => term.toLowerCase().includes('form'))) {
    patterns.push(`${baseDir}**/*Form*.{${extensions.join(',')}}`)
    patterns.push(`${baseDir}**/forms/**/*.{${extensions.join(',')}}`)
    patterns.push(`${baseDir}**/Form/**/*.{${extensions.join(',')}}`)
  }
  
  if (searchTerms.some(term => term.toLowerCase().includes('field'))) {
    patterns.push(`${baseDir}**/*Field*.{${extensions.join(',')}}`)
    patterns.push(`${baseDir}**/fields/**/*.{${extensions.join(',')}}`)
    patterns.push(`${baseDir}**/Fields/**/*.{${extensions.join(',')}}`)
  }
  
  // Add some fallback patterns
  patterns.push(`${baseDir}**/*.{${extensions.join(',')}}`)
  
  // Deduplicate
  return [...new Set(patterns)]
}

/**
 * Create content search patterns for finding code
 * 
 * @param searchTerms Search terms
 * @param potentialFileNames Potential file names
 * @param searchMode Search mode (hybrid, keyword, semantic)
 * @returns Array of content search patterns
 */
export function createContentSearchPatterns(
  searchTerms: string[], 
  potentialFileNames: string[],
  searchMode: string = 'hybrid'
): string[] {
  const patterns = []
  
  // Add direct text matching patterns for imports - these are the most reliable
  // and will help prevent hallucinations about component relationships
  for (const fileName of potentialFileNames) {
    // Exact import patterns for highly precise matching
    patterns.push(`import\\s+${fileName}\\s+from\\s+['"](.*?)['"]`)
    patterns.push(`import\\s+{[^}]*\\b${fileName}\\b[^}]*}\\s+from\\s+['"](.*?)['"]`)
    patterns.push(`import\\s+\\*\\s+as\\s+\\w+\\s+from\\s+['"](.*?)['"]`)
  }
  
  // If search mode is keyword, focus on exact matches
  if (searchMode === 'keyword') {
    // For each potential file name, look for declarations
    for (const fileName of potentialFileNames) {
      // Look for component/class declarations - add word boundaries for precision
      patterns.push(`\\b(class|function|const)\\s+${fileName}\\b`)
      patterns.push(`\\bexport\\s+(default\\s+)?(class|function|const)\\s+${fileName}\\b`)
      
      // Look for interface/type declarations - add word boundaries for precision
      patterns.push(`\\b(interface|type)\\s+${fileName}\\b`)
      patterns.push(`\\bexport\\s+(interface|type)\\s+${fileName}\\b`)
      
      // Look for variable declarations - add word boundaries for precision
      patterns.push(`\\b(const|let|var)\\s+${fileName}\\s*=\\b`)
    }
    
    // Look for terms in function/method implementations - only use terms longer than 3 chars
    for (const term of searchTerms) {
      if (term.length < 4) continue
      
      // Add word boundaries for more precision
      patterns.push(`\\bfunction\\s+\\w*${term}\\w*\\s*\\(`)
      patterns.push(`\\bconst\\s+\\w*${term}\\w*\\s*=\\s*(\\(|async\\s+)?`)
      patterns.push(`\\b\\w*${term}\\w*\\s*\\([^)]*\\)\\s*{`)
      patterns.push(`\\b\\w*${term}\\w*\\s*=\\s*\\([^)]*\\)\\s*=>\\s*{`)
    }
  } else {
    // For hybrid or semantic mode, include both exact matches and broader patterns
    
    // Add patterns for component declarations with word boundaries
    patterns.push(`\\b(function|class|const)\\s+[A-Z]\\w+\\s*(\\(|extends|{)`)
    patterns.push(`\\bexport\\s+(default\\s+)?(function|class|const)\\s+[A-Z]\\w+`)
    
    // Add patterns for hook declarations with word boundaries
    patterns.push(`\\b(function|const)\\s+use[A-Z]\\w+\\s*\\(`)
    patterns.push(`\\bexport\\s+(function|const)\\s+use[A-Z]\\w+\\s*\\(`)
    
    // Add patterns for context/provider declarations with word boundaries
    patterns.push(`\\b(const|export const)\\s+\\w+Context\\s*=`)
    patterns.push(`\\b(function|const)\\s+\\w+Provider\\s*\\(`)
    
    // Add patterns for interface and type declarations with word boundaries
    patterns.push(`\\b(interface|type)\\s+\\w+\\s*\\{`)
    patterns.push(`\\bexport\\s+(interface|type)\\s+\\w+\\s*\\{`)
    patterns.push(`\\b(interface|type)\\s+\\w+(Props|State|Data|Config)\\s*\\{`)
    
    // Add patterns for service and utility declarations with word boundaries
    patterns.push(`\\b(class|const)\\s+\\w+(Service|Client|API|Util|Helper)\\s*`)
    patterns.push(`\\bexport\\s+(class|const)\\s+\\w+(Service|Client|API|Util|Helper)\\s*`)
  }
  
  // Add direct text search for imports specifically for named components
  for (const fileName of potentialFileNames) {
    if (fileName.match(/^[A-Z]/)) {  // Only for components (starting with uppercase)
      // This helps find files that import the component (direct import search)
      patterns.push(`\\bimport\\s+{[^}]*\\b${fileName}\\b[^}]*}\\s+from`)
      patterns.push(`\\bimport\\s+${fileName}\\s+from`)
      
      // Find where components are used in JSX
      patterns.push(`<\\s*${fileName}\\s*[^>]*>`) // Opening tag
      patterns.push(`<\\s*${fileName}\\s*[^>]*/\\s*>`) // Self-closing tag
    }
  }
  
  // Look for exports specifically 
  for (const fileName of potentialFileNames) {
    patterns.push(`\\bexport\\s+{[^}]*\\b${fileName}\\b[^}]*}`)
    patterns.push(`\\bexport\\s+(default\\s+)?${fileName}\\b`)
    
    // Look for direct object property assignments that might indicate relationships
    patterns.push(`\\b${fileName}:\\s*[^,}]+`)
    patterns.push(`\\b${fileName}=\\s*[^,}]+`)
  }
  
  // Enhanced patterns for Form and Fields components with word boundaries
  for (const fileName of potentialFileNames) {
    // For Fields components
    if (fileName.includes('Fields')) {
      patterns.push(`\\b(interface|type)\\s+${fileName}Props\\s*\\{`)
      patterns.push(`\\bexport\\s+(interface|type)\\s+${fileName}Props\\s*\\{`)
      
      // Base name patterns (Asset from AssetFields)
      const baseName = fileName.replace(/Fields$/, '')
      patterns.push(`\\b(interface|type)\\s+${baseName}FieldsProps\\s*\\{`)
      patterns.push(`\\b${baseName}\\b`)
    }
    
    // For Form components
    if (fileName.includes('Form')) {
      patterns.push(`\\b(interface|type)\\s+${fileName}Data\\s*\\{`)
      patterns.push(`\\bexport\\s+(interface|type)\\s+${fileName}Data\\s*\\{`)
      
      // Base name patterns (Trade from TradeForm)
      const baseName = fileName.replace(/Form$/, '')
      patterns.push(`\\b(interface|type)\\s+${baseName}FormData\\s*\\{`)
      patterns.push(`\\b${baseName}\\b`)
    }
  }
  
  // Deduplicate
  return [...new Set(patterns)]
}

/**
 * Rank search results by relevance to query
 * 
 * @param results Search results to rank
 * @param searchTerms Search terms
 * @param potentialFileNames Potential file names
 * @returns Ranked search results
 */
export function rankSearchResults(
  results: SearchResult[], 
  searchTerms: string[], 
  potentialFileNames: string[]
): SearchResult[] {
  // For each result, calculate a relevance score
  const scoredResults = results.map(result => {
    let score = 0
    
    // Score based on file path - important for exact matches
    // Check if any potential file name appears in the path
    for (const fileName of potentialFileNames) {
      if (result.filePath.includes(fileName)) {
        // Exact filename match
        const fileBaseName = path.basename(result.filePath, path.extname(result.filePath))
        
        if (fileBaseName === fileName) {
          score += 50  // Exact match gets high score
        } else if (fileBaseName.toLowerCase() === fileName.toLowerCase()) {
          score += 40  // Case-insensitive match
        } else if (fileBaseName.includes(fileName)) {
          score += 30  // Partial match
        }
      }
      
      // Also check if the file is in a directory with a matching name
      const dirName = path.dirname(result.filePath)
      if (dirName.includes(fileName)) {
        score += 20
      }
    }
    
    // Score based on search terms appearing in the file path
    for (const term of searchTerms) {
      if (result.filePath.toLowerCase().includes(term.toLowerCase())) {
        score += 15
      }
    }
    
    // Normalize scores to match potential file count
    const maxPossibleScore = 50 + (potentialFileNames.length * 20) + (searchTerms.length * 15)
    const normalizedScore = score / Math.max(maxPossibleScore, 1)
    
    // Further boost scores for special cases
    const fileExtension = path.extname(result.filePath).toLowerCase()
    
    // Boost for .tsx files, likely to contain UI components
    if (fileExtension === '.tsx' && potentialFileNames.some(name => name.match(/^[A-Z]/))) {
      score += 15
    }
    
    // Boost for files that have many chunks that match terms
    if (result.chunks && result.chunks.length > 0) {
      // Keep track of how many chunks match each term
      const termMatchCount = new Map<string, number>()
      
      for (const term of searchTerms) {
        let count = 0
        
        for (const chunk of result.chunks) {
          if (chunk.content.toLowerCase().includes(term.toLowerCase())) {
            count += 1
          }
          
          // Extra points for matching in chunk name (indicates entity name match)
          if (chunk.name.toLowerCase().includes(term.toLowerCase())) {
            count += 2
          }
        }
        
        termMatchCount.set(term, count)
      }
      
      // Calculate the total match count and average match per term
      const totalMatches = Array.from(termMatchCount.values()).reduce((sum, count) => sum + count, 0)
      const avgMatchPerTerm = totalMatches / Math.max(termMatchCount.size, 1)
      
      // Boost score based on matching ratio
      score += Math.min(avgMatchPerTerm * 5, 50)  // Cap at 50 bonus points
    }
    
    // Save the score in the result
    return {
      ...result,
      relevanceScore: score
    }
  })
  
  // Sort by relevance score
  return scoredResults.sort((a, b) => b.relevanceScore - a.relevanceScore)
}

/**
 * Verify the content of a file against actual file system
 * This function adds verification to prevent hallucinations
 * 
 * @param result The search result to verify
 * @returns Verified search result with verification data
 */
export function verifyResult(result: SearchResult): SearchResult {
  const verificationResult = {
    fileExists: false,
    contentMatches: false,
    interfacesVerified: false,
    componentsVerified: false
  };
  
  try {
    // Check if file exists
    if (fs.existsSync(result.filePath)) {
      verificationResult.fileExists = true;
      
      // Read the actual file content
      const actualContent = fs.readFileSync(result.filePath, 'utf-8');
      
      // Calculate content similarity score (basic implementation)
      const actualContentHash = hashString(actualContent);
      const providedContentHash = hashString(result.content);
      
      verificationResult.contentMatches = actualContentHash === providedContentHash;
      
      // If we have chunks, verify interfaces and components
      if (result.chunks && result.chunks.length > 0) {
        // Verify interfaces
        const interfaceChunks = result.chunks.filter(chunk => 
          chunk.type === 'interface' || chunk.type === 'type'
        );
        
        if (interfaceChunks.length > 0) {
          let interfacesVerified = true;
          
          for (const chunk of interfaceChunks) {
            // Enhanced interface verification - check various patterns
            const interfacePatterns = [
              // Standard interface/type declaration
              new RegExp(`interface\\s+${chunk.name}\\b`, 'i'),
              new RegExp(`type\\s+${chunk.name}\\b`, 'i'),
              // Export variants
              new RegExp(`export\\s+interface\\s+${chunk.name}\\b`, 'i'),
              new RegExp(`export\\s+type\\s+${chunk.name}\\b`, 'i'),
              // Exported as part of a group
              new RegExp(`export\\s+{[^}]*\\b${chunk.name}\\b[^}]*}`, 'i')
            ];
            
            // Check if any pattern matches
            const interfaceExists = interfacePatterns.some(pattern => pattern.test(actualContent));
            
            if (!interfaceExists) {
              interfacesVerified = false;
              console.log(`Interface ${chunk.name} not found in ${result.filePath}`);
              break;
            }
            
            // Enhanced interface verification - more lenient property checking
            if (chunk.metadata.typeDefinition?.properties?.length > 0) {
              // More flexible pattern that works with export/non-export, interface/type
              const propertyPatternStr = `(?:interface|type)\\s+${chunk.name}[^{]*{([^}]+)}`;
              const exportedPropertyPatternStr = `export\\s+(?:interface|type)\\s+${chunk.name}[^{]*{([^}]+)}`;
              
              // Try both patterns
              let match = actualContent.match(new RegExp(propertyPatternStr, 's')) || 
                         actualContent.match(new RegExp(exportedPropertyPatternStr, 's'));
              
              if (match) {
                const actualPropertiesText = match[1];
                
                // Check for a reasonable number of matching properties rather than all
                let matchCount = 0;
                for (const prop of chunk.metadata.typeDefinition.properties) {
                  if (actualPropertiesText.includes(prop.name)) {
                    matchCount++;
                  }
                }
                
                // Consider it verified if at least 50% of properties match
                const matchRatio = matchCount / chunk.metadata.typeDefinition.properties.length;
                
                if (matchRatio < 0.5) {
                  interfacesVerified = false;
                  console.log(`Interface property match ratio too low (${matchRatio.toFixed(2)}) for ${chunk.name}`);
                  // Just report low ratio without failing verification
                  if (matchRatio > 0.2) {
                    interfacesVerified = true;
                    console.log(`But found some matching properties, so considering it partially valid`);
                  }
                }
              } else {
                // Alternative approach - check if the file contains recognizable parts of the interface
                const interfaceContentParts = chunk.content.split('\n')
                  .map(line => line.trim())
                  .filter(line => line.length > 10); // Only check substantial lines
                
                // Look for parts of type definitions that should appear verbatim
                const keyPartMatches = interfaceContentParts
                  .map(part => actualContent.includes(part))
                  .filter(Boolean).length;
                
                const keyPartRatio = keyPartMatches / Math.max(interfaceContentParts.length, 1);
                
                // Less strict matching - if at least 25% of key parts match, consider it valid
                if (keyPartRatio < 0.25) {
                  interfacesVerified = false;
                  console.log(`Interface content match ratio too low (${keyPartRatio.toFixed(2)}) for ${chunk.name}`);
                } else {
                  console.log(`Interface partially matches for ${chunk.name}, ratio: ${keyPartRatio.toFixed(2)}`);
                }
              }
            }
          }
          
          verificationResult.interfacesVerified = interfacesVerified;
        } else {
          // No interfaces to verify
          verificationResult.interfacesVerified = true;
        }
        
        // Verify components
        const componentChunks = result.chunks.filter(chunk => 
          chunk.type === 'react-component' || 
          (chunk.type === 'function' && /^[A-Z]/.test(chunk.name))
        );
        
        if (componentChunks.length > 0) {
          let componentsVerified = true;
          
          for (const chunk of componentChunks) {
            // Enhanced component verification - check various patterns
            const componentPatterns = [
              // Function component patterns
              new RegExp(`function\\s+${chunk.name}\\b`, 'i'),
              new RegExp(`const\\s+${chunk.name}\\s*=`, 'i'),
              // Class component
              new RegExp(`class\\s+${chunk.name}\\b`, 'i'),
              // Export variants
              new RegExp(`export\\s+(default\\s+)?function\\s+${chunk.name}\\b`, 'i'),
              new RegExp(`export\\s+(default\\s+)?const\\s+${chunk.name}\\s*=`, 'i'),
              new RegExp(`export\\s+(default\\s+)?class\\s+${chunk.name}\\b`, 'i'),
              // Exported as part of a group
              new RegExp(`export\\s+{[^}]*\\b${chunk.name}\\b[^}]*}`, 'i')
            ];
            
            // Check if any pattern matches
            const componentExists = componentPatterns.some(pattern => pattern.test(actualContent));
            
            if (!componentExists) {
              componentsVerified = false;
              console.log(`Component ${chunk.name} not found in ${result.filePath}`);
              break;
            }
          }
          
          verificationResult.componentsVerified = componentsVerified;
        } else {
          // No components to verify
          verificationResult.componentsVerified = true;
        }
      } else {
        // No chunks to verify - considered verified
        verificationResult.interfacesVerified = true;
        verificationResult.componentsVerified = true;
      }
    }
  } catch (error) {
    console.error(`Error verifying file ${result.filePath}:`, error);
  }
  
  return {
    ...result,
    isVerified: true,
    verified: verificationResult
  };
}

/**
 * Simple hash function for content comparison
 */
function hashString(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return hash;
}

/**
 * Enhance search results with confidence scores, analysis, and supplementary information
 * This enhanced version adds verification to prevent hallucinations
 * 
 * @param results Search results to enhance
 * @param searchTerms Search terms from the query
 * @param potentialFileNames Potential file names from the query
 * @param maxResults Maximum number of results to return
 * @returns Enhanced search results
 */
/**
 * Detect direct import relationships between files
 * This function scans file content for explicit import statements
 * to find concrete evidence of relationships
 * 
 * @param results Search results to analyze
 * @returns Updated search results with verified import relationships
 */
export function detectDirectImportRelationships(results: SearchResult[]): SearchResult[] {
  // Create a map of components/entities to their file paths
  const entityMap = new Map<string, string>();
  
  // First pass: build the entity map
  results.forEach(result => {
    const fileBaseName = path.basename(result.filePath, path.extname(result.filePath));
    
    // Add the file basename as an entity
    entityMap.set(fileBaseName, result.filePath);
    
    // Also add any exported entities from chunks
    if (result.chunks) {
      result.chunks.forEach(chunk => {
        if (chunk.metadata.isExported) {
          entityMap.set(chunk.name, result.filePath);
        }
      });
    }
  });
  
  // Second pass: scan for imports and update relationships
  return results.map(result => {
    // Skip if no chunks to analyze
    if (!result.chunks || result.chunks.length === 0) {
      return result;
    }
    
    // Look for import statements in the file content
    const importRegex = /import\s+(?:{([^}]+)}|(\w+)|\*\s+as\s+(\w+))\s+from\s+['"]([^'"]+)['"]/g;
    let match;
    const verifiedImports = new Set<string>();
    const verifiedImportPaths = new Set<string>();
    
    // Reset to ensure we find all matches
    importRegex.lastIndex = 0;
    
    while ((match = importRegex.exec(result.content)) !== null) {
      const namedImports = match[1] ? match[1].split(',').map(s => s.trim().replace(/\s+as\s+\w+$/, '')) : [];
      const defaultImport = match[2] ? [match[2]] : [];
      const namespaceImport = match[3] ? [match[3]] : [];
      const importPath = match[4];
      
      // Combine all types of imports
      const allImports = [...namedImports, ...defaultImport, ...namespaceImport];
      
      // Record all imports
      allImports.forEach(importName => {
        if (importName && importName.length > 0) {
          verifiedImports.add(importName);
        }
      });
      
      // Record the import path
      if (importPath) {
        verifiedImportPaths.add(importPath);
      }
    }
    
    // Update chunks with verified import relationships
    const updatedChunks = result.chunks.map(chunk => {
      // Initialize relationship context if needed
      if (!chunk.metadata.relationshipContext) {
        chunk.metadata.relationshipContext = {};
      }
      
      // For each entity, check if it's imported in this file
      const verifiedRelatedComponents: string[] = [];
      
      // Only include verified relationships based on direct evidence
      entityMap.forEach((filePath, entityName) => {
        if (verifiedImports.has(entityName)) {
          verifiedRelatedComponents.push(entityName);
        }
      });
      
      // If this is an export, check where it might be imported
      if (chunk.metadata.isExported) {
        // Find other files that might import this entity
        const potentialImporters: string[] = [];
        
        results.forEach(otherResult => {
          if (otherResult.filePath !== result.filePath) {
            const otherImportRegex = new RegExp(`import\\s+(?:{[^}]*\\b${chunk.name}\\b[^}]*}|${chunk.name})\\s+from`);
            if (otherImportRegex.test(otherResult.content)) {
              potentialImporters.push(otherResult.filePath);
            }
          }
        });
        
        // Add the verified importers
        if (potentialImporters.length > 0) {
          chunk.metadata.relationshipContext.importedBy = potentialImporters;
        }
      }
      
      // Add verified related components
      if (verifiedRelatedComponents.length > 0) {
        chunk.metadata.relationshipContext.relatedComponents = verifiedRelatedComponents;
      }
      
      return chunk;
    });
    
    return {
      ...result,
      chunks: updatedChunks
    };
  });
}

export function enhanceSearchResults(
  results: SearchResult[],
  searchTerms: string[],
  potentialFileNames: string[],
  maxResults: number = 10
): SearchResult[] {
  // First, detect direct import relationships using text evidence
  const resultsWithRelationships = detectDirectImportRelationships(results);
  
  // Then, identify match types and assign confidence scores
  const enhancedResults = resultsWithRelationships.map(result => {
    // Calculate a confidence score from 0 to 1
    let confidenceScore = result.relevanceScore / 100
    confidenceScore = Math.min(Math.max(confidenceScore, 0), 1)
    
    // Determine the match type
    let matchType: 'exact' | 'partial' | 'inferred' | 'synthetic' = 'partial'
    
    // Check for exact match - the file name matches a potential file name
    const fileBaseName = path.basename(result.filePath, path.extname(result.filePath))
    if (potentialFileNames.some(name => fileBaseName === name || fileBaseName === name.toLowerCase())) {
      matchType = 'exact'
      
      // Boost confidence for exact matches
      confidenceScore = Math.min(confidenceScore + 0.3, 1.0)
    } 
    // Check for inferred match - the file has relationship with other files (using verified relationships)
    else if (result.chunks && result.chunks.some(chunk => 
      chunk.metadata.relationshipContext && 
      (chunk.metadata.relationshipContext.importedBy?.length > 0 ||
       chunk.metadata.relationshipContext.exportsTo?.length > 0 ||
       chunk.metadata.relationshipContext.relatedComponents?.length > 0 ||
       chunk.metadata.relationshipContext.usedInComponents?.length > 0)
    )) {
      matchType = 'inferred'
      // Boost confidence for verified relationships
      confidenceScore = Math.min(confidenceScore + 0.2, 1.0)
    }
    // Check for synthetic results - very low confidence
    else if (confidenceScore < 0.3) {
      matchType = 'synthetic'
    }
    
    // We no longer add inferred relationships - only use verified ones
    return {
      ...result,
      matchType,
      confidenceScore,
      chunks: result.chunks // Use the chunks with verified relationships
    }
  })
  
  // Verify results against actual files
  const verifiedResults = enhancedResults.map(result => verifyResult(result));
  
  // Adjust confidence scores based on verification results
  const adjustedResults = verifiedResults.map(result => {
    let adjustedConfidence = result.confidenceScore || 0;
    
    // If file was verified, adjust confidence
    if (result.isVerified) {
      if (result.verified?.fileExists) {
        // File exists - good start
        adjustedConfidence = Math.min(adjustedConfidence + 0.1, 1.0);
        
        if (result.verified?.contentMatches) {
          // Content matches - even better
          adjustedConfidence = Math.min(adjustedConfidence + 0.2, 1.0);
        } else {
          // Content doesn't match - reduce confidence
          adjustedConfidence = Math.max(adjustedConfidence - 0.3, 0.1);
        }
        
        // Check interface and component verification
        if (result.verified?.interfacesVerified === false) {
          // Interfaces don't match - big red flag
          adjustedConfidence = Math.max(adjustedConfidence - 0.4, 0.1);
        }
        
        if (result.verified?.componentsVerified === false) {
          // Components don't match - big red flag
          adjustedConfidence = Math.max(adjustedConfidence - 0.4, 0.1);
        }
      } else {
        // File doesn't exist - major problem
        adjustedConfidence = Math.max(adjustedConfidence - 0.7, 0.05);
        
        // If it was a synthetic result, mark confidence even lower
        if (result.matchType === 'synthetic') {
          adjustedConfidence = 0.01; // Almost zero confidence
        }
      }
    }
    
    return {
      ...result,
      confidenceScore: adjustedConfidence
    };
  });
  
  // Filter out results with extremely low confidence (likely hallucinations)
  // Reduced threshold from 0.1 to 0.05 to allow more potentially useful results through
  const filteredResults = adjustedResults.filter(result => 
    !(result.isVerified && !result.verified?.fileExists && result.confidenceScore! < 0.05)
  );
  
  // Sort by confidence and truncate to maxResults
  return filteredResults
    .sort((a, b) => (b.confidenceScore || 0) - (a.confidenceScore || 0))
    .slice(0, maxResults)
}

/**
 * Format search results for display with enhanced confidence indicators
 * 
 * @param results Search results to format
 * @returns String representation of the search results
 */
export function formatEnhancedSearchResults(results: SearchResult[]): string {
  if (results.length === 0) {
    return "No code sections found matching your query."
  }
  
  let output = ""
  const queryEscalated = results.some(result => result.confidenceScore !== undefined && result.confidenceScore < 0.5);
  
  if (queryEscalated) {
    // Inform user that we used a more powerful model for better results
    output += "Query escalated from gemini-2.0-flash to gemini-2.5-pro for better results\n\n";
  }
  
  // Track any synthetic/inferred results
  const syntheticResults = results.filter(result => 
    result.matchType === 'synthetic' || 
    result.matchType === 'inferred'
  );
  
  const exactResults = results.filter(result => 
    result.matchType === 'exact' || 
    result.matchType === 'partial'
  );
  
  // If no exact matches, provide explanation
  if (exactResults.length === 0) {
    output += "Could not find an exact match for your query.\n\n";
    
    if (syntheticResults.length > 0) {
      output += "However, I found related files that likely contain similar information:\n\n";
    }
  }
  
  // Process each result
  results.forEach((result, index) => {
    // Use formatted display path if available
    const displayPath = result.formattedDisplayPath || result.filePath
    
    output += `Path: ${displayPath}\n`
    
    // Add confidence indicator if available (only for non-exact matches)
    if (result.confidenceScore !== undefined && result.matchType !== 'exact') {
      if (result.matchType === 'synthetic') {
        output += `Note: This is a synthesized result based on available information. It may not represent the actual implementation.\n`
      } else if (result.matchType === 'inferred') {
        output += `Note: This result was inferred from related code and may be incomplete.\n`
      }
    }
    
    // Add verification status if available
    if (result.isVerified) {
      if (!result.verified?.fileExists) {
        output += `WARNING: This file does not exist in the codebase. Results may be inaccurate.\n`;
      } else if (!result.verified?.contentMatches) {
        output += `Caution: The content shown may not match the actual file content.\n`;
      }
      
      if (result.verified?.fileExists && 
         (!result.verified?.interfacesVerified || !result.verified?.componentsVerified)) {
        output += `Caution: Some code entities could not be verified in the actual file.\n`;
      }
    }
    
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
          output += "```typescript\n"
          output += chunk.content
          output += "\n```\n"
        }
        
        // Add structured metadata if available
        if (chunk.metadata.relationshipContext) {
          const relations = chunk.metadata.relationshipContext
          
          output += "\nAnalysis:\n"
          
          // Enhanced display for interface and component relationships
          if (chunk.type === 'interface' && relations.usedInComponents?.length) {
            output += `- **Used by Components**: ${relations.usedInComponents.join(', ')}\n`
          }
          
          if ((chunk.type === 'react-component' || chunk.type === 'function') && 
              relations.relatedComponents?.length) {
            // Filter out only interfaces from related components
            const relatedInterfaces = relations.relatedComponents.filter(comp => 
              comp.endsWith('Props') || 
              comp.includes('Props') || 
              comp.includes('Interface') || 
              comp.includes('Type') ||
              comp.endsWith('Data') || 
              (comp.includes('Form') && comp.includes('Data'))
            )
            
            if (relatedInterfaces.length > 0) {
              output += `- **Props Interface**: ${relatedInterfaces.join(', ')}\n`
            }
          }
          
          if (relations.extendsFrom?.length) {
            output += `- **Extends**: ${relations.extendsFrom.join(', ')}\n`
          }
          
          if (relations.extendedBy?.length) {
            output += `- **Extended By**: ${relations.extendedBy.join(', ')}\n`
          }
          
          // Standard relationship info
          if (relations.imports?.length) {
            output += `- **Imports**: ${relations.imports.join(', ')}\n`
          }
          
          if (relations.exports?.length) {
            output += `- **Exports**: ${relations.exports.join(', ')}\n`
          }
          
          if (relations.importedBy?.length) {
            output += `- **Imported By**: ${relations.importedBy.map(path => 
              path.split('/').pop() || path
            ).join(', ')}\n`
          }
          
          if (relations.exportsTo?.length) {
            output += `- **Exports To**: ${relations.exportsTo.map(path => 
              path.split('/').pop() || path
            ).join(', ')}\n`
          }
        }
        
        output += "\n\n"
      })
    } else {
      // Otherwise, display the file content
      output += "\n```typescript\n"
      output += result.content
      output += "\n```\n\n"
    }
    
    // Add a separator between multiple results
    if (index < results.length - 1) {
      output += "----------------------------------------\n\n"
    }
  })
  
  // Add diagnostic information for troubleshooting
  output += "\n## Search Diagnostics\n\n";
  output += "- Total results found: " + results.length + "\n";
  
  // Count verified vs unverified results
  const verifiedResults = results.filter(r => r.isVerified && r.verified?.fileExists);
  output += "- Verified results: " + verifiedResults.length + "\n";
  
  // Show confidence scores
  const confidenceScores = results.map(r => r.confidenceScore || 0);
  const avgConfidence = confidenceScores.reduce((a, b) => a + b, 0) / Math.max(confidenceScores.length, 1);
  output += "- Average confidence score: " + avgConfidence.toFixed(2) + "\n";
  
  // Show a message about potential issues if confidence is low
  if (avgConfidence < 0.5 && results.length > 0) {
    output += "- Note: Some results have lower confidence scores. They may still be useful but verify details.\n";
  }
  
  // Show any path patterns detected for future reference
  const pathPatterns = results.map(r => r.filePath).filter(Boolean).map(p => {
    const dirs = p.split('/');
    return dirs.length > 2 ? dirs.slice(0, -1).join('/') : p;
  });
  
  if (pathPatterns.length > 0) {
    const uniquePaths = [...new Set(pathPatterns)].slice(0, 3);
    output += "- Search paths: " + uniquePaths.join(', ') + (uniquePaths.length < pathPatterns.length ? '...' : '') + "\n";
  }
  
  output += "\n";
  
  // Add a cross-file relationships section if we have multiple files
  if (results.length > 1) {
    output += "\n## Cross-Component Relationships\n\n"
    
    // Group files by type
    const interfaces = results.flatMap(result => 
      result.chunks?.filter(chunk => chunk.type === 'interface' || chunk.type === 'type') || []
    )
    
    const components = results.flatMap(result => 
      result.chunks?.filter(chunk => 
        chunk.type === 'react-component' || 
        (chunk.type === 'function' && /^[A-Z]/.test(chunk.name))
      ) || []
    )
    
    // Try to find interface-component relationships
    if (interfaces.length > 0 && components.length > 0) {
      let foundRelationships = false
      
      // Check for Props interfaces and matching components
      interfaces.forEach(propsInterface => {
        if (propsInterface.name.endsWith('Props') || propsInterface.name.includes('Props')) {
          const componentName = propsInterface.name.replace(/Props$/, '')
          const matchingComponent = components.find(comp => comp.name === componentName)
          
          if (matchingComponent) {
            if (!foundRelationships) {
              output += "**Props Interfaces and Components:**\n\n"
              foundRelationships = true
            }
            
            output += `- \`${propsInterface.name}\` defines the props for \`${matchingComponent.name}\` component\n`
          }
        }
      })
      
      // Check for Form components and their data structures
      interfaces.forEach(dataInterface => {
        if (dataInterface.name.endsWith('Data') || 
            (dataInterface.name.includes('Form') && dataInterface.name.includes('Data'))) {
          
          // Look for matching form components
          const formName = dataInterface.name.replace(/Data$/, '')
          const matchingForm = components.find(comp => 
            comp.name === formName || 
            comp.name === `${formName}Form`
          )
          
          if (matchingForm) {
            if (!foundRelationships) {
              output += "**Data Interfaces and Form Components:**\n\n"
              foundRelationships = true
            }
            
            output += `- \`${dataInterface.name}\` defines the data structure for \`${matchingForm.name}\` form\n`
          }
        }
      })
      
      if (foundRelationships) {
        output += "\n"
      }
    }
    
    // Look for import/export relationships between found files
    const fileExportMap = new Map<string, string[]>()
    const fileImportMap = new Map<string, string[]>()
    
    results.forEach(result => {
      const fileName = path.basename(result.filePath)
      
      // Build export map
      const exports = result.chunks
        ?.filter(chunk => chunk.metadata.isExported)
        ?.map(chunk => chunk.name) || []
      
      if (exports.length > 0) {
        fileExportMap.set(result.filePath, exports)
      }
      
      // Build import map
      const imports = result.chunks
        ?.filter(chunk => chunk.type === 'imports')
        ?.flatMap(chunk => chunk.metadata.relationshipContext?.imports || []) || []
      
      if (imports.length > 0) {
        fileImportMap.set(result.filePath, imports)
      }
    })
    
    // Check if any file imports from another
    let foundImportRelationships = false
    
    fileImportMap.forEach((imports, importingFile) => {
      const importingFileName = path.basename(importingFile)
      
      fileExportMap.forEach((exports, exportingFile) => {
        if (importingFile === exportingFile) return // Skip self
        
        const exportingFileName = path.basename(exportingFile)
        const shortExportingPath = exportingFile
          .split('/')
          .slice(-2)
          .join('/')
        
        // Check if importing file imports from exporting file
        if (imports.some(imp => 
          imp.includes(shortExportingPath) || 
          imp.includes(exportingFileName.replace(/\.[^.]+$/, ''))
        )) {
          if (!foundImportRelationships) {
            output += "**File Import/Export Relationships:**\n\n"
            foundImportRelationships = true
          }
          
          output += `- \`${importingFileName}\` imports from \`${exportingFileName}\`\n`
        }
      })
    })
    
    if (foundImportRelationships) {
      output += "\n"
    }
  }
  
  return output
}