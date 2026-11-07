"""Late-bound dependencies for modules extracted from long-running supervisors."""


class Context:
    def __init__(self, namespace):
        object.__setattr__(self, "_namespace", namespace)

    def __getattr__(self, name):
        try:
            return self._namespace[name]
        except KeyError as error:
            raise AttributeError(name) from error

    def __setattr__(self, name, value):
        self._namespace[name] = value
