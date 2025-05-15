"""
Task Analyzer for Test Generation

This module analyzes task descriptions to extract key requirements,
identify potential edge cases, and suggest relevant test scenarios
to improve the quality and relevance of generated tests.
"""
import re
import logging
import nltk
from typing import Dict, List, Set, Tuple, Any, Optional
from src.task_relevance import extract_key_terms

# Configure logging
logger = logging.getLogger(__name__)

try:
    # Initialize NLTK resources if available
    nltk.data.find('tokenizers/punkt')
except LookupError:
    try:
        # Download necessary resources if not available
        nltk.download('punkt', quiet=True)
    except Exception as e:
        logger.warning(f"Could not download NLTK resources: {e}. Using fallback tokenization.")

class TaskAnalyzer:
    """
    Analyzes task descriptions to improve test generation relevance
    """
    
    def __init__(self):
        """Initialize the task analyzer"""
        # Common programming concepts that might need special testing
        self.special_concepts = {
            # Data types and structures
            "numeric": ["integer", "int", "float", "double", "number", "decimal", "numeric"],
            "string": ["string", "text", "str", "char", "character"],
            "boolean": ["boolean", "bool", "flag", "true", "false"],
            "array": ["array", "list", "sequence", "collection", "vector"],
            "object": ["object", "class", "instance", "struct"],
            "map": ["map", "dictionary", "dict", "hash", "key-value"],
            "set": ["set", "unique"],
            
            # Common operations
            "math": ["add", "subtract", "multiply", "divide", "sum", "calculate", "compute"],
            "sort": ["sort", "order", "arrange", "sequence"],
            "search": ["search", "find", "locate", "query", "lookup"],
            "filter": ["filter", "select", "where", "condition"],
            "transform": ["transform", "convert", "parse", "format", "map"],
            
            # Edge case indicators
            "validation": ["valid", "invalid", "validate", "check", "verify"],
            "error": ["error", "exception", "failure", "crash", "handling"],
            "edge": ["edge", "boundary", "limit", "max", "min", "empty", "full"],
            "performance": ["performance", "speed", "efficient", "optimize", "fast", "slow"],
            "async": ["async", "synchronous", "concurrent", "parallel", "thread"],
            
            # Additional programming paradigms
            "functional": ["functional", "pure", "immutable", "map", "reduce", "filter", "lambda"],
            "oop": ["class", "object", "inheritance", "polymorphism", "encapsulation", "method"],
            "memory": ["memory", "allocation", "deallocation", "leak", "pointer", "reference"],
            "io": ["io", "input", "output", "file", "stream", "read", "write"],
            "network": ["network", "http", "tcp", "udp", "socket", "request", "response"],
            "concurrency": ["thread", "mutex", "lock", "atomic", "concurrent", "parallel", "race"]
        }
        
        # Language-specific concepts that impact testing strategies
        self.language_concepts = {
            "python": ["generator", "iterator", "context manager", "decorator", "gil"],
            "javascript": ["promise", "async/await", "closure", "prototype", "event loop"],
            "typescript": ["type", "interface", "generic", "union", "intersection", "enum"],
            "java": ["checked exception", "unchecked exception", "final", "abstract", "interface"],
            "cpp": ["template", "raii", "move", "const", "pointer", "reference", "smart pointer", "std::expected", "std::format", "std::print", "modules", "auto(x)", "if consteval", "spaceship operator"],
            "rust": ["ownership", "borrow", "lifetime", "trait", "enum", "pattern matching"],
            "csharp": ["linq", "delegate", "event", "property", "extension method"],
            "go": ["goroutine", "channel", "defer", "interface", "error handling"]
        }
        
        # Testing patterns for different types of functionality
        self.testing_patterns = {
            "api": {
                "setup": ["create client", "instantiate api", "mock server"],
                "strategies": ["validate response codes", "check headers", "verify payloads"],
                "edge_cases": ["timeout", "server error", "malformed response", "rate limiting"]
            },
            "data_processing": {
                "setup": ["prepare input data", "setup processing pipeline"],
                "strategies": ["verify output format", "validate transformations", "check performance"],
                "edge_cases": ["empty dataset", "malformed data", "extremely large dataset"]
            },
            "algorithm": {
                "setup": ["initialize algorithm", "prepare test cases"],
                "strategies": ["verify correctness", "test time complexity", "validate optimizations"],
                "edge_cases": ["worst-case inputs", "already sorted data", "duplicate values"]
            },
            "user_interface": {
                "setup": ["render component", "simulate user environment"],
                "strategies": ["check rendering", "test interactions", "verify state changes"],
                "edge_cases": ["mobile viewport", "accessibility", "different browsers/platforms"]
            },
            "database": {
                "setup": ["create test database", "seed initial data"],
                "strategies": ["verify CRUD operations", "test transactions", "validate constraints"],
                "edge_cases": ["connection failure", "concurrent access", "data corruption"]
            },
            "security": {
                "setup": ["create authenticated context", "prepare secure environment"],
                "strategies": ["test authentication", "verify authorization", "check data protection"],
                "edge_cases": ["invalid credentials", "expired tokens", "injection attempts"]
            }
        }
        
    def analyze_task(self, task_description: str, code: str = None, language: str = None) -> Dict[str, Any]:
        """
        Analyze a task description to improve test generation.
        
        Args:
            task_description: The task description to analyze
            code: Optional code to provide additional context
            language: Programming language for language-specific analysis
            
        Returns:
            Dictionary with analysis results, including:
            - key_requirements: List of key functional requirements
            - edge_cases: List of potential edge cases to test
            - test_scenarios: List of suggested test scenarios
            - concepts: Identified programming concepts
        """
        if not task_description:
            logger.warning("Empty task description provided for analysis")
            return {
                "key_requirements": [],
                "edge_cases": [],
                "test_scenarios": [],
                "concepts": []
            }
            
        # Extract key terms from the task description
        key_terms = extract_key_terms(task_description)
        
        # Identify programming concepts
        concepts = self._identify_concepts(task_description, key_terms)
        
        # Extract key requirements
        requirements = self._extract_requirements(task_description)
        
        # Identify potential edge cases
        edge_cases = self._identify_edge_cases(task_description, concepts)
        
        # Detect language if not provided but code is available
        detected_language = language
        if code and not language:
            detected_language = self._detect_language(code)
            
        # Identify task domain/category 
        domain = self._identify_task_domain(task_description, key_terms, concepts)
            
        # Generate test scenarios
        test_scenarios = self._generate_test_scenarios(
            requirements, concepts, edge_cases, detected_language, domain
        )
        
        # If code is provided, enhance analysis with code inspection
        if code:
            code_insights = self._analyze_code(code, detected_language)
            # Supplement the analysis with code insights
            concepts.update(code_insights.get("concepts", set()))
            edge_cases.extend([ec for ec in code_insights.get("edge_cases", []) 
                             if ec not in edge_cases])
                             
            # Add code-specific test scenarios
            test_scenarios.extend([ts for ts in code_insights.get("test_scenarios", [])
                                if ts not in test_scenarios])
            
        analysis_result = {
            "key_requirements": list(requirements),
            "edge_cases": edge_cases,
            "test_scenarios": test_scenarios,
            "concepts": list(concepts),
            "domain": domain,
            "detected_language": detected_language
        }
        
        logger.info(f"Task analysis complete: {len(requirements)} requirements, "
                  f"{len(concepts)} concepts, {len(edge_cases)} edge cases")
        
        return analysis_result
        
    def _identify_concepts(self, text: str, key_terms: Set[str] = None) -> Set[str]:
        """
        Identify programming concepts in the task description.
        
        Args:
            text: The text to analyze
            key_terms: Optional pre-extracted key terms
            
        Returns:
            Set of identified concepts
        """
        text_lower = text.lower()
        concepts = set()
        
        # Look for known concepts in the text
        for concept_category, keywords in self.special_concepts.items():
            for keyword in keywords:
                if keyword in text_lower:
                    concepts.add(concept_category)
                    break
        
        # Look for programming patterns in the key terms
        if key_terms:
            pattern_concepts = {'api', 'database', 'file', 'async', 
                               'math', 'string', 'array', 'object'}
            for term in key_terms:
                if term in pattern_concepts:
                    concepts.add(term)
        
        return concepts
    
    def _extract_requirements(self, text: str) -> Set[str]:
        """
        Extract key functional requirements from the task description.
        
        Args:
            text: The task description
            
        Returns:
            Set of identified requirements
        """
        requirements = set()
        
        # Split into sentences
        try:
            sentences = nltk.sent_tokenize(text)
        except:
            # Fallback to simple splitting
            sentences = [s.strip() for s in re.split(r'[.!?]', text) if s.strip()]
        
        # Look for requirement indicators
        requirement_indicators = [
            r"should\s+\w+", r"must\s+\w+", r"needs?\s+to\s+\w+",
            r"implement\s+\w+", r"create\s+\w+", r"develop\s+\w+",
            r"add\s+\w+", r"support\s+\w+", r"handle\s+\w+",
            r"ensure\s+\w+", r"allow\s+\w+", r"provide\s+\w+"
        ]
        
        for sentence in sentences:
            for indicator in requirement_indicators:
                if re.search(indicator, sentence, re.IGNORECASE):
                    # Clean up the requirement
                    req = self._clean_requirement(sentence)
                    if req:
                        requirements.add(req)
                    break
        
        # If no explicit requirements found, use sentences as implicit requirements
        if not requirements and sentences:
            for sentence in sentences:
                req = self._clean_requirement(sentence)
                if req:
                    requirements.add(req)
        
        return requirements
    
    def _clean_requirement(self, text: str) -> Optional[str]:
        """Clean and format a requirement text"""
        # Remove unnecessary prefixes
        text = re.sub(r"^(you should|you need to|please|the code should|implement|create)", "", text, flags=re.IGNORECASE)
        text = text.strip('. \t\n,')
        
        # Only keep if substantial content remains
        if len(text) > 10:
            return text
        return None
    
    def _identify_edge_cases(self, text: str, concepts: Set[str]) -> List[str]:
        """
        Identify potential edge cases based on task description and concepts.
        
        Args:
            text: The task description
            concepts: Identified programming concepts
            
        Returns:
            List of potential edge cases to test
        """
        edge_cases = []
        
        # Add concept-specific edge cases
        if "numeric" in concepts:
            edge_cases.extend([
                "Test with zero values",
                "Test with negative numbers",
                "Test with very large numbers",
                "Test with decimal/floating point values",
                "Test with minimum/maximum allowed values",
                "Test with NaN or infinity values",
                "Test with numeric overflow/underflow"
            ])
        
        if "string" in concepts:
            edge_cases.extend([
                "Test with empty strings",
                "Test with very long strings",
                "Test with special characters",
                "Test with unicode/non-ASCII characters",
                "Test with whitespace-only strings",
                "Test with strings containing escape characters",
                "Test with multi-line strings"
            ])
            
        if "array" in concepts or "list" in concepts:
            edge_cases.extend([
                "Test with empty arrays/lists",
                "Test with very large arrays/lists",
                "Test with nested arrays/lists",
                "Test with duplicate elements",
                "Test with mixed type elements",
                "Test with pre-sorted and reverse-sorted arrays",
                "Test with arrays/lists containing null/None values"
            ])
            
        if "map" in concepts or "dictionary" in concepts:
            edge_cases.extend([
                "Test with empty dictionaries/maps",
                "Test with missing keys",
                "Test with nested dictionaries/maps",
                "Test with complex key types",
                "Test with very large dictionaries/maps",
                "Test with key collisions",
                "Test with null/None values in keys or values"
            ])
            
        if "error" in concepts:
            edge_cases.extend([
                "Test error handling for invalid inputs",
                "Test error handling for boundary conditions",
                "Test error handling for resource failures",
                "Test error propagation through call stack",
                "Test error recovery mechanisms",
                "Test custom exceptions/error types",
                "Test proper error messaging"
            ])
            
        if "async" in concepts:
            edge_cases.extend([
                "Test with concurrent operations",
                "Test with delayed responses",
                "Test with timeout conditions",
                "Test race conditions",
                "Test cancellation scenarios",
                "Test error handling in asynchronous code"
            ])
            
        if "performance" in concepts:
            edge_cases.extend([
                "Test with large inputs for performance",
                "Test with worst-case scenarios",
                "Test memory usage with large inputs",
                "Test response time under load",
                "Test caching mechanisms",
                "Test scaling behavior"
            ])
            
        if "io" in concepts:
            edge_cases.extend([
                "Test with empty files/streams",
                "Test with very large files/streams",
                "Test with corrupted input",
                "Test with file access permissions issues",
                "Test with network/connection failures"
            ])
            
        if "network" in concepts:
            edge_cases.extend([
                "Test with network latency",
                "Test with connection failures",
                "Test with partial responses",
                "Test with timeouts",
                "Test with malformed responses"
            ])
            
        if "concurrency" in concepts:
            edge_cases.extend([
                "Test with multiple concurrent threads/processes",
                "Test locking mechanisms",
                "Test for race conditions",
                "Test deadlock prevention",
                "Test thread scheduling scenarios"
            ])
            
        if "memory" in concepts:
            edge_cases.extend([
                "Test memory allocation failures",
                "Test memory leak prevention",
                "Test with very large memory requirements",
                "Test memory cleanup/release",
                "Test memory fragmentation scenarios"
            ])
        
        # Look for explicit mentions of edge cases in the text
        edge_case_indicators = [
            r"edge\s+case", r"boundary", r"corner\s+case",
            r"limit", r"exception", r"error", r"handle",
            r"crash", r"fail", r"special\s+case"
        ]
        
        text_lower = text.lower()
        for indicator in edge_case_indicators:
            if re.search(indicator, text_lower):
                # Extract sentences containing edge case indicators
                try:
                    sentences = nltk.sent_tokenize(text)
                    for sentence in sentences:
                        if re.search(indicator, sentence.lower()):
                            clean = self._clean_requirement(sentence)
                            if clean and "Test " + clean not in edge_cases:
                                edge_cases.append(f"Test {clean}")
                except:
                    # Fallback without sentence tokenization
                    pass
        
        return edge_cases
    
    def _identify_task_domain(self, text: str, key_terms: Set[str], concepts: Set[str]) -> str:
        """
        Identify the domain or category of the task.
        
        Args:
            text: The task description
            key_terms: Extracted key terms
            concepts: Identified concepts
            
        Returns:
            Domain category string
        """
        text_lower = text.lower()
        
        # Define domain detection patterns
        domain_patterns = {
            "api": ["api", "endpoint", "rest", "http", "request", "response", "server"],
            "data_processing": ["process", "transform", "convert", "parse", "data", "pipeline"],
            "algorithm": ["algorithm", "sort", "search", "compute", "calculate", "optimization"],
            "user_interface": ["ui", "interface", "display", "render", "component", "user"],
            "database": ["database", "db", "query", "sql", "nosql", "record", "store"],
            "security": ["security", "auth", "authentication", "encryption", "password", "token"]
        }
        
        # Score each domain based on term matches
        domain_scores = {}
        for domain, terms in domain_patterns.items():
            score = 0
            for term in terms:
                if term in text_lower:
                    score += 1
                if term in key_terms:
                    score += 2
            domain_scores[domain] = score
        
        # Adjust scores based on concepts
        if "network" in concepts or "async" in concepts:
            domain_scores["api"] = domain_scores.get("api", 0) + 2
            
        if "transform" in concepts or "filter" in concepts:
            domain_scores["data_processing"] = domain_scores.get("data_processing", 0) + 2
            
        if "sort" in concepts or "search" in concepts or "math" in concepts:
            domain_scores["algorithm"] = domain_scores.get("algorithm", 0) + 2
            
        if "validation" in concepts:
            domain_scores["user_interface"] = domain_scores.get("user_interface", 0) + 1
            
        if "map" in concepts or "object" in concepts:
            domain_scores["database"] = domain_scores.get("database", 0) + 1
            
        if "error" in concepts:
            domain_scores["security"] = domain_scores.get("security", 0) + 1
        
        # Return the domain with highest score
        if domain_scores:
            max_domain = max(domain_scores.items(), key=lambda x: x[1])
            if max_domain[1] > 0:
                return max_domain[0]
                
        # Default to "general" if no clear domain is detected
        return "general"
    
    def _generate_test_scenarios(self, requirements: Set[str], 
                                 concepts: Set[str], 
                                 edge_cases: List[str],
                                 language: str = None,
                                 domain: str = "general") -> List[str]:
        """
        Generate test scenarios based on requirements, concepts, edge cases and domain.
        
        Args:
            requirements: Extracted requirements
            concepts: Identified concepts
            edge_cases: Identified edge cases
            language: Programming language
            domain: Task domain/category
            
        Returns:
            List of test scenarios
        """
        scenarios = []
        
        # Convert requirements to test scenarios
        for req in requirements:
            scenario = f"Test that code correctly {req}"
            scenarios.append(scenario)
        
        # Add concept-specific standard scenarios
        if "validation" in concepts:
            scenarios.append("Test input validation for all parameters")
            scenarios.append("Test validation error messages are helpful and accurate")
            
        if "sort" in concepts:
            scenarios.append("Test sorting with pre-sorted input")
            scenarios.append("Test sorting with reverse-sorted input")
            scenarios.append("Test sorting stability with equal elements")
            scenarios.append("Test sorting performance with large datasets")
            
        if "search" in concepts:
            scenarios.append("Test searching for existing elements")
            scenarios.append("Test searching for non-existent elements")
            scenarios.append("Test search with duplicate elements")
            scenarios.append("Test search performance with large datasets")
            
        if "transform" in concepts:
            scenarios.append("Test transformation preserves all required data")
            scenarios.append("Test transformation correctly handles all formats")
            scenarios.append("Test transformation error handling for invalid formats")
            
        if "async" in concepts:
            scenarios.append("Test asynchronous operations complete correctly")
            scenarios.append("Test handling of concurrent requests")
            scenarios.append("Test proper error propagation in async context")
            
        if "io" in concepts:
            scenarios.append("Test file operations with valid and invalid paths")
            scenarios.append("Test handling of IO errors")
            scenarios.append("Test proper resource cleanup after operations")
        
        # Add domain-specific test scenarios
        if domain in self.testing_patterns:
            for strategy in self.testing_patterns[domain].get("strategies", []):
                scenarios.append(f"Test {strategy}")
        
        # Add language-specific test scenarios
        if language and language in self.language_concepts:
            for concept in self.language_concepts[language]:
                if any(concept in req.lower() for req in requirements):
                    scenarios.append(f"Test {language}-specific {concept} handling")
        
        # Include edge cases as scenarios if they're not too many
        if len(edge_cases) <= 5:
            scenarios.extend(edge_cases)
        else:
            # Otherwise, prioritize edge cases
            priority_concepts = ["error", "validation", "edge", "performance", "security"]
            priority_cases = []
            other_cases = []
            
            for case in edge_cases:
                is_priority = False
                for concept in priority_concepts:
                    if concept in case.lower():
                        priority_cases.append(case)
                        is_priority = True
                        break
                if not is_priority:
                    other_cases.append(case)
            
            # Add priority cases first, then others until limit
            scenarios.extend(priority_cases)
            remaining_slots = max(0, 10 - len(scenarios))
            if remaining_slots > 0:
                scenarios.extend(other_cases[:remaining_slots])
        
        # Ensure no duplicates
        unique_scenarios = []
        seen = set()
        for scenario in scenarios:
            normalized = scenario.lower()
            if normalized not in seen:
                seen.add(normalized)
                unique_scenarios.append(scenario)
        
        return unique_scenarios
    
    def _detect_language(self, code: str) -> str:
        """
        Attempt to detect the programming language from code.
        
        Args:
            code: Source code to analyze
            
        Returns:
            Detected programming language or "unknown"
        """
        if not code:
            return "unknown"
            
        code_lower = code.lower()
        
        # Check for language indicators
        if 'def ' in code and ':' in code:
            return "python"
        elif '{' in code and '}' in code:
            if 'function ' in code_lower or '=>' in code:
                if 'import ' in code and 'from ' in code:
                    return "typescript"
                else:
                    return "javascript"
            elif 'class ' in code_lower and ('public ' in code_lower or 'private ' in code_lower):
                return "java"
            elif '#include' in code:
                return "cpp"
            elif 'fn ' in code and ('let mut' in code_lower or 'impl ' in code_lower):
                return "rust"
            elif 'using ' in code and 'namespace ' in code:
                return "csharp"
            elif 'func ' in code and 'package ' in code:
                return "go"
        
        return "unknown"
        
    def _analyze_code(self, code: str, language: str = None) -> Dict[str, Any]:
        """
        Analyze code to enhance task analysis with additional insights.
        
        Args:
            code: The code to analyze
            language: Programming language of the code
            
        Returns:
            Dictionary with code analysis insights
        """
        insights = {
            "concepts": set(),
            "edge_cases": [],
            "test_scenarios": []
        }
        
        # Skip if code is missing or too short
        if not code or len(code) < 10:
            return insights
        
        code_lower = code.lower()
        
        # Detect language if not provided
        if not language:
            language = self._detect_language(code)
        
        # Identify concepts in code
        if 'if' in code_lower or 'else' in code_lower:
            insights["concepts"].add("condition")
        
        if 'for ' in code_lower or 'while ' in code_lower:
            insights["concepts"].add("loop")
        
        if 'try' in code_lower and ('catch' in code_lower or 'except' in code_lower):
            insights["concepts"].add("error")
            
        if 'class ' in code_lower:
            insights["concepts"].add("object")
            
        if '[]' in code or 'list' in code_lower or 'array' in code_lower or 'vector' in code_lower:
            insights["concepts"].add("array")
            
        if 'map' in code_lower or 'dictionary' in code_lower or 'dict' in code_lower or 'hashmap' in code_lower:
            insights["concepts"].add("map")
            
        if 'async ' in code_lower or 'promise' in code_lower or 'await' in code_lower or '.then' in code_lower:
            insights["concepts"].add("async")
            
        if 'thread' in code_lower or 'mutex' in code_lower or 'lock' in code_lower:
            insights["concepts"].add("concurrency")
            
        if 'file' in code_lower or 'open(' in code_lower or 'read' in code_lower or 'write' in code_lower:
            insights["concepts"].add("io")
            
        # Search for null checks as indicator of potential edge cases
        if 'null' in code_lower or 'none' in code_lower or 'undefined' in code_lower or 'nil' in code_lower:
            insights["edge_cases"].append("Test with null/None/undefined values")
            insights["test_scenarios"].append("Test handling of null/None/undefined values")
            
        # Look for boundary checks
        if '<=' in code or '>=' in code or '< 0' in code or '> 0' in code:
            insights["edge_cases"].append("Test boundary conditions in numeric comparisons")
            insights["test_scenarios"].append("Test boundary conditions in comparisons")
            
        # Check for string operations
        if '.length' in code or 'len(' in code or '.size()' in code:
            insights["edge_cases"].append("Test with empty and very long sequences")
            insights["test_scenarios"].append("Test handling of empty and very long sequences")
            
        # Check for error handling
        if 'throw' in code_lower or 'raise' in code_lower or 'error' in code_lower or 'exception' in code_lower:
            insights["edge_cases"].append("Test error handling paths")
            insights["test_scenarios"].append("Test comprehensive error handling paths")
            
        # Check for input validation
        if 'valid' in code_lower or 'check' in code_lower or 'verify' in code_lower:
            insights["edge_cases"].append("Test input validation")
            insights["test_scenarios"].append("Test comprehensive input validation")
            
        # Add language-specific test scenarios
        if language in self.language_concepts:
            for concept in self.language_concepts[language]:
                if concept.lower() in code_lower:
                    insights["test_scenarios"].append(f"Test {language}-specific {concept}")
            
        return insights

def analyze_task_for_testing(task_description: str, 
                             code: str = None, 
                             language: str = None) -> Dict[str, Any]:
    """
    Analyze a task description to improve test generation.
    
    Args:
        task_description: The task description to analyze
        code: Optional code to provide additional context
        language: Programming language for language-specific analysis
        
    Returns:
        Dictionary with analysis results
    """
    analyzer = TaskAnalyzer()
    return analyzer.analyze_task(task_description, code, language)
