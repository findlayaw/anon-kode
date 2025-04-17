/**
 * Enhanced search result processing module
 * This module adds content validation and related entity recognition 
 * to prevent hallucinations in search results
 */

import * as path from 'path'
import * as fs from 'fs'
import { SearchResult } from './searchUtils'

/**
 * Validate entity references within a search result
 * This checks that referenced interfaces/types actually exist in other search results
 * 
 * @param result The search result to validate
 * @param allResults All search results for cross-referencing
 * @returns Updated search result with validated entity references
 */
export function validateEntityReferences(result: SearchResult, allResults: SearchResult[]): SearchResult {
  // Only process if we have chunks
  if (!result.chunks || result.chunks.length === 0) {
    return result;
  }
  
  // Get all entity names from all results (for validation)
  const allEntityNames = new Set<string>();
  allResults.forEach(otherResult => {
    otherResult.chunks?.forEach(chunk => {
      if (chunk.name) {
        allEntityNames.add(chunk.name);
      }
    });
  });
  
  // Validate each chunk's references
  const validatedChunks = result.chunks.map(chunk => {
    // Skip chunks without relationship context
    if (!chunk.metadata.relationshipContext) {
      return chunk;
    }
    
    // Get relationship data
    const { relatedComponents, usedInComponents } = chunk.metadata.relationshipContext;
    
    // Validate related components (filter out those that don't exist)
    const validatedRelatedComponents = relatedComponents?.filter(component => 
      allEntityNames.has(component)
    ) || [];
    
    // Validate used in components (filter out those that don't exist)
    const validatedUsedInComponents = usedInComponents?.filter(component => 
      allEntityNames.has(component)
    ) || [];
    
    // Update the chunk with validated relationships
    return {
      ...chunk,
      metadata: {
        ...chunk.metadata,
        relationshipContext: {
          ...chunk.metadata.relationshipContext,
          relatedComponents: validatedRelatedComponents,
          usedInComponents: validatedUsedInComponents
        }
      }
    };
  });
  
  // Return updated result
  return {
    ...result,
    chunks: validatedChunks
  };
}

/**
 * Perform a deep content validation of search results against actual files
 * with improved structure and signature checking
 * 
 * @param results The search results to validate
 * @returns Search results with validation data
 */
export function validateSearchResultContent(results: SearchResult[]): SearchResult[] {
  // Import parser functions for structural analysis
  const { parseCodeWithAST, extractCodeChunksWithAST } = require('./improvedParser');
  
  // Enhanced validation with detailed logging
  return results.map(result => {
    console.log(`Validating result for file: ${result.filePath}`);
    
    // Skip if already verified
    if (result.isVerified) {
      console.log(`- Already verified, skipping`);
      return result;
    }
    
    // Check if the file exists
    if (!fs.existsSync(result.filePath)) {
      console.log(`- File does not exist: ${result.filePath}`);
      return {
        ...result,
        isVerified: true,
        verified: {
          fileExists: false,
          contentMatches: false,
          interfacesVerified: false,
          componentsVerified: false,
          lastModified: null
        }
      };
    }
    
    // Read actual file content
    try {
      console.log(`- File exists, reading content`);
      const actualContent = fs.readFileSync(result.filePath, 'utf-8');
      
      // Get file stats to check last modified time
      const fileStats = fs.statSync(result.filePath);
      const lastModified = fileStats.mtime.getTime();
      
      // Compare content length as a basic check
      const contentLengthMatches = Math.abs(actualContent.length - result.content.length) < 100;
      console.log(`- Content length match: ${contentLengthMatches ? 'Yes' : 'No'} (Actual: ${actualContent.length}, Provided: ${result.content.length})`);
      
      // Check if file generally contains the type of entities claimed
      const hasInterfaces = actualContent.includes('interface ') || actualContent.includes('type ');
      const hasComponents = actualContent.includes('function ') || 
                            actualContent.includes('const ') || 
                            actualContent.includes('class ');
      
      console.log(`- File contains interfaces/types: ${hasInterfaces ? 'Yes' : 'No'}`);
      console.log(`- File contains components/functions: ${hasComponents ? 'Yes' : 'No'}`);
      
      // Check if chunks match content - improved with structural analysis
      let chunksVerified = true;
      let interfacesVerified = true;
      let componentsVerified = true;
      
      // Try to parse the actual file content for accurate structure comparison
      let actualEntities = [];
      let actualMethods = new Set();
      let actualImports = [];
      let actualInterfaces = new Map();
      let actualTypes = new Map();
      let actualComponents = new Map();
      
      try {
        // Parse the actual code structure
        const { entities, dependencies } = parseCodeWithAST(result.filePath, actualContent);
        actualEntities = entities;
        
        // Build lookup maps for faster verification
        entities.forEach(entity => {
          if (entity.type === 'interface') {
            actualInterfaces.set(entity.name, entity);
          } else if (entity.type === 'type') {
            actualTypes.set(entity.name, entity);
          } else if (entity.type === 'react-component' || entity.type === 'function') {
            actualComponents.set(entity.name, entity);
          } else if (entity.type === 'method') {
            actualMethods.add(entity.name);
          }
        });
        
        // Store imports for validation
        actualImports = dependencies.imports;
        
        console.log(`- Found ${actualInterfaces.size} interfaces, ${actualTypes.size} types, ${actualComponents.size} components in actual file`);
      } catch (parseError) {
        console.log(`- Structural parsing failed, falling back to text-based verification: ${parseError.message}`);
      }
      
      // Track specific details on verification failures for better reporting
      const verificationDetails = {
        missingEntities: [],
        structuralMismatches: [],
        methodMismatches: [],
        implementationMismatches: []
      };
      
      if (result.chunks && result.chunks.length > 0) {
        console.log(`- Verifying ${result.chunks.length} chunks`);
        
        // Verify each chunk against the parsed structure and content
        for (const chunk of result.chunks) {
          console.log(`  - Chunk: ${chunk.type} ${chunk.name}`);
          
          // Enhanced structural validation - check if the entity exists with correct type
          let structureMatch = false;
          let foundEntityName = '';
          
          // Different validation approaches based on chunk type
          if (chunk.type === 'interface') {
            // Validate interface exists
            if (actualInterfaces.has(chunk.name)) {
              structureMatch = true;
              foundEntityName = chunk.name;
              
              // Check properties if we have them in both places
              if (chunk.metadata?.typeDefinition?.properties?.length > 0 && 
                  actualInterfaces.get(chunk.name).childEntities?.length > 0) {
                
                const chunkProps = new Set(chunk.metadata.typeDefinition.properties.map(p => p.name));
                const actualProps = new Set(actualInterfaces.get(chunk.name).childEntities.map(c => c.name));
                
                // Calculate property overlap percentage
                const intersection = [...chunkProps].filter(x => actualProps.has(x));
                const propMatchRatio = intersection.length / chunkProps.size;
                
                if (propMatchRatio < 0.5) {
                  structureMatch = false;
                  verificationDetails.structuralMismatches.push(
                    `Interface ${chunk.name} has different properties (match ratio: ${propMatchRatio.toFixed(2)})`
                  );
                }
              }
            } else {
              // Try case-insensitive search or similar name search
              const similarInterfaceNames = [...actualInterfaces.keys()].filter(
                name => name.toLowerCase() === chunk.name.toLowerCase() || 
                        name.replace(/Props$/, '') === chunk.name.replace(/Props$/, '') ||
                        (name.includes(chunk.name) && name.length < chunk.name.length + 5)
              );
              
              if (similarInterfaceNames.length > 0) {
                structureMatch = true;
                foundEntityName = similarInterfaceNames[0];
                verificationDetails.structuralMismatches.push(
                  `Interface name mismatch: found ${foundEntityName} instead of ${chunk.name}`
                );
              } else {
                verificationDetails.missingEntities.push(
                  `Interface ${chunk.name} not found in actual file`
                );
              }
            }
          } else if (chunk.type === 'type') {
            // Validate type exists
            if (actualTypes.has(chunk.name)) {
              structureMatch = true;
              foundEntityName = chunk.name;
            } else {
              // Similar approach for types
              const similarTypeNames = [...actualTypes.keys()].filter(
                name => name.toLowerCase() === chunk.name.toLowerCase() || 
                        (name.includes(chunk.name) && name.length < chunk.name.length + 5)
              );
              
              if (similarTypeNames.length > 0) {
                structureMatch = true;
                foundEntityName = similarTypeNames[0];
                verificationDetails.structuralMismatches.push(
                  `Type name mismatch: found ${foundEntityName} instead of ${chunk.name}`
                );
              } else {
                verificationDetails.missingEntities.push(
                  `Type ${chunk.name} not found in actual file`
                );
              }
            }
          } else if (chunk.type === 'react-component' || chunk.type === 'function') {
            // Validate component/function exists
            if (actualComponents.has(chunk.name)) {
              structureMatch = true;
              foundEntityName = chunk.name;
              
              // Check for method presence in components
              if (chunk.metadata?.methods?.length > 0) {
                const chunkMethods = new Set(chunk.metadata.methods);
                const missingMethods = [...chunkMethods].filter(m => !actualMethods.has(m));
                
                if (missingMethods.length > 0) {
                  verificationDetails.methodMismatches.push(
                    `Component/function ${chunk.name} is missing methods: ${missingMethods.join(', ')}`
                  );
                }
              }
            } else {
              // Try similar component names
              const similarComponentNames = [...actualComponents.keys()].filter(
                name => name.toLowerCase() === chunk.name.toLowerCase() || 
                        (name.includes(chunk.name) && name.length < chunk.name.length + 5)
              );
              
              if (similarComponentNames.length > 0) {
                structureMatch = true;
                foundEntityName = similarComponentNames[0];
                verificationDetails.structuralMismatches.push(
                  `Component/function name mismatch: found ${foundEntityName} instead of ${chunk.name}`
                );
              } else {
                verificationDetails.missingEntities.push(
                  `Component/function ${chunk.name} not found in actual file`
                );
              }
            }
          }
          
          // Fall back to content-based validation if structure check failed or for other types
          if (!structureMatch || !['interface', 'type', 'react-component', 'function'].includes(chunk.type)) {
            // Clean up chunk content for comparison (whitespace differences)
            const cleanedChunkContent = chunk.content
              .replace(/\s+/g, ' ')
              .trim();
            
            if (cleanedChunkContent.length > 15) { // Only check substantial chunks
              // Check if a reasonable amount of the chunk content is in the file
              const contentWords = cleanedChunkContent.split(/\s+/);
              const significantWords = contentWords.filter(word => word.length > 3);
              
              // Check what percentage of significant words appear in the file
              let matchCount = 0;
              for (const word of significantWords) {
                if (actualContent.includes(word)) {
                  matchCount++;
                }
              }
              
              // Calculate match ratio
              const matchRatio = significantWords.length > 0 ? 
                                matchCount / significantWords.length : 0;
              
              console.log(`    - Word match ratio: ${matchRatio.toFixed(2)} (${matchCount}/${significantWords.length})`);
              
              // More strict threshold for entities we claimed to find but failed structure check
              const thresholdFailed = (structureMatch === false && matchRatio < 0.6) || 
                                    (!structureMatch && matchRatio < 0.4);
              
              if (significantWords.length > 0 && thresholdFailed) {
                chunksVerified = false;
                console.log(`    - Below threshold, marked as unverified`);
                
                verificationDetails.implementationMismatches.push(
                  `Content mismatch for ${chunk.type} ${chunk.name} (match ratio: ${matchRatio.toFixed(2)})`
                );
                
                // Track which type of entities failed verification
                if (chunk.type === 'interface' || chunk.type === 'type') {
                  interfacesVerified = false;
                  console.log(`    - Interface/type verification failed`);
                } else if (chunk.type === 'react-component' || 
                          (chunk.type === 'function' && /^[A-Z]/.test(chunk.name))) {
                  componentsVerified = false;
                  console.log(`    - Component verification failed`);
                }
              } else {
                console.log(`    - Above threshold, marked as verified`);
              }
            } else {
              console.log(`    - Chunk too small to verify reliably`);
            }
          } else {
            console.log(`    - Structure verified: ${foundEntityName}`);
          }
        }
      }
      
      // Log summary of validation with detailed failure information
      console.log(`- Validation summary for ${result.filePath}:`);
      console.log(`  - Content length matches: ${contentLengthMatches}`);
      console.log(`  - Chunks verified: ${chunksVerified}`);
      console.log(`  - Interfaces verified: ${hasInterfaces && interfacesVerified}`);
      console.log(`  - Components verified: ${hasComponents && componentsVerified}`);
      
      if (verificationDetails.missingEntities.length > 0) {
        console.log(`  - Missing entities: ${verificationDetails.missingEntities.length}`);
        verificationDetails.missingEntities.forEach(detail => console.log(`    - ${detail}`));
      }
      
      if (verificationDetails.structuralMismatches.length > 0) {
        console.log(`  - Structural mismatches: ${verificationDetails.structuralMismatches.length}`);
        verificationDetails.structuralMismatches.forEach(detail => console.log(`    - ${detail}`));
      }
      
      // More lenient verification approach - if file exists, mark as at least partially valid
      // This helps prevent overly aggressive filtering
      const contentMatchesResult = contentLengthMatches || chunksVerified;
      const interfacesVerifiedResult = !hasInterfaces || interfacesVerified;
      const componentsVerifiedResult = !hasComponents || componentsVerified;
      
      return {
        ...result,
        isVerified: true,
        verified: {
          fileExists: true,
          contentMatches: contentMatchesResult,
          interfacesVerified: interfacesVerifiedResult,
          componentsVerified: componentsVerifiedResult,
          lastModified,
          verificationDetails // Add detailed verification information
        }
      };
    } catch (error) {
      console.error(`Error validating content for ${result.filePath}:`, error);
      // Mark the file as existing but with unknown content
      // This is less destructive than marking everything as failed
      return {
        ...result,
        isVerified: true,
        verified: {
          fileExists: true,
          contentMatches: true, // Assume content matches to avoid filtering out potentially useful results
          interfacesVerified: true,
          componentsVerified: true,
          lastModified: fs.statSync(result.filePath).mtime.getTime()
        }
      };
    }
  });
}

/**
 * Calculate a confidence score for a search result based on various factors
 * 
 * @param result The search result to score
 * @param searchTerms Search terms from the query
 * @param potentialFileNames Potential file names from the query
 * @returns A confidence score between 0 and 1
 */
export function calculateConfidenceScore(
  result: SearchResult, 
  searchTerms: string[],
  potentialFileNames: string[]
): number {
  let score = 0;
  
  // Base score from relevance (normalized)
  score += Math.min(result.relevanceScore / 100, 0.3);
  
  // File name match (high confidence factor)
  const fileName = path.basename(result.filePath);
  const fileNameWithoutExt = fileName.substring(0, fileName.lastIndexOf('.'));
  
  if (potentialFileNames.some(name => name === fileNameWithoutExt)) {
    score += 0.3; // Exact match
  } else if (potentialFileNames.some(name => fileNameWithoutExt.includes(name))) {
    score += 0.15; // Partial match
  }
  
  // Content relevance
  const contentTermMatches = searchTerms.filter(term => 
    result.content.toLowerCase().includes(term.toLowerCase())
  ).length;
  
  score += (contentTermMatches / Math.max(searchTerms.length, 1)) * 0.2;
  
  // Verification boost/penalty - less severe penalties
  if (result.isVerified) {
    if (result.verified?.fileExists) {
      // Boost for file existence
      score += 0.1;
      
      if (result.verified?.contentMatches) {
        // Boost for content match
        score += 0.1;
      } else {
        // Less severe penalty for content mismatch
        score -= 0.1;
      }
      
      // Less severe penalty for interface/component verification
      if (!result.verified?.interfacesVerified && !result.verified?.componentsVerified) {
        // Only penalize if both fail
        score -= 0.1;
      }
    } else {
      // File doesn't exist - significant but reduced confidence penalty
      score = Math.max(score - 0.5, 0.05); // Increased floor from 0 to 0.05
    }
  }
  
  // Entity relationships (boost confidence if we have valid relationships)
  if (result.chunks?.some(chunk => 
      chunk.metadata.relationshipContext?.relatedComponents?.length ||
      chunk.metadata.relationshipContext?.usedInComponents?.length
  )) {
    score += 0.1;
  }
  
  // Clamp to [0, 1] range
  return Math.max(0, Math.min(1, score));
}

/**
 * Identify potential hallucinations in search results
 * 
 * @param results The search results to analyze
 * @returns A set of indices for results that are likely hallucinations
 */
export function identifyHallucinations(results: SearchResult[]): Set<number> {
  const hallucinations = new Set<number>();
  
  results.forEach((result, index) => {
    // Definite hallucination - file doesn't exist
    if (result.isVerified && !result.verified?.fileExists) {
      hallucinations.add(index);
      return;
    }
    
    // Potential hallucination - file exists but content doesn't match
    if (result.isVerified && !result.verified?.contentMatches) {
      // Only mark as hallucination if interface/component verification also failed
      if (!result.verified?.interfacesVerified || !result.verified?.componentsVerified) {
        hallucinations.add(index);
        return;
      }
    }
    
    // Potential hallucination - low confidence score
    // Increased threshold from 0.05 to 0.6 to strictly filter out hallucinations
    if (result.confidenceScore !== undefined && result.confidenceScore < 0.6) {
      hallucinations.add(index);
      return;
    }
    
    // Check for inconsistent relationship patterns
    if (result.chunks) {
      const interfaceNames = result.chunks
        .filter(chunk => chunk.type === 'interface')
        .map(chunk => chunk.name);
      
      const componentNames = result.chunks
        .filter(chunk => chunk.type === 'react-component')
        .map(chunk => chunk.name);
      
      // Check if interface claims to be used by component that doesn't exist
      const hasInvalidRelationships = result.chunks.some(chunk => {
        if (chunk.type === 'interface' && chunk.metadata.relationshipContext?.usedInComponents) {
          return chunk.metadata.relationshipContext.usedInComponents.some(
            comp => !componentNames.includes(comp)
          );
        }
        return false;
      });
      
      if (hasInvalidRelationships) {
        hallucinations.add(index);
      }
    }
  });
  
  return hallucinations;
}

/**
 * Apply all enhancement methods to improve search results
 * 
 * @param results Raw search results to enhance
 * @param searchTerms Search terms from the query
 * @param potentialFileNames Potential file names from the query
 * @returns Enhanced search results
 */
export function enhanceSearchResults(
  results: SearchResult[],
  searchTerms: string[],
  potentialFileNames: string[]
): SearchResult[] {
  // First, validate content against actual files
  const validatedResults = validateSearchResultContent(results);
  
  // Cross-validate entity references
  const crossValidatedResults = validatedResults.map(result => 
    validateEntityReferences(result, validatedResults)
  );
  
  // Calculate confidence scores
  const scoredResults = crossValidatedResults.map(result => ({
    ...result,
    confidenceScore: calculateConfidenceScore(result, searchTerms, potentialFileNames)
  }));
  
  // Identify and remove hallucinations
  const hallucinations = identifyHallucinations(scoredResults);
  const filteredResults = scoredResults.filter((_, index) => !hallucinations.has(index));
  
  // Sort by confidence score
  return filteredResults.sort((a, b) => 
    (b.confidenceScore || 0) - (a.confidenceScore || 0)
  );
}