from google.adk.a2a.utils.agent_to_a2a import to_a2a

from app.agent import root_agent

app = to_a2a(root_agent, host="localhost", port=8001)
