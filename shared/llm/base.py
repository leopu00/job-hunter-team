"""Interfaccia astratta per i provider LLM.

Definisce il contratto che ogni provider (Claude, OpenAI, Minimax) deve rispettare.
"""

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Iterator, Optional


class ProviderError(Exception):
    """Errore generico del provider LLM."""

    def __init__(self, message: str, provider: str = "", status_code: int = 0):
        self.provider = provider
        self.status_code = status_code
        super().__init__(message)


@dataclass
class CompletionResponse:
    """Risposta unificata da qualsiasi provider."""
    content: str
    model: str
    provider: str
    usage: dict = field(default_factory=dict)
    finish_reason: str = ""
    raw: Optional[dict] = None


@dataclass
class ModelInfo:
    """Metadati di un modello disponibile."""
    id: str
    name: str
    provider: str
    context_window: int = 0
    max_output_tokens: int = 0
    supports_vision: bool = False
    supports_tools: bool = False


class LLMProvider(ABC):
    """Interfaccia base per tutti i provider LLM.

    Ogni provider concreto deve implementare complete() e stream().
    Il provider ID viene normalizzato (es. "anthropic" -> "claude").
    """

    provider_id: str = ""

    @abstractmethod
    def complete(
        self,
        prompt: str,
        *,
        model: Optional[str] = None,
        system: Optional[str] = None,
        temperature: float = 0.7,
        max_tokens: int = 4096,
    ) -> CompletionResponse:
        """Chiamata sincrona al modello. Restituisce la risposta completa."""
        ...

    @abstractmethod
    def stream(
        self,
        prompt: str,
        *,
        model: Optional[str] = None,
        system: Optional[str] = None,
        temperature: float = 0.7,
        max_tokens: int = 4096,
    ) -> Iterator[str]:
        """Chiamata in streaming. Yield di chunk di testo."""
        ...

    @abstractmethod
    def list_models(self) -> list[ModelInfo]:
        """Restituisce i modelli disponibili per questo provider."""
        ...

    def get_default_model(self) -> str:
        """Restituisce il modello di default per questo provider."""
        models = self.list_models()
        return models[0].id if models else ""

    def __repr__(self) -> str:
        return f"<{self.__class__.__name__} provider_id={self.provider_id!r}>"
