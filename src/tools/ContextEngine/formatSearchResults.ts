/**
 * Enhanced formatting functions for search results 
 * This module provides improved result formatting with confidence indicators
 */

import * as path from 'path'
import { SearchResult } from './searchUtils'

/**
 * Format search results for display with confidence indicators
 * 
 * @param results Search results to format
 * @returns String representation of the search results
 */
export function formatEnhancedSearchResults(results: SearchResult[]): string {
  if (results.length === 0) {
    return "No code sections found matching your query."
  }
  
  let output = ""
  
  // Check if any results have low confidence (indicating escalation is likely)
  const queryEscalated = results.some(result => result.confidenceScore !== undefined && result.confidenceScore < 0.5);
  
  // Check if any results were verified against the file system
  const verifiedResults = results.filter(result => result.isVerified);
  const invalidResults = verifiedResults.filter(result => !result.verified?.fileExists);
  
  // Provide a summary of verification results
  if (verifiedResults.length > 0) {
    if (invalidResults.length > 0) {
      output += `WARNING: ${invalidResults.length} of ${results.length} results could not be verified to exist in the codebase.\n\n`;
    } else {
      output += `All results verified against the actual code files.\n\n`;
    }
  }
  
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