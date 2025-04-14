import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  CallToolRequestSchema,
  CallToolResultSchema,
  ListToolsRequestSchema,
  ListToolsResultSchema,
  ToolSchema,
} from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod'
import { zodToJsonSchema } from 'zod-to-json-schema'
import { AgentTool } from '../tools/AgentTool/AgentTool'
import { hasPermissionsToUseTool } from '../permissions'
import { setCwd } from '../utils/state'
import { getSlowAndCapableModel } from '../utils/model'
import { logError } from '../utils/log'
import { BashTool } from '../tools/BashTool/BashTool'
import { DispatchTool } from '../tools/DispatchTool/DispatchTool'
import { GlobTool } from '../tools/GlobTool/GlobTool'
import { GrepTool } from '../tools/GrepTool/GrepTool'
import { MACRO } from '../constants/macros'
import { Command } from '../commands'
import review from '../commands/review'
import { lastX } from '../utils/generators'
import { Tool } from '../Tool'

type ToolInput = z.infer<typeof ToolSchema.shape.inputSchema>

const state: {
  readFileTimestamps: Record<string, number>
} = {
  readFileTimestamps: {},
}

const MCP_COMMANDS: Command[] = [review]

// Only include the tools we want to keep
// Excluded:
// - FileWriteTool
// - LSTool
// - FileEditTool
// - FileReadTool
// - MemoryReadTool
// - MemoryWriteTool
// - NotebookReadTool
// - NotebookEditTool
// - ThinkTool
// - BashTool
// - GlobTool
// - GrepTool
const MCP_TOOLS: Tool[] = [
  // AgentTool, // Disabled in favor of CodeContextTool
  // BashTool, // Hidden but still available for CodeContextTool
  DispatchTool,
  // GlobTool, // Hidden but still available for CodeContextTool
  // GrepTool, // Hidden but still available for CodeContextTool
]

export async function startCustomMCPServer(cwd: string): Promise<void> {
  await setCwd(cwd)
  const server = new Server(
    {
      name: 'claude/tengu-custom',
      version: MACRO.VERSION,
    },
    {
      capabilities: {
        tools: {},
      },
    },
  )

  server.setRequestHandler(
    ListToolsRequestSchema,
    async (): Promise<Zod.infer<typeof ListToolsResultSchema>> => {
      const tools = await Promise.all(
        MCP_TOOLS.map(async tool => ({
          ...tool,
          description: await tool.description(z.object({})),
          inputSchema: zodToJsonSchema(tool.inputSchema) as ToolInput,
        })),
      )

      return {
        tools,
      }
    },
  )

  server.setRequestHandler(
    CallToolRequestSchema,
    async (request): Promise<Zod.infer<typeof CallToolResultSchema>> => {
      const { name, arguments: args } = request.params
      const tool = MCP_TOOLS.find(_ => _.name === name)
      if (!tool) {
        throw new Error(`Tool ${name} not found`)
      }

      // TODO: validate input types with zod
      try {
        if (!(await tool.isEnabled())) {
          throw new Error(`Tool ${name} is not enabled`)
        }
        const model = await getSlowAndCapableModel()
        const validationResult = await tool.validateInput?.(
          (args as never) ?? {},
          {
            abortController: new AbortController(),
            options: {
              commands: MCP_COMMANDS,
              tools: MCP_TOOLS,
              slowAndCapableModel: model,
              forkNumber: 0,
              messageLogName: 'unused',
              maxThinkingTokens: 0,
            },
            messageId: undefined,
            readFileTimestamps: state.readFileTimestamps,
          },
        )
        if (validationResult && !validationResult.result) {
          throw new Error(
            `Tool ${name} input is invalid: ${validationResult.message}`,
          )
        }
        const result = tool.call(
          (args ?? {}) as never,
          {
            abortController: new AbortController(),
            messageId: undefined,
            options: {
              commands: MCP_COMMANDS,
              tools: MCP_TOOLS,
              slowAndCapableModel: await getSlowAndCapableModel(),
              forkNumber: 0,
              messageLogName: 'unused',
              maxThinkingTokens: 0,
            },
            readFileTimestamps: state.readFileTimestamps,
          },
          hasPermissionsToUseTool,
        )

        const finalResult = await lastX(result)

        if (finalResult.type !== 'result') {
          throw new Error(`Tool ${name} did not return a result`)
        }

        return {
          toolResult: finalResult.resultForAssistant,
        }
      } catch (error) {
        logError(error)
        throw error
      }
    },
  )

  async function runServer() {
    const transport = new StdioServerTransport()
    await server.connect(transport)
  }

  return await runServer()
}
