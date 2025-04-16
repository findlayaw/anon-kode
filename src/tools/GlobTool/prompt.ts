export const TOOL_NAME_FOR_PROMPT = 'GlobTool'

export const DESCRIPTION = `- Fast file pattern matching tool that works with any codebase size
- Supports glob patterns like "**/*.js" or "src/**/*.ts"
- Returns matching file paths sorted by modification time
- Use this tool when you need to find files by name patterns
- When you are doing an open ended search that may require multiple rounds of globbing and grepping, use the Agent tool instead
- When you need to find the root cause of an issue or understand code structure, use the ContextEngine instead - it will search and read files for you
`
