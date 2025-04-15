import { TextBlock } from '@anthropic-ai/sdk/resources/index.mjs'
import { Box } from 'ink'
import React from 'react'
import { z } from 'zod'
import { Tool } from '../../Tool'
import { FallbackToolUseRejectedMessage } from '../../components/FallbackToolUseRejectedMessage'
import { HighlightedCode } from '../../components/HighlightedCode'
import { getCwd, getOriginalCwd } from '../../utils/state'
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
import { parseCodeStructure, extractCodeChunks, getDependencyInfo } from './codeParser'
import { chunkCodeByStructure } from './chunking'
import { buildDependencyGraph, visualizeComponentRelationships, visualizeComponentHierarchy } from './dependencyGraph'
import { convertWindowsPathToWSL, convertWSLPathToWindows, isRunningInWSL, findDirectoryWithCorrectCase, findFileWithCorrectCase, findPathWithCorrectCase } from '../../utils/file'

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
    .enum(['hybrid', 'keyword', 'semantic', 'pattern'])
    .describe('Search mode to use: hybrid (default), keyword, semantic, or pattern-based')
    .optional(),
  context_lines: z
    .number()
    .describe('Number of context lines to include before and after the relevant code (default: 5)')
    .optional(),
  show_relationships: z
    .boolean()
    .describe('Whether to show component relationships and hierarchy')
    .optional(),
  exact_match: z
    .boolean()
    .describe('Whether to require exact matches for file names and paths')
    .optional(),
  search_pattern: z
    .string()
    .describe('Pattern to search for when using pattern search mode')
    .optional()
})

// Tools that the DispatchTool can use for searching the codebase
const SEARCH_TOOLS: Tool[] = [
  GrepTool,
  GlobTool,
  FileReadTool,
  LSTool,
]

export const DispatchTool = {
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
  async *call({ information_request, file_type, directory, include_dependencies, max_results, search_mode = 'hybrid', context_lines = 5, show_relationships = false, exact_match = false, search_pattern }, toolUseContext, canUseTool) {
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
      let directoryPath = directory
      if (isRunningInWSL() && directory.match(/^[a-zA-Z]:\\?/)) {
        directoryPath = convertWindowsPathToWSL(directory)
      }
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
    if (context_lines) {
      filters.push(`context_lines:${context_lines}`)
    }
    if (show_relationships) {
      filters.push(`show_relationships:true`)
    }
    if (exact_match) {
      filters.push(`exact_match:true`)
    }
    if (search_pattern) {
      filters.push(`search_pattern:"${search_pattern}"`)
    }

    // Add filters to the query in a more structured format
    if (filters.length > 0) {
      enhancedQuery += `\n\n<search_filters>\n${filters.join('\n')}\n</search_filters>\n\nIMPORTANT: Use the above filters when searching. The file_type filter specifies the extension of files to search for (e.g., "tsx", "js"). The directory filter specifies where to look for files.`
    }

    // Add a hint to check specific directories if they're mentioned in the query
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
    const dispatchCanUseTool = async (tool: Tool, input: any) => {
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

    const lastResponse = await lastX(
      query(
        messages,
        [SYSTEM_PROMPT],
        context,
        dispatchCanUseTool,
        modifiedContext,
      ),
    )

    if (lastResponse.type !== 'assistant') {
      throw new Error(`Invalid response from API`)
    }

    const data = lastResponse.message.content.filter(_ => _.type === 'text')

    // Format the response to look like the context engine output
    let formattedResponse = "The following code sections were retrieved:\n"

    // Extract the text content from the assistant's response
    const responseText = data.map(item => item.text).join('\n')

    // Define processedResponse at the top level of the function
    let processedResponse: string | undefined = undefined

    // Check if the response indicates no results or errors
    const noResultsIndicators = [
      "unable to find", "couldn't find", "could not find",
      "no results", "no files", "not found",
      "facing issues", "unable to provide", "unable to locate"
    ];

    const hasNoResults = noResultsIndicators.some(indicator =>
      responseText.toLowerCase().includes(indicator)
    );

    // If no results, try to provide helpful guidance
    if (hasNoResults) {
      // Try to find files using GlobTool directly
      try {
        // Get current working directory and handle Windows paths if needed
        let cwd = getCwd();
        if (isRunningInWSL() && cwd.match(/^[a-zA-Z]:\\?/)) {
          cwd = convertWindowsPathToWSL(cwd);
        }
        let suggestedFiles = [];

        // Look for files related to the query
        // First, try to extract potential file names from the information_request
        const fileNameMatches = information_request.match(/\b([A-Za-z]+(?:View|Form|Component|Page|Modal|Dialog)[A-Za-z]*)\b/g);

        if (fileNameMatches && fileNameMatches.length > 0) {
          // For each potential file name, try to find it in the codebase
          for (const potentialFileName of fileNameMatches) {
            // Try common directories
            const commonDirs = ['src/views', 'src/components', 'src/pages', 'src/forms'];

            for (const dir of commonDirs) {
              const dirPath = path.join(cwd, dir);

              // Try to find the directory with case-insensitive matching
              const dirWithCorrectCase = findDirectoryWithCorrectCase(dirPath);

              if (dirWithCorrectCase) {
                // Get all files in the directory
                const files = fs.readdirSync(dirWithCorrectCase);

                // Look for case-insensitive matches
                const matchingFiles = files.filter(file =>
                  file.toLowerCase().includes(potentialFileName.toLowerCase()));

                if (matchingFiles.length > 0) {
                  console.log(`Found ${matchingFiles.length} files matching '${potentialFileName}' in directory: ${dirWithCorrectCase}`);
                  suggestedFiles.push(...matchingFiles.map(f => `${dir}/${f}`));
                }
              } else {
                // Try to find a similar directory
                const parentDir = path.dirname(dirPath);
                if (fs.existsSync(parentDir)) {
                  const dirs = fs.readdirSync(parentDir);
                  const similarDirs = dirs.filter(d =>
                    fs.statSync(path.join(parentDir, d)).isDirectory() &&
                    d.toLowerCase().includes(path.basename(dir).toLowerCase()));

                  if (similarDirs.length > 0) {
                    console.log(`Directory '${dir}' not found, but found similar directories: ${similarDirs.join(', ')}`);
                    // Check these similar directories for matching files
                    for (const similarDir of similarDirs) {
                      const similarDirPath = path.join(parentDir, similarDir);
                      const files = fs.readdirSync(similarDirPath);
                      const matchingFiles = files.filter(file =>
                        file.toLowerCase().includes(potentialFileName.toLowerCase()));

                      if (matchingFiles.length > 0) {
                        const relativePath = path.join(path.relative(cwd, parentDir), similarDir);
                        suggestedFiles.push(...matchingFiles.map(f => `${relativePath}/${f}`));
                      }
                    }
                  }
                }
              }
            }
          }
        }

        // Look for dashboard components as before
        if (information_request.toLowerCase().includes('dashboard')) {
          const dashboardFiles = fs.existsSync(path.join(cwd, 'src/components/dashboard')) ?
            fs.readdirSync(path.join(cwd, 'src/components/dashboard')) : [];

          suggestedFiles.push(...dashboardFiles.map(f => `src/components/dashboard/${f}`));

          // Check for utils directory
          const utilsPath = path.join(cwd, 'src/components/dashboard/utils');
          if (fs.existsSync(utilsPath)) {
            const utilsFiles = fs.readdirSync(utilsPath);
            suggestedFiles.push(...utilsFiles.map(f => `src/components/dashboard/utils/${f}`));
          }

          // Check for components directory
          const componentsPath = path.join(cwd, 'src/components/dashboard/components');
          if (fs.existsSync(componentsPath)) {
            const componentFiles = fs.readdirSync(componentsPath);
            suggestedFiles.push(...componentFiles.map(f => `src/components/dashboard/components/${f}`));
          }
        }

        if (suggestedFiles.length > 0) {
          // If we found exactly one file and it matches what the user is looking for,
          // let's read it and analyze it instead of just suggesting it
          if (suggestedFiles.length === 1 &&
              information_request.toLowerCase().includes(path.basename(suggestedFiles[0]).toLowerCase())) {

            console.log(`Found exact file match: ${suggestedFiles[0]}. Reading and analyzing it...`);

            // Flag to track if we successfully read the file
            let fileReadSuccess = false;

            try {
              // Get the full path to the file
              const filePath = path.join(cwd, suggestedFiles[0]);

              // Use our improved file path handling
              const fileWithCorrectCase = findFileWithCorrectCase(filePath);

              if (fileWithCorrectCase) {
                const fileContent = fs.readFileSync(fileWithCorrectCase, 'utf-8');

                // Add this file to the response for the LLM to analyze
                formattedResponse = `The following code sections were retrieved:\nPath: ${suggestedFiles[0]}\n${fileContent}\n`;

                // Continue with normal processing instead of returning early
                processedResponse = formattedResponse;
                fileReadSuccess = true;
              }
            } catch (error) {
              console.error(`Error reading file: ${error}`);
              // Fall back to just suggesting the file
            }

            // If we successfully read the file, we'll return early
            if (fileReadSuccess) {
              // Return early with the file content
              yield {
                type: 'result',
                data: [{ type: 'text', text: formattedResponse }],
                resultForAssistant: formattedResponse,
              };
              return;
            }
          }

          // If we didn't read and analyze the file above, just suggest the files
          if (!processedResponse) {
            formattedResponse = `I found some potentially relevant files that might help with your query:\n\n`;
            suggestedFiles.forEach(file => {
              formattedResponse += `- ${file}\n`;
            });
            formattedResponse += `\nPlease try a more specific query targeting one of these files.`;

            // Return early with the suggestions
            yield {
              type: 'result',
              data: [{ type: 'text', text: formattedResponse }],
              resultForAssistant: formattedResponse,
            };
            return;
          }
        } else {
          // No files found, provide a more helpful error message
          formattedResponse = `I couldn't find any files matching your query. This could be due to:\n\n`;
          formattedResponse += `1. The file might exist with a different case than expected (e.g., 'TradeFormView.tsx' vs 'tradeformview.tsx')\n`;
          formattedResponse += `2. The file might be in a different directory than the ones I searched\n`;
          formattedResponse += `3. The file might have a slightly different name than what was extracted from your query\n\n`;

          // Extract what we were looking for to make the message more helpful
          if (fileNameMatches && fileNameMatches.length > 0) {
            formattedResponse += `I was looking for files containing: ${fileNameMatches.join(', ')}\n\n`;
          }

          // Add information about the search filters that were applied
          if (filters.length > 0) {
            formattedResponse += `Search filters applied:\n`;
            filters.forEach(filter => {
              formattedResponse += `- ${filter}\n`;
            });
            formattedResponse += `\n`;
          }

          // Add specific advice for file_type filter
          if (file_type) {
            formattedResponse += `Note: I was specifically looking for files with the extension '${file_type}'. `;
            formattedResponse += `If the file exists with a different extension, try removing the file_type filter or changing it.\n\n`;
          }

          // Add specific advice for directory filter
          if (directory) {
            formattedResponse += `Note: I was specifically looking in the directory '${directory}'. `;
            formattedResponse += `If the file exists in a different directory, try removing the directory filter or changing it.\n\n`;
          }

          formattedResponse += `Try one of these approaches:\n`;
          formattedResponse += `- Provide the exact file path if you know it\n`;
          formattedResponse += `- Use a more general search term\n`;
          formattedResponse += `- Specify a different directory to search in\n`;

          yield {
            type: 'result',
            data: [{ type: 'text', text: formattedResponse }],
            resultForAssistant: formattedResponse,
          };
          return;
        }
      } catch (error) {
        console.error('Error while trying to suggest files:', error);
      }
    }

    // Process the response to enhance it with additional context
    // Use the processedResponse variable defined earlier
    processedResponse = processedResponse || responseText

    // Convert any WSL paths in the response back to Windows paths
    if (isRunningInWSL()) {
      // Find paths like /mnt/c/... and convert them to C:\...
      const wslPathRegex = /\/mnt\/([a-z])\/([^\s"'<>]+)/g
      processedResponse = processedResponse.replace(wslPathRegex, (match, driveLetter, remainingPath) => {
        return `${driveLetter.toUpperCase()}:\\${remainingPath.replace(/\//g, '\\')}`
      })
    }

    // If include_dependencies or show_relationships is true, try to enhance the response with additional information
    if ((include_dependencies || show_relationships) && responseText.includes("Path:")) {
      try {
        // Extract file paths from the response
        const filePathRegex = /Path:\s*([^\n]+)/g
        const filePaths: string[] = []
        let match

        while ((match = filePathRegex.exec(responseText)) !== null) {
          if (match[1]) {
            filePaths.push(match[1].trim())
          }
        }

        // If show_relationships is true, build and visualize component relationships
        if (show_relationships && filePaths.length > 0) {
          try {
            // Build dependency graph from the files
            const { relationships } = buildDependencyGraph(filePaths)

            if (relationships.length > 0) {
              // Generate visualizations
              const relationshipsVisualization = visualizeComponentRelationships(relationships)
              const hierarchyVisualization = visualizeComponentHierarchy(relationships)

              // Add visualizations to the response
              processedResponse = processedResponse + "\n\n" + relationshipsVisualization + "\n\n" + hierarchyVisualization
            }
          } catch (error) {
            console.error('Error generating relationship visualizations:', error)
          }
        }

        // Process each file path
        for (const filePath of filePaths) {
          try {
            // Handle Windows paths if running in WSL
            let normalizedPath = filePath
            if (isRunningInWSL() && filePath.match(/^[a-zA-Z]:\\?/)) {
              normalizedPath = convertWindowsPathToWSL(filePath)
            }

            const fullPath = path.isAbsolute(normalizedPath) ? normalizedPath : path.resolve(getCwd(), normalizedPath)
            let actualFilePath = fullPath
            let fileContent = ''

            // Try to find the file with case-insensitive matching if it doesn't exist
            if (!fs.existsSync(fullPath)) {
              // Use our improved file path handling
              const fileWithCorrectCase = findFileWithCorrectCase(fullPath)

              if (fileWithCorrectCase) {
                // Use the file with correct case
                actualFilePath = fileWithCorrectCase
                fileContent = fs.readFileSync(actualFilePath, 'utf-8')
                console.log(`Found file with correct case: ${actualFilePath} (original: ${fullPath})`)
              } else {
                // If we get here, the file wasn't found even with case-insensitive matching
                console.error(`File not found: ${fullPath} (tried case-insensitive matching)`)
                continue // Skip to next file
              }
            } else {
              // File exists with the exact path
              fileContent = fs.readFileSync(fullPath, 'utf-8')
            }

            // Get dependency information
            const { imports, exports } = getDependencyInfo(actualFilePath, fileContent)

            // Use improved chunking to get better code structure information with context lines
            const chunks = chunkCodeByStructure(actualFilePath, fileContent, context_lines)

            // Create dependency section
            let dependencyInfo = '\n\nDependencies:'
            if (imports.length > 0) {
              dependencyInfo += `\nImports: ${imports.join(', ')}`
            }
            if (exports.length > 0) {
              dependencyInfo += `\nExports: ${exports.join(', ')}`
            }

            // Add structure information in a more concise format
            if (chunks.length > 0) {
              dependencyInfo += '\nStructure:'

              // Group chunks by type for better organization
              const groupedChunks = chunks.reduce((acc, chunk) => {
                const type = chunk.type
                if (!acc[type]) acc[type] = []
                acc[type].push(chunk)
                return acc
              }, {} as Record<string, typeof chunks>)

              // Add each type of chunk to the dependency info
              Object.entries(groupedChunks).forEach(([type, typeChunks]) => {
                if (type !== 'imports' && typeChunks.length > 0) {
                  dependencyInfo += `\n  ${type}s (${typeChunks.length}):`
                  typeChunks.forEach(chunk => {
                    let chunkInfo = `\n    - ${chunk.name}`
                    if (chunk.metadata.parentName) {
                      chunkInfo += ` (in ${chunk.metadata.parentName})`
                    }
                    chunkInfo += ` (lines ${chunk.startLine}-${chunk.endLine})`
                    dependencyInfo += chunkInfo
                  })
                }
              })
            }

            // Add dependency information to the response
            processedResponse = processedResponse.replace(
              new RegExp(`(Path:\s*${filePath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[^]*?)(?=Path:|$)`, 's'),
              `$1${dependencyInfo}\n\n`
            )
          } catch (fileError) {
            console.error(`Error processing dependencies for ${filePath}:`, fileError)
          }
        }
      } catch (error) {
        console.error('Error processing dependencies:', error)
      }
    }

    // If the response already has the expected format, use it directly
    if (responseText.includes("Path:") || processedResponse.includes("Path:")) {
      formattedResponse = processedResponse
    } else {
      // Otherwise, wrap it in our format
      formattedResponse += processedResponse
    }

    // Check if the response is empty or just contains the header
    if (formattedResponse.trim() === "The following code sections were retrieved:" ||
        formattedResponse.includes("(no content)")) {
      console.log("Empty response detected, adding debug information")
      formattedResponse += "\n\nDebug information:\n"
      formattedResponse += `- processedResponse length: ${processedResponse?.length || 0}\n`
      formattedResponse += `- responseText length: ${responseText?.length || 0}\n`
      formattedResponse += `- filters: ${filters.join(', ')}\n`

      // Try to read the file directly as a last resort
      if (directory) {
        try {
          const dirPath = directory
          const wslDirPath = isRunningInWSL() ? convertWindowsPathToWSL(dirPath) : dirPath
          const dirWithCorrectCase = findDirectoryWithCorrectCase(wslDirPath)

          if (dirWithCorrectCase) {
            console.log(`Found directory with correct case: ${dirWithCorrectCase}`)
            const files = fs.readdirSync(dirWithCorrectCase)
            formattedResponse += `\nFiles in directory: ${files.join(', ')}\n`

            // Look for TradeFormView.tsx specifically
            const tradeFormFile = files.find((file: string) =>
              file.toLowerCase() === 'tradeformview.tsx')

            if (tradeFormFile) {
              console.log(`Found TradeFormView.tsx with correct case: ${tradeFormFile}`)
              const filePath = path.join(dirWithCorrectCase, tradeFormFile)
              const fileContent = fs.readFileSync(filePath, 'utf-8')
              formattedResponse = `The following code sections were retrieved:\nPath: ${directory}\\${tradeFormFile}\n${fileContent}\n`
            }
          }
        } catch (error) {
          console.error(`Error in last resort file reading: ${error}`)
          formattedResponse += `\nError reading file directly: ${error}\n`
        }
      }
    }

    // Add a note about filters if they were applied
    if (filters.length > 0) {
      formattedResponse = `Search filters applied: ${filters.join(', ')}\n\n${formattedResponse}`
    }

    // Final check to ensure all paths are in Windows format
    if (isRunningInWSL()) {
      // Convert any remaining WSL paths to Windows paths
      const wslPathRegex = /\/mnt\/([a-z])\/([^\s"'<>]+)/g
      formattedResponse = formattedResponse.replace(wslPathRegex, (match, driveLetter, remainingPath) => {
        return `${driveLetter.toUpperCase()}:\\${remainingPath.replace(/\//g, '\\')}`
      })

      // Also convert any directory filters from WSL to Windows format
      if (formattedResponse.includes('directory:/mnt/')) {
        formattedResponse = formattedResponse.replace(/directory:\/mnt\/([a-z])\/([^\s,]+)/g, (match, driveLetter, remainingPath) => {
          return `directory:${driveLetter.toUpperCase()}:\\${remainingPath.replace(/\//g, '\\')}`
        })
      }
    }

    yield {
      type: 'result',
      data: [{ type: 'text', text: formattedResponse }],
      resultForAssistant: formattedResponse,
    }
  },
  async prompt() {
    return DESCRIPTION
  },
  renderResultForAssistant(data) {
    return data
  },
  renderToolUseMessage({ information_request, file_type, directory, include_dependencies, max_results, search_mode, context_lines, show_relationships, exact_match, search_pattern }) {
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
    if (context_lines) {
      message += `, context_lines: ${context_lines}`
    }
    if (show_relationships) {
      message += `, show_relationships: ${show_relationships}`
    }
    if (exact_match) {
      message += `, exact_match: ${exact_match}`
    }
    if (search_pattern) {
      message += `, search_pattern: "${search_pattern}"`
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
