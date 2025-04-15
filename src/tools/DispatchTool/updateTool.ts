/**
 * Update script to replace the original DispatchTool with the improved implementation
 * Run this script to apply the improvements to the codebase
 */

import * as fs from 'fs'
import * as path from 'path'

// Get the current directory
const dispatchDir = __dirname

// Find all the new implementation files
const improvedFiles = [
  'improvedParser.ts',
  'improvedChunking.ts',
  'filePathUtils.ts',
  'searchUtils.ts',
  'improvedDispatchTool.tsx'
]

console.log('Starting the DispatchTool upgrade process...')

// Update DispatchTool.tsx
try {
  console.log('Updating DispatchTool.tsx...')
  
  // Read the improved implementation
  const improvedToolPath = path.join(dispatchDir, 'improvedDispatchTool.tsx')
  const improvedToolContent = fs.readFileSync(improvedToolPath, 'utf-8')
  
  // Update the file with some minor adjustments
  let updatedContent = improvedToolContent
    // Change the export name from ImprovedDispatchTool to DispatchTool
    .replace('export const ImprovedDispatchTool = {', 'export const DispatchTool = {')
  
  // Write to the original file
  const originalToolPath = path.join(dispatchDir, 'DispatchTool.tsx')
  fs.writeFileSync(originalToolPath, updatedContent, 'utf-8')
  
  console.log('Successfully updated DispatchTool.tsx')
} catch (error) {
  console.error('Error updating DispatchTool.tsx:', error)
  process.exit(1)
}

// Update index.ts to export all the new modules
try {
  console.log('Creating/updating index.ts to export all modules...')
  
  const indexPath = path.join(dispatchDir, 'index.ts')
  
  const indexContent = `/**
 * CodeContextTool (DispatchTool) exports
 * This file exports all the modules needed for the improved DispatchTool
 */

// Re-export main tool
export { DispatchTool } from './DispatchTool'

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

console.log('DispatchTool upgrade complete!')
console.log('The following files were added:')
improvedFiles.forEach(file => console.log(`- ${file}`))
console.log('\nYou may now import the improved DispatchTool functionality using:')
console.log('import { DispatchTool } from \'./tools/DispatchTool\'')
console.log('\nTo verify the upgrade, run the tool and check its improved search capabilities.')