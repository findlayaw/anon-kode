# ContextEngine

## Overview

The ContextEngine is an advanced codebase search and context retrieval tool that helps users understand code structure and find root causes of issues. It combines file pattern matching, content searching, and code structure analysis to provide comprehensive context about the codebase.

## Key Features

- **Natural Language Querying**: Ask questions about the codebase in plain English
- **Hybrid Search**: Combines semantic, keyword, and structure-aware search techniques
- **Code Structure Analysis**: Understands functions, classes, and their relationships
- **Dependency Tracking**: Can include information about imports, exports, and dependencies
- **Metadata Filtering**: Filter results by file type, directory, or other criteria
- **Contextual Results**: Returns code snippets with explanations of their relevance

## Usage

```typescript
// Basic usage
ContextEngine({
  information_request: "How is the authentication module implemented?"
})

// With filters
ContextEngine({
  information_request: "Find all React components that use the useEffect hook",
  file_type: "tsx",
  directory: "src/components",
  include_dependencies: true,
  max_results: 5
})

// With specific search mode
ContextEngine({
  information_request: "Find exact matches for the pattern 'handleSubmit'",
  search_mode: "keyword"
})

ContextEngine({
  information_request: "Find code related to user authentication",
  search_mode: "semantic"
})
```

## Parameters

| Parameter | Type | Description | Required |
|-----------|------|-------------|----------|
| `information_request` | string | A description of the information you need from the codebase | Yes |
| `file_type` | string | Optional filter for specific file types (e.g., "ts", "js", "tsx") | No |
| `directory` | string | Optional filter to search only within a specific directory | No |
| `include_dependencies` | boolean | Whether to include dependency information in the results | No |
| `max_results` | number | Maximum number of results to return | No |
| `search_mode` | string | Search mode to use: 'hybrid' (default), 'keyword', or 'semantic' | No |

## Implementation Details

The tool works by:

1. Analyzing the user's query to understand what they're looking for
2. Using a hybrid search approach combining multiple techniques:
   - GlobTool for file pattern matching
   - GrepTool for keyword and regex-based searches
   - Code structure analysis for understanding relationships
3. Reading and analyzing the most promising files
4. Understanding code structure and relationships
5. Formatting the response in a structured way that mimics a context engine

## Code Structure Analysis

The tool includes a code parser that extracts structural information from code files:

- Functions and their definitions
- Classes and their methods
- Import/export relationships
- Parent-child relationships between classes
- Line numbers and code boundaries

This structural information enhances the context provided in the results, making it easier to understand how different parts of the code relate to each other.

## Future Improvements

- Integration with a proper AST parser like Tree-sitter for more accurate code structure analysis
- Vector embeddings for semantic code search
- Graph-based representation of code relationships
- More sophisticated chunking strategies based on code structure
- Integration with documentation and comments for better context
