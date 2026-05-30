"""Quick LSP smoke probe for python-lsp-server (pylsp).

Try the following in the editor once this file is open:

1. Hover over `numbers`, `total`, `multiply_by`, `Greeter`, `greet` —
   each should show its inferred type / signature.
2. Ctrl-Click (or F12) on `multiply_by` inside `compute_total` to jump
   to its definition.
3. Shift+F12 on `greet` to see references.
4. The line marked `# TYPE ERROR` should get a pylsp diagnostic
   (pylsp ships with pyflakes / pycodestyle by default; the call passes
   a string to a parameter typed as `int`).
"""

from dataclasses import dataclass


def multiply_by(value: int, factor: int) -> int:
    return value * factor


def compute_total(numbers: list[int], factor: int) -> int:
    total = 0
    for n in numbers:
        total += multiply_by(n, factor)
    return total


@dataclass
class Greeter:
    name: str

    def greet(self) -> str:
        return f"Hello, {self.name}!"


if __name__ == "__main__":
    print(compute_total([1, 2, 3], 4))
    print(Greeter("Vue").greet())
    # TYPE ERROR: passing a string where an int is expected.
    print(multiply_by("not a number", 2))
