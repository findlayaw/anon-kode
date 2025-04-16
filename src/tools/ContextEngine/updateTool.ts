/**
 * Update script to replace the original ContextEngine with the improved implementation
 * Run this script to apply the improvements to the codebase
 */

import * as fs from 'fs'
import * as path from 'path'

// Get the current directory
const contextEngineDir = __dirname

// Find all the new implementation files
const improvedFiles = [
  'improvedParser.ts',
  'improvedChunking.ts',
  'filePathUtils.ts',
  'searchUtils.ts',
  'improvedContextEngine.tsx'
]

console.log('Starting the ContextEngine upgrade process...')

// Update ContextEngine.tsx
try {
  console.log('Updating ContextEngine.tsx...')
  
  // Read the improved implementation
  const improvedToolPath = path.join(contextEngineDir, 'improvedContextEngine.tsx')
  const improvedToolContent = fs.readFileSync(improvedToolPath, 'utf-8')
  
  // Update the file with some minor adjustments
  let updatedContent = improvedToolContent
    // Change the export name from ImprovedContextEngine to ContextEngine
    .replace('export const ImprovedContextEngine = {', 'export const ContextEngine = {}')
  
  // Write to the original file
  const originalToolPath = path.join(contextEngineDir, 'ContextEngine.tsx')
  fs.writeFileSync(originalToolPath, updatedContent, 'utf-8')
  
  console.log('Successfully updated ContextEngine.tsx')
} catch (error) {
  console.error('Error updating ContextEngine.tsx:', error)
  process.exit(1)
}

// Update index.ts to export all the new modules
try {
  console.log('Creating/updating index.ts to export all modules...')
  
  const indexPath = path.join(contextEngineDir, 'index.ts')
  
  const indexContent = `/**
 * ContextEngine exports
 * This file exports all the modules needed for the improved ContextEngine
 */

// Re-export main tool
export { ContextEngine } from './ContextEngine'

// Export constants
export { TOOL_NAME } from './constants'
export { DESCRIPTION, SYSTEM_PROMPT } from './prompt'

// Export parser utilities
export { parseCodeWithAST, extractCodeChunksWithAST, getDependencyInfoWithAST } from './improvedParser'

// Export chunking utilities
export { 
  chunkCodeWithContext, 
  groupChunksByRelationship, 
  connectChunkRelationships,
  findRelevantChunks
} from './improvedChunking'

// Export file path utilities
export {
  findPathWithCorrectCase,
  findSimilarPaths,
  normalizePath,
  formatPathForDisplay,
  extractPathComponents,
  isLikelyUIComponent
} from './filePathUtils'

// Export search utilities
export {
  extractSearchTerms,
  extractPotentialFileNames,
  createAdvancedGlobPatterns,
  createContentSearchPatterns,
  rankSearchResults,
  enhanceSearchResults,
  formatSearchResults
} from './searchUtils'
`
  
  fs.writeFileSync(indexPath, indexContent, 'utf-8')
  console.log('Successfully created/updated index.ts')
} catch (error) {
  console.error('Error creating/updating index.ts:', error)
  process.exit(1)
}

console.log('ContextEngine upgrade complete!')
console.log('The following files were added:')
improvedFiles.forEach(file => console.log(`- ${file}`))
console.log('\nYou may now import the improved ContextEngine functionality using:')
console.log('import { ContextEngine } from \'./tools/ContextEngine\'')
console.log('\nTo verify the upgrade, run the tool and check its improved search capabilities.')