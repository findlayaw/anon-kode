#!/bin/bash

# Script to apply and test ContextEngine improvements

# Color formatting
RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${BLUE}=== ContextEngine Improvement Runner ===${NC}"
echo ""

# Check if @babel dependencies are installed
echo -e "${YELLOW}Checking for required dependencies...${NC}"

# Array of required packages
REQUIRED_PACKAGES=(
  "@babel/parser"
  "@babel/traverse"
  "@babel/types"
)

NEED_INSTALL=false

# Check if each package is installed
for PACKAGE in "${REQUIRED_PACKAGES[@]}"
do
  if ! npm list "$PACKAGE" > /dev/null 2>&1; then
    echo -e "${RED}Missing dependency: $PACKAGE${NC}"
    NEED_INSTALL=true
  else
    echo -e "${GREEN}Found dependency: $PACKAGE${NC}"
  fi
done

# Install dependencies if needed
if [ "$NEED_INSTALL" = true ]; then
  echo -e "${YELLOW}Installing missing dependencies...${NC}"
  npm install @babel/parser @babel/traverse @babel/types --save
  if [ $? -ne 0 ]; then
    echo -e "${RED}Failed to install dependencies. Please install manually:${NC}"
    echo "npm install @babel/parser @babel/traverse @babel/types --save"
    exit 1
  fi
  echo -e "${GREEN}Dependencies installed successfully.${NC}"
fi

# Apply the improvements
echo -e "${YELLOW}Applying ContextEngine improvements...${NC}"
npx tsx ./src/tools/ContextEngine/updateTool.ts

if [ $? -ne 0 ]; then
  echo -e "${RED}Failed to apply improvements. Please check the error message above.${NC}"
  exit 1
fi

echo -e "${GREEN}ContextEngine improvements applied successfully!${NC}"
echo ""

# Ask if user wants to run tests
echo -e "${BLUE}Would you like to run tests to verify the improvements? (y/n)${NC}"
read -r run_tests

if [[ $run_tests =~ ^[Yy]$ ]]; then
  echo -e "${YELLOW}Running tests...${NC}"
  npx tsx ./src/tools/ContextEngine/testImprovedTool.ts
  
  if [ $? -ne 0 ]; then
    echo -e "${RED}Tests failed. Please check the error message above.${NC}"
  else
    echo -e "${GREEN}Tests completed! Check the test-results directory for details.${NC}"
  fi
else
  echo -e "${BLUE}Skipping tests.${NC}"
fi

echo ""
echo -e "${GREEN}ContextEngine improvements are complete!${NC}"
echo -e "${BLUE}Please refer to IMPROVEMENTS.md for details about the changes made.${NC}"
echo -e "${YELLOW}To use the improved tool, simply use the ContextEngine as before - all improvements are now active.${NC}"