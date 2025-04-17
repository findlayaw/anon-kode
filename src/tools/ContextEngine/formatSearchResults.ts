/**
 * Enhanced formatting functions for search results 
 * This module provides improved result formatting with confidence indicators
 */

import * as path from 'path'
import { SearchResult } from './searchUtils'

/**
 * Format search results for display with confidence indicators
 * and improved structural verification details
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
  
  // Calculate verification statistics
  const structuralMismatchResults = verifiedResults.filter(
    result => result.verified?.verificationDetails?.structuralMismatches?.length > 0
  );
  const implementationMismatchResults = verifiedResults.filter(
    result => result.verified?.verificationDetails?.implementationMismatches?.length > 0
  );
  
  // Provide a more detailed summary of verification results
  if (verifiedResults.length > 0) {
    if (invalidResults.length > 0) {
      output += `WARNING: ${invalidResults.length} of ${results.length} results could not be verified to exist in the codebase.\n\n`;
    } else if (structuralMismatchResults.length > 0 || implementationMismatchResults.length > 0) {
      output += `NOTE: ${structuralMismatchResults.length + implementationMismatchResults.length} of ${results.length} results have structural or implementation differences from the actual code.\n\n`;
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
    
    // Add confidence score display when available
    const confidenceDisplay = result.confidenceScore !== undefined ? 
      ` [Confidence: ${(result.confidenceScore * 100).toFixed(0)}%]` : '';
    
    output += `Path: ${displayPath}${confidenceDisplay}\n`
    
    // Show verification status indicators
    if (result.isVerified) {
      if (!result.verified?.fileExists) {
        output += `⚠️ WARNING: This file was not found in the codebase. The content shown may be incorrect.\n`;
      } else if (result.verified?.verificationDetails) {
        const details = result.verified.verificationDetails;
        
        // Show structural mismatch warnings
        if (details.structuralMismatches?.length > 0) {
          output += `ℹ️ NOTE: Minor structural differences detected in the actual implementation:\n`;
          details.structuralMismatches.slice(0, 2).forEach(detail => {
            output += `   - ${detail}\n`;
          });
          if (details.structuralMismatches.length > 2) {
            output += `   - ... and ${details.structuralMismatches.length - 2} more differences\n`;
          }
        }
        
        // Show file modification time if available
        if (result.verified.lastModified) {
          const modifiedDate = new Date(result.verified.lastModified);
          output += `Last modified: ${modifiedDate.toISOString().split('T')[0]}\n`;
        }
      }
    }
    
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
        
        // Show implementation verification warning if necessary
        if (result.verified?.verificationDetails?.implementationMismatches) {
          const mismatches = result.verified.verificationDetails.implementationMismatches.filter(
            mismatch => mismatch.includes(`${chunk.type} ${chunk.name}`)
          );
          
          if (mismatches.length > 0) {
            output += "\n⚠️ **Implementation Notice**: The actual implementation may differ from what is shown. ";
            output += "There may be updated methods, different parameter orders, or additional functionality.\n";
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
      
      // Check for Props interfaces and matching components with improved fuzzy matching
      interfaces.forEach(propsInterface => {
        if (propsInterface.name.endsWith('Props') || propsInterface.name.includes('Props')) {
          // Try different component name variations for better matching
          const possibleComponentNames = [
            propsInterface.name.replace(/Props$/, ''),
            propsInterface.name.replace(/Props/, ''),
            propsInterface.name.replace(/^(.+)Props$/, '$1'),
            propsInterface.name.replace(/^(.+)ComponentProps$/, '$1')
          ];
          
          // Find any matching component
          const matchingComponent = components.find(comp => 
            possibleComponentNames.some(name => 
              comp.name === name || 
              // Case insensitive comparison as fallback
              (comp.name.toLowerCase() === name.toLowerCase()) ||
              // Prefix/suffix comparison
              (comp.name.includes(name) && name.length > 3)
            )
          );
          
          if (matchingComponent) {
            if (!foundRelationships) {
              output += "**Props Interfaces and Components:**\n\n"
              foundRelationships = true
            }
            
            output += `- \`${propsInterface.name}\` defines the props for \`${matchingComponent.name}\` component\n`
          }
        }
      })
      
      // Check for Form components and their data structures with improved matching
      interfaces.forEach(dataInterface => {
        const isDataInterface = dataInterface.name.endsWith('Data') || 
                              (dataInterface.name.includes('Form') && dataInterface.name.includes('Data')) ||
                              dataInterface.name.endsWith('FormData');
        
        if (isDataInterface) {
          // Try different form name variations for better matching
          const possibleFormNames = [
            dataInterface.name.replace(/Data$/, ''),
            dataInterface.name.replace(/FormData$/, 'Form'),
            dataInterface.name.replace(/FormData$/, ''),
            dataInterface.name.replace(/Data$/, 'Form')
          ];
          
          // Find any matching form component
          const matchingForm = components.find(comp => 
            possibleFormNames.some(name => 
              comp.name === name || 
              comp.name === `${name}Form` ||
              comp.name.endsWith('Form') && comp.name.includes(name)
            )
          );
          
          if (matchingForm) {
            if (!foundRelationships) {
              output += "**Data Interfaces and Form Components:**\n\n"
              foundRelationships = true
            }
            
            output += `- \`${dataInterface.name}\` defines the data structure for \`${matchingForm.name}\` form\n`
          }
        }
      })
      
      // Enhanced parent-child component relationships
      const parentChildComponents = new Map<string, string[]>();
      
      components.forEach(component => {
        if (component.metadata?.relationshipContext?.usedComponents) {
          component.metadata.relationshipContext.usedComponents.forEach(usedComp => {
            // Check if the used component is in our components list
            const matchingChild = components.find(c => c.name === usedComp);
            if (matchingChild) {
              if (!parentChildComponents.has(component.name)) {
                parentChildComponents.set(component.name, []);
              }
              parentChildComponents.get(component.name)?.push(usedComp);
            }
          });
        }
      });
      
      if (parentChildComponents.size > 0) {
        output += "\n**Component Composition:**\n\n";
        
        parentChildComponents.forEach((children, parent) => {
          output += `- \`${parent}\` uses: ${children.map(c => `\`${c}\``).join(', ')}\n`;
        });
        
        output += "\n";
      }
      
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
        
        // Enhanced import detection with fuzzy matching
        if (imports.some(imp => 
          imp.includes(shortExportingPath) || 
          imp.includes(exportingFileName.replace(/\.[^.]+$/, '')) ||
          // Add common variations of import paths
          imp.includes(exportingFileName.replace(/\.[^.]+$/, '').toLowerCase()) ||
          imp.includes(path.dirname(exportingFile).split('/').pop() || '')
        )) {
          if (!foundImportRelationships) {
            output += "**File Import/Export Relationships:**\n\n"
            foundImportRelationships = true
          }
          
          // Show what's being imported
          const sharedExports = exports.filter(exp => 
            imports.some(imp => imp.includes(exp))
          );
          
          if (sharedExports.length > 0) {
            output += `- \`${importingFileName}\` imports ${sharedExports.map(e => `\`${e}\``).join(', ')} from \`${exportingFileName}\`\n`;
          } else {
            output += `- \`${importingFileName}\` imports from \`${exportingFileName}\`\n`;
          }
        }
      })
    })
    
    if (foundImportRelationships) {
      output += "\n"
    }
    
    // Add a usage flowchart for key components
    if (components.length > 1) {
      const usageMap = new Map<string, string[]>();
      const usedByMap = new Map<string, string[]>();
      
      // Build usage maps
      components.forEach(component => {
        if (component.metadata?.relationshipContext?.usedComponents) {
          usageMap.set(component.name, component.metadata.relationshipContext.usedComponents);
          
          // Populate the usedBy map
          component.metadata.relationshipContext.usedComponents.forEach(used => {
            if (!usedByMap.has(used)) {
              usedByMap.set(used, []);
            }
            usedByMap.get(used)?.push(component.name);
          });
        }
      });
      
      // Find entry point components (used by many, use few)
      const entryPoints = components.filter(comp => 
        (usedByMap.get(comp.name)?.length || 0) > 1 && 
        (usageMap.get(comp.name)?.length || 0) < 2
      ).map(comp => comp.name);
      
      if (entryPoints.length > 0) {
        output += "**Key Component Flow:**\n\n";
        entryPoints.forEach(entryPoint => {
          output += `- \`${entryPoint}\` → may be a central component in this workflow\n`;
        });
        output += "\n";
      }
    }
  }
  
  // Add a verification summary footer
  if (verifiedResults.length > 0) {
    output += "\n## Verification Summary\n\n";
    
    const verifiedOk = verifiedResults.filter(r => 
      r.verified?.fileExists && 
      r.verified?.contentMatches && 
      !r.verified?.verificationDetails?.structuralMismatches?.length &&
      !r.verified?.verificationDetails?.implementationMismatches?.length
    ).length;
    
    output += `- ${verifiedOk} of ${results.length} results fully verified as accurate\n`;
    
    if (structuralMismatchResults.length > 0) {
      output += `- ${structuralMismatchResults.length} results have structural differences (entity names or properties)\n`;
    }
    
    if (implementationMismatchResults.length > 0) {
      output += `- ${implementationMismatchResults.length} results have implementation differences\n`;
    }
    
    if (invalidResults.length > 0) {
      output += `- ${invalidResults.length} referenced files not found in the codebase\n`;
    }
    
    // Add a timestamp to help identify when verification occurred
    output += `\nVerification timestamp: ${new Date().toISOString()}\n`;
  }
  
  return output
}