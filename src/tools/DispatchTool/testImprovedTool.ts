/**
 * Test script for the improved DispatchTool
 * This script runs a set of test queries to verify the enhanced functionality
 */

import path from 'path'
import fs from 'fs'
import { getCwd } from '../../utils/state'
import { ImprovedDispatchTool } from './improvedDispatchTool'

// Mock context and canUseTool functions for testing
const mockContext = {
  options: {
    tools: []
  }
}

const mockCanUseTool = async (tool: any, input: any) => {
  return { result: true }
}

// Test query scenarios
const testQueries = [
  {
    name: 'Basic Component Search',
    query: {
      information_request: 'How is the MessageSelector component implemented?',
      include_dependencies: true
    }
  },
  {
    name: 'Function Search',
    query: {
      information_request: 'Find the formatSearchResults function',
      file_type: 'ts'
    }
  },
  {
    name: 'Directory-Specific Search',
    query: {
      information_request: 'How are permissions handled?',
      directory: 'src/utils/permissions',
      include_dependencies: true
    }
  },
  {
    name: 'Semantic Search',
    query: {
      information_request: 'How does the application handle authentication?',
      search_mode: 'semantic'
    }
  }
]

// Function to run a test
async function runTest(test: typeof testQueries[0]) {
  console.log(`\n===== Running Test: ${test.name} =====`)
  console.log(`Query: ${JSON.stringify(test.query)}`)
  
  try {
    // Create generator from the tool
    const resultGenerator = ImprovedDispatchTool.call(
      test.query as any, 
      mockContext as any, 
      mockCanUseTool as any
    )
    
    // Process generator
    let result = await resultGenerator.next()
    while (!result.done) {
      if (result.value?.type === 'result') {
        // Get the data
        const resultText = result.value.data
          .filter((item: any) => item.type === 'text')
          .map((item: any) => item.text)
          .join('\n')
        
        // Log a summary of the result
        const resultLines = resultText.split('\n')
        console.log(`Result summary (${resultLines.length} lines):`)
        console.log(resultLines.slice(0, 3).join('\n') + '...')
        
        // Count paths found
        const pathCount = (resultText.match(/Path:/g) || []).length
        console.log(`Found ${pathCount} file paths`)
        
        // Record the test result
        const resultsDir = path.join(__dirname, 'test-results')
        if (!fs.existsSync(resultsDir)) {
          fs.mkdirSync(resultsDir)
        }
        
        fs.writeFileSync(
          path.join(resultsDir, `${test.name.replace(/\s+/g, '-')}.md`),
          resultText,
          'utf-8'
        )
        
        console.log(`Full result saved to ${path.join('test-results', `${test.name.replace(/\s+/g, '-')}.md`)}`)
      }
      
      result = await resultGenerator.next()
    }
    
    console.log(`Test completed: ${test.name}`)
  } catch (error) {
    console.error(`Error in test ${test.name}:`, error)
  }
}

// Run all tests
async function runAllTests() {
  console.log('Starting DispatchTool tests...')
  console.log(`Working directory: ${getCwd()}`)
  
  // Create test results directory
  const resultsDir = path.join(__dirname, 'test-results')
  if (!fs.existsSync(resultsDir)) {
    fs.mkdirSync(resultsDir)
  }
  
  // Run each test sequentially
  for (const test of testQueries) {
    await runTest(test)
  }
  
  console.log('\nAll tests completed')
  console.log(`Results saved in ${path.join(__dirname, 'test-results')}`)
}

// Run tests if this script is executed directly
if (require.main === module) {
  runAllTests().catch(error => {
    console.error('Test runner error:', error)
    process.exit(1)
  })
}

export { runAllTests }