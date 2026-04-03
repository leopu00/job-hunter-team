"""Provider abstraction layer — interfaccia unificata per Claude, OpenAI, Minimax.

Usa credential_manager per la risoluzione delle API key.

Uso:
    from shared.llm import get_provider

    llm = get_provider("claude")
    risposta = llm.complete("Ciao, come stai?")
    print(risposta.content)
"""

from shared.llm.base import LLMProvider, CompletionResponse, ProviderError
from shared.llm.factory import get_provider, get_default_provider, list_available_providers
