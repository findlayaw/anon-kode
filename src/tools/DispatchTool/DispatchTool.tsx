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

const inputSchema = z.strictObject({
  information_request: z
    .string()
    .describe('A description of the information you need from the codebase'),
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
  async *call({ information_request }, toolUseContext, canUseTool) {
    // Ensure we have read permissions for the filesystem
    grantReadPermissionForOriginalDir()

    const userMessage = createUserMessage(information_request)
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

    const lastResponse = await lastX(
      query(
        messages,
        [SYSTEM_PROMPT],
        await getContext(),
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

    // If the response already has the expected format, use it directly
    if (responseText.includes("Path:")) {
      formattedResponse = responseText
    } else {
      // Otherwise, wrap it in our format
      formattedResponse += responseText
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
  renderToolUseMessage({ information_request }) {
    return `information_request: "${information_request}"`
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
