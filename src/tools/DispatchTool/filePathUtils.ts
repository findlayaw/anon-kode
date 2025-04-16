/**
 * File path utility functions for the CodeContextTool
 * This module provides functions for handling and resolving file paths across different platforms
 */

import * as fs from 'fs'
import * as path from 'path'
import { isRunningInWSL, convertWindowsPathToWSL, convertWSLPathToWindows } from '../../utils/file'
import { getCwd } from '../../utils/state'

/**
 * Advanced case-insensitive file path finder
 * Attempts to find a file or directory path regardless of case sensitivity
 * 
 * @param targetPath The path to find (absolute or relative to cwd)
 * @returns The path with correct case, or undefined if not found
 */
export function findPathWithCorrectCase(targetPath: string): string | undefined {
  try {
    // Normalize the path and handle WSL conversions
    let normalizedPath = targetPath
    if (isRunningInWSL() && targetPath.match(/^[a-zA-Z]:\\?/)) {
      normalizedPath = convertWindowsPathToWSL(targetPath)
    }
    
    // If path is relative, make it absolute
    if (!path.isAbsolute(normalizedPath)) {
      normalizedPath = path.resolve(getCwd(), normalizedPath)
    }
    
    // If path exists with exact case, return it
    if (fs.existsSync(normalizedPath)) {
      return normalizedPath
    }
    
    // Otherwise, try to find the path with case-insensitive matching
    return findPathCaseInsensitive(normalizedPath)
  } catch (error) {
    console.error(`Error in findPathWithCorrectCase for ${targetPath}:`, error)
    return undefined
  }
}

/**
 * Recursively find a path regardless of case
 * 
 * @param targetPath The path to find
 * @returns The path with correct case, or undefined if not found
 */
function findPathCaseInsensitive(targetPath: string): string | undefined {
  try {
    // Split the path into components
    const pathComponents = targetPath.split(path.sep)
    
    // Start with the root component
    let currentPath = pathComponents[0] || '/'
    
    // For Windows paths in WSL, handle the drive letter
    if (currentPath.match(/^\/mnt\/[a-z]$/)) {
      currentPath += '/'
      pathComponents.shift() // Remove the first component as we've handled it
    }
    
    // Iterate through the path components to build the correct case path
    for (let i = 1; i < pathComponents.length; i++) {
      const component = pathComponents[i]
      
      // Skip empty components
      if (!component) continue
      
      // Check if the current path exists
      if (!fs.existsSync(currentPath)) {
        return undefined
      }
      
      // Get contents of the current directory
      const dirContents = fs.readdirSync(currentPath)
      
      // Find a case-insensitive match
      const match = dirContents.find(item => 
        item.toLowerCase() === component.toLowerCase())
      
      // If no match found, return undefined
      if (!match) {
        return undefined
      }
      
      // Update the current path with the matched component
      currentPath = path.join(currentPath, match)
    }
    
    return currentPath
  } catch (error) {
    console.error(`Error in findPathCaseInsensitive for ${targetPath}:`, error)
    return undefined
  }
}

/**
 * Get similar directories or files when an exact match isn't found
 * 
 * @param targetPath The path that wasn't found
 * @returns Array of similar paths that do exist
 */
export function findSimilarPaths(targetPath: string): string[] {
  try {
    // Normalize the path and handle WSL conversions
    let normalizedPath = targetPath
    if (isRunningInWSL() && targetPath.match(/^[a-zA-Z]:\\?/)) {
      normalizedPath = convertWindowsPathToWSL(targetPath)
    }
    
    // If path is relative, make it absolute
    if (!path.isAbsolute(normalizedPath)) {
      normalizedPath = path.resolve(getCwd(), normalizedPath)
    }
    
    // Get the parent directory and base name
    const parentDir = path.dirname(normalizedPath)
    const baseName = path.basename(normalizedPath).toLowerCase()
    
    // If parent directory doesn't exist, try to find a similar parent
    if (!fs.existsSync(parentDir)) {
      const grandparentDir = path.dirname(parentDir)
      const parentBaseName = path.basename(parentDir).toLowerCase()
      
      // If grandparent exists, look for similar directories
      if (fs.existsSync(grandparentDir)) {
        try {
          const similarParents = fs.readdirSync(grandparentDir)
            .filter(item => {
              const itemPath = path.join(grandparentDir, item)
              return fs.statSync(itemPath).isDirectory() && 
                     item.toLowerCase().includes(parentBaseName)
            })
            .map(item => path.join(grandparentDir, item))
          
          // Return paths that have the grandparent/similar-parent structure
          const results: string[] = []
          
          for (const parent of similarParents) {
            try {
              // Look for files in this parent that match the basename
              const similarFiles = fs.readdirSync(parent)
                .filter(item => item.toLowerCase().includes(baseName))
                .map(item => path.join(parent, item))
              
              results.push(...similarFiles)
            } catch (e) {
              // Skip errors reading directory contents
            }
          }
          
          return results
        } catch (e) {
          // If we can't read the grandparent directory, return empty array
          return []
        }
      }
      
      return []
    }
    
    // If parent directory exists, look for similar files/directories
    try {
      const similarItems = fs.readdirSync(parentDir)
        .filter(item => {
          // Check if the item name is similar (contains the target basename)
          const isNameSimilar = item.toLowerCase().includes(baseName)
          
          // Check file extension match if the target has an extension
          const targetExt = path.extname(baseName)
          const itemExt = path.extname(item).toLowerCase()
          const isExtensionMatch = targetExt ? itemExt === targetExt : true
          
          return isNameSimilar && isExtensionMatch
        })
        .map(item => path.join(parentDir, item))
      
      return similarItems
    } catch (e) {
      // If we can't read the parent directory, return empty array
      return []
    }
  } catch (error) {
    console.error(`Error in findSimilarPaths for ${targetPath}:`, error)
    return []
  }
}

/**
 * Ensures a file path is in the correct format for the current platform
 * 
 * @param filePath The file path to normalize
 * @returns Normalized file path for the current platform
 */
export function normalizePath(filePath: string): string {
  if (!filePath) return filePath
  
  // Handle WSL path conversions
  if (isRunningInWSL()) {
    // Convert Windows path to WSL path for file operations
    if (filePath.match(/^[a-zA-Z]:\\?/)) {
      return convertWindowsPathToWSL(filePath)
    }
    
    // For displaying to user, we want Windows paths
    // However, the core functionality should use WSL paths
  } else {
    // In Windows, convert any WSL paths to Windows paths
    if (filePath.match(/^\/mnt\/[a-z]\//)) {
      return convertWSLPathToWindows(filePath)
    }
  }
  
  return filePath
}

/**
 * Format a file path for display to the user
 * 
 * @param filePath The file path to format
 * @param preferWindowsPaths Whether to prefer Windows-style paths even in WSL
 * @returns Formatted file path for display
 */
export function formatPathForDisplay(filePath: string, preferWindowsPaths: boolean = true): string {
  if (!filePath) return filePath
  
  // In WSL, convert to Windows path for display
  if (isRunningInWSL() && preferWindowsPaths) {
    // Convert WSL path to Windows path for display
    if (filePath.match(/^\/mnt\/[a-z]\//)) {
      return convertWSLPathToWindows(filePath)
    }
  }
  
  return filePath
}

/**
 * Extract file type and directory from file path
 * 
 * @param filePath The file path to analyze
 * @returns Object with fileType and directory
 */
export function extractPathComponents(filePath: string): {
  fileType?: string,
  directory?: string,
  fileName: string,
  extension: string
} {
  // Normalize the path first
  const normalizedPath = normalizePath(filePath)
  
  // Extract file extension
  const extension = path.extname(normalizedPath).toLowerCase()
  const fileType = extension ? extension.slice(1) : undefined
  
  // Extract directory
  const directory = path.dirname(normalizedPath)
  const fileName = path.basename(normalizedPath)
  
  return {
    fileType,
    directory: directory === '.' ? undefined : directory,
    fileName,
    extension
  }
}

/**
 * Check if a file is likely a React/UI component
 * 
 * @param filePath The file path to check
 * @param fileContent Optional file content to analyze
 * @returns Boolean indicating if the file is likely a React component
 */
export function isLikelyUIComponent(filePath: string, fileContent?: string): boolean {
  const fileName = path.basename(filePath)
  const extension = path.extname(filePath).toLowerCase()
  
  // Check by extension first
  const isUIExtension = extension === '.jsx' || extension === '.tsx' || 
                       (extension === '.js' || extension === '.ts') // Some projects use .js/.ts for components too
  
  // Check by filename convention (PascalCase for components)
  const isPascalCase = /^[A-Z][a-zA-Z0-9]*\.(j|t)sx?$/.test(fileName)
  
  // Check for common component naming patterns
  const hasComponentName = /Component|Form|View|Page|Modal|Card|Field|Button|Input/i.test(fileName)
  
  // Check by directory name
  const directory = path.dirname(filePath)
  const isInComponentsDir = directory.includes('components') || 
                           directory.includes('pages') || 
                           directory.includes('views') ||
                           directory.includes('forms') ||
                           directory.includes('fields')
  
  // If we have file content, do deeper analysis
  if (fileContent) {
    // Check for React imports
    const hasReactImport = fileContent.includes('import React') || 
                           fileContent.includes("from 'react'") || 
                           fileContent.includes('from "react"')
    
    // Check for JSX syntax
    const hasJSX = fileContent.includes('<') && fileContent.includes('/>') ||
                  fileContent.includes('</') && fileContent.includes('>')
    
    // Check for component patterns
    const hasComponentPattern = fileContent.includes('function ') && hasJSX ||
                               fileContent.includes('const ') && fileContent.includes(' = (') && hasJSX ||
                               fileContent.includes('class ') && fileContent.includes(' extends ') ||
                               fileContent.includes('export default') && (fileContent.includes('function') || fileContent.includes('class'))
    
    // Check for hooks - strong indicator for React components
    const hasHooks = fileContent.includes('useState') || 
                     fileContent.includes('useEffect') || 
                     fileContent.includes('useRef') ||
                     fileContent.includes('useContext') ||
                     fileContent.includes('use')
    
    return (hasReactImport && hasJSX) || hasComponentPattern || (hasHooks && hasJSX)
  }
  
  // Without content, use heuristics
  return (isUIExtension && isPascalCase) || 
         (isPascalCase && isInComponentsDir) || 
         hasComponentName ||
         (isInComponentsDir && fileName.startsWith('use')) // React custom hooks
}