/**
 * Code chunking utilities for the CodeContextTool
 * This module provides functions to split code into logical chunks for better context retrieval
 */

import * as path from 'path'
import { CodeEntity, parseCodeStructure } from './codeParser'

/**
 * Represents a code chunk with metadata
 */
export interface CodeChunk {
  content: string
  startLine: number
  endLine: number
  type: string
  name: string
  filePath: string
  metadata: Record<string, any>
}

/**
 * Split code into logical chunks based on code structure
 *
 * @param filePath Path to the file
 * @param fileContent Content of the file
 * @param contextLines Number of context lines to include before and after each chunk (default: 5)
 * @returns Array of code chunks
 */
export function chunkCodeByStructure(filePath: string, fileContent: string, contextLines: number = 5): CodeChunk[] {
  // Parse the code structure
  const entities = parseCodeStructure(filePath, fileContent)
  const lines = fileContent.split('\n')
  const chunks: CodeChunk[] = []

  // If no entities were found, create a single chunk for the whole file
  if (entities.length === 0) {
    return [{
      content: fileContent,
      startLine: 1,
      endLine: lines.length,
      type: 'file',
      name: path.basename(filePath),
      filePath,
      metadata: {
        language: getLanguageFromFilePath(filePath)
      }
    }]
  }

  // Create chunks for each entity with additional context
  entities.forEach(entity => {
    // Calculate start and end lines with context
    const contextStartLine = Math.max(1, entity.startLine - contextLines)
    const contextEndLine = Math.min(lines.length, entity.endLine + contextLines)

    // Get the content for this entity with context
    const chunkLines = lines.slice(contextStartLine - 1, contextEndLine)
    const content = chunkLines.join('\n')

    // Create the chunk
    chunks.push({
      content,
      startLine: contextStartLine,
      endLine: contextEndLine,
      type: entity.type,
      name: entity.name,
      filePath,
      metadata: {
        language: getLanguageFromFilePath(filePath),
        parentName: entity.parentName,
        dependencies: entity.dependencies,
        originalStartLine: entity.startLine,  // Store original boundaries
        originalEndLine: entity.endLine
      }
    })
  })

  // Add imports section as a separate chunk if present
  const importSection = extractImportSection(fileContent)
  if (importSection) {
    // Add context to import section as well
    const contextStartLine = Math.max(1, importSection.startLine - contextLines)
    const contextEndLine = Math.min(lines.length, importSection.endLine + contextLines)

    const chunkLines = lines.slice(contextStartLine - 1, contextEndLine)
    const content = chunkLines.join('\n')

    chunks.push({
      content,
      startLine: contextStartLine,
      endLine: contextEndLine,
      type: 'imports',
      name: 'imports',
      filePath,
      metadata: {
        language: getLanguageFromFilePath(filePath),
        originalStartLine: importSection.startLine,
        originalEndLine: importSection.endLine
      }
    })
  }

  return chunks
}

/**
 * Extract the import section from a file
 */
function extractImportSection(fileContent: string): { content: string, startLine: number, endLine: number } | null {
  const lines = fileContent.split('\n')
  let startLine = -1
  let endLine = -1

  // Find consecutive import statements
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim()
    if (line.startsWith('import ') && startLine === -1) {
      startLine = i + 1
    } else if (startLine !== -1 && !line.startsWith('import ') && line !== '') {
      endLine = i
      break
    }
  }

  if (startLine !== -1 && endLine !== -1) {
    return {
      content: lines.slice(startLine - 1, endLine).join('\n'),
      startLine,
      endLine
    }
  }

  return null
}

/**
 * Get the programming language from a file path
 */
function getLanguageFromFilePath(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase()

  switch (ext) {
    case '.js':
      return 'javascript'
    case '.jsx':
      return 'jsx'
    case '.ts':
      return 'typescript'
    case '.tsx':
      return 'tsx'
    case '.py':
      return 'python'
    case '.rb':
      return 'ruby'
    case '.java':
      return 'java'
    case '.go':
      return 'go'
    case '.php':
      return 'php'
    case '.c':
    case '.cpp':
    case '.cc':
      return 'cpp'
    case '.cs':
      return 'csharp'
    case '.html':
      return 'html'
    case '.css':
      return 'css'
    case '.md':
      return 'markdown'
    case '.json':
      return 'json'
    case '.yml':
    case '.yaml':
      return 'yaml'
    default:
      return 'text'
  }
}
