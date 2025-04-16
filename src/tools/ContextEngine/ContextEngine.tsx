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
import { CONTEXT_ENGINE_TOOL_NAME } from './constants'
import { executeProgressiveQuery } from './progressiveQueryEscalation'
import { getGlobalConfig } from '../../utils/config'
import { logEvent } from '../../services/statsig'
import path from 'path'
import fs from 'fs'
import { parseCodeStructure, extractCodeChunks, getDependencyInfo } from './codeParser'
import { chunkCodeByStructure } from './chunking'
import { convertWindowsPathToWSL, convertWSLPathToWindows, isRunningInWSL, findDirectoryWithCorrectCase } from '../../utils/file'

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

export const ContextEngine = {
  name: CONTEXT_ENGINE_TOOL_NAME,
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
    
    // Check if the models are configured
    const config = getGlobalConfig()
    const smallModelName = config.smallModelName
    const largeModelName = config.largeModelName

    if (!smallModelName || !largeModelName) {
      const errorMessage = "Progressive query model configuration is missing. Please configure both the small and large models."
      yield {
        type: 'result',
        data: [{ type: 'text', text: errorMessage }],
        resultForAssistant: errorMessage,
      }
      return
    }

    logEvent('context_engine_progressive_query_start', {
      smallModel: smallModelName,
      largeModel: largeModelName
    })

    // Build an enhanced query with metadata filters if provided
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

    // Create a custom canUseTool function that always grants permission for our search tools
    const contextEngineCanUseTool = async (tool: Tool, input: any) => {
      // Always allow our search tools
      if (SEARCH_TOOLS.map(_ => _.name).includes(tool.name)) {
        return { result: true }
      }
      // For other tools, use the original canUseTool function
      return canUseTool(tool, input, toolUseContext)
    }

    // Execute the progressive query
    try {
      const result = await executeProgressiveQuery(
        information_request,
        filters,
        toolUseContext,
        canUseTool,
        SEARCH_TOOLS,
        contextEngineCanUseTool
      )

      // Log the query results
      logEvent('context_engine_progressive_query_result', {
        successful: String(result.successful),
        escalated: String(result.escalated),
        modelUsed: result.modelUsed,
        durationMs: String(result.durationMs),
        inputTokens: result.inputTokens ? String(result.inputTokens) : 'unknown',
        outputTokens: result.outputTokens ? String(result.outputTokens) : 'unknown'
      })

      // Format the response
      let formattedResponse = result.response

      // Convert any WSL paths in the response back to Windows paths
      if (isRunningInWSL()) {
        // Find paths like /mnt/c/... and convert them to C:\...
        const wslPathRegex = /\/mnt\/([a-z])\/([^\s"'<>]+)/g
        formattedResponse = formattedResponse.replace(wslPathRegex, (match, driveLetter, remainingPath) => {
          return `${driveLetter.toUpperCase()}:\\${remainingPath.replace(/\//g, '\\')}`
        })
      }

      // Add filters to the response if they were applied
      if (filters.length > 0) {
        formattedResponse = `Search filters applied: ${filters.join(', ')}\n\n${formattedResponse}`
      }

      yield {
        type: 'result',
        data: [{ type: 'text', text: formattedResponse }],
        resultForAssistant: formattedResponse,
      }
    } catch (error) {
      console.error('Error in progressive query execution:', error)
      const errorMessage = `Error analyzing the codebase: ${error.message}\n\nPlease try again with a more specific query.`
      
      yield {
        type: 'result',
        data: [{ type: 'text', text: errorMessage }],
        resultForAssistant: errorMessage,
      }
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
