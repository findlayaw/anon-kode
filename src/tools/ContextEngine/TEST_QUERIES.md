# ContextEngine Test Queries for Journalit - Failed Tests Only

This document provides queries that failed in the test results for the ContextEngine. These queries are based on actual usage patterns from the Journalit codebase and highlight areas for improvement.

## Directory-Specific Searches

### Query
```
{
  "directory": "src/components/forms/trade/fields",
  "information_request": "Find implementation of AssetFields component to understand its structure"
}
```

**Expected Outcome**: 
- Complete AssetFields component implementation
- Props interface definition
- Proper display of useEffect hooks and state variables
- Any child components it renders

## Interface and Type Definitions

### Query
```
{
  "information_request": "Find the TradeFormData interface definition and related types"
}
```

**Expected Outcome**: 
- Complete TradeFormData interface definition
- Related types it references
- Where the interface is imported and used
- Any validation logic related to this interface

### Query
```
{
  "information_request": "Find the AssetFieldsProps interface definition in AssetFields.tsx"
}
```

**Expected Outcome**: 
- Complete AssetFieldsProps interface
- Property types and optional flags
- Default values if specified
- How the interface is used in the component

## Relationship and Usage Searches

### Query
```
{
  "information_request": "Find how ImageUploader component is used and integrated in the TradeForm",
  "include_dependencies": true
}
```

**Expected Outcome**: 
- Implementation of ImageUploader integration
- Data flow between TradeForm and ImageUploader
- Event handlers for image uploads
- How images are stored and retrieved
- Related dependencies and imports

## Component Rendering and Structure

### Query
```
{
  "directory": "src/components/dashboard/components",
  "file_type": "tsx",
  "information_request": "Check the structure and implementation of dashboard widgets, focusing on data visualization components"
}
```

**Expected Outcome**: 
- Implementation of dashboard widget components
- Chart implementation and configuration
- Data fetching and processing
- Responsive layout handling

## Edge Cases and Error Handling

### Query
```
{
  "information_request": "Find error handling logic in ImageService for image uploads",
  "search_mode": "hybrid"
}
```

**Expected Outcome**: 
- Try/catch blocks in image handling
- Error state management
- Error message display components
- File system error handling

## Performance Optimization

### Query
```
{
  "information_request": "Find how data fetching is optimized in TradeService",
  "include_dependencies": true
}
```

**Expected Outcome**: 
- Data fetching logic in TradeService
- Caching mechanisms
- Loading state handling
- Optimized re-fetch strategies

## Cross-File Relationship Test

### Query
```
{
  "information_request": "Show all components that import and use the ImageUploader component",
  "include_dependencies": true
}
```

**Expected Outcome**: 
- List of components importing ImageUploader
- How ImageUploader is instantiated in each component
- Props passed to ImageUploader

### Search Result Completeness Test
```
{
  "information_request": "Find the full implementation of the image upload workflow from UI to storage"
}
```

**Expected Outcome**: 
- Complete image upload handler
- Service layer method for storage
- Data transformation between UI and storage
- Related interfaces and types