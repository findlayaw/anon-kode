# CodeContextTool Test Queries

This document provides a comprehensive set of queries to test all capabilities of the improved CodeContextTool. These queries are based on actual usage patterns and are designed to exercise different aspects of the tool.

## Basic Component Search

### Query
```
{
  "information_request": "Find the TradeForm component implementation and understand how it manages form data"
}
```

**Expected Outcome**: 
- Complete TradeForm component code
- State management logic for form data
- Form submission handlers
- Proper context around the component

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

### Query
```
{
  "directory": "src/services/options",
  "information_request": "Understand how CustomOptionsService works for saving and retrieving user preferences"
}
```

**Expected Outcome**: 
- CustomOptionsService implementation
- Methods for saving/retrieving preferences
- Related interfaces or types
- Relationship with other services

## File Type Filtering

### Query
```
{
  "file_type": "ts",
  "information_request": "Find the generateTradeContent method in the TradeService.ts file"
}
```

**Expected Outcome**: 
- Precise location of generateTradeContent method
- Complete method implementation
- Related types and interfaces
- Context around how the method is used

### Query
```
{
  "file_type": "tsx",
  "information_request": "Check how ComboBox components are styled in the application"
}
```

**Expected Outcome**: 
- ComboBox component rendering with style properties
- Style-related props passed to ComboBox
- Special z-index or styling handling
- Any related style constants or theme values

## Interface and Type Definitions

### Query
```
{
  "information_request": "Find the TradeData interface definition and related types"
}
```

**Expected Outcome**: 
- Complete TradeData interface definition
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
  "information_request": "Find how ComboBox is used in the MetadataFields component for the Tags field",
  "include_dependencies": true
}
```

**Expected Outcome**: 
- ComboBox usage in MetadataFields
- Props passed to ComboBox
- Data flow for options and selected values
- Event handlers attached to ComboBox
- Related imports and dependencies

### Query
```
{
  "information_request": "Find how tagOptions is defined and populated in MetadataFields",
  "include_dependencies": true
}
```

**Expected Outcome**: 
- Definition and initialization of tagOptions
- Data source for tagOptions
- Any transformations applied to the data
- How tagOptions is passed to child components
- Related dependencies and imports

## Component Rendering and Structure

### Query
```
{
  "information_request": "Find the TradeForm component's return statement showing how the fields components are rendered"
}
```

**Expected Outcome**: 
- Complete JSX in the return statement
- All field components being rendered
- Props passed to each field component
- Layout structure (grids, containers, etc.)

### Query
```
{
  "directory": "src/components/forms/trade/fields",
  "file_type": "tsx",
  "information_request": "Check the structure and implementation of all field components, focusing on hooks and state management"
}
```

**Expected Outcome**: 
- Implementation of all field components in the directory
- useEffect and useState hooks
- State management approach
- Prop handling and validation

## Complex Semantic Searches

### Query
```
{
  "information_request": "Find how direction selection works in trade forms",
  "search_mode": "semantic"
}
```

**Expected Outcome**: 
- Direction selector component
- Direction options definition
- How direction affects other form fields
- Event handlers for direction changes
- Any validation logic related to direction

### Query
```
{
  "information_request": "Find validation logic for trade form fields",
  "search_mode": "semantic"
}
```

**Expected Outcome**: 
- Form validation implementation
- Field-specific validation rules
- Error message handling
- Where validation is triggered
- Related interfaces for validation state

## Event Handling and Behavior

### Query
```
{
  "information_request": "Show how field change events are handled in TradeForm components"
}
```

**Expected Outcome**: 
- onChange handlers in form components
- State updates in response to changes
- Any debouncing or throttling logic
- Validation triggered by changes

### Query
```
{
  "information_request": "Find special handling for ComboBox components in TradeFormView.tsx, focusing on event handling"
}
```

**Expected Outcome**: 
- Event handlers for ComboBox
- Special behaviors when selecting options
- Any custom key handlers
- Focus and blur handling

## Style and DOM Rendering

### Query
```
{
  "file_type": "tsx",
  "information_request": "Show me how the ComboBox component is rendered in the DOM, specifically focusing on its data attributes and styles"
}
```

**Expected Outcome**: 
- ComboBox component JSX
- Style properties and classes
- Data attributes
- Accessibility attributes
- DOM structure

### Query
```
{
  "information_request": "Find styling approach for trade form field layouts, looking at grid or flexbox usage"
}
```

**Expected Outcome**: 
- Layout components used in forms
- Grid or flexbox configurations
- Responsive styling
- Container components

## Edge Cases and Error Handling

### Query
```
{
  "information_request": "Find error handling logic in trade form submission",
  "search_mode": "hybrid"
}
```

**Expected Outcome**: 
- Try/catch blocks in submission handlers
- Error state management
- Error message display components
- API error handling

### Query
```
{
  "information_request": "Find how empty or undefined values are handled in trade form fields"
}
```

**Expected Outcome**: 
- Null/undefined checks in field components
- Default value handling
- Optional chaining usage
- Conditional rendering based on value presence

## Performance Optimization

### Query
```
{
  "information_request": "Find memoization usage in trade form components",
  "file_type": "tsx"
}
```

**Expected Outcome**: 
- useMemo and useCallback hooks
- React.memo usage
- Dependencies arrays in hooks
- Performance optimization patterns

### Query
```
{
  "information_request": "Find how data fetching is optimized in trade forms",
  "include_dependencies": true
}
```

**Expected Outcome**: 
- Data fetching logic
- Caching mechanisms
- Loading state handling
- Optimized re-fetch strategies

## Testing Each New Feature

### AST Parsing Test
```
{
  "information_request": "Find all React components that extend from BaseComponent",
  "file_type": "tsx"
}
```

**Expected Outcome**: 
- Accurate list of components extending BaseComponent
- Class hierarchy information
- Inherited methods and properties

### File Path Handling Test
```
{
  "information_request": "Find TradeFormView.tsx regardless of case sensitivity"
}
```

**Expected Outcome**: 
- Correct file found even if case doesn't exactly match
- Path normalized appropriately for the platform

### Cross-File Relationship Test
```
{
  "information_request": "Show all components that import and use the ComboBox component",
  "include_dependencies": true
}
```

**Expected Outcome**: 
- List of components importing ComboBox
- How ComboBox is instantiated in each component
- Props passed to ComboBox

### Search Result Completeness Test
```
{
  "information_request": "Find the full implementation of the trade submission workflow from form to API call"
}
```

**Expected Outcome**: 
- Complete form submission handler
- Service layer method for API call
- Data transformation between form and API
- Related interfaces and types