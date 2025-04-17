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
  fileProcessingTokens?: number; // New field to track tokens from processed files
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
You are a codebase search tool that retrieves and presents exact code matches from files. Your primary function is accurate information retrieval without inference or assumptions.

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

IMPORTANT: Your job is STRICTLY to find and report actual code that exists in files. Present ONLY what you directly observe in the codebase. Do not include assumptions or theories—only the facts.

Follow these steps:

1. Analyze the user's query precisely:
   - Identify exact keywords, file names, class names, and function names to search for
   - Look for literal code patterns rather than concepts
   - Focus on concrete entity names rather than abstract concepts
   - DO NOT infer technical concepts not explicitly mentioned

2. Select the optimal search strategy:
   - For 'hybrid' mode (default): Use exact text searches combined with pattern matching
   - For 'keyword' mode: Use precise pattern matching focusing on exact terms only
   - For 'semantic' mode: Focus on textual similarity and naming patterns

3. Execute a precise, evidence-based search:
   - Use direct text matching for exact component/class/interface names
   - For imports, search for the exact text "import X from" where X is the entity name
   - Verify each search result exists in the file before reporting it
   - NEVER report files or code that don't actually exist
   - Confirm all relationships between components with direct evidence

4. Handle case sensitivity and path variations:
   - If exact matches fail, try case-insensitive searches
   - Check both kebab-case and camelCase variations (e.g., "data-service" vs "dataService")
   - ONLY report files that actually exist in the filesystem
   - Use the exact file paths from the repository

5. Analyze code with strict evidence requirements:
   - ONLY extract functions, classes, and interfaces that are literally present in the code
   - ONLY report imports/exports that are explicitly declared in the file
   - ONLY identify relationships that are explicitly defined, not inferred
   - Do not invent or synthesize relationships between components without evidence

6. Apply strict verification for all results:
   - Verify all file paths exist before reporting them
   - Verify imports by confirming the exact import statement text exists
   - Verify class/interface definitions by finding exact declaration patterns
   - Verify component usage by finding actual instances in the code
   - Reject low-confidence matches (below 0.6 confidence score)

Format your output as follows:

<analysis>
Search Strategy:
[Explanation of the exact search methods and terms used]

Retrieved Code Sections (VERIFIED ONLY):

1. Path: [exact_file_path]
[actual code snippet with proper indentation and formatting]

Analysis (VERIFIED FACTS ONLY):
- [What this code does based on direct observation]
- [Directly observable implementation details]
- [Explicitly defined relationships with other components]

2. Path: [another_exact_file_path]
[another actual code snippet]

Analysis (VERIFIED FACTS ONLY):
- [What this code does based on direct observation]
- [Directly observable implementation details]
- [Explicitly defined relationships]

...

[ONLY if there are explicitly defined relationships between components]
Cross-Component Relationships (VERIFIED ONLY):
[Only relationships that are explicitly defined in the code, such as imports/exports]

[If no results are found]
No code found matching the query criteria.

</analysis>

When in doubt, provide less information rather than risk inaccuracy. Never synthesize or fabricate implementations. Verify all reported findings with direct evidence from the codebase.
`;

export const LARGE_MODEL_PROMPT = `
You are a codebase search tool that retrieves and presents exact code matches from files. Your primary function is accurate information retrieval without inference or assumptions.

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

IMPORTANT: Your job is STRICTLY to find and report actual code that exists in files. Present ONLY what you directly observe in the codebase. Do not include assumptions or theories—only the facts.

Follow these steps:

1. Analyze the user's query precisely:
   - Identify exact keywords, file names, class names, and function names to search for
   - Look for literal code patterns rather than concepts
   - Focus on concrete entity names rather than abstract concepts
   - DO NOT infer technical concepts not explicitly mentioned

2. Select the optimal search strategy:
   - For 'hybrid' mode (default): Use exact text searches combined with pattern matching
   - For 'keyword' mode: Use precise pattern matching focusing on exact terms only
   - For 'semantic' mode: Focus on textual similarity and naming patterns

3. Execute a precise, evidence-based search:
   - Use direct text matching for exact component/class/interface names
   - For imports, search for the exact text "import X from" where X is the entity name
   - Verify each search result exists in the file before reporting it
   - NEVER report files or code that don't actually exist
   - Confirm all relationships between components with direct evidence

4. Handle case sensitivity and path variations:
   - If exact matches fail, try case-insensitive searches
   - Check both kebab-case and camelCase variations (e.g., "data-service" vs "dataService")
   - ONLY report files that actually exist in the filesystem
   - Use the exact file paths from the repository

5. Analyze code with strict evidence requirements:
   - ONLY extract functions, classes, and interfaces that are literally present in the code
   - ONLY report imports/exports that are explicitly declared in the file
   - ONLY identify relationships that are explicitly defined, not inferred
   - Do not invent or synthesize relationships between components without evidence

6. Present results with accuracy and precision:
   - Use the exact file paths as they appear in the repository
   - Always include complete code snippets with proper indentation preserved
   - Show accurate line numbers for precise referencing
   - Only include directly observed code, never synthesized examples
   - For each result, clearly indicate with high confidence that the code exists

   Use the following format:
   \`\`\`
   The following code sections were retrieved with high confidence:
   
   Path: [exact_file_path]
   [actual code snippet with proper indentation and formatting]
   
   Analysis (VERIFIED FACTS ONLY):
   - [What this code does based on direct observation]
   - [Directly observable implementation details]
   - [Explicitly defined relationships with other components]
   
   Path: [another_exact_file_path]
   [another actual code snippet]
   
   Analysis (VERIFIED FACTS ONLY):
   - [What this code does based on direct observation]
   - [Directly observable implementation details]
   - [Explicitly defined relationships]
   
   [ONLY if there are explicitly defined relationships between components]
   ## Cross-Component Relationships (VERIFIED ONLY)
   [Only relationships that are explicitly defined in the code, such as imports/exports]
   \`\`\`

7. Handle missing results honestly:
   - If no matches are found, state this clearly without speculation
   - DO NOT provide "best guesses" if exact matches aren't found
   - DO NOT suggest theoretical implementations
   - Simply report: "No code found matching the query criteria"
   - NEVER synthesize code that doesn't exist in the codebase

8. Apply strict verification for all results:
   - Verify all file paths exist before reporting them
   - Verify imports by confirming the exact import statement text exists
   - Verify class/interface definitions by finding exact declaration patterns
   - Verify component usage by finding actual instances in the code
   - Reject low-confidence matches (below 0.6 confidence score)

9. Maintain result quality through verification:
   - ONLY include results with high confidence scores
   - NEVER include speculative content
   - Exclude results that can't be directly verified in files
   - If unsure about a relationship, exclude it rather than speculate

10. When in doubt:
    - Provide less information rather than risk inaccuracy
    - Simply omit things you're uncertain about
    - NEVER fabricate implementation details
    - Do not attempt to be helpful by guessing or speculating

Your final output should consist only of verified, factual information directly observed in the codebase WITHOUT including your thought process or the steps you took to arrive at your answer. Never invent or assume features, patterns, or implementations that are not explicitly present in the code.
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
  
  // Create token counter to track total token usage during search operations
  let totalFileProcessingTokens = 0;
  const trackFileProcessing = (filePath: string, content: string) => {
    // Estimate tokens using simple character count / 4 (rough approximation)
    const estimatedTokens = Math.ceil(content.length / 4);
    totalFileProcessingTokens += estimatedTokens;
    
    // Log only for larger files to reduce noise
    if (estimatedTokens > 1000) {
      console.log(`[Token Tracker] Processed ${filePath}: ~${estimatedTokens.toLocaleString()} tokens`);
    }
  };
  
  // Monkey patch the file read functions to track token usage
  const originalReadFileSync = fs.readFileSync;
  fs.readFileSync = function(path: any, options: any) {
    const result = originalReadFileSync(path, options);
    if (typeof result === 'string' && typeof path === 'string') {
      trackFileProcessing(path, result);
    }
    return result;
  };
  
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
  
  // Add token tracking information to the context
  console.log(`[Token Tracker] Starting token tracking for query ID: ${queryId}`);
  console.log(`[Token Tracker] Query: "${information_request.substring(0, 100)}${information_request.length > 100 ? '...' : ''}"`);
  console.log(`[Token Tracker] Filters: ${search_filters.join(', ')}`);
  
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
  
  // Track file modification times to detect code freshness
  const fileModificationCache = new Map<string, number>();
  
  // Helper function to check file modification times
  const getFileModificationTime = (filePath: string): number => {
    if (fileModificationCache.has(filePath)) {
      return fileModificationCache.get(filePath)!;
    }
    
    try {
      const stats = fs.statSync(filePath);
      const modTime = stats.mtime.getTime();
      fileModificationCache.set(filePath, modTime);
      return modTime;
    } catch (error) {
      return 0; // File doesn't exist or can't be accessed
    }
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
    
    // Extract file paths from the response for freshness checking
    const filePathRegex = /Path: ([^\n]+)/g;
    const filePaths = [];
    let match;
    while ((match = filePathRegex.exec(responseText)) !== null) {
      filePaths.push(match[1].trim());
    }
    
    // Check if any referenced files have been modified recently
    let hasRecentModifications = false;
    if (filePaths.length > 0) {
      const now = Date.now();
      const oneDayMs = 24 * 60 * 60 * 1000;
      
      // Check if any file was modified in the last day
      hasRecentModifications = filePaths.some(filePath => {
        const modTime = getFileModificationTime(filePath);
        return modTime > 0 && (now - modTime) < oneDayMs;
      });
      
      console.log(`[Progressive Query] Found ${filePaths.length} file references, recent modifications: ${hasRecentModifications}`);
    }
    
    // Check if the response indicates no results or errors - enhanced with more patterns
    const noResultsIndicators = [
      "couldn't find", "could not find",
      "no results found", "no files found", 
      "unable to locate",
      "no matching files", "no relevant files", "cannot locate",
      "no content found", "no relevant content",
      "no exact match", "no code sections found"
    ];
    
    // Check for hallucination indicators - improved with more nuanced patterns
    const hallucinationIndicators = [
      "probably", "presumably", "might be",
      "not entirely clear", "appears to be",
      "inferring", "i think", "i believe", 
      "cannot determine", "unable to verify",
      "could not verify", "could not confirm"
    ];
    
    // Detect code structure issues
    const isIncompleteAnalysis = !responseText.includes('Analysis:') || 
                                !responseText.includes('Path:') ||
                                responseText.length < 300;
    
    // Check for missing implementation patterns
    const missingImplementationIndicators = [
      "implementation details are not available",
      "implementation could not be found",
      "could not find the full implementation",
      "implementation is not shown here"
    ];
    
    const hasMissingImplementations = missingImplementationIndicators.some(indicator =>
      responseText.toLowerCase().includes(indicator.toLowerCase())
    );
    
    // Enhanced hallucination detection - checks overall response quality
    const uncertaintyCount = hallucinationIndicators.filter(indicator =>
      responseText.toLowerCase().includes(indicator.toLowerCase())
    ).length;
    
    const hasExplicitUncertainty = responseText.toLowerCase().includes("low confidence") ||
                                 responseText.toLowerCase().includes("unable to verify") ||
                                 responseText.toLowerCase().includes("cannot determine");
    
    // Use a weighted approach for hallucination detection
    const hasHallucinations = (uncertaintyCount >= 3) || 
                            (hasExplicitUncertainty && uncertaintyCount >= 2) ||
                            (hasMissingImplementations && uncertaintyCount >= 1);
    
    // Check for low confidence markers with expanded patterns
    const hasLowConfidence = responseText.toLowerCase().includes('confidence') && 
                            (responseText.toLowerCase().includes('low confidence') ||
                             responseText.toLowerCase().includes('not confident') ||
                             responseText.toLowerCase().includes('uncertain') ||
                             responseText.toLowerCase().includes('limited confidence'));
    
    // Check if response lacks specific details (improved implementation detail detection)
    const missingDetailsIndicators = [
      "No specific implementation details", 
      "couldn't find specifics",
      "specific implementation was not found",
      "details of the implementation are not available"
    ];
    
    const hasMissingDetails = missingDetailsIndicators.some(indicator => 
      responseText.toLowerCase().includes(indicator.toLowerCase())
    );
    
    // Check structural integrity of component and interface results
    const interfacePatterns = [
      /interface [A-Za-z0-9_]+ \{/g,
      /type [A-Za-z0-9_]+ =/g
    ];
    
    const componentPatterns = [
      /const [A-Za-z0-9_]+ = (\([^)]*\))? =>/g,
      /function [A-Za-z0-9_]+\(/g,
      /class [A-Za-z0-9_]+ extends/g
    ];
    
    // Check if component or interface mentions lack actual code sections
    const mentionsInterfaceWithoutDefinition = 
      responseText.toLowerCase().includes("interface") && 
      !interfacePatterns.some(pattern => pattern.test(responseText));
    
    const mentionsComponentWithoutDefinition = 
      (responseText.toLowerCase().includes("component") || responseText.toLowerCase().includes("function")) && 
      !componentPatterns.some(pattern => pattern.test(responseText));
    
    // Enhanced escalation criteria
    const hasNoResults = noResultsIndicators.some(indicator =>
      responseText.toLowerCase().includes(indicator.toLowerCase())
    );
    
    const hasStructuralIssues = isIncompleteAnalysis || 
                              mentionsInterfaceWithoutDefinition || 
                              mentionsComponentWithoutDefinition;
    
    const hasContentIssues = hasHallucinations || 
                           hasLowConfidence || 
                           hasMissingDetails || 
                           hasMissingImplementations;
    
    // Decide if escalation is needed based on all factors
    const needsEscalation = hasNoResults || 
                          hasStructuralIssues || 
                          hasContentIssues || 
                          hasRecentModifications;
    
    console.log(`[Progressive Query] Escalation decision:
    - No results indicators: ${hasNoResults}
    - Structural issues: ${hasStructuralIssues}
    - Content issues: ${hasContentIssues}
    - Recent file modifications: ${hasRecentModifications}
    - Final decision: ${needsEscalation ? 'ESCALATE' : 'USE SMALL MODEL'}`);
    
    // If the small model found results and they appear reliable, return them
    if (!needsEscalation) {
      console.log('[Progressive Query] Small model succeeded');
      
      // Format the response
      let formattedResponse = responseText;
      
      // Add a note about which model was used
      formattedResponse = `Query processed using ${smallModelName}\n\n${formattedResponse}`;
      
      // Save feedback
      feedbackData.smallModelResult = true;
      saveQueryFeedback(feedbackData);
      
      // Restore original fs.readFileSync to avoid affecting other operations
      fs.readFileSync = originalReadFileSync;
      
      // Log token usage information
      console.log(`[Token Tracker] Query complete. Processed ${totalFileProcessingTokens.toLocaleString()} tokens from files`);
      console.log(`[Token Tracker] Model input tokens: ${feedbackData.tokensSmall?.input.toLocaleString() || 'unknown'}`);
      console.log(`[Token Tracker] Model output tokens: ${feedbackData.tokensSmall?.output.toLocaleString() || 'unknown'}`);
      console.log(`[Token Tracker] Total tokens: ${
        (totalFileProcessingTokens + (feedbackData.tokensSmall?.input || 0)).toLocaleString()
      }`);
      
      // Return the successful result with file processing token count
      return {
        successful: true,
        escalated: false,
        response: formattedResponse,
        modelUsed: 'small',
        durationMs: smallModelDuration,
        inputTokens: feedbackData.tokensSmall?.input,
        outputTokens: feedbackData.tokensSmall?.output,
        fileProcessingTokens: totalFileProcessingTokens
      };
    }
    
    // If we get here, the small model didn't find good results or they were unreliable
    console.log('[Progressive Query] Small model results insufficient, escalating...');
    console.log(`[Progressive Query] Escalation reason: ${
      hasNoResults ? 'No results found' : 
      hasStructuralIssues ? 'Structural issues in response' : 
      hasContentIssues ? 'Content issues or uncertainty' : 
      'Recent file modifications'
    }`);
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
    
    // Restore original fs.readFileSync to avoid affecting other operations
    fs.readFileSync = originalReadFileSync;
    
    // Log token usage information
    console.log(`[Token Tracker] Query complete with large model. Processed ${totalFileProcessingTokens.toLocaleString()} tokens from files`);
    console.log(`[Token Tracker] Small model tokens: ${feedbackData.tokensSmall?.input || 0} input, ${feedbackData.tokensSmall?.output || 0} output`);
    console.log(`[Token Tracker] Large model tokens: ${feedbackData.tokensLarge?.input?.toLocaleString() || 'unknown'} input, ${feedbackData.tokensLarge?.output?.toLocaleString() || 'unknown'} output`);
    console.log(`[Token Tracker] Total search tokens: ${
      (totalFileProcessingTokens + 
      (feedbackData.tokensSmall?.input || 0) + 
      (feedbackData.tokensLarge?.input || 0)).toLocaleString()
    }`);
    
    // Return the result with file processing token count
    return {
      successful: true,
      escalated: true,
      response: formattedResponse,
      modelUsed: 'large',
      durationMs: largeModelDuration,
      inputTokens: feedbackData.tokensLarge?.input,
      outputTokens: feedbackData.tokensLarge?.output,
      fileProcessingTokens: totalFileProcessingTokens
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
    
    // Restore original fs.readFileSync before returning error response
    fs.readFileSync = originalReadFileSync;
    
    // Log token usage information even for failed queries
    console.log(`[Token Tracker] Query failed but processed ${totalFileProcessingTokens.toLocaleString()} tokens from files`);
    console.log(`[Token Tracker] Small model tokens: ${feedbackData.tokensSmall?.input || 0} input, ${feedbackData.tokensSmall?.output || 0} output`);
    if (feedbackData.tokensLarge) {
      console.log(`[Token Tracker] Large model tokens: ${feedbackData.tokensLarge.input || 0} input, ${feedbackData.tokensLarge.output || 0} output`);
    }
    
    return {
      successful: false,
      escalated: true,
      response: `I couldn't find relevant information in the codebase for your query: "${information_request}"\n\nDiagnostic Information:\n- Attempted a broader reformulated query but still found no results\n- The query may contain entity names that don't match the actual codebase\n- If you're looking for an interface like "SomeProps", try searching for the component file instead\n- If searching for a specific functionality, try broader terms or focus on directories\n\nSuggested Approaches:\n- Try a more general search term like the base name (e.g., "Trade" instead of "TradeFormData")\n- Check specific directories like "components/", "types/", or "interfaces/"\n- Use a keyword search with common patterns (e.g., "interface *Props" or "type *Data")\n- Provide a partial file path if you have an idea where the code might be located`,
      modelUsed: 'large',
      durationMs: Date.now() - largeModelStartTime,
      fileProcessingTokens: totalFileProcessingTokens
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