import fs from 'fs'
import path from 'path'
import { logEvent } from '../../services/statsig'
import { getGlobalConfig } from '../../utils/config'
import { logError } from '../../utils/log'
import { query } from '../../query'
import { createUserMessage } from '../../utils/messages'
import { lastX } from '../../utils/generators'
import { getContext } from '../../context'
import { TextBlock } from '@anthropic-ai/sdk/resources/index.mjs'
import { Tool } from '../../Tool'
import { SearchResult } from './searchUtils'

// Define the result types for the query escalation
export type QueryResult = {
  successful: boolean;
  escalated: boolean;
  response: string;
  searchResults?: SearchResult[];
  modelUsed: 'small' | 'large';
  durationMs: number;
  inputTokens?: number;
  outputTokens?: number;
}

// Define the feedback data to improve routing
export type QueryFeedbackData = {
  queryId: string;
  query: string;
  smallModelResult: boolean;
  escalatedToLargeModel: boolean;
  largeModelResult?: boolean;
  durationSmall?: number;
  durationLarge?: number;
  tokensSmall?: {
    input: number;
    output: number;
  };
  tokensLarge?: {
    input: number;
    output: number;
  };
}

// Store feedback data in memory for the current session
const queryFeedbackStore: QueryFeedbackData[] = [];

// Constants for model prompts
export const SMALL_MODEL_PROMPT = `
You are a sophisticated codebase context retrieval expert with deep code understanding capabilities. Your task is to search through the provided codebase to find, analyze, and present the most relevant code snippets based on the user's query. Remember, your job is strictly information retrieval and analysis, NOT problem-solving or code generation.

You will be provided with three inputs:

<user_query>
{{USER_QUERY}}
</user_query>

<search_filters>
{{SEARCH_FILTERS}}
</search_filters>

<codebase_content>
{{CODEBASE_CONTENT}}
</codebase_content>

Follow these steps to complete your task:

1. Analyze the user's query:
   - Classify the query type (semantic, structural, relational, or implementation-specific)
   - Identify key concepts, entities, and their relationships
   - Infer implied technical concepts
   - Recognize domain-specific terminology and programming patterns

2. Select the optimal search strategy based on the search_filters:
   - Use the specified search_mode (hybrid, keyword, or semantic)
   - Apply file_type, directory, and max_results filters
   - Consider include_dependencies setting for relationship analysis

3. Execute a comprehensive, multi-phase search within the codebase_content:
   - Start with specific, targeted searches before broadening
   - Use appropriate search patterns for components, classes, interfaces, and functions
   - Apply case-insensitive matching when initial searches fail
   - Consider language-specific implementations and patterns

4. Analyze the retrieved code comprehensively:
   - Extract and understand logical structural units
   - Build dependency graphs and identify relationships
   - Recognize architectural patterns and map data flow

5. Present results with structured, insightful analysis:
   - Use correct file paths following the appropriate convention
   - Include complete code context (at least 5-10 lines before/after key sections)
   - Show line numbers for precise referencing
   - Group logically related code together
   - Order results by relevance to the query
   - Provide concise explanations highlighting functionality, relevance, and relationships

6. Handle partial or missing results intelligently:
   - Provide the closest relevant results if exact matches aren't found
   - Explain what was searched for and what alternatives were tried
   - Suggest potential naming variations or locations for unfound files
   - Propose specific follow-up queries that might yield better results

7. Apply language-specific understanding based on the codebase content

8. Maintain result quality and relevance:
   - Focus on the most relevant sections that directly answer the query
   - Balance between breadth and depth of analysis
   - Connect related code across different files to show complete workflows

9. Respect information boundaries:
   - Focus exclusively on code analysis and understanding
   - Do not suggest code changes, improvements, or new implementations
   - Do not expose sensitive information

Format your output as follows:

<analysis>
Query Classification: [Type of query]
Key Concepts: [List of identified key concepts]

Search Strategy:
[Explanation of the search strategy used]

Retrieved Code Sections:

1. Path: [file_path]
[code snippet with relevant sections, including line numbers]

Analysis:
- [Primary purpose/functionality of the code]
- [Key implementation details]
- [Relationships with other components]
- [How this answers the specific query]

2. Path: [another_file_path]
[another code snippet with line numbers]

Analysis:
- [Primary purpose/functionality]
- [Key implementation details]
- [Relationships and connections]

...

Cross-Component Relationships:
[Overview of how the retrieved components interact]

[If applicable] Partial Results / Alternative Suggestions:
[Explanation of partial matches or alternative search strategies]

</analysis>

Remember to prioritize accuracy and relevance in your analysis, and strictly adhere to the information retrieval and analysis scope of your role.
`;

export const LARGE_MODEL_PROMPT = `
You are a sophisticated codebase context retrieval expert with deep code understanding capabilities. Your task is to search through the provided codebase to find, analyze, and present the most relevant code snippets based on the user's query. Remember, your job is strictly information retrieval and analysis, NOT problem-solving or code generation.

You will be provided with three inputs:

<codebase>
{{CODEBASE}}
</codebase>
This contains the entire codebase you will be searching through.

<user_query>
{{USER_QUERY}}
</user_query>
This is the query you need to address by searching the codebase.

<search_filters>
{{SEARCH_FILTERS}}
</search_filters>
These are the filters to apply to your search, including file types, directories, result limits, and search mode.

Follow these steps to complete your task:

1. Analyze the user's query:
   - Classify the query type (semantic, structural, relational, or implementation-specific)
   - Identify key concepts, entities, and their relationships
   - Infer implied technical concepts
   - Recognize domain-specific terminology and programming patterns

2. Select the optimal search strategy based on the search_mode specified in the search_filters:
   - For 'hybrid' mode (default): Combine semantic understanding with structural code analysis
   - For 'keyword' mode: Use precise pattern matching focusing on exact terms
   - For 'semantic' mode: Focus on conceptual similarity, related patterns, and domain equivalents

3. Execute a comprehensive, multi-phase search:
   - Start with specific, targeted searches before broadening
   - Use appropriate search patterns for components, classes, interfaces, and functions
   - Apply case-insensitive matching when initial searches fail
   - Use tiered searching: first target exact matches, then related files, then broader context
   - Consider language-specific implementations and code patterns

4. Handle case sensitivity and path variations:
   - Try case-insensitive searches if exact matches fail
   - Check both kebab-case and camelCase variations
   - Look for files with similar names if exact matches aren't found
   - Consider path variations and alternative directory structures
   - Search for imports/references to files if specific files aren't found

5. Analyze the code comprehensively:
   - Extract and understand logical structural units
   - Build dependency graphs by tracking imports/exports
   - Identify parent-child relationships between components
   - Recognize architectural patterns
   - Map data flow through the application
   - Connect related components across different files

6. Present your results with structured, insightful analysis using the following format:

   \`\`\`
   The following code sections were retrieved:
   
   Path: [file_path]
   [code snippet with relevant sections]
   
   Analysis:
   - [Primary purpose/functionality of the code]
   - [Key implementation details]
   - [Relationships with other components]
   - [How this answers the specific query]
   
   Path: [another_file_path]
   [another code snippet]
   
   Analysis:
   - [Primary purpose/functionality]
   - [Key implementation details]
   - [Relationships and connections]
   ...
   
   ## Cross-Component Relationships
   [Overview of how the retrieved components interact]
   \`\`\`

   Ensure you:
   - Use correct file paths following the appropriate convention for the user's OS
   - Include complete code context (at least 5-10 lines before/after key sections)
   - Show line numbers for precise referencing
   - Group logically related code together
   - Order results by relevance to the query

7. If you encounter partial or missing results:
   - Provide the closest relevant results if exact matches aren't found
   - Explain what was searched for and what alternatives were tried
   - Provide concrete suggestions for alternative search strategies
   - Suggest potential naming variations or locations for unfound files
   - Explain what aspects of the query were addressed and what's missing
   - Propose specific follow-up queries that might yield better results

8. Apply language-specific understanding based on the codebase:
   - Recognize appropriate declaration styles and patterns
   - Identify framework-specific concepts (e.g., React hooks, Redux slices)
   - Pay attention to typed language features if applicable
   - Map object-oriented or functional programming patterns as appropriate

9. Maintain result quality and relevance:
   - Focus on the most relevant sections that directly answer the query
   - Include sufficient context to understand functionality and relationships
   - Prioritize exported/public APIs over internal implementation details (unless specifically requested)
   - Select the most representative examples when multiple results exist
   - Balance between breadth and depth in your analysis
   - Connect related code across different files to show complete workflows
   - Provide high-level architectural insight for complex systems

10. Respect these information boundaries:
    - Focus exclusively on code analysis and understanding
    - Do not suggest code changes or improvements
    - Do not implement new features or fix bugs
    - Do not expose sensitive information (API keys, credentials, etc.)
    - If the query requests implementation or fixes, clarify that you're focused on understanding existing code

Your final output should consist only of the structured analysis as described in step 6, without including your thought process or the steps you took to arrive at your answer. Ensure that your response directly and comprehensively addresses the user's query while adhering to the search filters and guidelines provided.
`;

// Save query feedback to improve the routing algorithm
export function saveQueryFeedback(feedbackData: QueryFeedbackData): void {
  queryFeedbackStore.push(feedbackData);
  
  // Write the feedback data to a local file for persistence
  try {
    const configDir = path.dirname(getGlobalConfig()["GLOBAL_CLAUDE_FILE"] || path.join(process.env.HOME || '', '.claude-code'));
    const feedbackFilePath = path.join(configDir, 'query_feedback.json');
    
    // Read existing data if file exists
    let existingData: QueryFeedbackData[] = [];
    if (fs.existsSync(feedbackFilePath)) {
      try {
        const fileContent = fs.readFileSync(feedbackFilePath, 'utf-8');
        existingData = JSON.parse(fileContent);
      } catch (err) {
        logError(err);
        existingData = [];
      }
    }
    
    // Append new data
    existingData.push(feedbackData);
    
    // Write back to file
    fs.writeFileSync(feedbackFilePath, JSON.stringify(existingData, null, 2));
    
    // Log the event
    logEvent('query_escalation_feedback_saved', {
      queryId: feedbackData.queryId,
      smallModelResult: String(feedbackData.smallModelResult),
      escalated: String(feedbackData.escalatedToLargeModel),
      largeModelResult: feedbackData.largeModelResult !== undefined ? String(feedbackData.largeModelResult) : 'n/a'
    });
  } catch (err) {
    logError(err);
  }
}

// Function to execute a query with progressive escalation
export async function executeProgressiveQuery(
  information_request: string, 
  search_filters: string[],
  toolUseContext: any, 
  canUseTool: any,
  searchTools: Tool[],
  contextEngineCanUseTool: any
): Promise<QueryResult> {
  const config = getGlobalConfig();
  const smallModelName = config.smallModelName;
  const largeModelName = config.largeModelName;
  
  if (!smallModelName || !largeModelName) {
    throw new Error("Both small and large model names must be configured");
  }
  
  // Generate a unique ID for this query
  const queryId = Math.random().toString(36).substring(2, 15);
  
  // Log the start of the query
  logEvent('progressive_query_start', {
    queryId,
    smallModelName,
    largeModelName,
    query: information_request.substring(0, 100) // Truncate for logging
  });
  
  // Create the enhanced query with filters
  let enhancedQuery = information_request;
  
  // Add filters to the query in a more structured format
  if (search_filters.length > 0) {
    enhancedQuery += `\n\n<search_filters>\n${search_filters.join('\n')}\n</search_filters>\n\nIMPORTANT: Use the above filters when searching. The file_type filter specifies the extension of files to search for (e.g., "tsx", "js"). The directory filter specifies where to look for files.`;
  }
  
  const userMessage = createUserMessage(enhancedQuery);
  const messages = [userMessage];
  
  // Create a modified context with dangerouslySkipPermissions set to true
  const modifiedContext = {
    ...toolUseContext,
    options: {
      ...toolUseContext.options,
      tools: searchTools,
      dangerouslySkipPermissions: true,
      slowAndCapableModel: smallModelName // Start with the small model
    },
  };
  
  // Add additional context about the codebase structure
  const context = await getContext();
  
  // Create feedback data object
  const feedbackData: QueryFeedbackData = {
    queryId,
    query: information_request,
    smallModelResult: false, 
    escalatedToLargeModel: false
  };
  
  // 1. First attempt with small model
  console.log(`[Progressive Query] Starting with small model: ${smallModelName}`);
  const smallModelStartTime = Date.now();
  
  try {
    const lastResponse = await lastX(
      query(
        messages,
        [SMALL_MODEL_PROMPT],
        context,
        contextEngineCanUseTool,
        modifiedContext,
      ),
    );
    
    const smallModelDuration = Date.now() - smallModelStartTime;
    feedbackData.durationSmall = smallModelDuration;
    
    if (lastResponse.type !== 'assistant') {
      throw new Error(`Invalid response from API`);
    }
    
    const data = lastResponse.message.content.filter(_ => _.type === 'text');
    const responseText = data.map(item => item.text).join('\n');
    
    // Record token usage if available
    if (lastResponse.message.usage) {
      feedbackData.tokensSmall = {
        input: lastResponse.message.usage.input_tokens || 0,
        output: lastResponse.message.usage.output_tokens || 0
      };
    }
    
    // Check if the response indicates no results or errors
    // Reduced list of indicators to be less aggressive
    const noResultsIndicators = [
      "couldn't find", "could not find",
      "no results found", "no files found", 
      "unable to locate",
      "no matching files", "no relevant files", "cannot locate",
      "no content found", "no relevant content"
    ];
    
    // Check for hallucination indicators - reduced and focused on stronger signals
    const hallucinationIndicators = [
      "probably", "presumably", 
      "not entirely clear",
      "inferring", "i think", 
      "cannot determine", "unable to verify"
    ];
    
    // Check for structural issues in the response
    const isIncompleteAnalysis = !responseText.includes('Analysis:') || 
                                !responseText.includes('Path:') ||
                                responseText.length < 300;
    
    // Check for hallucination patterns - much more focused approach
    // Only consider it a hallucination if uncertainty indicators appear multiple times
    // and are specifically related to core content
    const uncertaintyCount = hallucinationIndicators.filter(indicator =>
      responseText.toLowerCase().includes(indicator)
    ).length;
    
    const hasExplicitUncertainty = responseText.toLowerCase().includes("low confidence") ||
                                 responseText.toLowerCase().includes("unable to verify") ||
                                 responseText.toLowerCase().includes("cannot determine");
    
    // Only flag as hallucination if multiple strong signals 
    const hasHallucinations = (uncertaintyCount >= 3) || 
                            (hasExplicitUncertainty && uncertaintyCount >= 2);
    
    // Check for low confidence markers
    const hasLowConfidence = responseText.toLowerCase().includes('confidence') && 
                            (responseText.toLowerCase().includes('low confidence') ||
                             responseText.toLowerCase().includes('not confident') ||
                             responseText.toLowerCase().includes('uncertain'));
    
    // Mark as needing escalation if any issues detected
    const hasNoResults = noResultsIndicators.some(indicator =>
      responseText.toLowerCase().includes(indicator)
    ) || isIncompleteAnalysis || hasHallucinations || hasLowConfidence;
    
    // If the small model found results, return them
    if (!hasNoResults) {
      console.log('[Progressive Query] Small model succeeded');
      
      // Format the response
      let formattedResponse = responseText;
      
      // Add a note about which model was used
      formattedResponse = `Query processed using ${smallModelName}\n\n${formattedResponse}`;
      
      // Save feedback
      feedbackData.smallModelResult = true;
      saveQueryFeedback(feedbackData);
      
      // Return the successful result
      return {
        successful: true,
        escalated: false,
        response: formattedResponse,
        modelUsed: 'small',
        durationMs: smallModelDuration,
        inputTokens: feedbackData.tokensSmall?.input,
        outputTokens: feedbackData.tokensSmall?.output
      };
    }
    
    // If we get here, the small model didn't find good results
    console.log('[Progressive Query] Small model failed to find results, escalating...');
  } catch (error) {
    logError(error);
    console.log('[Progressive Query] Small model encountered an error, escalating...');
  }
  
  // 2. Escalate to large model if small model didn't produce good results
  console.log(`[Progressive Query] Escalating to large model: ${largeModelName}`);
  feedbackData.smallModelResult = false;
  feedbackData.escalatedToLargeModel = true;
  
  // Update the context to use the large model
  modifiedContext.options.slowAndCapableModel = largeModelName;
  
  const largeModelStartTime = Date.now();
  
  try {
    const lastResponse = await lastX(
      query(
        messages,
        [LARGE_MODEL_PROMPT],
        context,
        contextEngineCanUseTool,
        modifiedContext,
      ),
    );
    
    const largeModelDuration = Date.now() - largeModelStartTime;
    feedbackData.durationLarge = largeModelDuration;
    
    if (lastResponse.type !== 'assistant') {
      throw new Error(`Invalid response from API`);
    }
    
    const data = lastResponse.message.content.filter(_ => _.type === 'text');
    const responseText = data.map(item => item.text).join('\n');
    
    // Record token usage if available
    if (lastResponse.message.usage) {
      feedbackData.tokensLarge = {
        input: lastResponse.message.usage.input_tokens || 0,
        output: lastResponse.message.usage.output_tokens || 0
      };
    }
    
    // Format the response
    let formattedResponse = responseText;
    
    // Add a note about which model was used and the escalation
    formattedResponse = `Query escalated from ${smallModelName} to ${largeModelName} for better results\n\n${formattedResponse}`;
    
    // Save feedback
    feedbackData.largeModelResult = true;
    saveQueryFeedback(feedbackData);
    
    // Return the result
    return {
      successful: true,
      escalated: true,
      response: formattedResponse,
      modelUsed: 'large',
      durationMs: largeModelDuration,
      inputTokens: feedbackData.tokensLarge?.input,
      outputTokens: feedbackData.tokensLarge?.output
    };
  } catch (error) {
    logError(error);
    
    // Both models failed, try a reformulated query as a final fallback
    console.log('[Progressive Query] Both models failed, attempting query reformulation...');
    
    // Extract potential entities and file types from the original query
    const entityMatch = information_request.match(/\b([A-Z][a-zA-Z0-9]*(?:Component|Service|Props|Data|Interface|Form|Fields|Client|API|Helper|Utils|Context|Provider)?)\b/g);
    const potentialEntities = entityMatch ? Array.from(new Set(entityMatch)) : [];
    
    // Create a simplified and reformulated query focusing just on finding files
    let reformulatedQuery = `Find all files in the codebase related to ${potentialEntities.join(', ')}.`;
    
    if (potentialEntities.length === 0) {
      // If no clear entities, extract key terms
      const terms = information_request.split(/\s+/)
        .filter(term => term.length > 3 && !["find", "show", "where", "what", "which", "implement", "implementation"].includes(term.toLowerCase()));
      
      if (terms.length > 0) {
        reformulatedQuery = `Find all files containing these terms: ${terms.join(', ')}.`;
      }
    }
    
    console.log(`[Progressive Query] Reformulated query: ${reformulatedQuery}`);
    
    // Create a new user message with the reformulated query
    const reformulatedUserMessage = createUserMessage(reformulatedQuery);
    
    try {
      // Last attempt with the large model and reformulated query
      const reformStartTime = Date.now();
      const lastResponse = await lastX(
        query(
          [reformulatedUserMessage],
          [LARGE_MODEL_PROMPT],
          context,
          contextEngineCanUseTool,
          modifiedContext,
        ),
      );
      
      const reformDuration = Date.now() - reformStartTime;
      
      if (lastResponse.type !== 'assistant') {
        throw new Error(`Invalid response from API`);
      }
      
      const data = lastResponse.message.content.filter(_ => _.type === 'text');
      let responseText = data.map(item => item.text).join('\n');
      
      // If we got any results, format them with a note about the fallback
      if (responseText.includes('Path:') && !responseText.includes("couldn't find")) {
        responseText = `Note: The original query did not return results, so I performed a broader search for related files.\n\nReformulated query: "${reformulatedQuery}"\n\n${responseText}`;
        
        feedbackData.largeModelResult = true;
        saveQueryFeedback(feedbackData);
        
        return {
          successful: true,
          escalated: true,
          response: responseText,
          modelUsed: 'large',
          durationMs: reformDuration,
        };
      }
    } catch (error) {
      console.error('[Progressive Query] Reformulation attempt failed:', error);
    }
    
    // If we still can't find anything, return a helpful error message with diagnostics
    feedbackData.largeModelResult = false;
    saveQueryFeedback(feedbackData);
    
    return {
      successful: false,
      escalated: true,
      response: `I couldn't find relevant information in the codebase for your query: "${information_request}"\n\nDiagnostic Information:\n- Attempted a broader reformulated query but still found no results\n- The query may contain entity names that don't match the actual codebase\n- If you're looking for an interface like "SomeProps", try searching for the component file instead\n- If searching for a specific functionality, try broader terms or focus on directories\n\nSuggested Approaches:\n- Try a more general search term like the base name (e.g., "Trade" instead of "TradeFormData")\n- Check specific directories like "components/", "types/", or "interfaces/"\n- Use a keyword search with common patterns (e.g., "interface *Props" or "type *Data")\n- Provide a partial file path if you have an idea where the code might be located`,
      modelUsed: 'large',
      durationMs: Date.now() - largeModelStartTime
    };
  }
}

// Custom middleware to optimize prompts for each model
export function optimizePromptForModel(
  model: 'small' | 'large', 
  information_request: string, 
  search_filters: string[]
): string {
  // Start with the base query
  let enhancedQuery = information_request;
  
  // Add filters to the query in a more structured format
  if (search_filters.length > 0) {
    enhancedQuery += `\n\n<search_filters>\n${search_filters.join('\n')}\n</search_filters>`;
  }
  
  // Add model-specific enhancements
  if (model === 'small') {
    // For small model, focus on conciseness and direct search instructions
    enhancedQuery += '\n\nIMPORTANT: Return only the most relevant search results. Focus on exact matches.';
  } else {
    // For large model, focus on comprehensive analysis
    enhancedQuery += '\n\nIMPORTANT: Conduct a comprehensive search and analysis. If direct matches are not found, look for semantically related code.';
    
    // Add reasoning guidance for large model
    enhancedQuery += '\n\nFocus on quality of analysis rather than quantity. Do not show your reasoning process in the output, only include the final analysis.';
  }
  
  return enhancedQuery;
}