"""
AI Development Monitor Agent

This module implements an agent that connects to an LLM to oversee the development process,
verify code, detect hallucinations, and prevent recursive behaviors.
"""
import os
import json
import logging
import requests
import datetime
from typing import Dict, List, Optional, Union, Any, Tuple

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


class DevelopmentMonitorAgent:
    """
    An agent that monitors AI-assisted development to detect and prevent issues
    such as hallucinations and recursive behaviors.
    """

    def __init__(self, config_path: Optional[str] = None):
        """
        Initialize the development monitor agent.

        Args:
            config_path: Path to the configuration file. If None, default config is used.
        """
        self.config = self._load_config(config_path)
        self.llm_context_window = int(self.config.get("llm_context_window", 8192))
        self.llm_client = None
        self.development_context = {}
        self.verification_history = []
        logger.info("Development Monitor Agent initialized")

    def _load_config(self, config_path: Optional[str]) -> Dict[str, Any]:
        """
        Load configuration from a file or use default configuration.

        Args:
            config_path: Path to the configuration file.

        Returns:
            Configuration dictionary.
        """
        default_config = {
            "llm_api_endpoint": os.environ.get("LLM_API_ENDPOINT", "http://localhost:11434"),
            "ollama_model": os.environ.get("OLLAMA_MODEL", "deepcoder:14b"),
            "llm_api_key": os.environ.get("LLM_API_KEY", ""),
            "verification_threshold": 0.8,
            "max_recursive_depth": 3,
            "log_level": "INFO"
        }

        if config_path and os.path.exists(config_path):
            try:
                with open(config_path, 'r') as f:
                    config = json.load(f)
                    return {**default_config, **config}
            except Exception as e:
                logger.error(f"Error loading config from {config_path}: {e}")
                return default_config
        
        return default_config

    def connect_llm(self):
        """
        Connect to the LLM service using the configuration settings.
        
        Returns:
            bool: True if connection is successful, False otherwise.
        """
        logger.info("Connecting to Ollama LLM service...")
        
        try:
            # Set up the connection to Ollama
            endpoint = self.config["llm_api_endpoint"]
            model = self.config["ollama_model"]
            
            # Test the connection with a simple request
            url = f"{endpoint}/api/generate"
            headers = {"Content-Type": "application/json"}
            data = {
                "model": model,
                "prompt": "Hello, are you operational?",
                "stream": False
            }
            
            response = requests.post(url, headers=headers, json=data, timeout=10)
            
            if response.status_code == 200:
                logger.info(f"Successfully connected to Ollama using model: {model}")
                self.llm_client = {
                    "endpoint": endpoint,
                    "model": model,
                    "headers": headers
                }
                return True
            else:
                logger.error(f"Failed to connect to Ollama. Status code: {response.status_code}")
                logger.error(f"Response: {response.text}")
                return False
                
        except Exception as e:
            logger.error(f"Error connecting to Ollama LLM: {e}")
            return False

    def monitor_development_process(self, code_snippets: List[str], task_description: str):
        """
        Monitor the development process by analyzing code snippets and task descriptions.
        
        Args:
            code_snippets: List of code snippets to analyze
            task_description: Description of the development task
            
        Returns:
            Dict containing analysis results
        """
        if not self.llm_client:
            logger.warning("LLM client not connected. Connect first with connect_llm()")
            return {"error": "LLM client not connected"}
        
        # Use this method to monitor the ongoing development process
        logger.info("Monitoring development process...")
        
        # Analyze code snippets and task description
        analysis_results = self._analyze_code_snippets(code_snippets, task_description)
        
        # Store results in development context
        self.development_context.update({
            "latest_analysis": analysis_results,
            "task_description": task_description,
        })
        
        return analysis_results
    
    def verify_code(self, code: str, expected_behavior: str) -> Dict[str, Any]:
        """
        Verify code against expected behavior to detect hallucinations.
        
        Args:
            code: Code to verify
            expected_behavior: Description of expected behavior
            
        Returns:
            Verification results
        """
        logger.info("Verifying code against expected behavior...")
        
        # This is where you would send the code to the LLM to verify
        # For now, using a placeholder implementation
        verification_result = {
            "verified": True,
            "confidence": 0.95,
            "issues": [],
            "suggestions": []
        }
        
        # Add to verification history
        self.verification_history.append({
            "code": code,
            "expected_behavior": expected_behavior,
            "result": verification_result,
            "timestamp": "timestamp_here"  # Replace with actual timestamp
        })
        
        return verification_result
    
    def _analyze_code_snippets(self, code_snippets: List[str], task_description: str) -> Dict[str, Any]:
        """
        Analyze code snippets for potential issues.
        
        Args:
            code_snippets: List of code snippets to analyze
            task_description: Description of the development task
            
        Returns:
            Analysis results
        """
        # Placeholder for actual LLM-based analysis
        analysis_results = {
            "hallucination_risk": 0.2,  # Example value
            "recursive_risk": 0.1,     # Example value
            "alignment_score": 0.8,    # How well code aligns with task
            "issues_detected": [],     # List of specific issues
            "recommendations": []      # Recommendations for improvement
        }
        
        return analysis_results
    
    def detect_recursive_behavior(self, execution_trace: List[Dict[str, Any]]) -> Dict[str, Any]:
        """
        Analyze execution trace to detect potential recursive behavior.
        
        Args:
            execution_trace: List of execution steps with relevant metadata
            
        Returns:
            Dict with analysis of recursive behavior risk
        """
        logger.info("Analyzing for recursive behavior...")
        
        # Placeholder implementation
        # In a real implementation, you would analyze the execution trace for patterns
        # that suggest recursive behavior
        
        result = {
            "recursive_behavior_detected": False,
            "risk_level": "low",
            "identified_patterns": [],
            "recommendations": ["Monitor closely if complexity increases"]
        }
        
        return result



    def _truncate_prompt_to_context_window(self, prompt: str) -> str:
        """
        Truncate the prompt to fit within the LLM context window (in tokens).
        This is a simple approximation: 1 token ≈ 4 characters (for English text/code).
        """
        max_tokens = self.llm_context_window
        # Approximate: 1 token ≈ 4 chars (conservative for code)
        max_chars = max_tokens * 4
        if len(prompt) > max_chars:
            logger.warning(f"Prompt length ({len(prompt)} chars) exceeds context window ({max_tokens} tokens, ~{max_chars} chars). Truncating.")
            return prompt[:max_chars]
        return prompt

    def send_prompt_to_llm(self, prompt: str) -> Dict[str, Any]:
        """
        Send a prompt to the connected LLM and get the response.
        Args:
            prompt: The prompt to send to the LLM
        Returns:
            Dict containing the LLM response and metadata
        """
        if not self.llm_client:
            logger.warning("LLM client not connected. Connect first with connect_llm()")
            return {"error": "LLM client not connected"}

        import time
        import psutil
        logger.info("Sending prompt to Ollama...")
        prompt = self._truncate_prompt_to_context_window(prompt)
        logger.info(f"Prompt content: {prompt}")
        start_time = time.time()
        try:
            url = f"{self.llm_client['endpoint']}/api/generate"
            data = {
                "model": self.llm_client["model"],
                "prompt": prompt,
                "stream": False
            }
            # Set timeout to 180 seconds (3 minutes)
            response = requests.post(url, headers=self.llm_client["headers"], json=data, timeout=180)
            elapsed = time.time() - start_time
            logger.info(f"LLM request completed in {elapsed:.2f} seconds")
            response_data = response.json()
            logger.debug(f"LLM response: {response_data}")
            if response.status_code == 200:
                
                return {
                    "success": True,
                    "response": response_data.get("response", ""),
                    "model": self.llm_client["model"],
                    "metadata": {
                        "eval_count": response_data.get("eval_count", 0),
                        "eval_duration": response_data.get("eval_duration", 0),
                        "llm_request_time": elapsed
                    }
                }
            else:
                # Log system resource usage on error
                cpu = psutil.cpu_percent(interval=0.1)
                mem = psutil.virtual_memory().percent
                logger.error(f"Failed to get response from Ollama. Status code: {response.status_code}")
                logger.error(f"Response: {response.text}")
                logger.error(f"System CPU: {cpu}%, Memory: {mem}% at LLM error time")
                return {
                    "success": False,
                    "error": f"API error: {response.status_code}",
                    "response": response.text,
                    "llm_request_time": elapsed,
                    "system_cpu": cpu,
                    "system_mem": mem
                }
        except Exception as e:
            elapsed = time.time() - start_time
            cpu = psutil.cpu_percent(interval=0.1)
            mem = psutil.virtual_memory().percent
            logger.error(f"Error sending prompt to Ollama: {e}")
            logger.error(f"System CPU: {cpu}%, Memory: {mem}% at LLM exception time")
            return {
                "success": False,
                "error": str(e),
                "response": None,
                "llm_request_time": elapsed,
                "system_cpu": cpu,
                "system_mem": mem
            }
    
    def capture_and_analyze_output(self, ai_output: str, expected_behavior: str) -> Dict[str, Any]:
        """
        Capture the AI's output and analyze it for hallucinations or inaccuracies.
        
        Args:
            ai_output: The output from the AI to analyze
            expected_behavior: Description of the expected behavior
            
        Returns:
            Analysis results including confidence score and any detected issues
        """
        logger.info("Capturing and analyzing AI output...")
        
        # Create prompt to analyze the output
        analysis_prompt = f"""
        You are an AI Development Monitor agent. Your task is to analyze the following AI output 
        and check for potential hallucinations, inaccuracies, or recursive behavior.
        
        EXPECTED BEHAVIOR:
        {expected_behavior}
        
        AI OUTPUT:
        {ai_output}
        
        Please analyze the output for:
        1. Hallucinations: Facts, claims, or code that is incorrect or made up
        2. Inconsistencies: Conflicting statements or logic
        3. Recursive patterns: Signs of circular reasoning or infinite loops
        4. Alignment: How well the output matches the expected behavior
        
        Provide your analysis in JSON format with the following structure:
        {{
            "hallucination_risk": float between 0 and 1,
            "inconsistency_risk": float between 0 and 1,
            "recursive_risk": float between 0 and 1,
            "alignment_score": float between 0 and 1,
            "issues_detected": [list of specific issues found],
            "recommendations": [list of recommendations to improve the output]
        }}
        
        Return only the JSON, no explanation or other text.
        """
        
        # Send analysis prompt to LLM
        analysis_response = self.send_prompt_to_llm(analysis_prompt)
        
        if not analysis_response.get("success", False):
            logger.error("Failed to analyze AI output")
            return {
                "success": False,
                "error": analysis_response.get("error", "Unknown error during analysis"),
                "timestamp": datetime.datetime.now().isoformat()
            }
        
        # Parse the analysis response
        try:
            # Try to extract JSON from text response (in case LLM added additional text)
            response_text = analysis_response["response"]
            
            # Simple JSON extraction using string markers (can be improved)
            if '{' in response_text and '}' in response_text:
                start_idx = response_text.find('{')
                end_idx = response_text.rfind('}') + 1
                json_str = response_text[start_idx:end_idx]
                analysis = json.loads(json_str)
            else:
                # Attempt to parse the whole response
                analysis = json.loads(response_text)
                
            # Add timestamp and metadata
            analysis["timestamp"] = datetime.datetime.now().isoformat()
            analysis["success"] = True
            
            # Store in verification history
            self.verification_history.append({
                "output": ai_output,
                "expected_behavior": expected_behavior,
                "analysis": analysis,
                "timestamp": analysis["timestamp"]
            })
            
            return analysis
            
        except json.JSONDecodeError as e:
            logger.error(f"Failed to parse analysis result: {e}")
            logger.error(f"Raw response: {analysis_response['response']}")
            return {
                "success": False,
                "error": f"JSON decode error: {e}",
                "raw_response": analysis_response["response"],
                "timestamp": datetime.datetime.now().isoformat()
            }
        except Exception as e:
            logger.error(f"Error processing analysis: {e}")
            return {
                "success": False,
                "error": str(e),
                "timestamp": datetime.datetime.now().isoformat()
            }
    
    def evaluate_proposed_changes(self, original_code: str, proposed_changes: str, 
                                task_description: str) -> Tuple[bool, Dict[str, Any]]:
        """
        Evaluate proposed code changes to determine if they should be accepted or rejected.
        
        Args:
            original_code: The original code before changes
            proposed_changes: The proposed changes to evaluate
            task_description: Description of the development task
            
        Returns:
            Tuple of (accept_changes: bool, evaluation_results: Dict)
        """
        logger.info("Evaluating proposed code changes...")
        
        # First analyze the proposed changes
        analysis = self.capture_and_analyze_output(proposed_changes, task_description)
        
        if not analysis.get("success", False):
            logger.error("Failed to analyze proposed changes")
            return False, analysis
        
        # Decision logic based on analysis results
        hallucination_risk = analysis.get("hallucination_risk", 1.0)
        recursive_risk = analysis.get("recursive_risk", 1.0)
        alignment_score = analysis.get("alignment_score", 0.0)
        verification_threshold = self.config.get("verification_threshold", 0.8)
        
        # Simple decision rule (can be made more sophisticated)
        accept_changes = (
            hallucination_risk < 0.3 and
            recursive_risk < 0.3 and
            alignment_score >= verification_threshold
        )
        
        evaluation_result = {
            "accept_changes": accept_changes,
            "analysis": analysis,
            "original_code": original_code,
            "proposed_changes": proposed_changes,
            "task_description": task_description,
            "timestamp": datetime.datetime.now().isoformat(),
            "reason": "Automated evaluation based on analysis results"
        }
        logger.info(f"Evaluation result: {evaluation_result}")
        
        # Log the decision
        if accept_changes:
            logger.info("Proposed changes ACCEPTED")
        else:
            logger.warning("Proposed changes REJECTED")
            issues = analysis.get("issues_detected", ["Unknown issues"])
            logger.warning(f"Issues detected: {issues}")
        
        return accept_changes, evaluation_result


# Example usage
if __name__ == "__main__":
    # Example of how to use the agent
    agent = DevelopmentMonitorAgent()
    
    if agent.connect_llm():
        print("Successfully connected to LLM!")
        
        # Example task and code snippet
        task = "Create a function to calculate the factorial of a number"
        code = """
        def factorial(n):
            if n <= 1:
                return 1
            return n * factorial(n-1)
        """
        
        # Monitor development
        results = agent.monitor_development_process([code], task)
        print(f"Analysis results: {results}")
        
        # Verify code
        verification = agent.verify_code(code, task)
        print(f"Verification results: {verification}")
    else:
        print("Failed to connect to LLM. Check your configuration.")
