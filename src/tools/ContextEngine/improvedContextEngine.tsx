import { TextBlock } from '@anthropic-ai/sdk/resources/index.mjs'
import { Box } from 'ink'
import React from 'react'
import { z } from 'zod'
import { Tool } from '../../Tool'
import { FallbackToolUseRejectedMessage } from '../../components/FallbackToolUseRejectedMessage'
import { HighlightedCode } from '../../components/HighlightedCode'
import { getCwd } from '../../utils/state'
import { createUserMessage } from '../../utils/messages'
import { query } from '../../query'
import { getContext } from '../../context'
import { lastX } from '../../utils/generators'
import { grantReadPermissionForOriginalDir } from '../../utils/permissions/filesystem'
import { GrepTool } from '../GrepTool/GrepTool'
import { GlobTool } from '../GlobTool/GlobTool'
import { FileReadTool } from '../FileReadTool/FileReadTool'
import { LSTool } from '../lsTool/lsTool'
import { DESCRIPTION, SYSTEM_PROMPT } from './prompt'
import { TOOL_NAME } from './constants'
import path from 'path'
import fs from 'fs'
import { isRunningInWSL } from '../../utils/file'

// Import our improved utilities
import { chunkCodeWithContext, connectChunkRelationships, groupChunksByRelationship } from './improvedChunking'
import { findPathWithCorrectCase, findSimilarPaths, normalizePath, formatPathForDisplay, isLikelyUIComponent } from './filePathUtils'
import { 
  extractSearchTerms, 
  extractPotentialFileNames,
  createAdvancedGlobPatterns,
  createContentSearchPatterns, 
  SearchResult,
  rankSearchResults,
  enhanceSearchResults,
  formatSearchResults
} from './searchUtils'

const inputSchema = z.strictObject({
  information_request: z
    .string()
    .describe('A description of the information you need from the codebase'),
  file_type: z
    .string()
    .describe('Optional filter for specific file types (e.g., "ts", "js", "tsx")')
    .optional(),
  directory: z
    .string()
    .describe('Optional filter to search only within a specific directory')
    .optional(),
  include_dependencies: z
    .boolean()
    .describe('Whether to include dependency information in the results')
    .optional(),
  max_results: z
    .number()
    .describe('Maximum number of results to return')
    .optional(),
  search_mode: z
    .enum(['hybrid', 'keyword', 'semantic'])
    .describe('Search mode to use: hybrid (default), keyword, or semantic')
    .optional()
})

// Tools that the ContextEngine can use for searching the codebase
const SEARCH_TOOLS: Tool[] = [
  GrepTool,
  GlobTool,
  FileReadTool,
  LSTool,
]

export const ImprovedContextEngine = {
  name: TOOL_NAME,
  async description() {
    return DESCRIPTION
  },
  inputSchema,
  isReadOnly() {
    return true
  },
  userFacingName() {
    return 'Code Context'
  },
  async isEnabled() {
    return true
  },
  needsPermissions() {
    return false
  },
  async *call({ information_request, file_type, directory, include_dependencies = true, max_results = 10, search_mode = 'hybrid' }, toolUseContext, canUseTool) {
    // Ensure we have read permissions for the filesystem
    grantReadPermissionForOriginalDir()

    // Build an enhanced query with metadata filters if provided
    let enhancedQuery = information_request

    // Add metadata filters to the query if provided
    const filters = []
    if (file_type) {
      filters.push(`file_type:${file_type}`)
    }
    if (directory) {
      // Convert Windows path to WSL path if needed
      let directoryPath = normalizePath(directory)
      filters.push(`directory:${directoryPath}`)
    }
    if (include_dependencies) {
      filters.push('include_dependencies:true')
    }
    if (max_results) {
      filters.push(`max_results:${max_results}`)
    }
    if (search_mode) {
      filters.push(`search_mode:${search_mode}`)
    }

    // Extract search terms and potential file names from the query
    const searchTerms = extractSearchTerms(information_request)
    const potentialFileNames = extractPotentialFileNames(information_request)

    // Look for specific component or style-related terms
    const hasUIRelatedTerms = information_request.toLowerCase().includes('style') || 
                             information_request.toLowerCase().includes('component') ||
                             information_request.toLowerCase().includes('render') ||
                             information_request.toLowerCase().includes('dom')
                             
    // Look for data structure terms
    const hasDataStructureTerms = information_request.toLowerCase().includes('interface') || 
                                 information_request.toLowerCase().includes('type') ||
                                 information_request.toLowerCase().includes('props')
                                 
    // Look for relationship terms
    const hasRelationshipTerms = information_request.toLowerCase().includes('import') || 
                               information_request.toLowerCase().includes('use') ||
                               information_request.toLowerCase().includes('extends')

    console.log('Search terms:', searchTerms)
    console.log('Potential file names:', potentialFileNames)
    console.log('Query contains UI terms:', hasUIRelatedTerms)
    console.log('Query contains data structure terms:', hasDataStructureTerms)
    console.log('Query contains relationship terms:', hasRelationshipTerms)

    // Create advanced glob patterns for file matching
    const globPatterns = createAdvancedGlobPatterns(
      searchTerms,
      potentialFileNames,
      file_type,
      directory
    )

    // Create content search patterns for grep
    const contentPatterns = createContentSearchPatterns(
      searchTerms,
      potentialFileNames,
      search_mode
    )

    // Add filters and pattern information to the query
    if (filters.length > 0) {
      enhancedQuery += `\n\n<search_filters>\n${filters.join('\n')}\n</search_filters>\n\nIMPORTANT: Use the above filters when searching. The file_type filter specifies the extension of files to search for (e.g., "tsx", "js"). The directory filter specifies where to look for files.`
    }

    // Add glob patterns and content patterns for more precise searching
    enhancedQuery += `\n\n<glob_patterns>\n${globPatterns.slice(0, 10).join('\n')}\n</glob_patterns>`
    enhancedQuery += `\n\n<content_patterns>\n${contentPatterns.slice(0, 10).join('\n')}\n</content_patterns>`

    // Add hints based on query content
    if (information_request.toLowerCase().includes('dashboard')) {
      enhancedQuery += '\n\nHint: Check in src/components/dashboard/ directory for dashboard components.'
    }
    if (information_request.toLowerCase().includes('utils') ||
        information_request.toLowerCase().includes('datautils') ||
        information_request.toLowerCase().includes('data utils')) {
      enhancedQuery += '\n\nHint: Look for utility files in src/components/dashboard/utils/ or similar directories.'
    }

    const userMessage = createUserMessage(enhancedQuery)
    const messages = [userMessage]

    // Use the SEARCH_TOOLS directly instead of filtering from toolUseContext.options.tools
    const allowedTools = SEARCH_TOOLS

    // Create a custom canUseTool function that always grants permission for our search tools
    const contextEngineCanUseTool = async (tool: Tool, input: any) => {
      // Always allow our search tools
      if (SEARCH_TOOLS.map(_ => _.name).includes(tool.name)) {
        return { result: true }
      }
      // For other tools, use the original canUseTool function
      return canUseTool(tool, input, toolUseContext)
    }

    // Create a modified context with dangerouslySkipPermissions set to true
    const modifiedContext = {
      ...toolUseContext,
      options: {
        ...toolUseContext.options,
        tools: allowedTools,
        dangerouslySkipPermissions: true  // This is the key change
      },
    }

    // Add additional context about the codebase structure
    const context = await getContext()

    // Process a basic search with the LLM to find the most relevant files
    console.log('Performing initial LLM-guided search...')
    const lastResponse = await lastX(
      query(
        messages,
        [SYSTEM_PROMPT],
        context,
        contextEngineCanUseTool,
        modifiedContext,
      ),
    )

    if (lastResponse.type !== 'assistant') {
      throw new Error(`Invalid response from API`)
    }

    const data = lastResponse.message.content.filter(_ => _.type === 'text')

    // Extract the text content from the assistant's response
    const responseText = data.map(item => item.text).join('\n')

    // Check if the response indicates no results or errors
    const noResultsIndicators = [
      "unable to find", "couldn't find", "could not find",
      "no results", "no files", "not found",
      "facing issues", "unable to provide", "unable to locate"
    ]

    const hasNoResults = noResultsIndicators.some(indicator =>
      responseText.toLowerCase().includes(indicator)
    )

    // Initialize search results array
    let searchResults: SearchResult[] = []

    // Process file paths mentioned in the response
    const filePathRegex = /Path:\s*([^\n]+)/g
    const filePaths: string[] = []
    let match

    while ((match = filePathRegex.exec(responseText)) !== null) {
      if (match[1]) {
        filePaths.push(match[1].trim())
      }
    }

    console.log(`Found ${filePaths.length} file paths in LLM response`)

    // If no results from LLM query, or it didn't find enough files,
    // perform an expanded direct search to complement or replace LLM results
    if (hasNoResults || filePaths.length < 2) {
      console.log('LLM did not find sufficient results, performing direct search...')
      
      // Adjust search strategy based on query type
      if (hasUIRelatedTerms) {
        console.log('Query contains UI-related terms, prioritizing component search...')
      }
      
      if (hasDataStructureTerms) {
        console.log('Query contains data structure terms, prioritizing interface and type search...')
      }
      
      if (hasRelationshipTerms) {
        console.log('Query contains relationship terms, prioritizing cross-file dependency search...')
      }

      try {
        // Get current working directory
        let cwd = getCwd()
        
        // For each potential file name, try direct file matching
        for (const fileName of potentialFileNames) {
          // Try the most common locations first
          const commonDirPatterns = [
            'src/components',
            'src/views',
            'src/pages',
            'components',
            'src',
            ''  // Current directory
          ]

          if (directory) {
            // Add the specified directory first
            commonDirPatterns.unshift(directory)
          }

          for (const dirPattern of commonDirPatterns) {
            // Create a glob pattern to find files with this name
            const nameWithoutExt = fileName.includes('.')
              ? fileName.substring(0, fileName.lastIndexOf('.'))
              : fileName

            // Create path with the directory pattern
            const searchPath = path.join(cwd, dirPattern)
            if (!fs.existsSync(searchPath)) continue

            // Look for case-insensitive matches in directory
            const foundFiles = fs.readdirSync(searchPath)
              .filter(file => {
                // Skip directories
                const fullPath = path.join(searchPath, file)
                if (fs.statSync(fullPath).isDirectory()) return false

                // Check if file name contains our search term
                return file.toLowerCase().includes(nameWithoutExt.toLowerCase())
              })
              .map(file => path.join(dirPattern, file))

            for (const foundFile of foundFiles) {
              // Add to filePaths if not already included
              if (!filePaths.includes(foundFile)) {
                filePaths.push(foundFile)
              }
            }
          }
        }

        // If we still haven't found any files, try broader glob patterns
        if (filePaths.length === 0) {
          console.log('Trying broader glob patterns...')
          
          // Use simpler but broader glob patterns for direct search
          const simpleGlobPatterns = [
            `**/*${file_type ? `.${file_type}` : '.{js,jsx,ts,tsx}'}`,
            '**/*.{jsx,tsx}', // React components
            '**/components/**/*',
            '**/views/**/*',
            '**/pages/**/*'
          ]

          // Try each pattern
          for (const pattern of simpleGlobPatterns) {
            try {
              const { exec } = require('child_process')
              // Use find command for better performance with large codebases
              const cmd = `find ${cwd} -path "${pattern}" -type f -not -path "*/node_modules/*" -not -path "*/.git/*" | head -10`
              const results = exec(cmd, { encoding: 'utf8' })
              
              if (results.stdout) {
                const foundFiles = results.stdout.split('\n').filter(Boolean)
                  .map(file => path.relative(cwd, file))
                
                for (const foundFile of foundFiles) {
                  if (!filePaths.includes(foundFile)) {
                    filePaths.push(foundFile)
                  }
                }
              }
            } catch (error) {
              console.error(`Error with glob pattern ${pattern}:`, error)
            }
          }
        }
      } catch (error) {
        console.error('Error in direct file search:', error)
      }
    }

    // Process each found file
    for (const filePath of filePaths) {
      try {
        // Handle path normalization
        let normalizedPath = normalizePath(filePath)
        
        // Find the file with the correct case
        const pathWithCorrectCase = findPathWithCorrectCase(normalizedPath)
        
        if (!pathWithCorrectCase) {
          console.log(`File not found with correct case: ${normalizedPath}`)
          
          // Try to find similar files
          const similarPaths = findSimilarPaths(normalizedPath)
          
          if (similarPaths.length > 0) {
            console.log(`Found ${similarPaths.length} similar paths to ${normalizedPath}`)
            
            // Add the most relevant similar path
            const mostRelevantPath = similarPaths[0]
            normalizedPath = mostRelevantPath
          } else {
            console.log(`No similar paths found for ${normalizedPath}`)
            continue
          }
        } else {
          normalizedPath = pathWithCorrectCase
        }
        
        // Read the file content
        const fileContent = fs.readFileSync(normalizedPath, 'utf-8')
        
        // Format the path for display (converting to Windows path in WSL)
        const displayPath = formatPathForDisplay(normalizedPath, true)
        
        // Process the file with our improved chunking
        const { chunks, entities, dependencies } = chunkCodeWithContext(normalizedPath, fileContent)
        
        // Connect chunk relationships
        const connectedChunks = connectChunkRelationships(chunks)
        
        // Add a new search result
        searchResults.push({
          filePath: normalizedPath,
          formattedDisplayPath: displayPath,
          content: fileContent,
          chunks: connectedChunks,
          relevanceScore: 0 // Will be calculated later
        })
      } catch (error) {
        console.error(`Error processing file ${filePath}:`, error)
      }
    }

    // Create a map of file relationships
    const fileRelationships = new Map<string, { 
      importedBy: string[], 
      exportsTo: string[], 
      components: string[],
      interfaces: string[],
      types: string[]
    }>()
    
    // Calculate file relationships if we have include_dependencies
    if (include_dependencies && searchResults.length > 0) {
      console.log('Calculating file relationships...')
      
      // First, create a map of all exports and entity types
      const exportMap = new Map<string, string>()
      const componentMap = new Map<string, string>()
      const interfaceMap = new Map<string, string>()
      const typeMap = new Map<string, string>()
      const propsInterfaceMap = new Map<string, string>() // Special map for Props interfaces
      
      // First pass - collect all entity information
      searchResults.forEach(result => {
        // Initialize the relationship object
        fileRelationships.set(result.filePath, { 
          importedBy: [], exportsTo: [], components: [], interfaces: [], types: [] 
        });
        
        // Categorize entities in this file
        const components: string[] = [];
        const interfaces: string[] = [];
        const types: string[] = [];
        
        // Process chunks to categorize entities
        result.chunks.forEach(chunk => {
          // Track exports
          if (chunk.metadata.isExported) {
            exportMap.set(chunk.name, result.filePath);
          }
          
          // Track components
          if (chunk.type === 'react-component' || 
             (chunk.type === 'function' && /^[A-Z]/.test(chunk.name))) {
            components.push(chunk.name);
            componentMap.set(chunk.name, result.filePath);
          }
          
          // Track interfaces
          if (chunk.type === 'interface') {
            interfaces.push(chunk.name);
            interfaceMap.set(chunk.name, result.filePath);
            
            // Special tracking for Props interfaces
            if (chunk.name.endsWith('Props') || chunk.name.includes('Props')) {
              propsInterfaceMap.set(chunk.name, result.filePath);
              
              // Try to identify the component this props interface belongs to
              const possibleComponentName = chunk.name.replace(/Props$/, '');
              if (componentMap.has(possibleComponentName)) {
                // Record the component-props relationship
                const componentFilePath = componentMap.get(possibleComponentName)!;
                const componentFileRel = fileRelationships.get(componentFilePath);
                if (componentFileRel) {
                  if (!componentFileRel.interfaces.includes(chunk.name)) {
                    componentFileRel.interfaces.push(chunk.name);
                  }
                }
              }
            }
          }
          
          // Track types
          if (chunk.type === 'type') {
            types.push(chunk.name);
            typeMap.set(chunk.name, result.filePath);
          }
        });
        
        // Update the file relationship object with entity lists
        const relationship = fileRelationships.get(result.filePath)!;
        relationship.components = components;
        relationship.interfaces = interfaces;
        relationship.types = types;
      });
      
      // Second pass - resolve import/export relationships between files
      searchResults.forEach(result => {
        const importedBy: string[] = [];
        const exportsTo: string[] = [];
        
        // Get all imports from this file's chunks
        const imports = result.chunks
          .filter(chunk => chunk.type === 'imports')
          .flatMap(chunk => chunk.metadata.relationshipContext?.imports || []);
        
        // For each import, check if it's exported by one of our files
        imports.forEach(importPath => {
          // For relative imports, resolve the path
          if (importPath.startsWith('.')) {
            const resolvedPath = path.resolve(path.dirname(result.filePath), importPath);
            
            // Check various file extensions
            const possiblePaths = [
              resolvedPath,
              `${resolvedPath}.js`,
              `${resolvedPath}.jsx`,
              `${resolvedPath}.ts`,
              `${resolvedPath}.tsx`,
              // Also check for index files
              `${resolvedPath}/index.js`,
              `${resolvedPath}/index.jsx`,
              `${resolvedPath}/index.ts`,
              `${resolvedPath}/index.tsx`
            ];
            
            // Find the matching file in our results
            const matchingResult = searchResults.find(r => 
              possiblePaths.includes(r.filePath)
            );
            
            if (matchingResult) {
              exportsTo.push(matchingResult.filePath);
            }
          }
        });
        
        // For each exported chunk, check if it's imported by other files
        const exportedChunks = result.chunks.filter(chunk => chunk.metadata.isExported);
        
        if (exportedChunks.length > 0) {
          // Check if other files import from this file
          searchResults.forEach(otherResult => {
            if (otherResult.filePath === result.filePath) return;
            
            const otherImports = otherResult.chunks
              .filter(chunk => chunk.type === 'imports')
              .flatMap(chunk => chunk.metadata.relationshipContext?.imports || []);
            
            // Check if any imports in otherResult reference this file
            if (otherImports.some(imp => {
              // For relative imports, resolve the path
              if (imp.startsWith('.')) {
                const resolvedPath = path.resolve(path.dirname(otherResult.filePath), imp);
                
                // Check various file patterns
                return (
                  resolvedPath === result.filePath || 
                  resolvedPath === result.filePath.replace(/\.[^.]+$/, '') || // Without extension 
                  `${resolvedPath}.js` === result.filePath || 
                  `${resolvedPath}.jsx` === result.filePath || 
                  `${resolvedPath}.ts` === result.filePath || 
                  `${resolvedPath}.tsx` === result.filePath
                );
              }
              return false;
            })) {
              importedBy.push(otherResult.filePath);
            }
          });
        }
        
        // Add to relationships map
        const relationship = fileRelationships.get(result.filePath)!;
        relationship.importedBy = importedBy;
        relationship.exportsTo = exportsTo;
      });
      
      // Third pass - identify component-props relationships that might have been missed
      searchResults.forEach(result => {
        // Find interfaces in this file that might be component props
        const propsInterfaces = result.chunks.filter(chunk => 
          chunk.type === 'interface' && 
          (chunk.name.endsWith('Props') || chunk.name.includes('Props'))
        );
        
        propsInterfaces.forEach(propsInterface => {
          // Try to find a component that might use these props
          const possibleComponentName = propsInterface.name.replace(/Props$/, '');
          
          // Look for this component in our search results
          searchResults.forEach(componentResult => {
            const componentChunk = componentResult.chunks.find(chunk => 
              (chunk.type === 'react-component' || 
               (chunk.type === 'function' && /^[A-Z]/.test(chunk.name))) && 
              chunk.name === possibleComponentName
            );
            
            if (componentChunk) {
              // Update the interface chunk with the component relationship
              propsInterface.metadata.relationshipContext = {
                ...propsInterface.metadata.relationshipContext,
                usedInComponents: [
                  ...(propsInterface.metadata.relationshipContext?.usedInComponents || []),
                  componentChunk.name
                ]
              };
              
              // Update the component chunk with the props relationship
              componentChunk.metadata.relationshipContext = {
                ...componentChunk.metadata.relationshipContext,
                relatedComponents: [
                  ...(componentChunk.metadata.relationshipContext?.relatedComponents || []),
                  propsInterface.name
                ]
              };
              
              // Also update the type definition
              if (propsInterface.metadata.typeDefinition) {
                propsInterface.metadata.typeDefinition = {
                  ...propsInterface.metadata.typeDefinition,
                  isComponentProps: true,
                  referencedBy: [
                    ...(propsInterface.metadata.typeDefinition.referencedBy || []),
                    componentChunk.name
                  ]
                };
              }
            }
          });
        });
      });
      
      // Update all chunks with the relationship data
      searchResults = searchResults.map(result => {
        const relationship = fileRelationships.get(result.filePath);
        
        if (relationship) {
          // Update each chunk with the file relationship data
          const updatedChunks = result.chunks.map(chunk => {
            // Add entity-specific relationship data
            let entityRelationships = {};
            
            // For interfaces, add special relationship data
            if (chunk.type === 'interface') {
              // Find components using this interface
              const usedInComponents = relationship.components.filter(comp => {
                // Check if this could be a props interface for the component
                return (
                  chunk.name === `${comp}Props` || 
                  chunk.name.includes(`${comp}Props`) ||
                  comp.includes(chunk.name.replace(/Props$/, ''))
                );
              });
              
              if (usedInComponents.length > 0) {
                entityRelationships = {
                  usedInComponents
                };
              }
            }
            
            // For components, add related interfaces
            if (chunk.type === 'react-component' || 
               (chunk.type === 'function' && /^[A-Z]/.test(chunk.name))) {
              
              // Find interfaces that might be props for this component
              const relatedInterfaces = relationship.interfaces.filter(intf => 
                intf === `${chunk.name}Props` || 
                intf.includes(`${chunk.name}Props`)
              );
              
              if (relatedInterfaces.length > 0) {
                entityRelationships = {
                  relatedComponents: relatedInterfaces
                };
              }
            }
            
            return {
              ...chunk,
              metadata: {
                ...chunk.metadata,
                relationshipContext: {
                  ...chunk.metadata.relationshipContext,
                  importedBy: relationship.importedBy,
                  exportsTo: relationship.exportsTo,
                  ...entityRelationships
                }
              }
            };
          });
          
          return {
            ...result,
            chunks: updatedChunks
          };
        }
        
        return result;
      });
    }
    
    // Rank results by relevance to the search terms
    searchResults = rankSearchResults(searchResults, searchTerms, potentialFileNames)
    
    // Enhance and filter results to ensure completeness
    searchResults = enhanceSearchResults(searchResults, searchTerms, max_results)
    
    // Check if we have any results
    if (searchResults.length === 0) {
      // Handle the no results case
      let formattedResponse = "I couldn't find any code matching your query. This could be due to:\n\n"
      formattedResponse += "1. The files might exist with different names than expected\n"
      formattedResponse += "2. The code might be in different directories than searched\n"
      formattedResponse += "3. The naming conventions might differ from what was expected\n\n"
      
      if (searchTerms.length > 0) {
        formattedResponse += `I was searching for terms: ${searchTerms.join(', ')}\n\n`
      }
      
      if (potentialFileNames.length > 0) {
        formattedResponse += `Potential file names extracted: ${potentialFileNames.join(', ')}\n\n`
      }
      
      // Add filter information
      if (filters.length > 0) {
        formattedResponse += "Search filters applied:\n"
        filters.forEach(filter => {
          formattedResponse += `- ${filter}\n`
        })
        formattedResponse += "\n"
      }
      
      // Add suggestions
      formattedResponse += "Try one of these approaches:\n"
      formattedResponse += "- Provide a more specific file path if you know it\n"
      formattedResponse += "- Use broader search terms\n"
      formattedResponse += "- Specify a different directory to search in\n"
      formattedResponse += "- Change the file type filter\n"
      
      yield {
        type: 'result',
        data: [{ type: 'text', text: formattedResponse }],
        resultForAssistant: formattedResponse,
      }
      return
    }
    
    // Format the results for display
    const formattedResponse = formatSearchResults(searchResults)
    
    // Add filters to the response
    let finalResponse = formattedResponse
    if (filters.length > 0) {
      finalResponse = `Search filters applied: ${filters.join(', ')}\n\n${formattedResponse}`
    }
    
    yield {
      type: 'result',
      data: [{ type: 'text', text: finalResponse }],
      resultForAssistant: finalResponse,
    }
  },
  async prompt() {
    return DESCRIPTION
  },
  renderResultForAssistant(data) {
    return data
  },
  renderToolUseMessage({ information_request, file_type, directory, include_dependencies, max_results, search_mode }) {
    let message = `information_request: "${information_request}"`

    if (file_type) {
      message += `, file_type: "${file_type}"`
    }
    if (directory) {
      message += `, directory: "${directory}"`
    }
    if (include_dependencies) {
      message += `, include_dependencies: ${include_dependencies}`
    }
    if (max_results) {
      message += `, max_results: ${max_results}`
    }
    if (search_mode) {
      message += `, search_mode: "${search_mode}"`
    }

    return message
  },
  renderToolResultMessage(content) {
    return (
      <Box flexDirection="column" gap={1}>
        <HighlightedCode
          code={content.map(_ => _.text).join('\n')}
          language="markdown"
        />
      </Box>
    )
  },
  renderToolUseRejectedMessage() {
    return <FallbackToolUseRejectedMessage />
  },
} satisfies Tool<typeof inputSchema, TextBlock[]>