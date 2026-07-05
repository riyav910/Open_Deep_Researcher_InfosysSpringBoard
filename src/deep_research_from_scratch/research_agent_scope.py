
"""User Clarification and Research Brief Generation.

This module implements the scoping phase of the research workflow, where we:
1. Assess if the user's request needs clarification
2. Generate a detailed research brief from the conversation

The workflow uses structured output to make deterministic decisions about
whether sufficient context exists to proceed with research.
"""

from datetime import datetime
from typing_extensions import Literal

from langchain.chat_models import init_chat_model
from langchain_core.messages import HumanMessage, AIMessage, get_buffer_string
from langgraph.graph import StateGraph, START, END
from langgraph.types import Command

from deep_research_from_scratch.prompts import clarify_with_user_instructions, transform_messages_into_research_topic_prompt
from deep_research_from_scratch.state_scope import AgentState, ClarifyWithUser, ResearchQuestion, AgentInputState

# ===== UTILITY FUNCTIONS =====

def get_today_str() -> str:
    """Get current date in a human-readable format."""
    return datetime.now().strftime("%a %b %-d, %Y")

# ===== CONFIGURATION =====

# Initialize model - Primary: Google Gemini | Alternatives: "openai:gpt-4.1", "anthropic:claude-sonnet-4-20250514"

model = init_chat_model(
    model="gemini-3.1-flash-lite",
    model_provider="google_genai",
    temperature=0.0
)

# ===== WORKFLOW NODES =====

def clarify_with_user(state: AgentState) -> Command[Literal["write_research_brief", "__end__"]]:
    """
    Determine if the user's request contains sufficient information to proceed with research.

    Uses structured output to make deterministic decisions and avoid hallucination.
    Routes to either research brief generation or ends with a clarification question.
    """
    import json
    # Set up structured output model
    structured_output_model = model.with_structured_output(ClarifyWithUser)

    prompt_content = clarify_with_user_instructions.format(
        messages=get_buffer_string(messages=state["messages"]), 
        date=get_today_str()
    )

    # Invoke the model with clarification instructions
    try:
        response = structured_output_model.invoke([
            HumanMessage(content=prompt_content)
        ])
    except Exception:
        response = None

    # Fallback to manual JSON parsing if Pydantic parsing fails/returns None
    if response is None:
        try:
            raw_response = model.invoke([
                HumanMessage(content=prompt_content)
            ])
            content = raw_response.content
            if isinstance(content, list):
                parts = []
                for part in content:
                    if isinstance(part, str):
                        parts.append(part)
                    elif hasattr(part, "text"):
                        parts.append(part.text)
                    elif isinstance(part, dict) and "text" in part:
                        parts.append(part["text"])
                    elif hasattr(part, "get"):
                        parts.append(part.get("text", ""))
                content = "".join(parts)
            if isinstance(content, str) and "{" in content:
                json_str = content[content.find("{"):content.rfind("}")+1]
                data = json.loads(json_str)
                response = ClarifyWithUser(
                    need_clarification=data.get("need_clarification", True),
                    question=data.get("question", "Could you please clarify your request?"),
                    verification=data.get("verification", "")
                )
        except Exception:
            pass

    # Ultimate safe fallback
    if response is None:
        import traceback
        tb = traceback.format_exc()
        # Clean up traceback to make it fit in standard string format
        tb_clean = tb.replace('\n', ' | ').replace('"', "'")
        error_msg = f"Could you please provide more details about your research request? (Diagnostic Error: {tb_clean[-200:]})"
        response = ClarifyWithUser(
            need_clarification=True,
            question=error_msg,
            verification=""
        )

    # Route based on clarification need
    if response.need_clarification:
        return Command(
            goto=END, 
            update={"messages": [AIMessage(content=response.question)]}
        )
    else:
        return Command(
            goto="write_research_brief", 
            update={"messages": [AIMessage(content=response.verification)]}
        )

def write_research_brief(state: AgentState):
    """
    Transform the conversation history into a comprehensive research brief.

    Uses structured output to ensure the brief follows the required format
    and contains all necessary details for effective research.
    """
    import json
    # Set up structured output model
    structured_output_model = model.with_structured_output(ResearchQuestion)

    prompt_content = transform_messages_into_research_topic_prompt.format(
        messages=get_buffer_string(state.get("messages", [])),
        date=get_today_str()
    )

    # Generate research brief from conversation history
    try:
        response = structured_output_model.invoke([
            HumanMessage(content=prompt_content)
        ])
    except Exception:
        response = None

    # Fallback to manual JSON parsing if Pydantic parsing fails/returns None
    if response is None:
        try:
            raw_response = model.invoke([
                HumanMessage(content=prompt_content)
            ])
            content = raw_response.content
            if isinstance(content, list):
                parts = []
                for part in content:
                    if isinstance(part, str):
                        parts.append(part)
                    elif hasattr(part, "text"):
                        parts.append(part.text)
                    elif isinstance(part, dict) and "text" in part:
                        parts.append(part["text"])
                    elif hasattr(part, "get"):
                        parts.append(part.get("text", ""))
                content = "".join(parts)
            if isinstance(content, str) and "{" in content:
                json_str = content[content.find("{"):content.rfind("}")+1]
                data = json.loads(json_str)
                response = ResearchQuestion(
                    research_brief=data.get("research_brief", "Research on requested topic")
                )
        except Exception:
            pass

    # Ultimate safe fallback
    if response is None:
        response = ResearchQuestion(
            research_brief="Research on requested topic"
        )

    # Update state with generated research brief and pass it to the supervisor
    return {
        "research_brief": response.research_brief,
        "supervisor_messages": [HumanMessage(content=f"{response.research_brief}.")]
    }

# ===== GRAPH CONSTRUCTION =====

# Build the scoping workflow
deep_researcher_builder = StateGraph(AgentState, input_schema=AgentInputState)

# Add workflow nodes
deep_researcher_builder.add_node("clarify_with_user", clarify_with_user)
deep_researcher_builder.add_node("write_research_brief", write_research_brief)

# Add workflow edges
deep_researcher_builder.add_edge(START, "clarify_with_user")
deep_researcher_builder.add_edge("write_research_brief", END)

# Compile the workflow
scope_research = deep_researcher_builder.compile()
