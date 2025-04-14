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
  async *call({ information_request, file_type, directory, include_dependencies, max_results, search_mode = 'hybrid' }, toolUseContext, canUseTool) {
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
      filters.push(`directory:${directory}`)
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

    // Add filters to the query
    if (filters.length > 0) {
      enhancedQuery += `\n\nFilters: ${filters.join(', ')}`
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

    // Process the response to enhance it with additional context
    let processedResponse = responseText

    // If include_dependencies is true, try to enhance the response with dependency information
    if (include_dependencies && responseText.includes("Path:")) {
      // Extract file paths from the response
      const filePathRegex = /Path:\s*([^\n]+)/g
      const filePaths: string[] = []
      let match

      while ((match = filePathRegex.exec(responseText)) !== null) {
        if (match[1]) {
          filePaths.push(match[1].trim())
        }
      }

      // Add dependency information for each file
      for (const filePath of filePaths) {
        try {
          const fullPath = path.isAbsolute(filePath) ? filePath : path.resolve(getCwd(), filePath)
          if (fs.existsSync(fullPath)) {
            const fileContent = fs.readFileSync(fullPath, 'utf-8')

            // Get dependency information
            const { imports, exports } = getDependencyInfo(fullPath, fileContent)

            // Use improved chunking to get better code structure information
            const chunks = chunkCodeByStructure(fullPath, fileContent)

            // Create dependency section
            let dependencyInfo = '\n\nDependencies:';
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
          }
        } catch (error) {
          console.error(`Error processing dependencies for ${filePath}:`, error)
        }
      }
    }

    // If the response already has the expected format, use it directly
    if (responseText.includes("Path:")) {
      formattedResponse = processedResponse
    } else {
      // Otherwise, wrap it in our format
      formattedResponse += processedResponse
    }

    // Add a note about filters if they were applied
    if (filters.length > 0) {
      formattedResponse = `Search filters applied: ${filters.join(', ')}\n\n${formattedResponse}`
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
