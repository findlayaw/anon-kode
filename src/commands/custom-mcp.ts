import type { Command } from '../commands'
import { listMCPServers, getClients } from '../services/mcpClient'
import { PRODUCT_COMMAND } from '../constants/product'
import chalk from 'chalk'
import { getTheme } from '../utils/theme'

const customMcp = {
  type: 'local',
  name: 'custom-mcp',
  description: 'Show custom MCP server with limited tools',
  isEnabled: true,
  isHidden: false,
  async call() {
    return `⎿  To start the custom MCP server with limited tools, run \`${PRODUCT_COMMAND} mcp custom-serve\``
  },
  userFacingName() {
    return 'custom-mcp'
  },
} satisfies Command

export default customMcp
