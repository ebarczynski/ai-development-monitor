# SPDX-License-Identifier: Apache-2.0
# Copyright 2025 Edwin Barczyński

"""
Test Quality Metrics

This module defines and implements metrics for evaluating the quality of
test code to provide a more comprehensive assessment beyond simple pass/fail.
"""
import re
import logging
import math
from typing import Dict, List, Any, Optional, Set, Tuple

# Configure logging
logger = logging.getLogger(__name__)

class TestQualityMetrics:
    """
    Evaluates the quality of test code using various metrics
    """
    
    def __init__(self):
        """Initialize test quality metrics"""
        # Define patterns for different test types with enhanced language-independent patterns
        self.test_type_patterns = {
            # Unit test patterns for multiple languages
            "unit": [
                # Python patterns
                r"test_\w+", r"def test_", 
                # JavaScript/TypeScript patterns
                r"function test", r"it\(\s*['\"]\w+", r"test\(\s*['\"]\w+",
                # Java/C# patterns
                r"@Test", r"void test\w+\s*\(",
                # C++ patterns
                r"TEST\(", r"TEST_F\(", r"BOOST_(?:AUTO_)?TEST_CASE",
                # Rust patterns  
                r"#\[test\]", r"fn test_\w+",
                # Generic patterns
                r"assert_\w+", r"check_\w+"
            ],
            
            # Parameterized test patterns
            "parameterized": [
                # Python patterns
                r"@parameterized", r"@pytest.mark.parametrize", 
                # JavaScript patterns
                r"test.each\(", r"it.each\(", 
                # Java patterns
                r"@ParameterizedTest", r"@CsvSource", r"@ValueSource",
                # C++ patterns
                r"INSTANTIATE_TEST_SUITE_P", r"TEST_P",
                # Rust patterns
                r"#\[rstest\]", r"#\[case\]",
                # Generic patterns
                r"(?:for|foreach)\s*\([^)]*\)\s*{[^}]*(?:test|assert)"
            ],
            
            # Assertion patterns for multiple languages
            "assertion": [
                # Common across languages
                r"assert", r"expect\(.*\).to", r"should\.", 
                # Java/C# patterns
                r"assertEquals", r"assertTrue", r"assertFalse", r"verify\(", 
                # C++ patterns
                r"ASSERT_", r"EXPECT_", r"BOOST_(?:CHECK|REQUIRE|TEST)",
                # Rust patterns
                r"assert!", r"assert_eq!", r"assert_ne!",
                # Additional patterns
                r"is_equal", r"isEqual", r"areEqual", r"notEqual",
                r"is\s*\(", r"\.not\.", r"be\."
            ],
            
            # Edge case patterns
            "edge_case": [
                r"edge\s*case", r"boundary", r"empty", 
                r"null", r"nil", r"none", r"undefined", r"Option::None",
                r"exception", r"error", r"throw", r"unwrap", r"panic", r"fail",
                r"overflow", r"underflow", r"zero", r"NaN", r"Infinity",
                r"max\s*value", r"min\s*value", r"INT_MAX", r"INT_MIN", r"std::numeric_limits",
                r"special\s*character", r"unicode", r"utf", 
                r"(?:very|too)\s*(?:large|small|long|short)"
            ],
            
            # Mocking patterns for multiple languages
            "mocking": [
                r"mock", r"stub", r"fake", r"spy", r"dummy", r"double",
                r"@Mock", r"createMock", r"MockBean", r"mockito", 
                r"jest.fn", r"sinon", r"moq", r"gmock", r"test::mock",
                r"setUp\([^)]*mock", r"setup\([^)]*mock",
                r"patch", r"MagicMock"
            ],
            
            # Test fixures/setup
            "fixtures": [
                r"(?:before|after)(?:Each|All)", r"setUp", r"tearDown", 
                r"@Before", r"@After", r"@BeforeClass", r"@AfterClass",
                r"TestFixture", r"fixture", r"FIXTURE", 
                r"describe\([^)]*,\s*function", r"xdescribe", r"fdescribe"
            ],
            
            # Performance testing
            "performance": [
                r"benchmark", r"perf", r"performance", r"timing", r"elapsed",
                r"Duration", r"Stopwatch", r"time\.time", r"System\.nanoTime",
                r"Date\.now", r"performance\.now", r"hrtime", r"clock\(\)",
                r"CLOCK_", r"std::chrono", r"boost::timer"
            ],
            
            # Security testing
            "security": [
                r"security", r"vulnerability", r"exploit", r"attack", r"injection",
                r"sanitize", r"escape", r"XSS", r"CSRF", r"overflow", r"underflow",
                r"authenticate", r"authorize", r"permission", r"privilege"
            ]
        }
        
        # Language-specific features (to detect language and accommodate)
        self.language_features = {
            "python": [r"def\s+\w+", r"import\s+", r"from\s+\w+\s+import", r":\s*$", r"pytest", r"unittest"],
            "javascript": [r"function\s+", r"const\s+", r"let\s+", r"var\s+", r"=>\s*{", r"jest", r"mocha"],
            "typescript": [r"interface\s+", r"class\s+", r"type\s+", r":\s*\w+", r"<\w+>"],
            "java": [r"public\s+class", r"private\s+\w+", r"protected\s+\w+", r"@Test", r"JUnit", r"TestNG"],
            "cpp": [r"#include", r"::\s*\w+", r"std::", r"template\s*<", r"namespace", r"gtest", r"expected<", r"std::format", r"std::print", r"auto\s*\(\s*\w+\s*\)", r"if\s+consteval"],
            "csharp": [r"namespace\s+", r"using\s+\w+;", r"public\s+(?:class|void)", r"NUnit", r"xUnit"],
            "rust": [r"fn\s+\w+", r"let\s+mut", r"impl\s+", r"pub\s+", r"struct\s+", r"enum\s+", r"mod\s+", r"#\[test\]"],
            "bash": [r"\[\[", r"\$\(", r"\$\{", r"function\s+\w+\s*\(\)", r"echo", r"#!/"],
            "go": [r"func\s+\w+", r"package\s+\w+", r"import\s+\(", r"func Test\w+\(t \*testing.T\)"],
            "ruby": [r"def\s+\w+", r"describe\s+", r"it\s+", r"require\s+", r"rspec", r"test_"]
        }
        
    def evaluate_test_quality(self, test_code: str, task_description: str = None,
                             source_code: str = None, language: str = None) -> Dict[str, Any]:
        """
        Evaluate the quality of test code using various metrics.
        
        Args:
            test_code: The test code to evaluate
            task_description: Optional task description for relevance assessment
            source_code: Optional source code being tested
            language: Optional programming language for language-specific analysis
            
        Returns:
            Dictionary containing quality metrics including:
            - completeness_score: How complete the tests appear to be
            - variety_score: Variety of test types/approaches used
            - edge_case_score: How well edge cases are covered
            - assertion_density: Density of assertions per test case
            - readability_score: How readable/maintainable the tests are
            - overall_quality: Combined quality metric from 0.0 to 1.0
            - strengths: List of identified test strengths
            - weaknesses: List of identified test weaknesses
        """
        if not test_code or len(test_code.strip()) < 10:
            logger.warning("Empty or minimal test code provided for quality evaluation")
            return {
                "completeness_score": 0.0,
                "variety_score": 0.0,
                "edge_case_score": 0.0,
                "assertion_density": 0.0,
                "readability_score": 0.0,
                "overall_quality": 0.0,
                "strengths": [],
                "weaknesses": ["Tests appear to be empty or minimal"]
            }
        
        # Auto-detect language if not provided
        if not language:
            language = self._detect_language(test_code)
            logger.debug(f"Detected language as: {language}")
            
        # Calculate individual metrics
        completeness = self._calculate_completeness(test_code, source_code, language)
        variety = self._calculate_test_variety(test_code, language)
        edge_case_coverage = self._calculate_edge_case_coverage(test_code, task_description, language)
        assertion_density = self._calculate_assertion_density(test_code, language)
        readability = self._calculate_readability(test_code, language)
        test_isolation = self._calculate_test_isolation(test_code, language)
        task_alignment = self._calculate_task_alignment(test_code, task_description) if task_description else {"score": 0.7}
        
        # Determine overall quality with the enhanced metrics
        overall_quality = self._calculate_overall_quality([
            completeness["score"], 
            variety["score"], 
            edge_case_coverage["score"],
            assertion_density["normalized_score"],
            readability["score"],
            test_isolation["score"],
            task_alignment["score"]
        ])
        
        # Identify strengths and weaknesses
        strengths = []
        weaknesses = []
        
        # Add specific strengths
        if completeness["score"] > 0.7:
            strengths.append("Good test coverage")
        if variety["score"] > 0.7:
            strengths.append("Good variety of test approaches")
        if edge_case_coverage["score"] > 0.7:
            strengths.append("Good edge case handling")
        if assertion_density["normalized_score"] > 0.7:
            strengths.append("Strong assertion density")
        if readability["score"] > 0.7:
            strengths.append("High test readability")
        if test_isolation["score"] > 0.7:
            strengths.append("Well-isolated tests")
        if task_alignment["score"] > 0.7:
            strengths.append("Tests well-aligned with task requirements")
            
        # Add specific weaknesses
        if completeness["score"] < 0.4:
            weaknesses.append("Limited test coverage")
        if variety["score"] < 0.4:
            weaknesses.append("Limited variety of test approaches")
        if edge_case_coverage["score"] < 0.4:
            weaknesses.append("Insufficient edge case handling")
        if assertion_density["normalized_score"] < 0.4:
            weaknesses.append("Low assertion density")
        if readability["score"] < 0.4:
            weaknesses.append("Poor test readability")
        if test_isolation["score"] < 0.4:
            weaknesses.append("Tests lack proper isolation")
        if task_alignment["score"] < 0.4:
            weaknesses.append("Tests don't align well with task requirements")
            
        # Combine metrics
        return {
            "completeness_score": completeness["score"],
            "variety_score": variety["score"],
            "edge_case_score": edge_case_coverage["score"],
            "assertion_density": assertion_density["value"],
            "normalized_assertion_density": assertion_density["normalized_score"],
            "readability_score": readability["score"],
            "test_isolation_score": test_isolation["score"],
            "task_alignment_score": task_alignment["score"],
            "overall_quality": overall_quality,
            "detected_language": language,
            "strengths": strengths,
            "weaknesses": weaknesses,
            "test_count": completeness["test_count"],
            "assertion_count": assertion_density["assertion_count"]
        }
    
    def _detect_language(self, code: str) -> str:
        """
        Attempt to detect the programming language of the code.
        
        Args:
            code: The code to analyze
            
        Returns:
            The detected programming language or "unknown"
        """
        if not code:
            return "unknown"
            
        # Count matches for each language's features
        language_scores = {}
        for lang, patterns in self.language_features.items():
            score = 0
            for pattern in patterns:
                matches = re.findall(pattern, code)
                score += len(matches)
            language_scores[lang] = score
            
        # Return the language with the highest score
        if language_scores:
            max_lang = max(language_scores.items(), key=lambda x: x[1])
            if max_lang[1] > 0:
                return max_lang[0]
                
        return "unknown"
        
    def _calculate_completeness(self, test_code: str, source_code: str = None, 
                               language: str = "unknown") -> Dict[str, Any]:
        """
        Calculate how complete the tests appear to be.
        
        Args:
            test_code: The test code
            source_code: Optional source code being tested
            language: Programming language for language-specific analysis
            
        Returns:
            Dictionary with completeness score and related metrics
        """
        # Count test functions/methods
        test_count = 0
        for pattern in self.test_type_patterns["unit"]:
            test_count += len(re.findall(pattern, test_code))
            
        # If we have source code, try to estimate coverage
        coverage_ratio = None
        if source_code:
            # Extract function/method names from source code
            source_funcs = set()
            # Common patterns for function definitions across languages
            func_patterns = [
                r"def\s+(\w+)\s*\(", 
                r"function\s+(\w+)\s*\(",
                r"(?:public|private|protected)\s+\w+\s+(\w+)\s*\(",
                r"\w+\s+(\w+)\s*\([^)]*\)\s*\{",
                r"fn\s+(\w+)\s*\(",  # Rust
                r"func\s+(\w+)\s*\("  # Go
            ]
            for pattern in func_patterns:
                for match in re.finditer(pattern, source_code):
                    source_funcs.add(match.group(1))
            
            # Extract function/method names being tested
            tested_funcs = set()
            # Patterns that indicate a function is being tested
            test_func_patterns = [
                r"test\w*_(\w+)", 
                r"test\s+that\s+(\w+)",
                r"(\w+)\s*\([^)]*\)\s*(?:should|must|will)",
                r"(?:assert|expect)[^;]*(?:\.|\s+)(\w+)\s*\("
            ]
            for pattern in test_func_patterns:
                for match in re.finditer(pattern, test_code):
                    tested_funcs.add(match.group(1))
            
            # Calculate coverage if we found functions
            if source_funcs:
                coverage_ratio = len(tested_funcs.intersection(source_funcs)) / len(source_funcs)
                
                # Look for additional coverage indicators
                coverage_indicators = {}
                
                # Look for branch coverage indicators
                coverage_indicators["branches"] = re.search(r"branch\s+coverage", test_code.lower()) is not None
                
                # Look for statement coverage indicators
                coverage_indicators["statements"] = re.search(r"statement\s+coverage", test_code.lower()) is not None
                
                # Look for path coverage indicators
                coverage_indicators["paths"] = re.search(r"path\s+coverage", test_code.lower()) is not None
        
        # Calculate final score based on available metrics
        if coverage_ratio is not None:
            # If we have a coverage ratio, use it
            score = coverage_ratio
        else:
            # Otherwise base score on test count with diminishing returns
            score = min(1.0, math.sqrt(test_count / 10))
        
        return {
            "score": score,
            "test_count": test_count,
            "coverage_ratio": coverage_ratio
        }
        
    def _calculate_test_variety(self, test_code: str, language: str = "unknown") -> Dict[str, Any]:
        """
        Calculate the variety of testing approaches used.
        
        Args:
            test_code: The test code
            language: Programming language for language-specific analysis
            
        Returns:
            Dictionary with variety score and related metrics
        """
        approaches_used = {}
        
        # Check for different testing approaches
        approaches_used["parameterized"] = any(
            re.search(pattern, test_code)
            for pattern in self.test_type_patterns["parameterized"]
        )
        
        approaches_used["mocking"] = any(
            re.search(pattern, test_code)
            for pattern in self.test_type_patterns["mocking"]
        )
        
        # Check for setup/teardown
        approaches_used["setup_teardown"] = any(
            re.search(pattern, test_code)
            for pattern in self.test_type_patterns["fixtures"]
        )
        
        # Check for test grouping
        approaches_used["test_grouping"] = re.search(
            r"(?:describe\s*\(|suite\s*\(|class\s+\w+Test|@Nested|context\s*\(|xdescribe|fdescribe)",
            test_code
        ) is not None
        
        # Check for data-driven tests
        approaches_used["data_driven"] = re.search(
            r"(?:test.each|@TestFactory|@DataProvider|testdata|@UseDataProvider|@CsvSource|@ValueSource)",
            test_code
        ) is not None
        
        # Check for performance testing
        approaches_used["performance"] = any(
            re.search(pattern, test_code)
            for pattern in self.test_type_patterns["performance"]
        )
        
        # Check for security testing
        approaches_used["security"] = any(
            re.search(pattern, test_code)
            for pattern in self.test_type_patterns["security"]
        )
        
        # Count the number of approaches used
        approaches_count = sum(1 for used in approaches_used.values() if used)
        
        # Calculate score based on approaches used (3+ approaches = perfect score)
        base_score = min(1.0, approaches_count / 3)  
        
        # Adjust score based on the complexity of the testing requirements
        if approaches_used["parameterized"] and approaches_used["data_driven"]:
            base_score = min(1.0, base_score + 0.1)  # Bonus for comprehensive approach
            
        return {
            "score": base_score,
            "approaches": approaches_used,
            "approaches_count": approaches_count
        }
        
    def _calculate_edge_case_coverage(self, test_code: str, 
                                     task_description: str = None,
                                     language: str = "unknown") -> Dict[str, Any]:
        """
        Calculate how well edge cases are covered in the tests.
        
        Args:
            test_code: The test code
            task_description: Optional task description for relevance assessment
            language: Programming language for language-specific analysis
            
        Returns:
            Dictionary with edge case score and related metrics
        """
        # Look for edge case testing patterns
        edge_case_matches = []
        for pattern in self.test_type_patterns["edge_case"]:
            edge_case_matches.extend(re.finditer(pattern, test_code, re.IGNORECASE))
        
        # Count unique edge case tests (deduplicate by line number)
        seen_lines = set()
        unique_edge_case_count = 0
        for match in edge_case_matches:
            # Estimate line number based on newlines before the match
            line_num = test_code[:match.start()].count('\n')
            if line_num not in seen_lines:
                seen_lines.add(line_num)
                unique_edge_case_count += 1
        
        # Look for specific types of edge cases
        edge_case_types = {
            "null_empty": re.search(r"(?:null|none|empty|undefined|''|\"\"|\[\]|{})", test_code.lower()) is not None,
            "boundary": re.search(r"(?:boundary|limit|min|max|zero|negative|upper|lower)", test_code.lower()) is not None,
            "error": re.search(r"(?:exception|error|throw|invalid|fail|panic|crash)", test_code.lower()) is not None,
            "large_inputs": re.search(r"(?:large|big|huge|overflow|many|multiple|long)", test_code.lower()) is not None,
            "special_chars": re.search(r"(?:special|character|symbol|unicode|utf|escape|non-ascii)", test_code.lower()) is not None,
            "performance": re.search(r"(?:timeout|slow|fast|performance|benchmark)", test_code.lower()) is not None,
            "concurrency": re.search(r"(?:concurrent|parallel|race|deadlock|thread|async|await)", test_code.lower()) is not None
        }
        
        # Count types of edge cases covered
        types_covered = sum(1 for covered in edge_case_types.values() if covered)
        
        # Calculate edge case score
        type_score = types_covered / len(edge_case_types)
        count_score = min(1.0, unique_edge_case_count / 5)  # 5+ edge cases = perfect score
        
        # Weighted score: type diversity is more important than raw count
        score = (type_score * 0.6) + (count_score * 0.4)
        
        # Additional language-specific checks
        if language == "cpp" or language == "rust":
            # Memory safety edge cases are important for these languages
            has_memory_safety = re.search(r"(?:memory|leak|dangling|null|overflow|underflow|bound|out of bounds|buffer)", 
                                         test_code.lower()) is not None
            if has_memory_safety:
                score = min(1.0, score + 0.1)
        
        return {
            "score": score,
            "edge_case_count": unique_edge_case_count,
            "edge_case_types": edge_case_types,
            "types_covered": types_covered
        }
        
    def _calculate_assertion_density(self, test_code: str, language: str = "unknown") -> Dict[str, Any]:
        """
        Calculate the density of assertions per test case.
        
        Args:
            test_code: The test code
            language: Programming language for language-specific analysis
            
        Returns:
            Dictionary with assertion density and related metrics
        """
        # Count test functions
        test_count = 0
        for pattern in self.test_type_patterns["unit"]:
            test_count += len(re.findall(pattern, test_code))
        
        test_count = max(1, test_count)  # Avoid division by zero
        
        # Count assertions
        assertion_count = 0
        for pattern in self.test_type_patterns["assertion"]:
            assertion_count += len(re.findall(pattern, test_code))
            
        # Calculate density
        assertion_density = assertion_count / test_count
        
        # Analyze assertion diversity
        assertion_types = set()
        
        # Common assertion type patterns across languages
        assertion_type_patterns = {
            "equality": r"(?:equal|same|identical|matches|is)\b",
            "inequality": r"(?:not\s+equal|different|not\s+same|inequality|isNot)\b",
            "boolean": r"(?:true|false|assertTrue|assertFalse|isTrue|isFalse)\b",
            "null_check": r"(?:null|none|nil|undefined|assertNull|assertNotNull|isNull|isNotNull)\b",
            "exception": r"(?:throws|exception|assertThrows|expect\w*\s*\w+\s*to\s*throw|catch|try)\b",
            "type_check": r"(?:instanceof|typeof|is_a|isinstance|isInstanceOf|assertInstanceOf)\b",
            "collection": r"(?:contains|size|length|empty|has|elements|in)\b",
        }
        
        for assertion_type, pattern in assertion_type_patterns.items():
            if re.search(pattern, test_code, re.IGNORECASE):
                assertion_types.add(assertion_type)
        
        assertion_diversity = len(assertion_types) / len(assertion_type_patterns)
        
        # Normalize score (optimal density is around 3-5 assertions per test)
        if assertion_density <= 0:
            normalized_score = 0.0
        elif assertion_density < 1:
            normalized_score = assertion_density * 0.5  # Less than 1 assertion per test is suboptimal
        elif assertion_density <= 5:
            normalized_score = 0.5 + (assertion_density / 10)  # Linear increase up to 5
        else:
            normalized_score = 1.0  # 5+ is excellent
            
        # Adjust score based on assertion diversity
        normalized_score = min(1.0, normalized_score + (assertion_diversity * 0.2))
        
        return {
            "value": assertion_density,
            "assertion_count": assertion_count,
            "test_count": test_count,
            "normalized_score": normalized_score,
            "assertion_diversity": assertion_diversity,
            "assertion_types": list(assertion_types)
        }
        
    def _calculate_readability(self, test_code: str, language: str = "unknown") -> Dict[str, Any]:
        """
        Calculate the readability of test code.
        
        Args:
            test_code: The test code
            language: Programming language for language-specific analysis
            
        Returns:
            Dictionary with readability score and related metrics
        """
        # Split code into lines
        lines = test_code.splitlines()
        total_lines = len(lines)
        if total_lines == 0:
            return {"score": 0.0, "metrics": {}}
        
        # Calculate metrics
        metrics = {}
        
        # Check for comments
        comment_lines = 0
        comment_patterns = {
            "python": [r"^\s*#", r"^\s*\"\"\""],
            "javascript": [r"^\s*//", r"^\s*/\*"],
            "typescript": [r"^\s*//", r"^\s*/\*"],
            "java": [r"^\s*//", r"^\s*/\*"],
            "cpp": [r"^\s*//", r"^\s*/\*"],
            "csharp": [r"^\s*//", r"^\s*/\*"],
            "rust": [r"^\s*//", r"^\s*/\*"],
            "go": [r"^\s*//", r"^\s*/\*"],
            "unknown": [r"^\s*#", r"^\s*//", r"^\s*/\*", r"^\s*\"\"\""]
        }
        
        # Use language-specific comment patterns if available
        patterns = comment_patterns.get(language, comment_patterns["unknown"])
        
        for line in lines:
            stripped = line.strip()
            is_comment = False
            for pattern in patterns:
                if re.match(pattern, stripped):
                    is_comment = True
                    break
            if is_comment:
                comment_lines += 1
        
        metrics["comment_ratio"] = comment_lines / total_lines
        
        # Check for descriptive test names based on language
        test_name_patterns = {
            "python": r"def\s+test_(\w+)",
            "javascript": r"(?:test|it)\s*\(\s*['\"]([^'\"]+)",
            "typescript": r"(?:test|it)\s*\(\s*['\"]([^'\"]+)",
            "java": r"(?:public|private|protected)\s+void\s+test(\w+)",
            "cpp": r"TEST\s*\([^,]*,\s*(\w+)",
            "csharp": r"public\s+void\s+Test(\w+)",
            "rust": r"fn\s+test_(\w+)",
            "unknown": r"(?:test|Test)_?(\w+)"
        }
        
        # Use appropriate pattern
        pattern = test_name_patterns.get(language, test_name_patterns["unknown"])
        test_names = re.findall(pattern, test_code)
        
        # Check for descriptive names (longer than 8 chars, and containing underscore or multiple words)
        descriptive_names_count = 0
        for name in test_names:
            if len(name) >= 8 or '_' in name or re.search(r'[A-Z][a-z]', name):
                descriptive_names_count += 1
        
        if test_names:
            metrics["descriptive_names"] = descriptive_names_count / len(test_names)
        else:
            metrics["descriptive_names"] = 0.0
            
        # Check for test organization
        test_org_patterns = {
            "python": r"class\s+\w+Test",
            "javascript": r"describe\s*\(",
            "typescript": r"describe\s*\(",
            "java": r"(?:public|private)\s+class\s+\w+Test",
            "cpp": r"TEST_F\s*\(",
            "csharp": r"public\s+class\s+\w+Test",
            "rust": r"mod\s+tests",
            "unknown": r"(?:class|describe|module)\s+\w+"
        }
        
        # Use appropriate pattern
        pattern = test_org_patterns.get(language, test_org_patterns["unknown"])
        metrics["organized"] = re.search(pattern, test_code) is not None
        
        # Check average line length (too long is hard to read)
        avg_line_length = sum(len(line) for line in lines) / total_lines
        metrics["avg_line_length"] = avg_line_length
        line_length_score = max(0.0, min(1.0, 2.0 - (avg_line_length / 80)))
        
        # Check for consistent indentation
        indent_sizes = []
        for line in lines:
            if line.strip() and not line.isspace():
                leading_spaces = len(line) - len(line.lstrip())
                indent_sizes.append(leading_spaces)
        
        if indent_sizes:
            # Calculate the mode (most common indent size)
            from collections import Counter
            indent_counter = Counter(indent_sizes)
            mode_indent = indent_counter.most_common(1)[0][0]
            
            # Calculate the percentage of lines with consistent indentation
            consistent_lines = sum(1 for size in indent_sizes if size % mode_indent == 0)
            metrics["indent_consistency"] = consistent_lines / len(indent_sizes)
        else:
            metrics["indent_consistency"] = 1.0
        
        # Calculate overall readability score
        comment_score = min(1.0, metrics["comment_ratio"] * 5)  # Aim for ~20% comments
        
        readability_score = (
            comment_score * 0.25 +
            metrics.get("descriptive_names", 0.0) * 0.25 +
            (1.0 if metrics["organized"] else 0.0) * 0.2 +
            line_length_score * 0.15 +
            metrics.get("indent_consistency", 0.0) * 0.15
        )
        
        return {
            "score": readability_score,
            "metrics": metrics
        }
        
    def _calculate_test_isolation(self, test_code: str, language: str = "unknown") -> Dict[str, Any]:
        """
        Calculate how well tests are isolated from each other.
        
        Args:
            test_code: The test code
            language: Programming language
            
        Returns:
            Dictionary with test isolation score and related metrics
        """
        # Initialize metrics
        metrics = {
            "has_setup_teardown": False,
            "has_reset_between_tests": False,
            "shared_state_detected": False,
            "global_variables": False,
            "individual_test_fixtures": False
        }
        
        # Check for setup/teardown patterns
        setup_teardown_patterns = {
            "python": [r"def\s+setUp", r"def\s+tearDown", r"@pytest.fixture"],
            "javascript": [r"beforeEach", r"afterEach", r"beforeAll", r"afterAll"],
            "typescript": [r"beforeEach", r"afterEach", r"beforeAll", r"afterAll"],
            "java": [r"@Before", r"@After", r"@BeforeClass", r"@AfterClass"],
            "cpp": [r"SetUp\(\)", r"TearDown\(\)", r"TEST_F"],
            "csharp": [r"\[SetUp\]", r"\[TearDown\]"],
            "rust": [r"#\[fixture\]", r"mod\s+tests\s*\{"],
            "unknown": [r"(?:setup|teardown|before|after)"]
        }
        
        # Use appropriate patterns
        patterns = setup_teardown_patterns.get(language, setup_teardown_patterns["unknown"])
        metrics["has_setup_teardown"] = any(re.search(pattern, test_code, re.IGNORECASE) for pattern in patterns)
        
        # Check for reset patterns
        reset_patterns = [r"(?:reset|clear|clean|new)", r"mock\w*\.reset", r"restore"]
        metrics["has_reset_between_tests"] = any(re.search(pattern, test_code, re.IGNORECASE) for pattern in reset_patterns)
        
        # Check for shared state indicators
        shared_state_patterns = [
            r"static\s+\w+\s*=", 
            r"let\s+\w+\s*=.+;\s*(?:\n[^\n]*){2,}\s*\w+\s*=", 
            r"var\s+\w+\s*=.+;\s*(?:\n[^\n]*){2,}\s*\w+\s*=",
            r"(?:global|nonlocal)\s+\w+"
        ]
        metrics["shared_state_detected"] = any(re.search(pattern, test_code, re.MULTILINE) for pattern in shared_state_patterns)
        
        # Check for global variables
        global_patterns = {
            "python": [r"(?:^|\s)global\s+", r"(?:^|\s)\w+\s*=\s*(?!\s*(?:function|def|class))"],
            "javascript": [r"(?:var|let|const)\s+\w+\s*=.+;\s*(?:\n[^\n]*\n)[^\n]*\s*\w+\s*="],
            "typescript": [r"(?:var|let|const)\s+\w+\s*=.+;\s*(?:\n[^\n]*\n)[^\n]*\s*\w+\s*="],
            "java": [r"(?:static|public static|private static)\s+\w+\s+\w+\s*="],
            "cpp": [r"(?:static|extern)\s+\w+\s+\w+\s*="],
            "unknown": [r"(?:global|static|var|let|const)\s+\w+\s*="]
        }
        
        # Use appropriate patterns
        patterns = global_patterns.get(language, global_patterns["unknown"])
        metrics["global_variables"] = any(re.search(pattern, test_code, re.MULTILINE) for pattern in patterns)
        
        # Check for individual test fixtures/contexts
        fixture_patterns = {
            "python": [r"@pytest.fixture\s*def\s+\w+"],
            "javascript": [r"describe\([^)]+,\s*function\s*\(\)\s*{[^}]*beforeEach"],
            "java": [r"@Rule\s+public\s+\w+"],
            "cpp": [r"class\s+\w+\s*:\s*public\s+::testing::Test"],
            "unknown": [r"(?:fixture|context|describe|suite)"]
        }
        
        # Use appropriate patterns
        patterns = fixture_patterns.get(language, fixture_patterns["unknown"])
        metrics["individual_test_fixtures"] = any(re.search(pattern, test_code, re.IGNORECASE) for pattern in patterns)
        
        # Calculate score
        isolation_score = 0.0
        
        # Good practices increase score
        if metrics["has_setup_teardown"]:
            isolation_score += 0.3
        if metrics["has_reset_between_tests"]:
            isolation_score += 0.3
        if metrics["individual_test_fixtures"]:
            isolation_score += 0.2
            
        # Bad practices decrease score
        if metrics["shared_state_detected"]:
            isolation_score -= 0.3
        if metrics["global_variables"]:
            isolation_score -= 0.2
            
        # Ensure score is in valid range
        isolation_score = min(1.0, max(0.0, isolation_score + 0.5))  # Base of 0.5
        
        return {
            "score": isolation_score,
            "metrics": metrics
        }
    
    def _calculate_task_alignment(self, test_code: str, task_description: str) -> Dict[str, Any]:
        """
        Calculate how well tests align with the task description.
        
        Args:
            test_code: The test code
            task_description: The description of the task
            
        Returns:
            Dictionary with task alignment score and related metrics
        """
        if not task_description:
            return {"score": 0.7, "metrics": {"no_task_description": True}}
            
        # Extract key terms from task description
        # Simple extraction - real implementation would use NLP
        task_terms = set(re.findall(r'\b\w{3,}\b', task_description.lower()))
        
        # Remove common words
        common_words = {
            'the', 'and', 'for', 'with', 'that', 'this', 
            'implement', 'create', 'function', 'code', 'test',
            'should', 'would', 'could', 'must', 'may', 'might'
        }
        task_terms = {term for term in task_terms if term not in common_words}
        
        # Calculate how many terms from the task appear in the tests
        matched_terms = 0
        for term in task_terms:
            if re.search(rf'\b{re.escape(term)}\b', test_code, re.IGNORECASE):
                matched_terms += 1
                
        # Calculate alignment score
        if not task_terms:
            alignment_score = 0.7  # Default when no significant terms found
        else:
            alignment_score = min(1.0, matched_terms / len(task_terms) + 0.2)  # Add small bonus
            
        # Check for explicit task requirement testing
        req_indicators = ["requirement", "requirement_", "req_", "task_", "story_", "user_story"]
        has_req_indicators = any(re.search(rf'\b{re.escape(ind)}', test_code, re.IGNORECASE) for ind in req_indicators)
        
        if has_req_indicators:
            alignment_score = min(1.0, alignment_score + 0.1)
            
        return {
            "score": alignment_score,
            "metrics": {
                "task_terms": len(task_terms),
                "matched_terms": matched_terms,
                "req_indicators": has_req_indicators
            }
        }
        
    def _calculate_overall_quality(self, scores: List[float]) -> float:
        """
        Calculate overall test quality from component scores.
        
        Args:
            scores: List of component scores
            
        Returns:
            Overall quality score from 0.0 to 1.0
        """
        if not scores:
            return 0.0
        
        # Different weights for different metrics based on importance
        # Weights for: completeness, variety, edge_cases, assertions, readability, isolation, task_alignment
        weights = [0.20, 0.15, 0.20, 0.15, 0.10, 0.10, 0.10]
        
        # Ensure we have the right number of weights
        if len(weights) != len(scores):
            weights = [1.0 / len(scores)] * len(scores)
            
        # Calculate weighted average
        overall = sum(score * weight for score, weight in zip(scores, weights))
        
        return min(1.0, max(0.0, overall))

def evaluate_test_quality(test_code: str, task_description: str = None,
                         source_code: str = None, language: str = None) -> Dict[str, Any]:
    """
    Evaluate the quality of test code using various metrics.
    
    Args:
        test_code: The test code to evaluate
        task_description: Optional task description for relevance assessment
        source_code: Optional source code being tested
        language: Optional programming language for language-specific analysis
        
    Returns:
        Dictionary containing test quality metrics
    """
    evaluator = TestQualityMetrics()
    return evaluator.evaluate_test_quality(test_code, task_description, source_code, language)
