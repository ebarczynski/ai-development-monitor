
# Test MCP protocol compliance for all message types
import pytest
import uuid
import sys
import os

# Ensure src/ is in the Python path for imports
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '../src')))
from mcp_server import MCPMessage, MCPContext, MCPSuggestion, MCPEvaluation, MCPContinueRequest, MCPTDDRequest

def make_context():
    return MCPContext(
        conversation_id=str(uuid.uuid4()),
        message_id=str(uuid.uuid4()),
        parent_id=None,
        metadata={}
    )

def test_suggestion_message():
    content = MCPSuggestion(
        original_code="def foo(): pass",
        proposed_changes="def foo(): return 1",
        file_path="foo.py",
        language="python",
        task_description="Implement foo function"
    )
    msg = MCPMessage(context=make_context(), message_type="suggestion", content=content)
    assert msg.context.conversation_id
    assert msg.message_type == "suggestion"
    assert msg.content.original_code.startswith("def foo")

def test_evaluation_message():
    content = MCPEvaluation(
        accept=True,
        hallucination_risk=0.1,
        recursive_risk=0.0,
        alignment_score=1.0,
        issues_detected=[],
        recommendations=["Looks good"],
        reason="All tests pass"
    )
    msg = MCPMessage(context=make_context(), message_type="evaluation", content=content)
    assert msg.context.message_id
    assert msg.message_type == "evaluation"
    assert msg.content.accept is True

def test_continue_message():
    content = MCPContinueRequest(
        prompt="Continue to iterate?",
        timeout_occurred=True,
        error_message=None
    )
    msg = MCPMessage(context=make_context(), message_type="continue", content=content)
    assert msg.message_type == "continue"
    assert msg.content.prompt == "Continue to iterate?"

def test_tdd_request_message():
    content = MCPTDDRequest(
        code="def bar(): pass",
        language="python",
        iteration=1
    )
    msg = MCPMessage(context=make_context(), message_type="tdd_request", content=content)
    assert msg.message_type == "tdd_request"
    assert msg.content.language == "python"
# Test MCP protocol compliance for all message types
import pytest
import uuid
from src.mcp_server import MCPMessage, MCPContext, MCPSuggestion, MCPEvaluation, MCPContinueRequest, MCPTDDRequest

def make_context():
    return MCPContext(
        conversation_id=str(uuid.uuid4()),
        message_id=str(uuid.uuid4()),
        parent_id=None,
        metadata={}
    )

def test_suggestion_message():
    content = MCPSuggestion(
        original_code="def foo(): pass",
        proposed_changes="def foo(): return 1",
        file_path="foo.py",
        language="python",
        task_description="Implement foo function"
    )
    msg = MCPMessage(context=make_context(), message_type="suggestion", content=content)
    assert msg.context.conversation_id
    assert msg.message_type == "suggestion"
    assert msg.content.original_code.startswith("def foo")

def test_evaluation_message():
    content = MCPEvaluation(
        accept=True,
        hallucination_risk=0.1,
        recursive_risk=0.0,
        alignment_score=1.0,
        issues_detected=[],
        recommendations=["Looks good"],
        reason="All tests pass"
    )
    msg = MCPMessage(context=make_context(), message_type="evaluation", content=content)
    assert msg.context.message_id
    assert msg.message_type == "evaluation"
    assert msg.content.accept is True

def test_continue_message():
    content = MCPContinueRequest(
        prompt="Continue to iterate?",
        timeout_occurred=True,
        error_message=None
    )
    msg = MCPMessage(context=make_context(), message_type="continue", content=content)
    assert msg.message_type == "continue"
    assert msg.content.prompt == "Continue to iterate?"

def test_tdd_request_message():
    content = MCPTDDRequest(
        code="def bar(): pass",
        language="python",
        iteration=1
    )
    msg = MCPMessage(context=make_context(), message_type="tdd_request", content=content)
    assert msg.message_type == "tdd_request"
    assert msg.content.language == "python"
